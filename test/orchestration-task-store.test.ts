import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OrchestrationTaskStore,
  OrchestrationTaskStoreError,
  capOrchestrationResult,
  orchestrationRequestHash,
  type OrchestrationContext,
  type OrchestrationConstraints,
  type OrchestrationPlanStep,
} from '../src/orchestration-task-store.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-orchestration-tasks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { current: new Date('2026-10-21T06:00:00.000Z') };
  let sequence = 0;
  const store = new OrchestrationTaskStore({
    file: join(dir, 'orchestration-tasks.json'),
    clock: () => clock.current,
    idFactory: () => `id-${++sequence}`,
  });
  return { dir, clock, store };
}

const plan: OrchestrationPlanStep[] = [
  {
    stepId: 1,
    capability: 'query_plm',
    systemId: 'hengjian-plm',
    input: { path: '/project/page', params: { keyword: 'P-001' } },
  },
  {
    stepId: 2,
    capability: 'query_control_platform',
    systemId: 'other-system',
    input: { path: '/external/orders/list', params: { order_no: 'HJ-1' } },
  },
];

const context: OrchestrationContext = {
  userId: 'user-1',
  userDisplayName: '测试用户',
  businessObjectRef: 'business://order/HJ-1',
  summary: '查询 PLM 进度',
  evidenceRefs: ['control-platform://order/HJ-1/line/0010'],
};

const constraints: OrchestrationConstraints = { readOnly: true, maxSteps: 8 };

function create(store: OrchestrationTaskStore, overrides: Record<string, unknown> = {}) {
  const input = {
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
    ...overrides,
  };
  return store.create(input);
}

test('创建任务并初始化步骤', (t) => {
  const { store } = fixture(t);
  const task = create(store);
  assert.match(task.hubTaskId, /^hub-task-id-/);
  assert.equal(task.status, 'pending');
  assert.equal(task.fromSystem, 'control-platform');
  assert.equal(task.taskId, 'task-1');
  assert.equal(task.runs.length, 2);
  assert.deepEqual(task.runs.map((run) => run.status), ['pending', 'pending']);
  assert.deepEqual(task.completedStepIds, []);
  assert.equal(store.get(task.hubTaskId)?.hubTaskId, task.hubTaskId);
  assert.equal(store.findByTaskId('control-platform', 'task-1')?.hubTaskId, task.hubTaskId);
});

test('同一系统下 taskId 重复时拒绝', (t) => {
  const { store } = fixture(t);
  create(store);
  assert.throws(() => create(store), (error) => error instanceof OrchestrationTaskStoreError
    && error.code === 'ORCHESTRATION_TASK_DUPLICATE');
  // 不同系统可以复用同一个 taskId
  assert.doesNotThrow(() => create(store, { fromSystem: 'other-system' }));
});

test('requestHash 对对象键顺序稳定，对内容变化敏感', () => {
  const base = {
    taskId: 'task-1',
    conversationId: 'conv-1',
    turn: 2,
    plan,
    context,
    constraints,
  };
  const reordered = {
    ...base,
    plan: plan.map((step) => ({ ...step, input: { params: step.input.params, path: step.input.path } })),
  };
  assert.equal(orchestrationRequestHash(base), orchestrationRequestHash(reordered));
  assert.notEqual(orchestrationRequestHash(base), orchestrationRequestHash({ ...base, turn: 3 }));
});

test('更新任务状态与步骤结果', (t) => {
  const { store } = fixture(t);
  const task = create(store);
  const updated = store.update(task.hubTaskId, (current) => ({
    ...current,
    status: 'running',
    runs: current.runs.map((run) => run.stepId === 1
      ? {
          ...run,
          status: 'completed',
          runId: 'exec-run-1',
          borrowOrderId: 'borrow-1',
          startedAt: '2026-10-21T06:00:01.000Z',
          endedAt: '2026-10-21T06:00:02.000Z',
          result: { ok: true },
          resultBytes: 11,
        }
      : run),
    completedStepIds: [1],
  }));
  assert.equal(updated.status, 'running');
  assert.equal(updated.runs[0].status, 'completed');
  assert.equal(updated.runs[0].runId, 'exec-run-1');
  assert.deepEqual(updated.completedStepIds, [1]);
  assert.equal(store.get(task.hubTaskId)?.runs[0].resultBytes, 11);
});

test('更新不存在任务时报错', (t) => {
  const { store } = fixture(t);
  assert.throws(() => store.update('hub-task-missing', (task) => task), (error) => error instanceof OrchestrationTaskStoreError
    && error.code === 'ORCHESTRATION_TASK_NOT_FOUND');
});

test('超长结果截断并保留大小与预览', () => {
  const capped = capOrchestrationResult({ data: 'x'.repeat(300_000) });
  assert.equal(capped.truncated, true);
  assert.ok(capped.resultBytes > 256 * 1024);
  assert.equal((capped.result as { truncated: boolean }).truncated, true);
});

test('重载后仍能读取任务', (t) => {
  const { dir, store } = fixture(t);
  const task = create(store);
  const reloaded = new OrchestrationTaskStore({ file: join(dir, 'orchestration-tasks.json') });
  assert.equal(reloaded.get(task.hubTaskId)?.taskId, 'task-1');
});
