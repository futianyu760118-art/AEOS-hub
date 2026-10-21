import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OrchestrationTaskExecutor,
  OrchestrationTaskExecutionError,
  type BorrowCreateInput,
  type BorrowExecutionPort,
  type BorrowTerminal,
} from '../src/orchestration-task-executor.ts';
import {
  OrchestrationTaskStore,
  orchestrationRequestHash,
  type OrchestrationPlanStep,
} from '../src/orchestration-task-store.ts';

const plan: OrchestrationPlanStep[] = [
  {
    stepId: 1,
    capability: 'query_plm',
    systemId: 'hengjian-plm',
    input: { path: '/project/page', params: { keyword: 'P-1' } },
  },
  {
    stepId: 2,
    capability: 'query_control_platform',
    systemId: 'other-system',
    input: { path: '/external/orders/list', params: { order_no: 'HJ-1' } },
  },
];

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-orchestration-executor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new OrchestrationTaskStore({
    file: join(dir, 'orchestration-tasks.json'),
    clock: () => new Date('2026-10-21T06:00:00.000Z'),
    idFactory: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  return { dir, store };
}

function createTask(store: OrchestrationTaskStore) {
  const context = {
    userId: null,
    userDisplayName: null,
    businessObjectRef: 'business://order/HJ-1',
    summary: '测试任务',
    evidenceRefs: [],
  };
  const constraints = { readOnly: true, maxSteps: 8 };
  return store.create({
    tenantId: 'tenant-demo',
    fromSystem: 'control-platform',
    taskId: 'task-1',
    requestHash: orchestrationRequestHash({
      taskId: 'task-1', conversationId: 'conv-1', turn: 2, plan, context, constraints,
    }),
    conversationId: 'conv-1',
    turn: 2,
    plan,
    context,
    constraints,
  });
}

class FakeBorrowPort implements BorrowExecutionPort {
  calls: BorrowCreateInput[] = [];
  waits: Array<{ orderId: string; timeoutMs: number }> = [];
  private index = 0;
  private readonly script: Array<{
    createError?: OrchestrationTaskExecutionError;
    terminal?: BorrowTerminal;
  }>;

  constructor(script: Array<{
    createError?: OrchestrationTaskExecutionError;
    terminal?: BorrowTerminal;
  }>) {
    this.script = script;
  }

  async create(input: BorrowCreateInput) {
    this.calls.push(input);
    const item = this.script[this.index++];
    if (item?.createError) throw item.createError;
    return { orderId: `borrow-${this.calls.length}`, runId: `run-${this.calls.length}` };
  }

  async waitForTerminal(orderId: string, timeoutMs: number) {
    this.waits.push({ orderId, timeoutMs });
    const item = this.script[this.calls.length - 1];
    if (!item?.terminal) throw new Error('missing fake terminal');
    return item.terminal;
  }
}

test('两步顺序执行并完成', async (t) => {
  const { store } = fixture(t);
  const task = createTask(store);
  const port = new FakeBorrowPort([
    { terminal: { status: 'completed', result: { items: [{ id: 1 }], evidence_refs: ['e1'], data_as_of: '2026-10-21' } } },
    { terminal: { status: 'completed', result: { ok: true } } },
  ]);
  const executor = new OrchestrationTaskExecutor({ store, borrowPort: port });
  const result = await executor.executeTask(task.hubTaskId);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.completedStepIds, [1, 2]);
  assert.equal(result.runs[0].status, 'completed');
  assert.equal(result.runs[0].runId, 'run-1');
  assert.equal(result.runs[0].borrowOrderId, 'borrow-1');
  assert.deepEqual(result.runs[0].evidenceRefs, ['e1']);
  assert.equal(result.runs[0].dataAsOf, '2026-10-21');
  assert.equal(result.runs[1].status, 'completed');
  assert.deepEqual(port.calls.map((call) => call.capability), ['query_plm', 'query_control_platform']);
  assert.equal(port.calls[0].requestId, 'task-1:1');
  assert.equal(port.calls[0].systemId, 'hengjian-plm');
});

test('第二步失败时停止并保留已完成步骤', async (t) => {
  const { store } = fixture(t);
  const task = createTask(store);
  const port = new FakeBorrowPort([
    { terminal: { status: 'completed', result: { ok: true } } },
    { terminal: { status: 'failed', error: { code: 'PROVIDER_OFFLINE', message: '提供方离线', stage: 'execution' } } },
  ]);
  const executor = new OrchestrationTaskExecutor({ store, borrowPort: port });
  const result = await executor.executeTask(task.hubTaskId);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.completedStepIds, [1]);
  assert.equal(result.runs[0].status, 'completed');
  assert.equal(result.runs[1].status, 'failed');
  assert.equal(result.error?.code, 'PROVIDER_OFFLINE');
  assert.equal(result.error?.stepId, 2);
  assert.match(result.partialReason ?? '', /已完成步骤：1/);
  assert.equal(port.calls.length, 2);
});

test('派单失败时任务失败，不等待', async (t) => {
  const { store } = fixture(t);
  const task = createTask(store);
  const port = new FakeBorrowPort([
    { createError: new OrchestrationTaskExecutionError('DISPATCH_FAILED', '派单失败', 'dispatch') },
  ]);
  const executor = new OrchestrationTaskExecutor({ store, borrowPort: port });
  const result = await executor.executeTask(task.hubTaskId);
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'DISPATCH_FAILED');
  assert.equal(result.runs[0].status, 'failed');
  assert.equal(port.waits.length, 0);
});

test('执行超时后任务失败', async (t) => {
  const { store } = fixture(t);
  const task = createTask(store);
  const port = new FakeBorrowPort([
    { terminal: { status: 'failed', error: { code: 'TASK_TIMEOUT', message: '超时', stage: 'timeout' } } },
  ]);
  const executor = new OrchestrationTaskExecutor({ store, borrowPort: port });
  const result = await executor.executeTask(task.hubTaskId);
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'TASK_TIMEOUT');
  assert.equal(result.error?.stage, 'timeout');
  assert.equal(result.runs[0].status, 'failed');
});

test('超长结果被截断', async (t) => {
  const { store } = fixture(t);
  const task = createTask(store);
  const port = new FakeBorrowPort([
    { terminal: { status: 'completed', result: { data: 'x'.repeat(300_000) } } },
    { terminal: { status: 'completed', result: { ok: true } } },
  ]);
  const executor = new OrchestrationTaskExecutor({ store, borrowPort: port });
  const result = await executor.executeTask(task.hubTaskId);
  assert.equal(result.status, 'completed');
  assert.equal(result.runs[0].truncated, true);
  assert.ok(result.runs[0].resultBytes > 256 * 1024);
});

test('终态任务不会重复执行', async (t) => {
  const { store } = fixture(t);
  const task = createTask(store);
  store.update(task.hubTaskId, (current) => ({ ...current, status: 'completed' }));
  const port = new FakeBorrowPort([]);
  const executor = new OrchestrationTaskExecutor({ store, borrowPort: port });
  const result = await executor.executeTask(task.hubTaskId);
  assert.equal(result.status, 'completed');
  assert.equal(port.calls.length, 0);
});

test('总预算耗尽时直接失败', async (t) => {
  const { store } = fixture(t);
  const task = createTask(store);
  const port = new FakeBorrowPort([]);
  const executor = new OrchestrationTaskExecutor({ store, borrowPort: port, totalBudgetMs: -1 });
  const result = await executor.executeTask(task.hubTaskId);
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'TASK_TIMEOUT');
  assert.equal(port.calls.length, 0);
});
