import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createExecutionPolicyAuditor, type ExecutionPolicyFileSpec } from '../src/execution-policy-audit.ts';
import type { EvidenceInput } from '../src/evidence.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'policy-audit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const allowlist = join(dir, 'allowlist.json');
  const routing = join(dir, 'routing.json');
  writeFileSync(allowlist, '{"revision":1}');
  writeFileSync(routing, '{"revision":1}');
  const files: ExecutionPolicyFileSpec[] = [
    { name: 'agent-allowlist', file: allowlist, revision: () => 1 },
    { name: 'routing-policy', file: routing, revision: () => 2 },
  ];
  const events: EvidenceInput[] = [];
  const auditor = createExecutionPolicyAuditor({
    files,
    appendEvidence: (entry) => { events.push(entry); return entry; },
    clock: () => new Date('2026-10-26T07:00:00.000Z'),
  });
  return { dir, allowlist, routing, events, auditor };
}

test('首次检查只建基线，不写审计', (t) => {
  const { events, auditor } = fixture(t);
  auditor.check();
  assert.equal(events.length, 0);
});

test('配置内容变化时写一条 evidence，重复检查不重复写', (t) => {
  const { allowlist, events, auditor } = fixture(t);
  auditor.check();
  writeFileSync(allowlist, '{"revision":2}');
  auditor.check();
  assert.equal(events.length, 1);
  const entry = events[0]!;
  assert.equal(entry.correlation_id, 'execution-policy-changed');
  assert.equal(entry.actor_type, 'system');
  assert.equal(entry.source_system, 'aeos-hub');
  const payload = entry.payload as Record<string, unknown>;
  assert.equal(payload.name, 'agent-allowlist');
  assert.equal(payload.previousHash !== payload.hash, true);
  assert.equal(payload.revision, 1);
  assert.equal(payload.changedAt, '2026-10-26T07:00:00.000Z');

  auditor.check();
  assert.equal(events.length, 1);
});

test('配置文件被删除也会记录一次变更', (t) => {
  const { routing, events, auditor } = fixture(t);
  auditor.check();
  rmSync(routing);
  auditor.check();
  assert.equal(events.length, 1);
  const payload = events[0]!.payload as Record<string, unknown>;
  assert.equal(payload.name, 'routing-policy');
  assert.equal(payload.hash, null);
});
