import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionPlaneError, type ExecutionAgentRecord, type ExecutionRunRecord } from '../src/execution-plane.ts';
import { BorrowOrderStore, type BorrowOrderRecord } from '../src/borrow-order-store.ts';
import { BorrowOrderService, BorrowOrderServiceError } from '../src/borrow-order-service.ts';

function agent(overrides: Partial<ExecutionAgentRecord> = {}): ExecutionAgentRecord {
  return {
    agentId: 'agent-1',
    name: '中台查询智能体',
    version: '1.0.0',
    capabilities: [{
      name: 'query_control_platform',
      description: '只读查询',
      constraints: { readOnly: true },
    }],
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

function makePlane(initialAgents: ExecutionAgentRecord[]) {
  const agents = initialAgents;
  const runs = new Map<string, ExecutionRunRecord>();
  const dispatches: Array<{ agentId: string; capability: string; input: unknown }> = [];
  let counter = 0;
  return {
    agents,
    runs,
    dispatches,
    list: () => ({ agents, runs: [...runs.values()] }),
    dispatch: (agentId: string, capability: string, input: unknown) => {
      const target = agents.find((item) => item.agentId === agentId);
      if (!target || target.connectionStatus !== 'online') throw new ExecutionPlaneError('AGENT_OFFLINE', 'offline');
      const runId = `run-${++counter}`;
      runs.set(runId, { runId, agentId, capability, input, state: 'dispatched', startedAt: '2026-10-19T09:00:00.000Z', endedAt: null });
      dispatches.push({ agentId, capability, input });
      return { runId, state: 'dispatched' as const };
    },
    getRun: (runId: string) => runs.get(runId),
  };
}

function fixture(t: { after: (fn: () => void) => void }, initialAgents = [agent()]) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-borrow-service-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new BorrowOrderStore({ file: join(dir, 'borrow-orders.json'), idFactory: (() => { let n = 0; return () => `o-${++n}`; })() });
  const plane = makePlane(initialAgents);
  const evidence: unknown[] = [];
  const service = new BorrowOrderService({
    store,
    executionPlane: plane,
    appendEvidence: (entry) => { evidence.push(entry); return entry; },
    tenantId: 'pilot-default',
    openOrderLimit: 2,
  });
  return { dir, store, plane, service, evidence };
}

function body(overrides: Record<string, unknown> = {}) {
  return { requestId: 'req-1', capability: 'query_control_platform', input: { path: '/external/orders/list' }, fromAgentId: 'purchase-assistant', ...overrides };
}

function expectCode(code: string) {
  return (error: unknown) => error instanceof BorrowOrderServiceError && error.code === code;
}

test('创建即派单：选中跨系统只读提供方并记录 runId', (t) => {
  const { service, plane } = fixture(t);
  const result = service.create({ fromSystem: 'erp', body: body() });
  assert.equal(result.idempotent, false);
  assert.equal(result.order.status, 'dispatched');
  assert.equal(result.order.providerAgentId, 'agent-1');
  assert.equal(result.order.runId, 'run-1');
  assert.equal(plane.dispatches.length, 1);
});

test('排除离线、已注销、非只读与同系统 Agent', (t) => {
  const agents = [
    agent({ agentId: 'offline', connectionStatus: 'offline' }),
    agent({ agentId: 'deregistered', deregisteredAt: '2026-10-18T00:00:00.000Z' }),
    agent({ agentId: 'write-only', capabilities: [{ name: 'query_control_platform', description: '', constraints: { readOnly: false } }] }),
    agent({ agentId: 'same-system', sourceSystem: 'erp' }),
    agent({ agentId: 'eligible', sourceSystem: '公司中控平台' }),
  ];
  const { service } = fixture(t, agents);
  const result = service.create({ fromSystem: 'erp', body: body() });
  assert.equal(result.order.providerAgentId, 'eligible');
});

test('同能力多个候选：空闲优先，再按最近在线时间', (t) => {
  const agents = [
    agent({ agentId: 'busy', runtimeStatus: 'working', currentRunId: 'run-x', lastSeenAt: '2026-10-19T08:10:00.000Z' }),
    agent({ agentId: 'idle-old', lastSeenAt: '2026-10-19T08:00:00.000Z' }),
    agent({ agentId: 'idle-new', lastSeenAt: '2026-10-19T08:05:00.000Z' }),
  ];
  const { service } = fixture(t, agents);
  const result = service.create({ fromSystem: 'erp', body: body() });
  assert.equal(result.order.providerAgentId, 'idle-new');
});

test('指定 toSystem / toAgent 生效', (t) => {
  const agents = [
    agent({ agentId: 'a-1', sourceSystem: '中控' }),
    agent({ agentId: 'b-1', sourceSystem: 'PLM', capabilities: [{ name: 'query_plm', description: 'PLM 只读查询', constraints: { readOnly: true } }] }),
  ];
  const { service } = fixture(t, agents);
  assert.equal(service.create({ fromSystem: 'erp', body: body({ capability: 'query_plm', toSystem: 'PLM' }) }).order.providerAgentId, 'b-1');
  assert.equal(service.create({ fromSystem: 'erp', body: body({ requestId: 'req-2', toAgent: 'a-1' }) }).order.providerAgentId, 'a-1');
});

test('指定目标不可用时明确拒绝', (t) => {
  const { service } = fixture(t);
  assert.throws(() => service.create({ fromSystem: 'erp', body: body({ toAgent: 'missing' }) }), expectCode('TARGET_NOT_ELIGIBLE'));
  assert.throws(() => service.create({ fromSystem: 'erp', body: body({ toSystem: '不存在' }) }), expectCode('TARGET_NOT_ELIGIBLE'));
});

test('不能向本系统借调', (t) => {
  const agents = [agent({ agentId: 'own', sourceSystem: 'erp' })];
  const { service } = fixture(t, agents);
  assert.throws(() => service.create({ fromSystem: 'erp', body: body() }), expectCode('NO_PROVIDER'));
  assert.throws(() => service.create({ fromSystem: 'erp', body: body({ toSystem: 'erp' }) }), expectCode('SELF_BORROW_FORBIDDEN'));
  assert.throws(() => service.create({ fromSystem: 'erp', body: body({ toAgent: 'own' }) }), expectCode('SELF_BORROW_FORBIDDEN'));
});

test('能力不存在 / 只有非只读版本', (t) => {
  const missing = fixture(t, [agent({ capabilities: [{ name: 'other', description: '', constraints: { readOnly: true } }] })]);
  assert.throws(() => missing.service.create({ fromSystem: 'erp', body: body() }), expectCode('CAPABILITY_NOT_FOUND'));
  const writeOnly = fixture(t, [agent({ capabilities: [{ name: 'query_control_platform', description: '', constraints: { readOnly: false } }] })]);
  assert.throws(() => writeOnly.service.create({ fromSystem: 'erp', body: body() }), expectCode('NO_PROVIDER'));
});

test('敏感或未授权能力不允许跨系统借调，且不出现在能力目录', (t) => {
  const localFiles = agent({
    agentId: 'plm-files',
    sourceSystem: '恒剑PLM',
    capabilities: [{ name: 'query_local_files', description: '本机文件只读', constraints: { readOnly: true } }],
  });
  const { service } = fixture(t, [localFiles]);
  assert.throws(
    () => service.create({ fromSystem: 'erp', body: body({ capability: 'query_local_files', input: { action: 'info' } }) }),
    expectCode('CAPABILITY_NOT_ALLOWED'),
  );
  assert.deepEqual(service.capabilityDirectory('erp'), []);
});

test('幂等重放不重复派单，不同内容报冲突', (t) => {
  const { service, plane } = fixture(t);
  const first = service.create({ fromSystem: 'erp', body: body() });
  const replay = service.create({ fromSystem: 'erp', body: body() });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.order.orderId, first.order.orderId);
  assert.equal(plane.dispatches.length, 1);
  assert.throws(() => service.create({ fromSystem: 'erp', body: body({ input: { path: '/other' } }) }), expectCode('REQUEST_CONFLICT'));
});

