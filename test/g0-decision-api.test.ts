import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { G0DecisionApi } from '../src/g0-decision-api.ts';
import { G0DecisionRegisterStore } from '../src/g0-decision-register.ts';

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-g0-decision-api-'));
  const evidence: Array<Record<string, unknown>> = [];
  const store = new G0DecisionRegisterStore(
    join(directory, 'g0-decision-register.json'),
    () => new Date('2026-10-12T01:02:03.000Z'),
  );
  const api = new G0DecisionApi({
    store,
    appendEvidence: (entry) => { evidence.push(entry as Record<string, unknown>); },
  });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { api, evidence };
}

const manager = {
  actorId: 'm01:user:manager-demo', actorType: 'human' as const, tenantId: 'demo-tenant', organizationId: '订单交付组', roles: ['manager'],
};

test('allows an authenticated manager to read and record G0 choices using only the server actor', (t) => {
  const { api, evidence } = fixture(t);

  const initial = api.handle({ method: 'GET', pathname: '/api/governance/g0-decisions', actor: manager });
  assert.equal(initial?.status, 200);
  assert.equal((initial?.body.snapshot as { readyForG1: boolean }).readyForG1, false);

  const saved = api.handle({
    method: 'PUT', pathname: '/api/governance/g0-decisions', actor: manager,
    body: {
      actorId: 'agent:forged', tenantId: 'forged-tenant', roles: ['manager'],
      patch: {
        firstScenario: 'order_delivery_risk', businessOwnerActorId: 'owner-demo', verifyActorId: 'verify-demo',
        scope: { demoTenantId: 'demo-tenant', organizationScope: '订单交付组' },
      },
      note: '确认订单交付风险作为首个闭环。',
    },
  });

  assert.equal(saved?.status, 200);
  const snapshot = saved?.body.snapshot as { history: Array<{ actorId: string; tenantId: string }> };
  assert.equal(snapshot.history[0]?.actorId, manager.actorId);
  assert.equal(snapshot.history[0]?.tenantId, manager.tenantId);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.actor_id, manager.actorId);
  assert.equal((evidence[0]?.payload as { action: string }).action, 'g0_decision_recorded');
  assert.doesNotMatch(JSON.stringify(evidence[0]), /agent:forged|forged-tenant/);
});

test('denies non-manager, Agent, and service actors and audits each denied change safely', (t) => {
  const { api, evidence } = fixture(t);
  const deniedActors = [
    { actorId: 'm01:user:operator-demo', actorType: 'human' as const, tenantId: 'demo-tenant', roles: ['operator'] },
    { actorId: 'agent:analysis', actorType: 'agent' as const, tenantId: 'demo-tenant', roles: ['manager'] },
    { actorId: 'm01:service:sync', actorType: 'service' as const, tenantId: 'demo-tenant', roles: ['manager'] },
  ];

  for (const actor of deniedActors) {
    const response = api.handle({
      method: 'PUT', pathname: '/api/governance/g0-decisions', actor,
      body: { actorId: 'browser-forged', patch: { firstScenario: 'order_delivery_risk' }, note: '不应被接受。' },
    });
    assert.equal(response?.status, 403);
  }

  assert.equal(evidence.length, 3);
  for (const entry of evidence) {
    assert.equal((entry.payload as { action: string }).action, 'g0_decision_change_denied');
    assert.doesNotMatch(JSON.stringify(entry), /browser-forged/);
  }
});

test('rejects an invalid Owner and Verify combination and audits the rejected mutation', (t) => {
  const { api, evidence } = fixture(t);

  const response = api.handle({
    method: 'PUT', pathname: '/api/governance/g0-decisions', actor: manager,
    body: {
      patch: {
        firstScenario: 'order_delivery_risk', businessOwnerActorId: 'owner-demo', verifyActorId: 'owner-demo',
        scope: { demoTenantId: 'demo-tenant', organizationScope: '订单交付组' },
      },
      note: '错误的同人 Owner/Verify 配置。',
    },
  });

  assert.equal(response?.status, 400);
  assert.equal(response?.body.error, 'invalid governance request');
  assert.equal(evidence.length, 1);
  assert.equal((evidence[0]?.payload as { action: string; reason: string }).action, 'g0_decision_change_denied');
  assert.equal((evidence[0]?.payload as { reason: string }).reason, 'invalid_request');
});

