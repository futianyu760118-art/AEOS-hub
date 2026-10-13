import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTaskAssignmentPayload, canCreateTaskFromCase, g1TaskUiMutationGate, taskDisplayState, taskInteractionPolicy, taskUiCapabilities } from '../public/task-center.js';

const baseTask = {
  taskId: 'task-01', caseId: 'case-01', title: '订单交付风险', priority: 'high', dueAt: '2026-10-15',
  currentAssignee: { kind: 'responsibility_role', role: '订单交付负责人', actorId: 'm01:user:operator-demo', assignedAt: '2026-10-10T01:00:00.000Z' },
  status: 'IN_PROGRESS', evidenceRefs: ['control://order/SO-01'], nextAction: '继续核查缺口', resultId: null,
};
const g0Ready = {
  readyForG1: true,
  decisions: { scope: { value: { demoTenantId: 'demo-tenant', organizationScope: 'demo-org' } } },
};
const operatorSession = { actorId: 'm01:user:operator-demo', actorType: 'human', tenantId: 'demo-tenant', organizationId: 'demo-org', roles: ['operator'] };

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

test('builds a manager assignment request with only target identity and task data', () => {
  const payload = buildTaskAssignmentPayload({
    assigneeRole: '订单交付负责人 ', assigneeActorId: ' m01:user:operator-demo ', reason: '由订单交付组跟进。 ',
    actorId: 'm01:user:manager-demo', tenantId: 'demo-tenant', roles: 'manager',
  });

  assert.deepEqual(payload, {
    assigneeRole: '订单交付负责人', assigneeActorId: 'm01:user:operator-demo', reason: '由订单交付组跟进。',
  });
  assert.equal(Object.hasOwn(payload, 'actorId'), false);
  assert.equal(Object.hasOwn(payload, 'tenantId'), false);
  assert.equal(Object.hasOwn(payload, 'roles'), false);
});

test('projects operator actions only onto the assigned human actor', () => {
  const assigned = taskUiCapabilities(baseTask, operatorSession, '', g0Ready);
  const other = taskUiCapabilities(baseTask, { ...operatorSession, actorId: 'm01:user:other-operator' }, '', g0Ready);

  assert.equal(assigned.canSupplementEvidence, true);
  assert.equal(assigned.canSubmitPendingResult, true);
  assert.equal(other.canSupplementEvidence, false);
  assert.equal(other.canSubmitPendingResult, false);
  assert.equal(other.canStart, false);
});

test('projects verification only onto the registered supervisor/manager actor', () => {
  const awaiting = { ...baseTask, status: 'AWAITING_VERIFY', resultId: 'result-01' };
  const verifier = taskUiCapabilities(awaiting, { ...operatorSession, actorId: 'm01:user:supervisor-demo', roles: ['supervisor'] }, 'm01:user:supervisor-demo', g0Ready);
  const wrongVerifier = taskUiCapabilities(awaiting, { ...operatorSession, actorId: 'm01:user:other-supervisor', roles: ['supervisor'] }, 'm01:user:supervisor-demo', g0Ready);

  assert.equal(verifier.canVerify, true);
  assert.equal(verifier.canReject, true);
  assert.equal(wrongVerifier.canVerify, false);
  assert.equal(wrongVerifier.canReject, false);
});

test('keeps agent and system sessions read-only and only lets manager create an order task', () => {
  for (const actorType of ['agent', 'system', 'service']) {
    const capabilities = taskUiCapabilities(baseTask, { ...operatorSession, actorId: `${actorType}:analysis`, actorType, roles: ['manager', 'operator', 'owner'] }, 'm01:user:owner-demo', g0Ready);
    assert.equal(capabilities.canAssign, false);
    assert.equal(capabilities.canAccept, false);
    assert.equal(capabilities.canSubmitPendingResult, false);
    assert.equal(capabilities.canVerify, false);
    assert.equal(capabilities.isReadOnly, true);
  }

  const manager = { ...operatorSession, actorId: 'm01:user:manager-demo', roles: ['manager'] };
  assert.equal(canCreateTaskFromCase(manager, { source: 'order', evidenceRefs: ['control://order/SO-01'] }, g0Ready), true);
  assert.equal(canCreateTaskFromCase(manager, { source: 'quality', evidenceRefs: ['control://quality/Q-01'] }, g0Ready), false);
  assert.equal(canCreateTaskFromCase({ ...manager, roles: ['operator'] }, { source: 'order', evidenceRefs: ['control://order/SO-01'] }, g0Ready), false);
});

test('fails closed for every mutation control when G0 cannot establish a ready matching scope', () => {
  const manager = { ...operatorSession, actorId: 'm01:user:manager-demo', roles: ['manager'] };
  const awaiting = { ...baseTask, status: 'AWAITING_VERIFY', resultId: 'result-01' };
  const owner = { ...operatorSession, actorId: 'm01:user:owner-demo', roles: ['owner'] };
  const unavailable = taskUiCapabilities(baseTask, manager, '', null);
  const notReady = taskUiCapabilities(baseTask, operatorSession, '', { ...g0Ready, readyForG1: false });
  const wrongTenant = taskUiCapabilities(baseTask, manager, '', { ...g0Ready, decisions: { scope: { value: { demoTenantId: 'other-tenant', organizationScope: 'demo-org' } } } });
  const wrongOrganization = taskUiCapabilities(awaiting, { ...owner, organizationId: 'other-org' }, 'm01:user:owner-demo', g0Ready);

  assert.equal(unavailable.canAssign, false);
  assert.equal(unavailable.isReadOnly, true);
  assert.equal(notReady.canSupplementEvidence, false);
  assert.equal(notReady.canSubmitPendingResult, false);
  assert.equal(wrongTenant.canCreate, false);
  assert.equal(wrongOrganization.canVerify, false);
  assert.equal(canCreateTaskFromCase(manager, { source: 'order', evidenceRefs: ['control://order/SO-01'] }, null), false);
  assert.equal(g1TaskUiMutationGate(operatorSession, { ...g0Ready, readyForG1: false }).code, 'G0_NOT_READY');
});