test('拒绝伪造字段与超限输入', (t) => {
  const { service } = fixture(t);
  assert.throws(() => service.create({ fromSystem: 'erp', body: body({ fromSystem: 'mes' }) }), expectCode('INVALID_ARGUMENT'));
  assert.throws(() => service.create({ fromSystem: 'erp', body: body({ tenantId: 'x' }) }), expectCode('INVALID_ARGUMENT'));
  assert.throws(() => service.create({ fromSystem: 'erp', body: body({ input: { text: 'x'.repeat(70 * 1024) } }) }), expectCode('PAYLOAD_TOO_LARGE'));
});

test('未完成借调单达到上限时拒绝', (t) => {
  const { service } = fixture(t);
  service.create({ fromSystem: 'erp', body: body({ requestId: 'req-1' }) });
  service.create({ fromSystem: 'erp', body: body({ requestId: 'req-2' }) });
  assert.throws(() => service.create({ fromSystem: 'erp', body: body({ requestId: 'req-3' }) }), expectCode('TOO_MANY_OPEN_ORDERS'));
});

test('派单失败时订单落 failed 并返回映射错误', (t) => {
  const { service, plane } = fixture(t);
  plane.dispatch = () => { throw new ExecutionPlaneError('AGENT_OFFLINE', 'gone'); };
  assert.throws(() => service.create({ fromSystem: 'erp', body: body() }), expectCode('DISPATCH_AGENT_OFFLINE'));
  const order = service.listAll()[0];
  assert.equal(order.status, 'failed');
  assert.equal(order.error?.stage, 'dispatch');
});

