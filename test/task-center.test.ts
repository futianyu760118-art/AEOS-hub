import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  store.assign({ taskId, assigneeRole: '订单交付负责人', assigneeActorId: 'm01:user:delivery-01', actor: 'user:manager-01', reason: '指定责任角色' });
  store.transition({ taskId, toStatus: 'ACCEPTED', actor: 'm01:user:delivery-01', reason: '接受任务' });
  return store.transition({ taskId, toStatus: 'IN_PROGRESS', actor: 'm01:user:delivery-01', reason: '开始核查' });
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
    actor: 'm01:user:delivery-01',
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
    assigneeActorId: 'm01:user:supply-01',
    actor: 'user:manager-01',
    reason: '需要供应协同处理',
  });
  assert.equal(reassigned.currentAssignee?.role, '供应链负责人');
  assert.equal(store.load().history.at(-1)?.eventType, 'reassigned');
  assert.equal(store.load().history.at(-1)?.reason, '需要供应协同处理');

  const supplemented = store.supplementEvidence({
    taskId: task.taskId,
    evidenceRefs: ['quality:QI-09', 'supplier:SUP-20'],
    actor: 'm01:user:supply-01',
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

  store.transition({ taskId: task.taskId, toStatus: 'IN_PROGRESS', actor: 'm01:user:supply-01', reason: '协调结论已下达' });
  store.recordPendingResult({
    taskId: task.taskId, resultId: 'result-1002', actor: 'm01:user:supply-01', reason: '等待业务负责人核验', evidenceRefs: ['analysis:result-1002'],
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

test('binds each assignment to a specific operator and rejects a role-only assignment', (t) => {
  const store = fixture(t);
  const task = createTask(store);

  assert.throws(
    () => store.assign({ taskId: task.taskId, assigneeRole: '订单交付负责人', actor: 'user:manager-01', reason: '缺少指定人员' }),
    /assigneeActorId不能为空/,
  );

  const assigned = store.assign({
    taskId: task.taskId,
    assigneeRole: '订单交付负责人',
    assigneeActorId: 'm01:user:delivery-01',
    actor: 'user:manager-01',
    reason: '指定具体经办人',
  });
  assert.deepEqual(assigned.currentAssignee, {
    kind: 'responsibility_role',
    role: '订单交付负责人',
    actorId: 'm01:user:delivery-01',
    assignedAt: FIXED_NOW,
  });
});

test('migrates persisted role-only assignments to a safe unassigned state requiring reassignment', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-task-center-legacy-'));
  const file = join(dir, 'data', 'task-center.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'data'));
  writeFileSync(file, `${JSON.stringify({
    version: 1,
    revision: 4,
    updatedAt: FIXED_NOW,
    tasks: [{
      taskId: 'task-legacy-01', tenantId: 'pilot-tenant', businessObjectRef: 'business://order/SO-1001',
      caseId: 'case-order-1001', source: 'order', title: '历史订单风险', evidenceRefs: ['order:SO-1001'],
      priority: 'high', dueAt: '2026-10-15', initiatedBy: 'user:manager-01',
      currentAssignee: { kind: 'responsibility_role', role: '订单交付负责人', assignedAt: FIXED_NOW },
      status: 'ASSIGNED', correlationId: 'corr-order-1001', nextAction: '等待责任角色接受任务', resultId: null,
      createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
    }],
    history: [{
      eventId: 'task-event-legacy-01', taskId: 'task-legacy-01', eventType: 'assigned', fromStatus: 'DRAFT', toStatus: 'ASSIGNED',
      actor: 'user:manager-01', reason: '历史分派', evidenceRefs: ['order:SO-1001'], occurredAt: FIXED_NOW,
    }],
  }, null, 2)}\n`, { encoding: 'utf8', flush: true });

  const store = new TaskCenterStore({ file, clock: () => new Date(FIXED_NOW), tenantId: 'pilot-tenant' });
  const migrated = store.load().tasks[0]!;

  assert.equal(migrated.currentAssignee, null);
  assert.equal(migrated.status, 'ASSIGNED');
  assert.match(migrated.nextAction, /订单交付负责人/);
  assert.match(migrated.nextAction, /重新分派/);
  assert.equal(store.load().history[0]?.reason, '历史分派');
  assert.throws(
    () => store.transition({ taskId: migrated.taskId, toStatus: 'ACCEPTED', actor: 'm01:user:delivery-01', reason: '不能操作旧角色分派' }),
    /尚未分派具体责任人/,
  );
  const reassigned = store.assign({
    taskId: migrated.taskId, assigneeRole: '订单交付负责人', assigneeActorId: 'm01:user:delivery-01',
    actor: 'm01:user:manager-01', reason: '迁移后重新分派',
  });
  assert.equal(reassigned.currentAssignee?.actorId, 'm01:user:delivery-01');
});

test('keeps the accountable role and next action visible when work fails', (t) => {
  const store = fixture(t);
  const task = createTask(store);
  assignAndStart(store, task.taskId);

  assert.throws(
    () => store.transition({ taskId: task.taskId, toStatus: 'FAILED', actor: 'm01:user:delivery-01', reason: '外部系统不可用' }),
    /下一步动作/,
  );
  const failed = store.transition({
    taskId: task.taskId,
    toStatus: 'FAILED',
    actor: 'm01:user:delivery-01',
    reason: '外部系统不可用',
    nextAction: '由信息中心在两个工作小时内恢复数据接口后重新发起任务',
  });

  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.currentAssignee?.role, '订单交付负责人');
  assert.equal(failed.nextAction, '由信息中心在两个工作小时内恢复数据接口后重新发起任务');
  assert.notEqual(failed.status, 'COMPLETED');
});

test('rejects malformed actorId values instead of treating them as legacy assignments', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-task-center-corrupt-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'data'));

  for (const actorId of [null, ' ', 7]) {
    const file = join(dir, 'data', `task-center-${String(actorId)}.json`);
    writeFileSync(file, `${JSON.stringify({
      version: 1, revision: 1, updatedAt: FIXED_NOW,
      tasks: [{
        taskId: `task-corrupt-${String(actorId)}`, tenantId: 'pilot-tenant', businessObjectRef: 'business://order/SO-1001',
        caseId: 'case-order-1001', source: 'order', title: '损坏分派', evidenceRefs: ['order:SO-1001'], priority: 'high', dueAt: '2026-10-15',
        initiatedBy: 'user:manager-01', currentAssignee: { kind: 'responsibility_role', role: '订单交付负责人', actorId, assignedAt: FIXED_NOW },
        status: 'ASSIGNED', correlationId: 'corr-order-1001', nextAction: '等待处理', resultId: null, createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
      }],
      history: [{ eventId: `event-corrupt-${String(actorId)}`, taskId: `task-corrupt-${String(actorId)}`, eventType: 'assigned', fromStatus: 'DRAFT', toStatus: 'ASSIGNED', actor: 'user:manager-01', reason: '损坏数据', evidenceRefs: ['order:SO-1001'], occurredAt: FIXED_NOW }],
    })}\n`, { encoding: 'utf8', flush: true });
    const store = new TaskCenterStore({ file, clock: () => new Date(FIXED_NOW), tenantId: 'pilot-tenant' });
    assert.throws(() => store.load(), /任务中心 数据无效/);
  }
});

