import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { TaskCenterStore } from '../src/task-center.ts';

const FIXED_NOW = '2026-10-10T08:30:00.000Z';

function fixture(t: TestContext): TaskCenterStore {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-task-center-'));
  let id = 0;
  const store = new TaskCenterStore({
    file: join(dir, 'data', 'task-center.json'),
    clock: () => new Date(FIXED_NOW),
    idFactory: () => `test-${++id}`,
    tenantId: 'pilot-tenant',
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return store;
}

const operatingCase = {
  caseId: 'case-order-1001',
  source: 'order',
  entityId: 'SO-1001',
  title: '订单 SO-1001 交付风险',
  evidenceRefs: ['order:SO-1001', 'quality:QI-09'],
  ownerRole: '订单交付负责人',
  correlationId: 'corr-order-1001',
};

function createTask(store: TaskCenterStore) {
  return store.createFromOperatingCase({
    ...operatingCase,
    priority: 'high',
    dueAt: '2026-10-15',
    actor: 'user:manager-01',
    reason: '建立经营风险闭环任务',
  });
}

function assignAndStart(store: TaskCenterStore, taskId: string) {
  store.assign({ taskId, assigneeRole: '订单交付负责人', actor: 'user:manager-01', reason: '指定责任角色' });
  store.transition({ taskId, toStatus: 'ACCEPTED', actor: 'user:delivery-01', reason: '接受任务' });
  return store.transition({ taskId, toStatus: 'IN_PROGRESS', actor: 'user:delivery-01', reason: '开始核查' });
}

test('creates one evidence-bound task per open operating case and enforces the core state path', (t) => {
  const store = fixture(t);
  const created = createTask(store);
  const replay = createTask(store);

  assert.equal(created.taskId, replay.taskId);
  assert.equal(store.load().tasks.length, 1);
  assert.equal(store.load().revision, 1);
  assert.equal(created.status, 'DRAFT');
  assert.equal(created.tenantId, 'pilot-tenant');
  assert.equal(created.businessObjectRef, 'business://order/SO-1001');
  assert.deepEqual(created.evidenceRefs, ['order:SO-1001', 'quality:QI-09']);
  assert.equal(store.load().history.length, 1);
  assert.throws(
    () => store.transition({ taskId: created.taskId, toStatus: 'COMPLETED', actor: 'user:manager-01', reason: '跳过处理' }),
    /不允许/,
  );

  assignAndStart(store, created.taskId);
  const awaitingVerify = store.recordPendingResult({
    taskId: created.taskId,
    resultId: 'result-1001',
    actor: 'agent:order-analysis',
    reason: '已提交只读分析结果，等待业务核验',
    evidenceRefs: ['analysis:result-1001'],
  });
  const completed = store.verifyResult({
    taskId: created.taskId,
    resultId: 'result-1001',
    outcome: 'VERIFIED',
    actor: 'user:business-owner-01',
    reason: '业务负责人核验通过',
  });

  assert.equal(awaitingVerify.status, 'AWAITING_VERIFY');
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.currentAssignee?.role, '订单交付负责人');
  assert.deepEqual(store.load().history.map((entry) => entry.toStatus), [
    'DRAFT', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_VERIFY', 'COMPLETED',
  ]);
});

test('preserves reassignment and evidence history, requires escalation action, and blocks agent verification', (t) => {
  const store = fixture(t);
  const task = createTask(store);
  assignAndStart(store, task.taskId);

  const reassigned = store.assign({
    taskId: task.taskId,
    assigneeRole: '供应链负责人',
    actor: 'user:manager-01',
    reason: '需要供应协同处理',
  });
  assert.equal(reassigned.currentAssignee?.role, '供应链负责人');
  assert.equal(store.load().history.at(-1)?.eventType, 'reassigned');
  assert.equal(store.load().history.at(-1)?.reason, '需要供应协同处理');

  const supplemented = store.supplementEvidence({
    taskId: task.taskId,
    evidenceRefs: ['quality:QI-09', 'supplier:SUP-20'],
    actor: 'user:manager-01',
    reason: '补充供应商证据',
  });
  assert.deepEqual(supplemented.evidenceRefs, ['order:SO-1001', 'quality:QI-09', 'supplier:SUP-20']);

  assert.throws(
    () => store.escalate({ taskId: task.taskId, actor: 'user:manager-01', reason: '需要协同' }),
    /下一步动作/,
  );
  const escalated = store.escalate({
    taskId: task.taskId,
    actor: 'user:manager-01',
    reason: '需管理层协调供应优先级',
    nextAction: '由供应链总监在今日 17:00 前确认供应优先级',
  });
  assert.equal(escalated.status, 'AWAITING_DECISION');
  assert.equal(escalated.nextAction, '由供应链总监在今日 17:00 前确认供应优先级');
  assert.equal(escalated.currentAssignee?.role, '供应链负责人');

  store.transition({ taskId: task.taskId, toStatus: 'IN_PROGRESS', actor: 'user:supply-01', reason: '协调结论已下达' });
  store.recordPendingResult({
    taskId: task.taskId, resultId: 'result-1002', actor: 'agent:supply-analysis', reason: '等待业务负责人核验', evidenceRefs: ['analysis:result-1002'],
  });
  assert.throws(
    () => store.verifyResult({
      taskId: task.taskId, resultId: 'result-1002', outcome: 'VERIFIED', actor: 'agent:supply-analysis', reason: '不允许自证',
    }),
    /不能核验/,
  );
  const rejected = store.verifyResult({
    taskId: task.taskId, resultId: 'result-1002', outcome: 'REJECTED', actor: 'user:business-owner-01', reason: '证据不足，退回重做',
  });
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.currentAssignee?.role, '供应链负责人');
});

test('keeps the accountable role and next action visible when work fails', (t) => {
  const store = fixture(t);
  const task = createTask(store);
  assignAndStart(store, task.taskId);

  assert.throws(
    () => store.transition({ taskId: task.taskId, toStatus: 'FAILED', actor: 'user:delivery-01', reason: '外部系统不可用' }),
    /下一步动作/,
  );
  const failed = store.transition({
    taskId: task.taskId,
    toStatus: 'FAILED',
    actor: 'user:delivery-01',
    reason: '外部系统不可用',
    nextAction: '由信息中心在两个工作小时内恢复数据接口后重新发起任务',
  });

  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.currentAssignee?.role, '订单交付负责人');
  assert.equal(failed.nextAction, '由信息中心在两个工作小时内恢复数据接口后重新发起任务');
  assert.notEqual(failed.status, 'COMPLETED');
});