test('运行状态回调：running → completed，结果按上限截断', (t) => {
  const { service } = fixture(t);
  const created = service.create({ fromSystem: 'erp', body: body() });
  service.handleRunStateChange({ runId: created.order.runId!, agentId: 'agent-1', state: 'running', startedAt: '2026-10-19T09:00:00.000Z', endedAt: null });
  assert.equal(service.listAll()[0].status, 'running');
  service.handleRunStateChange({ runId: created.order.runId!, agentId: 'agent-1', state: 'completed', result: { items: [1, 2] }, startedAt: '2026-10-19T09:00:00.000Z', endedAt: '2026-10-19T09:00:02.000Z' });
  const done = service.listAll()[0];
  assert.equal(done.status, 'completed');
  assert.deepEqual(done.result, { items: [1, 2] });
});

test('运行失败/召回/提供方掉线都会终结订单', (t) => {
  const { service } = fixture(t);
  const a = service.create({ fromSystem: 'erp', body: body({ requestId: 'req-1' }) });
  service.handleRunStateChange({ runId: a.order.runId!, agentId: 'agent-1', state: 'failed', error: { code: 'X', message: 'boom' }, startedAt: '', endedAt: null });
  assert.equal(service.listAll().find((order) => order.orderId === a.order.orderId)?.status, 'failed');

  const b = service.create({ fromSystem: 'erp', body: body({ requestId: 'req-2' }) });
  service.handleRunStateChange({ runId: b.order.runId!, agentId: 'agent-1', state: 'recalled', startedAt: '', endedAt: null });
  assert.equal(service.listAll().find((order) => order.orderId === b.order.orderId)?.status, 'cancelled');

  const c = service.create({ fromSystem: 'erp', body: body({ requestId: 'req-3' }) });
  service.handleAgentOffline({ agentId: 'agent-1', runId: c.order.runId! });
  const offline = service.listAll().find((order) => order.orderId === c.order.orderId);
  assert.equal(offline?.status, 'failed');
  assert.equal(offline?.error?.code, 'PROVIDER_DISCONNECTED');
});

test('用量归属：补请求方与借调单号，非借调事件不变', (t) => {
  const { service } = fixture(t);
  const created = service.create({ fromSystem: 'erp', body: body() });
  const attributed = service.attributeUsage({
    agentId: 'agent-1', systemId: '公司中控平台', modelId: null, runId: created.order.runId, tokensIn: 1, tokensOut: 2, cost: 0,
    startedAt: '', endedAt: '',
  });
  assert.equal(attributed.consumerSystemId, 'erp');
  assert.equal(attributed.consumerAgentId, 'purchase-assistant');
  assert.equal(attributed.borrowOrderId, created.order.orderId);
  assert.equal(attributed.systemId, '公司中控平台');
  const untouched = service.attributeUsage({
    agentId: 'x', systemId: 'y', modelId: null, runId: 'unknown', tokensIn: 1, tokensOut: 1, cost: 0, startedAt: '', endedAt: '',
  });
  assert.equal(untouched.consumerSystemId, undefined);
});

