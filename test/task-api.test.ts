import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { G0DecisionRegisterStore } from '../src/g0-decision-register.ts';
import { OperatingCenterStore } from '../src/operating-center.ts';
import { TaskCenterStore } from '../src/task-center.ts';
import { TaskApi, type TaskApiActor } from '../src/task-api.ts';
import type { DashboardRisk } from '../src/dashboard.ts';

const manager: TaskApiActor = { actorId: 'm01:user:manager-01', actorType: 'human', tenantId: 'tenant-a', organizationId: 'org-a', roles: ['manager'] };
const operator: TaskApiActor = { actorId: 'm01:user:operator-01', actorType: 'human', tenantId: 'tenant-a', organizationId: 'org-a', roles: ['operator'] };
const otherOperator: TaskApiActor = { actorId: 'm01:user:operator-02', actorType: 'human', tenantId: 'tenant-a', organizationId: 'org-a', roles: ['operator'] };
const owner: TaskApiActor = { actorId: 'm01:user:owner-01', actorType: 'human', tenantId: 'tenant-a', organizationId: 'org-a', roles: ['supervisor'] };
const otherOwner: TaskApiActor = { actorId: 'm01:user:owner-02', actorType: 'human', tenantId: 'tenant-a', organizationId: 'org-a', roles: ['supervisor'] };
const agent: TaskApiActor = { actorId: 'agent:delivery-analysis', actorType: 'agent', tenantId: 'tenant-a', organizationId: 'org-a', roles: ['manager', 'operator', 'owner'] };
const system: TaskApiActor = { actorId: 'system:delivery-analysis', actorType: 'system', tenantId: 'tenant-a', organizationId: 'org-a', roles: ['owner'] };
const service: TaskApiActor = { actorId: 'm01:service:delivery-analysis', actorType: 'service', tenantId: 'tenant-a', organizationId: 'org-a', roles: ['manager', 'operator', 'owner'] };

const risk: DashboardRisk = {
  source: 'order', orderNo: 'SO-G1-01', issueNo: '', summary: '订单交付风险待人工核验', customer: '试点客户', product: 'P-G1',
  orderQty: 100, completedQty: 20, amountCny: 100_000, probability: 0.7, riskScore: 70, dueDate: '2026-10-16', shippingPlan: '2026-10-16', owner: '订单交付负责人',
  orderStatus: 'open', riskLevel: '高', evidenceRef: 'control-platform://orders/SO-G1-01@2026-10-10',
  prompt: '核查订单交付风险，并引用 evidence_refs。', kitRateByItem: null, shortageItemCount: null, shortageQty: null,
  estimatedFullKitDate: '', occurredAt: '2026-10-10T09:00:00+08:00',
};

function fixture(t: TestContext, appendEvidence?: (entry: unknown) => unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-task-api-'));
  const clock = () => new Date('2026-10-10T01:00:00.000Z');
  const operatingCenter = new OperatingCenterStore(join(dir, 'operating-center.json'), clock);
  const taskCenter = new TaskCenterStore({ file: join(dir, 'task-center.json'), clock, idFactory: (() => { let id = 0; return () => `test-${++id}`; })() });
  const g0Store = new G0DecisionRegisterStore(join(dir, 'g0.json'), clock);
  g0Store.record({
    actor: { actorId: manager.actorId, tenantId: manager.tenantId },
    patch: {
      firstScenario: 'order_delivery_risk', businessOwnerActorId: owner.actorId, verifyActorId: 'm01:user:verify-01',
      scope: { demoTenantId: manager.tenantId, organizationScope: manager.organizationId! },
      threeAccountAuthorization: { managerActorId: manager.actorId, operatorActorId: operator.actorId, ownerActorId: owner.actorId, decision: 'approved_for_g1' },
      m02Responsibility: { ownerActorId: owner.actorId, status: 'assigned' }, taskStoreDecision: 'reuse_existing_task_center', g4Admission: 'blocked_until_g1',
    }, note: 'G1 订单交付风险试点已就绪',
  });
  const evidence: Array<Record<string, unknown>> = [];
  const api = new TaskApi({
    operatingCenter,
    taskCenter,
    g0DecisionStore: g0Store,
    appendEvidence: appendEvidence ?? ((entry) => { evidence.push(entry as Record<string, unknown>); }),
  });
  const operatingCase = operatingCenter.upsertDashboardRisks([risk], 'dashboard', 1).created[0]!;
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { api, evidence, operatingCase, operatingCenter };
}

