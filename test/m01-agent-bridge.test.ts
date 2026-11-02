import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import {
  registerAgentWithM01,
  isM01AgentDispatchable,
  loadM01AgentBridgeConfig,
  stableM01RegistrationEventId,
  type M01AgentBridgeConfig,
} from '../src/m01-agent-bridge.ts';

const agent = {
  id: 'agent-aeos-hub',
  name: 'AEOS 中枢 Agent',
  role: '主 Agent',
  parentAgentId: null,
  skills: ['task:execute'],
};

const config: M01AgentBridgeConfig = {
  url: 'http://m01.test/integrations/m13',
  secret: 'test-secret',
  tenantId: 'TENANT_A',
  ownerPersonId: 'P_OWNER',
  timeoutMs: 100,
};

test('registers a HUB Agent with the signed M13 event contract', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await registerAgentWithM01(agent, config, async (url, init) => {
    requestUrl = String(url);
    requestInit = init;
    return new Response(JSON.stringify({
      ok: true,
      idempotent: false,
      agent: { agent_id: agent.id, tenant_id: config.tenantId, status: 'active', scopes: ['task:execute'] },
      clamped_scopes: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  assert.equal(requestUrl, config.url);
  assert.equal(result.state, 'active');
  assert.deepEqual(result.effectiveScopes, ['task:execute']);
  assert.deepEqual(result.clampedScopes, []);
  assert.ok(requestInit?.body);
  const rawBody = String(requestInit.body);
  const headers = new Headers(requestInit.headers);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(
    headers.get('x-m01-signature'),
    `sha256=${createHmac('sha256', config.secret).update(rawBody).digest('hex')}`,
  );
  assert.deepEqual(JSON.parse(rawBody), {
    event_id: result.eventId,
    tenant_id: 'TENANT_A',
    type: 'agent.registered',
    agent_id: 'agent-aeos-hub',
    owner_person_id: 'P_OWNER',
    parent_agent_id: null,
    scopes: ['task:execute'],
  });
});

test('persists only M01 effective scopes when M01 clamps requested scopes', async () => {
  const result = await registerAgentWithM01(
    { ...agent, skills: ['task:execute', 'data:export'] },
    config,
    async () => new Response(JSON.stringify({
      ok: true,
      agent: { agent_id: agent.id, tenant_id: config.tenantId, status: 'active', scopes: ['task:execute'] },
      clamped_scopes: ['data:export'],
    }), { status: 200 }),
  );

  assert.equal(result.state, 'active');
  assert.deepEqual(result.requestedScopes, ['task:execute', 'data:export']);
  assert.deepEqual(result.effectiveScopes, ['task:execute']);
  assert.deepEqual(result.clampedScopes, ['data:export']);
});

test('classifies M01 business rejection without exposing the secret', async () => {
  const result = await registerAgentWithM01(agent, config, async () => new Response(JSON.stringify({ error: 'owner person is not active' }), { status: 403 }));

  assert.equal(result.state, 'rejected');
  assert.match(result.reason ?? '', /owner person is not active/);
  assert.ok(!JSON.stringify(result).includes(config.secret));
});

test('uses a stable event id for the same tenant, Agent and event type', () => {
  const first = stableM01RegistrationEventId('TENANT_A', 'agent-aeos-hub', 'agent.registered');
  const second = stableM01RegistrationEventId('TENANT_A', 'agent-aeos-hub', 'agent.registered');
  assert.equal(first, second);
  assert.match(first, /^hub-m01-[a-f0-9]{64}$/);
  assert.equal(first.slice(-64), createHash('sha256').update(JSON.stringify(['TENANT_A', 'agent.registered', 'agent-aeos-hub'])).digest('hex'));
});

test('requires explicit opt-in for an HTTP M01 registration endpoint', () => {
  const baseEnv = {
    M01_AGENT_REGISTRATION_URL: 'http://m01.test/integrations/m13',
    M01_AGENT_REGISTRATION_SECRET: 'secret',
  };
  assert.equal(loadM01AgentBridgeConfig(baseEnv).configured, false);
  assert.equal(loadM01AgentBridgeConfig({ ...baseEnv, M01_AGENT_REGISTRATION_ALLOW_INSECURE_HTTP: 'true' }).configured, true);
});

test('maps Harbor display labels to a safe M01 authorization scope', async () => {
  let payload: Record<string, unknown> = {};
  await registerAgentWithM01({ ...agent, skills: ['订单风险扫描', '物料缺口核查'] }, config, async (_url, init) => {
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ ok: true, agent: { agent_id: agent.id, tenant_id: config.tenantId, status: 'active', scopes: ['task:execute'] }, clamped_scopes: [] }), { status: 200 });
  });

  assert.deepEqual(payload.scopes, ['task:execute']);
});

test('keeps an idempotent response without Agent details non-dispatchable', async () => {
  const result = await registerAgentWithM01({
    ...agent,
    m01Registration: { effectiveScopes: ['task:execute'] },
  }, config, async () => new Response(JSON.stringify({ ok: true, idempotent: true, event_id: stableM01RegistrationEventId(config.tenantId, agent.id, 'agent.registered') }), { status: 200 }));

  assert.equal(result.idempotent, true);
  assert.equal(result.state, 'pending');
  assert.deepEqual(result.effectiveScopes, []);
});

test('rejects a successful response for another Agent', async () => {
  const result = await registerAgentWithM01(agent, config, async () => new Response(JSON.stringify({
    ok: true, agent: { agent_id: 'agent-other', tenant_id: config.tenantId, status: 'active', scopes: ['task:execute'] },
  }), { status: 200 }));

  assert.equal(result.state, 'rejected');
  assert.match(result.reason ?? '', /标识不匹配/);
});

test('treats an M01 server failure as pending and requires task execution scope', async () => {
  const pending = await registerAgentWithM01(agent, config, async () => new Response('{}', { status: 503 }));
  assert.equal(pending.state, 'pending');
  assert.equal(isM01AgentDispatchable({ m01Registration: { state: 'active', effectiveScopes: [] } }), false);
  assert.equal(isM01AgentDispatchable({ m01Registration: { state: 'active', effectiveScopes: ['task:execute'] } }), true);
});
