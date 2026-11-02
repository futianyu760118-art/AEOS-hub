import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { registerAgentWithM01, isM01AgentDispatchable, type M01AgentRegistrationResult } from '../src/m01-agent-bridge.ts';
import { HarborStore } from '../src/harbor-store.ts';

const NOW = '2026-11-02T08:00:00.000Z';

function fixture(t: TestContext): { file: string; store: HarborStore } {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-m01-registration-'));
  const file = join(dir, 'data', 'ai-harbor.json');
  const store = new HarborStore({ file, clock: () => new Date(NOW), idFactory: () => 'test-agent', lockTimeoutMs: 50 });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { file, store };
}

function activeResult(agentId: string): M01AgentRegistrationResult {
  return {
    state: 'active', eventId: 'hub-m01-event', agentId,
    requestedScopes: ['task:execute', 'data:export'], effectiveScopes: ['task:execute'], clampedScopes: ['data:export'],
    reason: null, idempotent: false,
  };
}

test('loads a legacy Harbor snapshot without M01 registration metadata', (t) => {
  const { file, store } = fixture(t);
  const initial = store.load();
  const legacy = structuredClone(initial) as Record<string, unknown>;
  const agents = (legacy.agents as Array<Record<string, unknown>>);
  delete agents[0].m01Registration;
  writeFileSync(file, JSON.stringify(legacy), 'utf8');

  const loaded = store.load();
  assert.equal(loaded.agents[0].m01Registration.state, 'not_configured');
});

test('persists M01 accepted state and effective scopes', (t) => {
  const { store } = fixture(t);
  const agent = store.load().agents[0];
  const updated = store.updateAgentM01Registration(agent.id, activeResult(agent.id));

  assert.equal(updated.m01Registration.state, 'active');
  assert.deepEqual(updated.m01Registration.effectiveScopes, ['task:execute']);
  assert.deepEqual(store.load().agents[0].m01Registration.clampedScopes, ['data:export']);
  assert.equal(isM01AgentDispatchable(updated), true);
});

test('persists M01 rejection and keeps the Agent non-dispatchable', (t) => {
  const { store } = fixture(t);
  const agent = store.load().agents[0];
  const rejected = store.updateAgentM01Registration(agent.id, {
    ...activeResult(agent.id), state: 'rejected', effectiveScopes: [], clampedScopes: [], reason: 'owner person is not active',
  });

  assert.equal(rejected.m01Registration.state, 'rejected');
  assert.equal(isM01AgentDispatchable(rejected), false);
  assert.match(rejected.m01Registration.reason ?? '', /owner person/);
});

test('retrying registration keeps the same event id', async (t) => {
  const { store } = fixture(t);
  const agent = store.load().agents[0];
  const config = { url: 'http://m01.test/integrations/m13', secret: 'secret', tenantId: 'TENANT_A', ownerPersonId: 'P_OWNER' };
  let calls = 0;
  const transport = async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: true, idempotent: calls > 1, agent: { agent_id: agent.id, tenant_id: config.tenantId, status: 'active', scopes: agent.skills }, clamped_scopes: [] }), { status: 200 });
  };
  const first = await registerAgentWithM01(agent, config, transport);
  const second = await registerAgentWithM01(agent, config, transport);

  assert.equal(first.eventId, second.eventId);
  assert.equal(second.idempotent, true);
  assert.equal(calls, 2);
  assert.equal(JSON.parse(readFileSync(store.file, 'utf8')).agents.length, 1);
});