function post(api: TaskApi, pathname: string, actor: TaskApiActor | null, body: Record<string, unknown>) {
  return api.handle({ method: 'POST', pathname, actor, body });
}

function actionOf(entry: Record<string, unknown> | undefined): string | undefined {
  return (entry?.payload as { action?: string } | undefined)?.action;
}

test('uses only trusted manager identity to create and assign a G0-ready order-delivery task', (t) => {
  const { api, evidence, operatingCase } = fixture(t);
  const denied = post(api, `/api/operating-cases/${operatingCase.id}/tasks`, operator, {
    actorId: manager.actorId, tenantId: 'tenant-z', roles: ['manager'], priority: 'high', reason: '伪造管理者身份',
  });
  assert.equal(denied?.status, 403);
  assert.equal(actionOf(evidence.at(-1)), 'task_action_denied');
  assert.equal((evidence.at(-1)?.payload as { policyCode?: string }).policyCode, 'MANAGER_ROLE_REQUIRED');

  const created = post(api, `/api/operating-cases/${encodeURIComponent(operatingCase.id)}/tasks`, manager, {
    actorId: agent.actorId, tenantId: 'tenant-z', roles: ['owner'], priority: 'high', reason: '建立订单交付风险闭环',
  });
  assert.equal(created?.status, 201);
  const task = (created?.body as { task: { taskId: string; initiatedBy: string; tenantId: string } }).task;
  assert.equal(task.initiatedBy, manager.actorId);
  assert.equal(task.tenantId, manager.tenantId);

  const nonHumanTarget = post(api, `/api/tasks/${task.taskId}/assignments`, manager, {
    assigneeRole: '订单交付经办人', assigneeActorId: agent.actorId, reason: '不能把人工任务分派给 Agent',
  });
  assert.equal(nonHumanTarget?.status, 403);
  assert.equal((evidence.at(-1)?.payload as { policyCode?: string }).policyCode, 'HUMAN_OPERATOR_TARGET_REQUIRED');

  const assignment = post(api, `/api/tasks/${task.taskId}/assignments`, manager, {
    assigneeRole: '订单交付经办人', assigneeActorId: operator.actorId, reason: '由指定经办人核查', actorId: otherOperator.actorId, roles: ['owner'], tenantId: 'tenant-z',
  });
  assert.equal(assignment?.status, 200);
  assert.equal((assignment?.body as { task: { currentAssignee: { actorId: string } } }).task.currentAssignee.actorId, operator.actorId);

  const operatorCannotAssign = post(api, `/api/tasks/${task.taskId}/assignments`, operator, {
    assigneeRole: '订单交付经办人', assigneeActorId: otherOperator.actorId, reason: '伪造管理者重分派', roles: ['manager'],
  });
  assert.equal(operatorCannotAssign?.status, 403);
  assert.equal((evidence.at(-1)?.payload as { policyCode?: string }).policyCode, 'MANAGER_ROLE_REQUIRED');
});

