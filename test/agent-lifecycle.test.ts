import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HarborStore } from '../src/harbor-store.ts';
import { validateActivationGate, validateLifecycleTransition } from '../src/agent-lifecycle.ts';

const NOW = '2026-10-10T01:00:00.000Z';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-agent-lifecycle-'));
  const clock = () => new Date(NOW);
  const harbor = new HarborStore({ file: join(dir, 'harbor.json'), workspaceRoot: dir, clock, idFactory: () => 'harbor-test', lockTimeoutMs: 50 });
  return { harbor };
}

test('lifecycle transition matrix allows only the governed paths', () => {
  assert.deepEqual(validateLifecycleTransition('draft', 'testing'), { allowed: true });
  assert.equal(validateLifecycleTransition('draft', 'active').allowed, false);
  assert.deepEqual(validateLifecycleTransition('testing', 'active'), { allowed: true });
  assert.deepEqual(validateLifecycleTransition('active', 'suspended'), { allowed: true });
  assert.deepEqual(validateLifecycleTransition('suspended', 'active'), { allowed: true });
  assert.deepEqual(validateLifecycleTransition('active', 'retired'), { allowed: true });
  assert.deepEqual(validateLifecycleTransition('suspended', 'retired'), { allowed: true });
  assert.equal(validateLifecycleTransition('retired', 'active').allowed, false);
  assert.equal(validateLifecycleTransition('draft', 'suspended').allowed, false);
});

test('activation gate requires a verified runtime for an otherwise complete profile', () => {
  const { harbor } = fixture();
  const snapshot = harbor.load();
  const agent = snapshot.agents[0]!;
  // Default runtime has no verification yet, so activation must be blocked.
  assert.equal(validateActivationGate(agent, snapshot.runtimes[0]!).allowed, false);
  // After a healthy verification the complete default hub profile may activate.
  harbor.recordRuntimeVerification(snapshot.runtimes[0]!.id, { status: 'healthy', checkedAt: NOW, message: 'ready', code: null });
  const verified = harbor.load();
  assert.equal(validateActivationGate(verified.agents[0]!, verified.runtimes[0]!).allowed, true);
});

test('activation gate rejects an incomplete profile', () => {
  const { harbor } = fixture();
  const snapshot = harbor.load();
  snapshot.agents[0]!.registration.taskServiceProfile.businessOwner = 'unassigned';
  snapshot.agents[0]!.registration.taskServiceProfile.supportedTaskTypes = [];
  harbor.save(snapshot);
  const s = harbor.load();
  const gate = validateActivationGate(s.agents[0]!, s.runtimes[0]!);
  assert.equal(gate.allowed, false);
  assert.ok(gate.reasons.some((reason) => reason.includes('业务 Owner')));
  assert.ok(gate.reasons.some((reason) => reason.includes('任务类型')));
});

test('transitionAgentLifecycle persists governed transitions and audit events', () => {
  const { harbor } = fixture();
  const snapshot = harbor.load();
  const agentId = snapshot.agents[0]!.id;
  const runtimeId = snapshot.runtimes[0]!.id;
  harbor.recordRuntimeVerification(runtimeId, { status: 'healthy', checkedAt: NOW, message: 'ready', code: null });
  const suspended = harbor.transitionAgentLifecycle({ agentId, to: 'suspended', actor: 'm01:user:manager-01', reason: '暂停' });
  assert.equal(suspended.registration.lifecycle, 'suspended');
  const active = harbor.transitionAgentLifecycle({ agentId, to: 'active', actor: 'm01:user:manager-01', reason: '恢复' });
  assert.equal(active.registration.lifecycle, 'active');
  const final = harbor.load();
  assert.equal(final.lifecycleEvents.length, 2);
  assert.equal(final.lifecycleEvents[0]?.from, 'active');
  assert.equal(final.lifecycleEvents[0]?.to, 'suspended');
  assert.equal(final.lifecycleEvents[1]?.from, 'suspended');
  assert.equal(final.lifecycleEvents[1]?.to, 'active');
});

test('transitionAgentLifecycle rejects an illegal jump', () => {
  const { harbor } = fixture();
  const agentId = harbor.load().agents[0]!.id;
  assert.throws(() => harbor.transitionAgentLifecycle({ agentId, to: 'testing', actor: 'x', reason: '回退' }), /不允许从 active 流转到 testing/);
});

test('transitionAgentLifecycle blocks activation without a verified runtime', () => {
  const { harbor } = fixture();
  const snapshot = harbor.load();
  snapshot.agents[0]!.registration.lifecycle = 'testing';
  harbor.save(snapshot);
  const agentId = snapshot.agents[0]!.id;
  assert.throws(() => harbor.transitionAgentLifecycle({ agentId, to: 'active', actor: 'x', reason: '发布' }), /发布门禁/);
});
