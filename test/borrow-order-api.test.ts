import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionPlaneError, type ExecutionAgentRecord, type ExecutionRunRecord } from '../src/execution-plane.ts';
import { BorrowOrderStore } from '../src/borrow-order-store.ts';
import { BorrowOrderService } from '../src/borrow-order-service.ts';
import { BorrowOrderApi } from '../src/borrow-order-api.ts';
import { deriveSystemToken } from '../src/system-token.ts';

const ROOT_SECRET = 'test-root-secret';

function agent(overrides: Partial<ExecutionAgentRecord> = {}): ExecutionAgentRecord {
  return {
    agentId: 'agent-1',
    name: '中台查询智能体',
    version: '1.0.0',
    capabilities: [{ name: 'query_control_platform', description: '只读查询', constraints: { readOnly: true } }],
    connectionStatus: 'online',
    runtimeStatus: 'idle',
    lastSeenAt: '2026-10-19T08:00:00.000Z',
    currentRunId: null,
    registeredAt: '2026-10-01T00:00:00.000Z',
    local: false,
    sourceSystem: '公司中控平台',
    deregisteredAt: null,
    ...overrides,
  };
}

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-borrow-api-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agents = [agent()];
  const runs = new Map<string, ExecutionRunRecord>();
  let counter = 0;
  const executionPlane = {
    list: () => ({ agents, runs: [...runs.values()] }),
    dispatch: (agentId: string) => {
      if (!agents.find((item) => item.agentId === agentId)) throw new ExecutionPlaneError('AGENT_NOT_FOUND', 'missing');
      const runId = `run-${++counter}`;
      runs.set(runId, { runId, agentId, capability: 'query_control_platform', input: {}, state: 'dispatched', startedAt: '', endedAt: null });
      return { runId, state: 'dispatched' as const };
    },
    getRun: (runId: string) => runs.get(runId),
  };
  const store = new BorrowOrderStore({ file: join(dir, 'borrow-orders.json'), idFactory: () => `api-${counter}` });
  const evidence: unknown[] = [];
  const service = new BorrowOrderService({ store, executionPlane, appendEvidence: (entry) => { evidence.push(entry); return entry; } });
  const api = new BorrowOrderApi({ rootSecret: ROOT_SECRET, service, appendEvidence: (entry) => { evidence.push(entry); return entry; } });
  return { api, store, evidence, token: (systemId: string) => deriveSystemToken(ROOT_SECRET, systemId) };
}

function createRequest(token: string, body: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    pathname: '/api/system/borrow-orders',
    systemId: 'erp',
    token,
    body: { requestId: 'req-1', capability: 'query_control_platform', input: {}, fromAgentId: 'purchase-assistant', ...body },
  };
}

test('鉴权失败返回 401 并写审计', (t) => {
  const { api, evidence } = fixture(t);
  const missing = api.handle({ method: 'GET', pathname: '/api/system/borrow-orders', systemId: '', token: '' });
  assert.equal(missing?.status, 401);
  const wrong = api.handle({ method: 'GET', pathname: '/api/system/borrow-orders', systemId: 'erp', token: 'wrong' });
  assert.equal(wrong?.status, 401);
  assert.ok(evidence.length >= 2);
});

test('未配置根密钥时 fail-closed', (t) => {
  const { store } = fixture(t);
  const service = new BorrowOrderService({
    store,
    executionPlane: { list: () => ({ agents: [], runs: [] }), dispatch: () => { throw new Error('no'); }, getRun: () => undefined },
    appendEvidence: () => ({}),
  });
  const api = new BorrowOrderApi({ rootSecret: '', service, appendEvidence: () => ({}) });
  assert.equal(api.handle({ method: 'GET', pathname: '/api/system/borrow-orders', systemId: 'erp', token: 'x' })?.status, 503);
});

test('创建成功 201，幂等重放 200', (t) => {
  const { api, token } = fixture(t);
  const created = api.handle(createRequest(token('erp')));
  assert.equal(created?.status, 201);
  const order = created?.body.order as { orderId: string; status: string; runId: string };
  assert.equal(order.status, 'dispatched');
  assert.ok(order.runId);
  const replay = api.handle(createRequest(token('erp')));
  assert.equal(replay?.status, 200);
  assert.equal(replay?.body.idempotent, true);
});

test('列表按方向返回，详情仅发起方/提供方可见', (t) => {
  const { api, token } = fixture(t);
  const created = api.handle(createRequest(token('erp')));
  const orderId = (created?.body.order as { orderId: string }).orderId;

  const outgoing = api.handle({ method: 'GET', pathname: '/api/system/borrow-orders', systemId: 'erp', token: token('erp'), query: new URLSearchParams() });
  assert.equal((outgoing?.body.outgoing as unknown[]).length, 1);
  const incoming = api.handle({ method: 'GET', pathname: '/api/system/borrow-orders', systemId: '公司中控平台', token: token('公司中控平台'), query: new URLSearchParams({ direction: 'incoming' }) });
  assert.equal((incoming?.body.incoming as unknown[]).length, 1);

  assert.equal(api.handle({ method: 'GET', pathname: `/api/system/borrow-orders/${orderId}`, systemId: 'erp', token: token('erp') })?.status, 200);
  assert.equal(api.handle({ method: 'GET', pathname: `/api/system/borrow-orders/${orderId}`, systemId: '公司中控平台', token: token('公司中控平台') })?.status, 200);
  assert.equal(api.handle({ method: 'GET', pathname: `/api/system/borrow-orders/${orderId}`, systemId: 'mes', token: token('mes') })?.status, 404);
});

test('能力目录只返回只读且排除本系统', (t) => {
  const { api, token } = fixture(t);
  const result = api.handle({ method: 'GET', pathname: '/api/system/borrow-orders/capabilities', systemId: 'erp', token: token('erp') });
  assert.equal(result?.status, 200);
  const capabilities = result?.body.capabilities as Array<{ name: string; providers: Array<{ systemId: string }> }>;
  assert.equal(capabilities.length, 1);
  assert.equal(capabilities[0].providers[0].systemId, 'control-platform');
  const own = api.handle({ method: 'GET', pathname: '/api/system/borrow-orders/capabilities', systemId: '公司中控平台', token: token('公司中控平台') });
  assert.deepEqual((own?.body.capabilities as unknown[]), []);
});

test('业务错误映射为对应 HTTP 状态', (t) => {
  const { api, token } = fixture(t);
  assert.equal(api.handle(createRequest(token('erp'), { toSystem: 'erp' }))?.status, 403);
  assert.equal(api.handle(createRequest(token('erp'), { capability: 'nope' }))?.status, 404);
  assert.equal(api.handle(createRequest(token('erp'), { tenantId: 'x' }))?.status, 400);
  assert.equal(api.handle({ ...createRequest(token('erp')), bodyParseFailed: true })?.status, 400);
  assert.equal(api.handle({ method: 'GET', pathname: '/api/system/borrow-orders', systemId: 'erp', token: token('erp'), query: new URLSearchParams({ status: 'bogus' }) })?.status, 400);
  assert.equal(api.handle({ method: 'DELETE', pathname: '/api/system/borrow-orders', systemId: 'erp', token: token('erp') })?.status, 405);
  assert.equal(api.handle({ method: 'GET', pathname: '/api/system/borrow-orders/unknown/path', systemId: 'erp', token: token('erp') })?.status, 404);
});

test('非借调路径返回 null', (t) => {
  const { api, token } = fixture(t);
  assert.equal(api.handle({ method: 'GET', pathname: '/api/other', systemId: 'erp', token: token('erp') }), null);
});