test('allows only the assigned human operator to accept, start, supplement evidence, and submit a result', (t) => {
  const { api, evidence, operatingCase } = fixture(t);
  const created = post(api, `/api/operating-cases/${operatingCase.id}/tasks`, manager, { priority: 'high', reason: '建立闭环' });
  const taskId = (created?.body as { task: { taskId: string } }).task.taskId;
  assert.equal(post(api, `/api/tasks/${taskId}/assignments`, manager, { assigneeRole: '订单交付经办人', assigneeActorId: operator.actorId, reason: '分派' })?.status, 200);

  const wrongAssignee = post(api, `/api/tasks/${taskId}/transitions`, otherOperator, { toStatus: 'ACCEPTED', reason: '越权接受', actorId: operator.actorId, roles: ['operator'] });
  assert.equal(wrongAssignee?.status, 403);
  assert.equal((evidence.at(-1)?.payload as { policyCode?: string }).policyCode, 'ASSIGNEE_MISMATCH');
  assert.equal(post(api, `/api/tasks/${taskId}/transitions`, operator, { toStatus: 'ACCEPTED', reason: '接受任务' })?.status, 200);
  assert.equal(post(api, `/api/tasks/${taskId}/transitions`, operator, { toStatus: 'IN_PROGRESS', reason: '开始核查' })?.status, 200);

  const agentResult = post(api, `/api/tasks/${taskId}/results`, agent, { resultType: 'risk_analysis', summary: 'Agent 不得提交', roles: ['operator'] });
  assert.equal(agentResult?.status, 403);
  assert.equal((evidence.at(-1)?.payload as { policyCode?: string }).policyCode, 'HUMAN_ACTOR_REQUIRED');
  const serviceResult = post(api, `/api/tasks/${taskId}/results`, service, { resultType: 'risk_analysis', summary: '服务身份不得提交' });
  assert.equal(serviceResult?.status, 403);
  assert.equal((evidence.at(-1)?.payload as { policyCode?: string }).policyCode, 'HUMAN_ACTOR_REQUIRED');
  const wrongEvidence = post(api, `/api/tasks/${taskId}/evidence`, otherOperator, { evidenceRefs: ['control-platform://orders/SO-G1-01/extra'], reason: '越权补证' });
  assert.equal(wrongEvidence?.status, 403);

  assert.equal(post(api, `/api/tasks/${taskId}/evidence`, operator, { evidenceRefs: ['control-platform://orders/SO-G1-01/extra'], reason: '补充齐套证据' })?.status, 200);
  const result = post(api, `/api/tasks/${taskId}/results`, operator, { resultType: 'risk_analysis', summary: '人工完成交付风险核查', reason: '提交给 Owner 核验' });
  assert.equal(result?.status, 201);
  assert.equal((result?.body as { task: { status: string } }).task.status, 'AWAITING_VERIFY');
});

test('permits only the G0-registered human supervisor to verify or reject', (t) => {
  const { api, evidence, operatingCase } = fixture(t);
  const created = post(api, `/api/operating-cases/${operatingCase.id}/tasks`, manager, { priority: 'high', reason: '建立闭环' });
  const taskId = (created?.body as { task: { taskId: string } }).task.taskId;
  post(api, `/api/tasks/${taskId}/assignments`, manager, { assigneeRole: '订单交付经办人', assigneeActorId: operator.actorId, reason: '分派' });
  post(api, `/api/tasks/${taskId}/transitions`, operator, { toStatus: 'ACCEPTED', reason: '接受' });
  post(api, `/api/tasks/${taskId}/transitions`, operator, { toStatus: 'IN_PROGRESS', reason: '开始' });
  const pending = post(api, `/api/tasks/${taskId}/results`, operator, { resultType: 'risk_analysis', summary: '待 Owner 核验' });
  const resultId = (pending?.body as { result: { result_id: string } }).result.result_id;

  assert.equal(post(api, `/api/tasks/${taskId}/results/${resultId}/verify`, manager, { outcome: 'VERIFIED', reason: '管理者不是 Owner' })?.status, 403);
  assert.equal(post(api, `/api/tasks/${taskId}/results/${resultId}/verify`, otherOwner, { outcome: 'VERIFIED', reason: '不是登记 Owner' })?.status, 403);
  assert.equal(post(api, `/api/tasks/${taskId}/results/${resultId}/verify`, system, { outcome: 'VERIFIED', reason: '系统不得核验' })?.status, 403);
  assert.equal((evidence.at(-1)?.payload as { policyCode?: string }).policyCode, 'HUMAN_ACTOR_REQUIRED');
  assert.equal(post(api, `/api/tasks/${taskId}/results/${resultId}/verify`, service, { outcome: 'VERIFIED', reason: '服务不得核验' })?.status, 403);
  assert.equal(post(api, `/api/tasks/${taskId}/results/${resultId}/verify`, service, { outcome: 'REJECTED', reason: '服务不得驳回' })?.status, 403);

  const verified = post(api, `/api/tasks/${taskId}/results/${resultId}/verify`, owner, { outcome: 'VERIFIED', reason: '业务 Owner 核验通过', actorId: otherOwner.actorId, roles: ['manager'], tenantId: 'tenant-z' });
  assert.equal(verified?.status, 200);
  assert.equal((verified?.body as { task: { status: string } }).task.status, 'COMPLETED');
  assert.equal((verified?.body as { result: { status: string; verified_by: string } }).result.verified_by, owner.actorId);
});

