import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OaIdentitySynchronizer, OaSyncStateStore, projectOaIdentity, type OaIdentityRecord } from '../src/oa-identity-sync.ts';
test('normalizes OA identity records without credentials or browser scope', () => {
  const projection = projectOaIdentity({ externalEmployeeId: 'E-100', displayName: '张三', tenantId: 'tenant-demo', organizationId: 'org-demo', departmentId: 'D-1', active: true, updatedAt: '2026-10-12T00:00:00.000Z' }, '2026-10-12T01:00:00.000Z');
  assert.equal(projection.source, 'oa');
  assert.equal(projection.externalEmployeeId, 'E-100');
  assert.equal(projection.syncedAt, '2026-10-12T01:00:00.000Z');
});
test('rejects missing immutable employee identifiers', () => {
  assert.throws(() => projectOaIdentity({ displayName: '张三', tenantId: 'tenant-demo', organizationId: 'org-demo', active: true, updatedAt: '2026-10-12T00:00:00.000Z' }));
});

test('advances a persisted cursor only after a fully successful batch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-oa-sync-'));
  try {
    const state = new OaSyncStateStore(join(directory, 'state.json'));
    const rows: OaIdentityRecord[] = [
      { externalEmployeeId: 'E-1', displayName: '张三', tenantId: 't', organizationId: 'o', active: true, updatedAt: '2026-10-12T01:00:00.000Z' },
      { externalEmployeeId: 'E-2', displayName: '李四', tenantId: 't', organizationId: 'o', active: false, updatedAt: '2026-10-12T02:00:00.000Z' },
    ];
    const applied: OaIdentityRecord[] = [];
    const synchronizer = new OaIdentitySynchronizer({
      source: { async *listInitial() { yield* rows; }, async *listChanges() { yield* rows; } },
      target: { async upsertSyncedUser(record) { applied.push(record); } }, state, now: () => '2026-10-12T03:00:00.000Z',
    });
    const result = await synchronizer.run('initial');
    assert.equal(result.status, 'succeeded');
    assert.equal(result.processed, 2);
    assert.match(result.cursor?.value || '', /E-2$/);
    assert.equal(state.load().cursor?.value, result.cursor?.value);
    assert.equal(applied[1]?.active, false, 'inactive rows are projected, never interpreted as deletion');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('keeps the last good cursor when the OA source is unavailable or malformed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-oa-sync-'));
  try {
    const state = new OaSyncStateStore(join(directory, 'state.json'));
    state.save({ version: 1, status: 'succeeded', cursor: { value: 'old', updatedAt: '2026-10-12T00:00:00.000Z' }, lastSuccessAt: '2026-10-12T00:00:00.000Z', processed: 3 });
    let applied = 0;
    const synchronizer = new OaIdentitySynchronizer({
      source: { async *listInitial() { throw new Error('database unavailable'); }, async *listChanges() { throw new Error('database unavailable'); } },
      target: { async upsertSyncedUser() { applied += 1; } }, state, now: () => '2026-10-12T04:00:00.000Z',
    });
    const result = await synchronizer.run();
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'SOURCE_UNAVAILABLE');
    assert.equal(result.cursor?.value, 'old');
    assert.equal(applied, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