test('能力目录排除本系统与非只读能力', (t) => {
  const agents = [
    agent({ agentId: 'a', sourceSystem: '中控', lastSeenAt: '2026-10-19T08:00:00.000Z', connectionStatus: 'offline' }),
    agent({ agentId: 'b', sourceSystem: 'erp' }),
    agent({ agentId: 'c', sourceSystem: 'PLM', capabilities: [{ name: 'write', description: '', constraints: { readOnly: false } }] }),
  ];
  const { service } = fixture(t, agents);
  const directory = service.capabilityDirectory('erp');
  assert.equal(directory.length, 1);
  assert.equal(directory[0].name, 'query_control_platform');
  assert.deepEqual(directory[0].providers.map((provider) => provider.agentId), ['a']);
  assert.equal(directory[0].providers[0].online, false);
});

test('启动对账：无 run / run 丢失 / 仍在跑 → failed，已完成 → completed', (t) => {
  const { service, store, plane } = fixture(t);
  const noRun = store.create({
    tenantId: 'pilot-default', requestId: 'r1', requestHash: 'a'.repeat(64), fromSystem: 'erp', fromAgentId: null,
    capability: 'query_control_platform', input: {}, toSystem: null, toAgent: null, providerSystem: '公司中控平台', providerAgentId: 'agent-1',
  });
  const missingRun = store.create({
    tenantId: 'pilot-default', requestId: 'r2', requestHash: 'b'.repeat(64), fromSystem: 'erp', fromAgentId: null,
    capability: 'query_control_platform', input: {}, toSystem: null, toAgent: null, providerSystem: '公司中控平台', providerAgentId: 'agent-1',
  });
  store.update(missingRun.orderId, { status: 'dispatched', runId: 'run-missing' });
  const runningRun = store.create({
    tenantId: 'pilot-default', requestId: 'r3', requestHash: 'c'.repeat(64), fromSystem: 'erp', fromAgentId: null,
    capability: 'query_control_platform', input: {}, toSystem: null, toAgent: null, providerSystem: '公司中控平台', providerAgentId: 'agent-1',
  });
  store.update(runningRun.orderId, { status: 'dispatched', runId: 'run-live' });
  plane.runs.set('run-live', { runId: 'run-live', agentId: 'agent-1', capability: 'query_control_platform', input: {}, state: 'running', startedAt: '', endedAt: null });
  const completedRun = store.create({
    tenantId: 'pilot-default', requestId: 'r4', requestHash: 'd'.repeat(64), fromSystem: 'erp', fromAgentId: null,
    capability: 'query_control_platform', input: {}, toSystem: null, toAgent: null, providerSystem: '公司中控平台', providerAgentId: 'agent-1',
  });
  store.update(completedRun.orderId, { status: 'dispatched', runId: 'run-done' });
  plane.runs.set('run-done', { runId: 'run-done', agentId: 'agent-1', capability: 'query_control_platform', input: {}, state: 'completed', startedAt: '', endedAt: '2026-10-19T09:00:00.000Z', result: { ok: true } });

  const result = service.reconcileOnStartup();
  assert.equal(result.failed, 3);
  assert.equal(result.reconciled, 1);
  const byId = new Map<string, BorrowOrderRecord>(store.load().orders.map((order) => [order.orderId, order]));
  assert.equal(byId.get(noRun.orderId)?.error?.code, 'INTERRUPTED_BEFORE_DISPATCH');
  assert.equal(byId.get(missingRun.orderId)?.error?.code, 'ORPHANED_RUN_NOT_FOUND');
  assert.equal(byId.get(runningRun.orderId)?.error?.code, 'ORPHANED_AFTER_RESTART');
  assert.equal(byId.get(completedRun.orderId)?.status, 'completed');
});

test('可见性：发起方看 outgoing，提供方看 incoming，无关系统查不到', (t) => {
  const { service } = fixture(t);
  const created = service.create({ fromSystem: 'erp', body: body() });
  assert.equal(service.listForSystem('erp').outgoing.length, 1);
  assert.equal(service.listForSystem('公司中控平台', { direction: 'incoming' }).incoming.length, 1);
  assert.equal(service.listForSystem('mes').outgoing.length, 0);
  assert.equal(service.listForSystem('mes').incoming.length, 0);
  assert.throws(() => service.getForSystem('mes', created.order.orderId), expectCode('ORDER_NOT_FOUND'));
  assert.equal(service.getForSystem('公司中控平台', created.order.orderId).orderId, created.order.orderId);
});