test('keeps task reads tenant-scoped without leaking another tenant task', (t) => {
  const { api, operatingCase, evidence } = fixture(t);
  const created = post(api, `/api/operating-cases/${operatingCase.id}/tasks`, manager, { priority: 'high', reason: '建立闭环' });
  const taskId = (created?.body as { task: { taskId: string } }).task.taskId;
  const outsider: TaskApiActor = { ...manager, actorId: 'm01:user:manager-b', tenantId: 'tenant-b' };
  assert.equal(api.handle({ method: 'GET', pathname: `/api/tasks/${taskId}`, actor: outsider })?.status, 404);
  assert.equal(post(api, `/api/tasks/${taskId}/assignments`, outsider, { assigneeRole: '订单交付经办人', assigneeActorId: operator.actorId, reason: '跨租户分派' })?.status, 403);
  assert.equal((evidence.at(-1)?.payload as { action?: string }).action, 'task_action_denied');
  assert.equal((evidence.at(-1)?.payload as { policyCode?: string }).policyCode, 'G0_SCOPE_REQUIRED');
});

test('fails closed before case lookup when an authenticated manager is outside the registered G0 tenant or organization', (t) => {
  const { api, operatingCase } = fixture(t);
  const otherTenantManager: TaskApiActor = { ...manager, actorId: 'm01:user:manager-b', tenantId: 'tenant-b', organizationId: 'org-b' };
  const otherOrganizationManager: TaskApiActor = { ...manager, actorId: 'm01:user:manager-a-b', organizationId: 'org-b' };

  for (const actor of [otherTenantManager, otherOrganizationManager]) {
    const response = post(api, `/api/operating-cases/${operatingCase.id}/tasks`, actor, { priority: 'high', reason: '跨范围探测' });
    assert.deepEqual(response?.body, { error: 'task action forbidden', auditStatus: 'recorded' });
    assert.equal(response?.status, 403);
  }
});

test('allows G1 task creation only for an order delivery operating case', (t) => {
  const { api, evidence, operatingCenter } = fixture(t);
  const qualityCase = operatingCenter.upsertDashboardRisks([{
    ...risk,
    source: 'quality',
    issueNo: 'QI-G1-NON-ORDER',
    summary: '质量异常不属于本轮订单交付风险闭环',
    evidenceRef: 'control-platform://quality/issue/QI-G1-NON-ORDER@2026-10-10',
  }], 'dashboard', 1).created[0]!;

  const response = post(api, `/api/operating-cases/${qualityCase.id}/tasks`, manager, { priority: 'high', reason: '不得为非订单事项建立 G1 任务' });
  assert.equal(response?.status, 403);
  assert.deepEqual(response?.body, { error: 'task action forbidden', auditStatus: 'recorded' });
  assert.equal((evidence.at(-1)?.payload as { policyCode?: string }).policyCode, 'ORDER_DELIVERY_CASE_REQUIRED');
});

test('fails closed for a same-tenant Owner from a different organization before verify or reject lookup', (t) => {
  const { api, operatingCase } = fixture(t);
  const created = post(api, `/api/operating-cases/${operatingCase.id}/tasks`, manager, { priority: 'high', reason: '建立闭环' });
  const taskId = (created?.body as { task: { taskId: string } }).task.taskId;
  assert.equal(post(api, `/api/tasks/${taskId}/assignments`, manager, { assigneeRole: '订单交付经办人', assigneeActorId: operator.actorId, reason: '分派' })?.status, 200);
  assert.equal(post(api, `/api/tasks/${taskId}/transitions`, operator, { toStatus: 'ACCEPTED', reason: '接受' })?.status, 200);
  assert.equal(post(api, `/api/tasks/${taskId}/transitions`, operator, { toStatus: 'IN_PROGRESS', reason: '开始' })?.status, 200);
  const pending = post(api, `/api/tasks/${taskId}/results`, operator, { resultType: 'risk_analysis', summary: '待 Owner 核验' });
  const resultId = (pending?.body as { result: { result_id: string } }).result.result_id;
  const wrongOrganizationOwner: TaskApiActor = { ...owner, organizationId: 'org-b' };

  for (const outcome of ['VERIFIED', 'REJECTED'] as const) {
    const response = post(api, `/api/tasks/${taskId}/results/${resultId}/verify`, wrongOrganizationOwner, { outcome, reason: '跨组织核验' });
    assert.deepEqual(response?.body, { error: 'task action forbidden', auditStatus: 'recorded' });
    assert.equal(response?.status, 403);
  }
});

