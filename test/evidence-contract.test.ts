import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { validateEvidenceEntry } from '../src/evidence-contract.ts';
import { appendEvidence, readRecentEvidence } from '../src/evidence.ts';

function evidenceFile(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-evidence-contract-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'evidence.jsonl');
}

test('rejects an Evidence entry without required tenant and business context', () => {
  assert.throws(
    () => validateEvidenceEntry({
      event_id: 'event-1',
      occurred_at: '2026-10-09T00:00:00.000Z',
      kind: 'app_event',
      source_system: 'aeos-hub',
      correlation_id: 'corr-1',
      version: '1.0',
      evidence_refs: [],
      payload_hash: '0'.repeat(64),
    }),
    /tenant_id|object_ref/,
  );
});

test('writes a complete, traceable Evidence entry', async (t) => {
  const file = evidenceFile(t);
  const entry = appendEvidence({
    kind: 'app_event',
    tenant_id: 'tenant-a',
    object_ref: 'business://order/SO-1001',
    source_system: 'company-control',
    correlation_id: 'case-1001',
    version: '1.0',
    evidence_refs: ['control-platform://order/SO-1001@2026-10-09T00:00:00Z'],
    payload: { orderNo: 'SO-1001', state: 'risk_detected' },
  }, file);

  assert.equal(entry.tenant_id, 'tenant-a');
  assert.equal(entry.object_ref, 'business://order/SO-1001');
  assert.equal(entry.correlation_id, 'case-1001');
  assert.equal(entry.evidence_refs.length, 1);
  assert.match(entry.payload_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).payload_hash, entry.payload_hash);

  const recent = await readRecentEvidence(1, file);
  assert.equal(recent.rows[0]?.object_ref, 'business://order/SO-1001');
});

test('stores a typed actor identity and filters Evidence without excluding legacy events', async (t) => {
  const file = evidenceFile(t);
  appendEvidence({
    kind: 'authentication_audit', tenant_id: 'tenant-a', object_ref: 'hub://identity/m01/tenant-a/user-a',
    actor_id: 'm01:user:user-a', actor_type: 'human', payload: { outcome: 'login_succeeded' },
  }, file);
  appendEvidence({
    kind: 'app_event', tenant_id: 'tenant-a', object_ref: 'hub://agent/hrm-master',
    actor_id: 'agent:hrm-master', actor_type: 'agent', payload: { action: 'delegated' },
  }, file);
  appendEvidence({ kind: 'app_event', tenant_id: 'tenant-a', object_ref: 'hub://runtime/system', payload: { legacy: true } }, file);

  const human = await readRecentEvidence(10, file, { actorId: 'm01:user:user-a', actorType: 'human' });
  assert.equal(human.rows.length, 1);
  assert.equal(human.rows[0]?.actor_id, 'm01:user:user-a');
  assert.equal(human.rows[0]?.actor_type, 'human');

  const agent = await readRecentEvidence(10, file, { actorType: 'agent' });
  assert.equal(agent.rows.length, 1);
  assert.equal(agent.rows[0]?.actor_id, 'agent:hrm-master');
});

test('rejects incomplete or unsupported typed actor identities', () => {
  const base = {
    event_id: '33333333-3333-4333-8333-333333333333', occurred_at: '2026-10-10T00:00:00.000Z',
    tenant_id: 'tenant-a', object_ref: 'hub://identity/m01', source_system: 'aeos-hub', correlation_id: 'corr-3',
    version: '1.0', kind: 'authentication_audit', evidence_refs: [], payload_hash: '0'.repeat(64),
  };
  assert.throws(() => validateEvidenceEntry({ ...base, actor_id: 'm01:user:user-a' }), /actor_id and actor_type/);
  assert.throws(() => validateEvidenceEntry({ ...base, actor_id: 'm01:user:user-a', actor_type: 'unknown' }), /actor_type/);
});

test('uses a Hub runtime reference for system evidence without fabricating a business object', (t) => {
  const file = evidenceFile(t);
  const entry = appendEvidence({
    kind: 'runtime_verification',
    thread_id: 'thread-1001',
    payload: { status: 'healthy' },
  }, file);

  assert.equal(entry.tenant_id, 'tenant-demo');
  assert.equal(entry.object_ref, 'hub://runtime/thread-1001');
  assert.equal(entry.source_system, 'aeos-hub');
  assert.equal(entry.correlation_id, 'thread-1001');
});

test('normalizes a legacy JSONL entry while preserving its payload and identifiers', async (t) => {
  const file = evidenceFile(t);
  const legacy = {
    event_id: '11111111-1111-4111-8111-111111111111',
    occurred_at: '2026-10-09T00:00:00.000Z',
    kind: 'app_event',
    thread_id: 'legacy-thread',
    payload: { legacy: true },
  };
  writeFileSync(file, `${JSON.stringify(legacy)}\n`, 'utf8');

  const recent = await readRecentEvidence(1, file);
  assert.equal(recent.rows[0]?.event_id, legacy.event_id);
  assert.equal(recent.rows[0]?.tenant_id, 'tenant-demo');
  assert.equal(recent.rows[0]?.object_ref, 'hub://runtime/legacy-thread');
  assert.match(recent.rows[0]?.payload_hash ?? '', /^[a-f0-9]{64}$/);
});

test('filters evidence rows by tenant', async (t) => {
  const file = evidenceFile(t);
  appendEvidence({ kind: 'app_event', tenant_id: 'tenant-a', correlation_id: 'corr-a', payload: { a: 1 } }, file);
  appendEvidence({ kind: 'app_event', tenant_id: 'tenant-b', correlation_id: 'corr-b', payload: { b: 1 } }, file);

  const a = await readRecentEvidence(10, file, { tenantId: 'tenant-a' });
  assert.equal(a.rows.length, 1);
  assert.equal(a.rows[0]?.tenant_id, 'tenant-a');
  assert.equal(a.rows[0]?.correlation_id, 'corr-a');
  const b = await readRecentEvidence(10, file, { tenantId: 'tenant-b' });
  assert.equal(b.rows.length, 1);
  assert.equal(b.rows[0]?.tenant_id, 'tenant-b');
});

test('skips a corrupt JSONL line without hiding a valid Evidence entry', async (t) => {
  const file = evidenceFile(t);
  const valid = {
    event_id: '22222222-2222-4222-8222-222222222222',
    occurred_at: '2026-10-09T00:00:00.000Z',
    kind: 'app_event',
    thread_id: 'valid-thread',
    payload: { valid: true },
  };
  writeFileSync(file, `${JSON.stringify(valid)}\nthis is not json\n`, 'utf8');

  const recent = await readRecentEvidence(10, file);
  assert.equal(recent.rows.length, 1);
  assert.equal(recent.rows[0]?.event_id, valid.event_id);
});

test('retains the original payload hash when a large payload is archived', (t) => {
  const file = evidenceFile(t);
  const entry = appendEvidence({
    kind: 'app_event',
    tenant_id: 'tenant-a',
    object_ref: 'business://order/SO-1002',
    payload: { source: 'x'.repeat(100_001) },
  }, file);

  assert.equal(typeof entry.payload, 'object');
  assert.match(entry.payload_hash, /^[a-f0-9]{64}$/);
  assert.equal((entry.payload as { sha256?: string }).sha256, entry.payload_hash);
});