test('requires the first write to establish the authenticated tenant and isolates a recorded demo tenant', (t) => {
  const { api, evidence } = fixture(t);
  const otherTenantManager = {
    actorId: 'm01:user:manager-other', actorType: 'human' as const, tenantId: 'other-tenant', roles: ['manager'],
  };

  const wrongInitialScope = api.handle({
    method: 'PUT', pathname: '/api/governance/g0-decisions', actor: manager,
    body: {
      patch: { scope: { demoTenantId: 'other-tenant', organizationScope: '错误租户' } },
      note: '认证租户与试点租户不一致。',
    },
  });
  assert.equal(wrongInitialScope?.status, 403);
  assert.equal((evidence[0]?.payload as { reason: string }).reason, 'tenant_scope_mismatch');

  const established = api.handle({
    method: 'PUT', pathname: '/api/governance/g0-decisions', actor: manager,
    body: {
      patch: { scope: { demoTenantId: 'demo-tenant', organizationScope: '订单交付组' } },
      note: '建立试点租户范围。',
    },
  });
  assert.equal(established?.status, 200);

  const rejectedScopeMove = api.handle({
    method: 'PUT', pathname: '/api/governance/g0-decisions', actor: manager,
    body: {
      patch: { scope: { demoTenantId: 'other-tenant', organizationScope: '不得迁移' } },
      note: '不得用现有租户身份切换试点租户。',
    },
  });
  assert.equal(rejectedScopeMove?.status, 403);

  const deniedRead = api.handle({ method: 'GET', pathname: '/api/governance/g0-decisions', actor: otherTenantManager });
  const deniedWrite = api.handle({
    method: 'PUT', pathname: '/api/governance/g0-decisions', actor: otherTenantManager,
    body: { patch: { firstScenario: 'order_delivery_risk' }, note: '不得越租户写入。' },
  });
  assert.equal(deniedRead?.status, 403);
  assert.equal(deniedWrite?.status, 403);
  assert.equal((evidence.at(-2)?.payload as { action: string; reason: string }).action, 'g0_decision_access_denied');
  assert.equal((evidence.at(-2)?.payload as { reason: string }).reason, 'tenant_scope_mismatch');
  assert.equal((evidence.at(-1)?.payload as { reason: string }).reason, 'tenant_scope_mismatch');
  assert.doesNotMatch(JSON.stringify(evidence.at(-1)), /demo-tenant|订单交付组/);
});

test('audits a server-signalled malformed JSON PUT without using browser identity fields', (t) => {
  const { api, evidence } = fixture(t);
  const response = api.handle({
    method: 'PUT', pathname: '/api/governance/g0-decisions', actor: manager, bodyParseFailed: true,
  });

  assert.equal(response?.status, 400);
  assert.equal(response?.body.error, 'invalid governance request');
  assert.equal(evidence.length, 1);
  assert.deepEqual(evidence[0]?.payload, { action: 'g0_decision_change_denied', reason: 'invalid_request' });
});

test('reports a committed decision when its post-commit Evidence append fails', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-g0-decision-audit-failure-'));
  const store = new G0DecisionRegisterStore(
    join(directory, 'g0-decision-register.json'),
    () => new Date('2026-10-12T01:02:03.000Z'),
  );
  let appendCalls = 0;
  const api = new G0DecisionApi({
    store,
    appendEvidence: () => { appendCalls += 1; throw new Error('evidence sink unavailable'); },
  });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const response = api.handle({
    method: 'PUT', pathname: '/api/governance/g0-decisions', actor: manager,
    body: {
      patch: { scope: { demoTenantId: 'demo-tenant', organizationScope: '订单交付组' } },
      note: '审计服务暂不可用时仍明确登记结果。',
    },
  });

  assert.equal(response?.status, 200);
  assert.equal(response?.body.committed, true);
  assert.equal(response?.body.auditStatus, 'failed');
  assert.match(String(response?.body.warning), /audit event was not appended/);
  assert.equal(store.load().revision, 1);
  assert.equal(appendCalls, 1);
});

test('keeps denied responses stable when the denial Evidence sink fails', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-g0-decision-denial-audit-failure-'));
  const store = new G0DecisionRegisterStore(join(directory, 'g0-decision-register.json'));
  let appendCalls = 0;
  const api = new G0DecisionApi({
    store,
    appendEvidence: () => { appendCalls += 1; throw new Error('internal evidence connection detail'); },
  });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const nonManager = api.handle({
    method: 'PUT', pathname: '/api/governance/g0-decisions',
    actor: { actorId: 'm01:user:operator-demo', actorType: 'human', tenantId: 'demo-tenant', roles: ['operator'] },
    body: { actorId: 'browser-forged' },
  });
  const malformed = api.handle({
    method: 'PUT', pathname: '/api/governance/g0-decisions', actor: manager, bodyParseFailed: true,
  });

  assert.deepEqual(nonManager, { status: 403, body: { error: 'manager role required', auditStatus: 'failed' } });
  assert.deepEqual(malformed, { status: 400, body: { error: 'invalid governance request', auditStatus: 'failed' } });
  assert.equal(appendCalls, 2);
  assert.doesNotMatch(JSON.stringify([nonManager, malformed]), /internal evidence|browser-forged/);
});

test('rejects a scope whose organization does not match the authenticated session organization', (t) => {
  const { api, evidence } = fixture(t);
  const response = api.handle({
    method: 'PUT', pathname: '/api/governance/g0-decisions', actor: manager,
    body: { patch: { scope: { demoTenantId: 'demo-tenant', organizationScope: '其他组织' } }, note: '越组织范围。' },
  });
  assert.equal(response?.status, 403);
  assert.equal((evidence.at(-1)?.payload as { reason: string }).reason, 'tenant_scope_mismatch');
});
