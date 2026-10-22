import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveSystemToken } from '../src/system-token.ts';
import { BorrowOrderStore } from '../src/borrow-order-store.ts';
import { BorrowOrderService } from '../src/borrow-order-service.ts';
import { CapabilityInvocationService } from '../src/capability-invocation-service.ts';
import { CapabilityInvocationApi } from '../src/capability-invocation-api.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'capability-invocation-api-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const rootSecret = 'test-root-secret';
  const store = new BorrowOrderStore({ file: join(dir, 'borrow-orders.json') });
  const agent = {
    agentId: 'runtime-execution-query',
    name: '恒剑 PLM 执行面智能体',
    version: '1.0.0',
    capabilities: [{
      name: 'query_plm',
      description: 'PLM 只读查询',
      constraints: { readOnly: true },
    }],
    connectionStatus: 'online' as const,
    runtimeStatus: 'idle' as const,
    lastSeenAt: '2026-10-22T00:00:00.000Z',
    currentRunId: null,
    registeredAt: '2026-10-01T00:00:00.000Z',
    local: false,
    sourceSystem: 'hengjian-plm',
    deregisteredAt: null,
  };
  const plane = {
    list: () => ({ agents: [agent], runs: [] }),
    dispatch: (agentId: string, capability: string, input: unknown) => {
      if (agentId !== 'runtime-execution-query') throw new Error('offline');
      return { runId: 'run-1', state: 'dispatched' as const };
    },
    getRun: () => undefined,
  };
  const borrowOrders = new BorrowOrderService({
    store,
    executionPlane: plane,
    appendEvidence: (entry) => entry,
    tenantId: 'tenant-demo',
  });
  const service = new CapabilityInvocationService({
    borrowOrders,
    executionPlane: plane,
    idFactory: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const evidence: unknown[] = [];
  const api = new CapabilityInvocationApi({
    rootSecret,
    service,
    appendEvidence: (entry) => { evidence.push(entry); return entry; },
  });
  const token = deriveSystemToken(rootSecret, 'control-platform');
  return { api, evidence, token };
}

function requestBody(requestId = 'req-api-1') {
  return {
    capability: 'query_plm',
    params: { keyword: 'HJ.26033.V1.256JY' },
    requestId,
    fromAgentId: 'runtime-control-platform-query',
  };
}

test('未认证调用返回 401 并审计', (t) => {
  const { api, evidence } = fixture(t);
  const outcome = api.handle({
    method: 'POST',
    pathname: '/api/system/capability-invocations',
    systemId: 'control-platform',
    token: 'invalid',
    body: requestBody(),
  });
  assert.equal(outcome?.status, 401);
  assert.equal(outcome.body.code, 'AUTH_REQUIRED');
  assert.equal(evidence.length, 1);
});

test('GET templates 返回 PLM 与中台只读能力模板', (t) => {
  const { api } = fixture(t);
  const list = api.handle({
    method: 'GET',
    pathname: '/api/system/capability-invocations',
    systemId: 'control-platform',
    token: deriveSystemToken('test-root-secret', 'control-platform'),
  });
  assert.equal(list?.status, 200);
  const templates = (list.body.templates as Array<Record<string, unknown>>);
  assert.equal(templates.length, 2);
  assert.deepEqual(
    templates.map((template) => template.capability),
    ['query_control_platform', 'query_plm'],
  );
  assert.equal('readOnly' in templates[0]!, false);
});

test('POST invocation 返回 202 和借调单摘要', (t) => {
  const { api, token } = fixture(t);
  const outcome = api.handle({
    method: 'POST',
    pathname: '/api/system/capability-invocations',
    systemId: 'control-platform',
    token,
    body: requestBody(),
  });
  assert.equal(outcome?.status, 202);
  assert.equal(outcome.body.idempotent, false);
  const invocation = outcome.body.invocation as Record<string, unknown>;
  assert.equal(invocation.capability, 'query_plm');
  assert.equal(invocation.status, 'dispatched');
  const order = outcome.body.order as Record<string, unknown>;
  assert.equal(order.providerSystem, 'hengjian-plm');
  assert.equal('input' in order, false);
  assert.equal('result' in order, false);
});

test('模板不存在返回 404', (t) => {
  const { api, token } = fixture(t);
  const outcome = api.handle({
    method: 'POST',
    pathname: '/api/system/capability-invocations',
    systemId: 'control-platform',
    token,
    body: { capability: 'query_missing', params: {} },
  });
  assert.equal(outcome?.status, 404);
  assert.equal(outcome.body.code, 'CAPABILITY_NOT_FOUND');
});
