import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BorrowOrderServiceError } from '../src/borrow-order-service.ts';
import type { BorrowOrderRecord } from '../src/borrow-order-store.ts';
import { BorrowOrderExecutionAdapter } from '../src/orchestration-task-borrow-adapter.ts';
import { OrchestrationTaskExecutionError } from '../src/orchestration-task-executor.ts';

function order(overrides: Partial<BorrowOrderRecord> = {}): BorrowOrderRecord {
  return {
    orderId: 'borrow-1',
    tenantId: 'tenant-demo',
    requestId: 'task-1:1',
    requestHash: 'a'.repeat(64),
    fromSystem: 'control-platform',
    fromAgentId: null,
    capability: 'query_plm',
    capabilityVersion: '1.0.0',
    inputSchemaHash: null,
    outputSchemaHash: null,
    input: {},
    toSystem: 'hengjian-plm',
    toAgent: null,
    providerSystem: 'hengjian-plm',
    providerAgentId: 'runtime-execution-query',
    runId: 'run-1',
    status: 'completed',
    error: null,
    result: { ok: true },
    resultBytes: 11,
    resultTruncated: false,
    createdAt: '2026-10-21T06:00:00.000Z',
    updatedAt: '2026-10-21T06:00:01.000Z',
    dispatchedAt: '2026-10-21T06:00:00.000Z',
    startedAt: '2026-10-21T06:00:00.000Z',
    endedAt: '2026-10-21T06:00:01.000Z',
    ...overrides,
  };
}

test('create 返回借调单与 runId', async () => {
  let received: unknown = null;
  const adapter = new BorrowOrderExecutionAdapter({
    borrowOrderService: {
      create: ((input) => {
        received = input;
        return { order: order({ status: 'dispatched', result: null }), idempotent: false, auditStatus: 'recorded' };
      }) as never,
      getForSystem: (() => order()) as never,
    },
  });
  const created = await adapter.create({
    fromSystem: 'control-platform',
    requestId: 'task-1:1',
    capability: 'query_plm',
    systemId: 'hengjian-plm',
    input: { path: '/project/page' },
  });
  assert.deepEqual(created, { orderId: 'borrow-1', runId: 'run-1' });
  assert.deepEqual(received, {
    fromSystem: 'control-platform',
    body: {
      requestId: 'task-1:1',
      capability: 'query_plm',
      input: { path: '/project/page' },
      toSystem: 'hengjian-plm',
    },
  });
});

test('create 把借调错误映射为派单错误', async () => {
  const adapter = new BorrowOrderExecutionAdapter({
    borrowOrderService: {
      create: (() => { throw new BorrowOrderServiceError('NO_PROVIDER', 409, '没有提供方'); }) as never,
      getForSystem: (() => order()) as never,
    },
  });
  await assert.rejects(
    () => adapter.create({ fromSystem: 'control-platform', requestId: 'r', capability: 'query_plm', systemId: 'hengjian-plm', input: {} }),
    (error) => error instanceof OrchestrationTaskExecutionError
      && error.code === 'NO_PROVIDER'
      && error.stage === 'dispatch',
  );
});

test('waitForTerminal 返回完成结果', async () => {
  const adapter = new BorrowOrderExecutionAdapter({
    borrowOrderService: {
      create: (() => ({ order: order(), idempotent: false, auditStatus: 'recorded' })) as never,
      getForSystem: (() => order()) as never,
    },
  });
  const terminal = await adapter.waitForTerminal('borrow-1', 500, 'control-platform');
  assert.deepEqual(terminal, { status: 'completed', result: { ok: true } });
});

test('waitForTerminal 映射失败原因', async () => {
  const adapter = new BorrowOrderExecutionAdapter({
    borrowOrderService: {
      create: (() => ({ order: order(), idempotent: false, auditStatus: 'recorded' })) as never,
      getForSystem: (() => order({
        status: 'failed',
        result: null,
        error: { code: 'PROVIDER_OFFLINE', message: '提供方离线', stage: 'execution' },
      })) as never,
    },
  });
  const terminal = await adapter.waitForTerminal('borrow-1', 500, 'control-platform');
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.error?.code, 'PROVIDER_OFFLINE');
  assert.equal(terminal.error?.stage, 'execution');
});

test('waitForTerminal 超时返回 TASK_TIMEOUT', async () => {
  let time = 0;
  const adapter = new BorrowOrderExecutionAdapter({
    borrowOrderService: {
      create: (() => ({ order: order(), idempotent: false, auditStatus: 'recorded' })) as never,
      getForSystem: (() => order({ status: 'running', result: null })) as never,
    },
    pollIntervalMs: 10,
    now: () => time,
    sleep: async (ms) => { time += ms; },
  });
  await assert.rejects(
    () => adapter.waitForTerminal('borrow-1', 50, 'control-platform'),
    (error) => error instanceof OrchestrationTaskExecutionError
      && error.code === 'TASK_TIMEOUT'
      && error.stage === 'timeout',
  );
});

test('waitForTerminal 把取消映射为失败', async () => {
  const adapter = new BorrowOrderExecutionAdapter({
    borrowOrderService: {
      create: (() => ({ order: order(), idempotent: false, auditStatus: 'recorded' })) as never,
      getForSystem: (() => order({ status: 'cancelled', result: null })) as never,
    },
  });
  const terminal = await adapter.waitForTerminal('borrow-1', 500, 'control-platform');
  assert.equal(terminal.status, 'failed');
  assert.equal(terminal.error?.code, 'TASK_CANCELLED');
});