test('binds operator transitions, evidence, and result submission to the assigned actor', (t) => {
  const store = fixture(t);
  const task = createTask(store);
  store.assign({ taskId: task.taskId, assigneeRole: '订单交付负责人', assigneeActorId: 'm01:user:delivery-01', actor: 'm01:user:manager-01', reason: '指定经办人' });

  assert.throws(
    () => store.transition({ taskId: task.taskId, toStatus: 'ACCEPTED', actor: 'm01:user:operator-other', reason: '越权接受' }),
    /只能由被分派的具体责任人操作/,
  );
  assert.throws(
    () => store.transition({ taskId: task.taskId, toStatus: 'ACCEPTED', actor: 'agent:order-analysis', reason: 'Agent 不可接受' }),
    /不能执行人工任务操作/,
  );
  store.transition({ taskId: task.taskId, toStatus: 'ACCEPTED', actor: 'm01:user:delivery-01', reason: '接受任务' });
  store.transition({ taskId: task.taskId, toStatus: 'IN_PROGRESS', actor: 'm01:user:delivery-01', reason: '开始处理' });
  assert.throws(
    () => store.supplementEvidence({ taskId: task.taskId, evidenceRefs: ['analysis:other'], actor: 'm01:user:operator-other', reason: '越权补证' }),
    /只能由被分派的具体责任人操作/,
  );
  assert.throws(
    () => store.recordPendingResult({ taskId: task.taskId, resultId: 'result-other', actor: 'system:sync', reason: '系统不可提交', evidenceRefs: ['analysis:other'] }),
    /不能执行人工任务操作/,
  );
});

test('blocks every non-human identity format from human task execution and verification', (t) => {
  const store = fixture(t);
  const task = createTask(store);
  store.assign({ taskId: task.taskId, assigneeRole: '订单交付负责人', assigneeActorId: 'service:sync', actor: 'm01:user:manager-01', reason: '错误分派服务账号' });
  for (const actor of ['service:sync', 'm01:agent:order-analysis', 'm01:system:sync']) {
    assert.throws(
      () => store.transition({ taskId: task.taskId, toStatus: 'ACCEPTED', actor, reason: '非人工身份不可接受' }),
      /不能执行人工任务操作/,
    );
  }

  store.assign({ taskId: task.taskId, assigneeRole: '订单交付负责人', assigneeActorId: 'm01:user:delivery-01', actor: 'm01:user:manager-01', reason: '更正为人工经办人' });
  store.transition({ taskId: task.taskId, toStatus: 'ACCEPTED', actor: 'm01:user:delivery-01', reason: '接受任务' });
  store.transition({ taskId: task.taskId, toStatus: 'IN_PROGRESS', actor: 'm01:user:delivery-01', reason: '开始处理' });
  store.recordPendingResult({ taskId: task.taskId, resultId: 'result-service', actor: 'm01:user:delivery-01', reason: '提交人工结果', evidenceRefs: ['analysis:service'] });
  for (const actor of ['service:sync', 'm01:service:sync', 'm01:agent:order-analysis', 'm01:system:sync']) {
    assert.throws(
      () => store.verifyResult({ taskId: task.taskId, resultId: 'result-service', outcome: 'VERIFIED', actor, reason: '服务账号不可核验' }),
      /不能核验/,
    );
  }
});

test('deleteTask 删除任务及其历史记录', (t) => {
  const store = fixture(t);
  const task = createTask(store);
  assert.deepEqual(store.deleteTask({ taskId: task.taskId }), { deleted: true });
  const snapshot = store.load();
  assert.equal(snapshot.tasks.some((candidate) => candidate.taskId === task.taskId), false);
  assert.equal(snapshot.history.some((entry) => entry.taskId === task.taskId), false);
});

test('deleteTask 删除不存在的任务返回 deleted:false', (t) => {
  const store = fixture(t);
  assert.deepEqual(store.deleteTask({ taskId: 'task-none' }), { deleted: false });
});
