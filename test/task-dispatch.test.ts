import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HarborStore } from '../src/harbor-store.ts';
import { recommendTaskAssignees, validateAgentAssignment } from '../src/task-dispatch.ts';

const NOW = '2026-10-10T01:00:00.000Z';
const task = { taskId: 'task-1', tenantId: 'tenant-a', source: 'order' };

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-task-dispatch-'));
  const clock = () => new Date(NOW);
  const harbor = new HarborStore({ file: join(dir, 'harbor.json'), workspaceRoot: dir, clock, idFactory: () => 'harbor-test', lockTimeoutMs: 50 });
  const snapshot = harbor.load();
  snapshot.agents[0]!.registration.taskServiceProfile.tenantIds = ['tenant-a'];
  harbor.save(snapshot);
  harbor.recordRuntimeVerification(snapshot.runtimes[0]!.id, { status: 'healthy', checkedAt: NOW, message: 'ready', code: null });
  return { harbor };
}

test('recommendTaskAssignees returns a stable, eligible-first ordering', () => {
  const { harbor } = fixture();
  const snapshot = harbor.load();
  const first = recommendTaskAssignees(task, snapshot.agents, snapshot.runtimes, NOW);
  const second = recommendTaskAssignees(task, snapshot.agents, snapshot.runtimes, NOW);
  assert.deepEqual(first, second);
  assert.equal(first[0]?.agentId, 'agent-aeos-hub');
  assert.equal(first[0]?.eligible, true);
  assert.deepEqual(first[0]?.reasons, []);
});

test('recommendTaskAssignees reports reasons for an ineligible agent', () => {
  const { harbor } = fixture();
  const snapshot = harbor.load();
  snapshot.agents[0]!.registration.taskServiceProfile.tenantIds = ['tenant-b'];
  harbor.save(snapshot);
  const recs = recommendTaskAssignees(task, harbor.load().agents, harbor.load().runtimes, NOW);
  assert.equal(recs[0]?.eligible, false);
  assert.ok((recs[0]?.reasons ?? []).length > 0);
});

test('validateAgentAssignment allows an eligible agent', () => {
  const { harbor } = fixture();
  const snapshot = harbor.load();
  const decision = validateAgentAssignment(task, snapshot.agents[0]!, snapshot.runtimes[0]!, NOW);
  assert.deepEqual(decision, { allowed: true, code: 'ALLOWED' });
});

test('validateAgentAssignment rejects a cross-tenant agent', () => {
  const { harbor } = fixture();
  const snapshot = harbor.load();
  snapshot.agents[0]!.registration.taskServiceProfile.tenantIds = ['tenant-b'];
  harbor.save(snapshot);
  const s = harbor.load();
  const decision = validateAgentAssignment(task, s.agents[0]!, s.runtimes[0]!, NOW);
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.some((reason) => reason.includes('租户')));
});

test('validateAgentAssignment rejects an agent with stale runtime health', () => {
  const { harbor } = fixture();
  const snapshot = harbor.load();
  const later = '2026-10-10T03:00:00.000Z';
  const decision = validateAgentAssignment(task, snapshot.agents[0]!, snapshot.runtimes[0]!, later);
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasons.some((reason) => reason.includes('新鲜')));
});