test('fails closed when the G0 register is missing, not ready, or omits its registered Owner', (t) => {
  const { operatingCase } = fixture(t);
  const makeApi = (g0DecisionStore: ConstructorParameters<typeof TaskApi>[0]['g0DecisionStore']) => {
    const dir = mkdtempSync(join(tmpdir(), 'aeos-task-api-g0-gate-'));
    const clock = () => new Date('2026-10-10T01:00:00.000Z');
    const operatingCenter = new OperatingCenterStore(join(dir, 'operating-center.json'), clock);
    const taskCenter = new TaskCenterStore({ file: join(dir, 'task-center.json'), clock });
    const seededCase = operatingCenter.upsertDashboardRisks([risk], 'dashboard', 1).created[0]!;
    return { api: new TaskApi({ operatingCenter, taskCenter, g0DecisionStore, appendEvidence: () => undefined }), caseId: seededCase.id, dir };
  };
  const missing = makeApi(undefined);
  const notReady = makeApi({ load: () => ({ readyForG1: false, decisions: {} }) } as unknown as ConstructorParameters<typeof TaskApi>[0]['g0DecisionStore']);
  const missingOwner = makeApi({ load: () => ({
    readyForG1: true,
    decisions: {
      firstScenario: { value: 'order_delivery_risk' },
      scope: { value: { demoTenantId: manager.tenantId, organizationScope: manager.organizationId } },
      businessOwnerActor: null,
    },
  }) } as unknown as ConstructorParameters<typeof TaskApi>[0]['g0DecisionStore']);

  for (const candidate of [missing, notReady, missingOwner]) {
    assert.equal(post(candidate.api, `/api/operating-cases/${candidate.caseId}/tasks`, manager, { priority: 'high', reason: 'G0 门禁' })?.status, 403);
    rmSync(candidate.dir, { recursive: true, force: true });
  }
  assert.ok(operatingCase.id);
});

test('reports committed mutations when post-commit Evidence appends fail', (t) => {
  const { api, operatingCase } = fixture(t, () => { throw new Error('evidence unavailable'); });
  const created = post(api, `/api/operating-cases/${operatingCase.id}/tasks`, manager, { priority: 'high', reason: '建立闭环' });
  assert.equal(created?.status, 201);
  assert.equal(created?.body.committed, true);
  assert.equal(created?.body.auditStatus, 'failed');
  const taskId = (created?.body as { task: { taskId: string } }).task.taskId;
  assert.equal(post(api, `/api/tasks/${taskId}/assignments`, manager, { assigneeRole: '订单交付经办人', assigneeActorId: operator.actorId, reason: '分派' })?.status, 200);
  assert.equal(post(api, `/api/tasks/${taskId}/transitions`, operator, { toStatus: 'ACCEPTED', reason: '接受' })?.status, 200);
  assert.equal(post(api, `/api/tasks/${taskId}/transitions`, operator, { toStatus: 'IN_PROGRESS', reason: '开始' })?.status, 200);
  const submitted = post(api, `/api/tasks/${taskId}/results`, operator, { resultType: 'risk_analysis', summary: '人工提交结果' });
  assert.equal(submitted?.status, 201);
  assert.equal(submitted?.body.committed, true);
  assert.equal(submitted?.body.auditStatus, 'failed');
  const resultId = (submitted?.body as { result: { result_id: string } }).result.result_id;
  const verified = post(api, `/api/tasks/${taskId}/results/${resultId}/verify`, owner, { outcome: 'VERIFIED', reason: '核验通过' });
  assert.equal(verified?.status, 200);
  assert.equal(verified?.body.committed, true);
  assert.equal(verified?.body.auditStatus, 'failed');
});
