import assert from 'node:assert/strict';
import test from 'node:test';
import { taskDisplayState, taskInteractionPolicy } from '../public/task-center.js';

const baseTask = {
  taskId: 'task-01', caseId: 'case-01', title: '订单交付风险', priority: 'high', dueAt: '2026-10-15',
  currentAssignee: { kind: 'responsibility_role', role: '订单交付负责人', assignedAt: '2026-10-10T01:00:00.000Z' },
  status: 'IN_PROGRESS', evidenceRefs: ['control://order/SO-01'], nextAction: '继续核查缺口', resultId: null,
};

test('marks failed or overdue work as attention required with the accountable role and next action', () => {
  const failed = taskDisplayState({ ...baseTask, status: 'FAILED', nextAction: '信息中心恢复接口后重新处理' }, '2026-10-10');
  assert.equal(failed.needsAttention, true);
  assert.equal(failed.assigneeLabel, '订单交付负责人');
  assert.equal(failed.nextAction, '信息中心恢复接口后重新处理');
  assert.notEqual(failed.label, '已完成');

  const overdue = taskDisplayState({ ...baseTask, dueAt: '2026-10-09' }, '2026-10-10');
  assert.equal(overdue.needsAttention, true);
  assert.equal(overdue.overdue, true);
  assert.equal(overdue.assigneeLabel, '订单交付负责人');
});

test('shows pending Result as awaiting business verification and never offers automatic execution or self-verification', () => {
  const waiting = taskDisplayState({ ...baseTask, status: 'AWAITING_VERIFY', resultId: 'result-01' }, '2026-10-10');
  const policy = taskInteractionPolicy({ ...baseTask, status: 'AWAITING_VERIFY', resultId: 'result-01' });

  assert.equal(waiting.label, '待业务核验');
  assert.equal(policy.canVerify, true);
  assert.equal(policy.allowsAutomaticBusinessExecution, false);
  assert.equal(policy.allowsAgentSelfVerification, false);
});
