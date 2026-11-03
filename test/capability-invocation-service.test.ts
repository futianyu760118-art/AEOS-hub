import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionPlaneError, type ExecutionAgentRecord, type ExecutionRunRecord } from '../src/execution-plane.ts';
import { BorrowOrderStore } from '../src/borrow-order-store.ts';
import { BorrowOrderService, BorrowOrderServiceError } from '../src/borrow-order-service.ts';
import { CapabilityInvocationService } from '../src/capability-invocation-service.ts';

function agent(): ExecutionAgentRecord {
  return {
    agentId: 'runtime-execution-query',
    name: '恒剑 PLM 执行面智能体',
    version: '1.0.0',
    capabilities: [{
      name: 'query_plm',
      description: 'PLM 只读查询',
      constraints: { readOnly: true },
    }],
    connectionStatus: 'online',
    runtimeStatus: 'idle',
    lastSeenAt: '2026-10-22T00:00:00.000Z',
    currentRunId: null,
    registeredAt: '2026-10-01T00:00:00.000Z',
    local: false,
    sourceSystem: 'hengjian-plm',
    deregisteredAt: null,
  };
}

function controlQueryAgent(): ExecutionAgentRecord {
  return {
    agentId: 'gateway-control-platform',
    name: '公司中台查询智能体',
    version: '1.0.0',
    capabilities: [{
      name: 'query_control_platform',
      description: '中台只读查询',
      constraints: { readOnly: true },
    }],
    connectionStatus: 'online',
    runtimeStatus: 'idle',
    lastSeenAt: '2026-10-22T00:00:00.000Z',
    currentRunId: null,
    registeredAt: '2026-10-01T00:00:00.000Z',
    local: false,
    sourceSystem: 'control-platform',
    deregisteredAt: null,
  };
}

function makePlane() {
  const agents = [agent(), controlQueryAgent()];
  const dispatches: Array<{ agentId: string; capability: string; input: unknown }> = [];
  return {
    dispatches,
    list: () => ({ agents, runs: [] as ExecutionRunRecord[] }),
    dispatch: (agentId: string, capability: string, input: unknown) => {
      const target = agents.find((item) => item.agentId === agentId);
      if (!target || target.connectionStatus !== 'online') throw new ExecutionPlaneError('AGENT_OFFLINE', 'offline');
      dispatches.push({ agentId, capability, input });
      return { runId: `run-${dispatches.length}`, state: 'dispatched' as const };
    },
    getRun: () => undefined,
  };
}

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'capability-invocation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new BorrowOrderStore({ file: join(dir, 'borrow-orders.json') });
  const plane = makePlane();
  const borrowOrders = new BorrowOrderService({
    store,
    executionPlane: plane,
    appendEvidence: (entry) => entry,
    tenantId: 'tenant-demo',
  });
  let invocationId = 0;
  const service = new CapabilityInvocationService({
    borrowOrders,
    executionPlane: plane,
    idFactory: () => `id-${++invocationId}`,
  });
  return { service, plane, store };
}

test('capability invocation 按模板渲染并派单到固定 PLM Agent', (t) => {
  const { service, plane } = fixture(t);
  const result = service.invoke({
    fromSystem: 'control-platform',
    body: {
      capability: 'query_plm',
      params: { keyword: 'HJ.26033.V1.256JY' },
      requestId: 'req-cap-1',
      fromAgentId: 'runtime-control-platform-query',
    },
  });

  assert.equal(result.idempotent, false);
  assert.equal(result.capability, 'query_plm');
  assert.equal(result.templateVersion, '1.0.0');
  assert.equal(result.order.status, 'dispatched');
  assert.equal(result.order.providerAgentId, 'runtime-execution-query');
  assert.deepEqual(plane.dispatches[0]?.input, {
    path: '/project/page',
    params: {
      keyword: 'HJ.26033.V1.256JY',
      pageNum: 1,
      pageSize: 5,
    },
  });
});

test('同 requestId 同参数幂等返回原借调单', (t) => {
  const { service } = fixture(t);
  const body = {
    capability: 'query_plm',
    params: { keyword: 'HJ.26033.V1.256JY' },
    requestId: 'req-idempotent',
  };
  const first = service.invoke({ fromSystem: 'control-platform', body });
  const second = service.invoke({ fromSystem: 'control-platform', body });
  assert.equal(first.order.orderId, second.order.orderId);
  assert.equal(second.idempotent, true);
});

test('未知模板、非法参数、未知字段和自系统调用拒绝', (t) => {
  const { service } = fixture(t);

  assert.throws(
    () => service.invoke({ fromSystem: 'control-platform', body: { capability: 'query_missing' } }),
    (error: unknown) => (error as Error).message.includes('能力模板不存在'),
  );
  assert.throws(
    () => service.invoke({ fromSystem: 'control-platform', body: { capability: 'query_plm', params: {} } }),
    (error: unknown) => (error as Error).message.includes('缺少必填字段 keyword'),
  );
  assert.throws(
    () => service.invoke({
      fromSystem: 'control-platform',
      body: { capability: 'query_plm', params: { keyword: 'X', targetUrl: 'https://evil' } },
    }),
    (error: unknown) => (error as Error).message.includes('不支持的参数：targetUrl'),
  );
  assert.throws(
    () => service.invoke({
      fromSystem: 'hengjian-plm',
      body: { capability: 'query_plm', params: { keyword: 'X' } },
    }),
    (error: unknown) => (error as Error).message.includes('不能通过能力调用查询本系统'),
  );
});

test('PLM 可通过 query_control_platform 模板回查中台', (t) => {
  const { service, plane } = fixture(t);
  const result = service.invoke({
    fromSystem: 'hengjian-plm',
    body: {
      capability: 'query_control_platform',
      params: {
        path: '/external/orders/list',
        params: { page: 1, page_size: 5 },
      },
      requestId: 'req-control-1',
      fromAgentId: 'runtime-execution-query',
    },
  });

  assert.equal(result.order.status, 'dispatched');
  assert.equal(result.order.providerSystem, 'control-platform');
  assert.equal(result.order.providerAgentId, 'gateway-control-platform');
  assert.deepEqual(plane.dispatches.at(-1)?.input, {
    path: '/external/orders/list',
    params: { page: 1, page_size: 5 },
  });
});

test('中台不能通过 query_control_platform 调用本系统', (t) => {
  const { service } = fixture(t);
  assert.throws(
    () => service.invoke({
      fromSystem: 'control-platform',
      body: {
        capability: 'query_control_platform',
        params: { path: '/external/orders/list' },
      },
    }),
    (error: unknown) => (error as Error).message.includes('不能通过能力调用查询本系统'),
  );
});

test('底层借调冲突可透传', (t) => {
  const { service } = fixture(t);
  service.invoke({
    fromSystem: 'control-platform',
    body: { capability: 'query_plm', params: { keyword: 'A' }, requestId: 'same-id' },
  });
  assert.throws(
    () => service.invoke({
      fromSystem: 'control-platform',
      body: { capability: 'query_plm', params: { keyword: 'B' }, requestId: 'same-id' },
    }),
    (error: unknown) => error instanceof BorrowOrderServiceError && error.code === 'REQUEST_CONFLICT',
  );
});
