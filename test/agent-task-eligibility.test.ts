import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { HarborStore, type HarborAgent, type HarborRuntime } from '../src/harbor-store.ts';
import { evaluateAgentTaskEligibility } from '../src/agent-task-eligibility.ts';

const CHECKED_AT = '2026-10-10T01:00:00.000Z';
const EVALUATED_AT = '2026-10-10T01:10:00.000Z';

function fixture(t: TestContext): { agent: HarborAgent; runtime: HarborRuntime } {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-agent-eligibility-'));
  const store = new HarborStore({
    file: join(dir, 'harbor.json'), workspaceRoot: dir, clock: () => new Date(CHECKED_AT), idFactory: () => 'test', lockTimeoutMs: 50,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const initial = store.load();
  const runtime = store.recordRuntimeVerification(initial.runtimes[0]!.id, {
    status: 'healthy', checkedAt: CHECKED_AT, message: 'ready', code: null,
  });
  return { agent: store.load().agents[0]!, runtime };
}

function evaluate(agent: HarborAgent, runtime: HarborRuntime | null, tenantId = 'default') {
  return evaluateAgentTaskEligibility({
    taskId: 'task-001', tenantId, taskType: 'operating-case-analysis', agent, runtime, evaluatedAt: EVALUATED_AT,
  });
}

test('returns a safe eligible decision only when every governed gate passes', (t) => {
  const { agent, runtime } = fixture(t);

  const decision = evaluate(agent, runtime);

  assert.equal(decision.eligible, true);
  assert.deepEqual(decision.reasonCodes, []);
  assert.equal(decision.candidate.agentId, agent.id);
  assert.equal(decision.candidate.runtime?.id, runtime.id);
  assert.equal('endpoint' in (decision.candidate.runtime ?? {}), false);
  assert.equal('instructions' in decision.candidate, false);
});

test('fails closed with stable reasons for every Agent task eligibility gate', (t) => {
  const { agent, runtime } = fixture(t);
  const scenarios: Array<{ name: string; agent?: HarborAgent; runtime?: HarborRuntime | null; tenantId?: string; expected: string }> = [
    {
      name: 'unconfigured service profile',
      agent: { ...agent, registration: { ...agent.registration, taskServiceProfile: {
        ...agent.registration.taskServiceProfile, profileVersion: '0.0.0', supportedTaskTypes: [], tenantIds: [], dataFreshnessMinutes: 0,
      } } },
      expected: 'AGENT_PROFILE_UNCONFIGURED',
    },
    { name: 'non-active lifecycle', agent: { ...agent, registration: { ...agent.registration, lifecycle: 'testing' } }, expected: 'AGENT_LIFECYCLE_NOT_ACTIVE' },
    { name: 'offline Agent', agent: { ...agent, status: 'offline' }, expected: 'AGENT_STATUS_UNUSABLE' },
    { name: 'tenant mismatch', tenantId: 'tenant-other', expected: 'TENANT_NOT_APPROVED' },
    {
      name: 'task type mismatch',
      agent: { ...agent, registration: { ...agent.registration, taskServiceProfile: { ...agent.registration.taskServiceProfile, supportedTaskTypes: ['another-task'] } } },
      expected: 'TASK_TYPE_NOT_APPROVED',
    },
    { name: 'missing Runtime', runtime: null, expected: 'RUNTIME_NOT_BOUND' },
    { name: 'unusable Runtime', runtime: { ...runtime, status: 'offline' }, expected: 'RUNTIME_STATUS_UNUSABLE' },
    { name: 'missing verification', runtime: { ...runtime, lastVerification: null }, expected: 'RUNTIME_HEALTH_UNVERIFIED' },
    { name: 'unhealthy verification', runtime: { ...runtime, lastVerification: { ...runtime.lastVerification!, status: 'unhealthy' } }, expected: 'RUNTIME_HEALTH_UNHEALTHY' },
    { name: 'stale verification', runtime: { ...runtime, lastVerification: { ...runtime.lastVerification!, checkedAt: '2026-10-10T00:00:00.000Z' } }, expected: 'RUNTIME_HEALTH_STALE' },
  ];

  for (const scenario of scenarios) {
    const decision = evaluate(scenario.agent ?? agent, scenario.runtime === undefined ? runtime : scenario.runtime, scenario.tenantId);
    assert.equal(decision.eligible, false, scenario.name);
    assert.ok(decision.reasonCodes.includes(scenario.expected), scenario.name);
  }
});

test('reports multiple blocks together and never treats online alone as healthy', (t) => {
  const { agent, runtime } = fixture(t);
  const decision = evaluate(
    { ...agent, status: 'offline', registration: { ...agent.registration, lifecycle: 'suspended' } },
    { ...runtime, status: 'online', lastVerification: null },
    'tenant-other',
  );

  assert.equal(decision.eligible, false);
  assert.deepEqual(decision.reasonCodes, [
    'AGENT_LIFECYCLE_NOT_ACTIVE', 'AGENT_STATUS_UNUSABLE', 'TENANT_NOT_APPROVED', 'RUNTIME_HEALTH_UNVERIFIED',
  ]);
});
