import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { HarborStore } from '../src/harbor-store.ts';
import type { G0DecisionRegisterStore } from '../src/g0-decision-register.ts';
import { OperatingCenterStore } from '../src/operating-center.ts';
import { TaskApi } from '../src/task-api.ts';
import { TaskCenterStore } from '../src/task-center.ts';
import type { DashboardRisk } from '../src/dashboard.ts';

const NOW = '2026-10-10T01:00:00.000Z';
const manager = { actorId: 'm01:user:manager-01', actorType: 'human' as const, tenantId: 'tenant-a', organizationId: 'org-a', roles: ['manager'] };
const otherTenantManager = { actorId: 'm01:user:manager-02', actorType: 'human' as const, tenantId: 'tenant-b', organizationId: 'org-b', roles: ['manager'] };
const risk: DashboardRisk = {
  source: 'order', orderNo: 'SO-ELIGIBILITY-01', issueNo: '', summary: '订单交付风险待核查', customer: '', product: 'P-01',
  orderQty: null, completedQty: null, amountCny: null, probability: null, riskScore: null, dueDate: '2026-10-16', shippingPlan: '', owner: '',
  orderStatus: 'open', riskLevel: '高', evidenceRef: 'control-platform://orders/SO-ELIGIBILITY-01@2026-10-10',
  prompt: '核查订单交付风险。', kitRateByItem: null, shortageItemCount: null, shortageQty: null, estimatedFullKitDate: '', occurredAt: '2026-10-10T09:00:00+08:00',
};

function fixture(
  t: TestContext,
  runOutcome: { state: string; failure?: { message?: string; code?: string } | null } = { state: 'completed' },
  assignAgent = true,
  executionResult: unknown = { conclusion: '存在物料齐套风险', evidence_refs: ['control-platform://orders/SO-ELIGIBILITY-01@2026-10-10'] },
) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-task-agent-run-'));
  const clock = () => new Date(NOW);
  const operatingCenter = new OperatingCenterStore(join(dir, 'operating-center.json'), clock);
  const taskCenter = new TaskCenterStore({ file: join(dir, 'task-center.json'), clock, idFactory: () => 'task-test' });
  const harbor = new HarborStore({ file: join(dir, 'harbor.json'), workspaceRoot: dir, clock, idFactory: () => 'harbor-test', lockTimeoutMs: 50 });
  const harborSnapshot = harbor.load();
  harborSnapshot.agents[0]!.registration.taskServiceProfile.tenantIds = ['tenant-a'];
  harbor.save(harborSnapshot);
  harbor.recordRuntimeVerification(harbor.load().runtimes[0]!.id, { status: 'healthy', checkedAt: NOW, message: 'ready', code: null });
  const evidence: unknown[] = [];
  const g0DecisionStore = {
    load: () => ({
      readyForG1: true,
      decisions: {
        firstScenario: { value: 'order_delivery_risk' },
        scope: { value: { demoTenantId: manager.tenantId, organizationScope: manager.organizationId } },
        businessOwnerActor: { value: { actorId: 'm01:user:owner-01' } },
      },
    }),
  } as unknown as Pick<G0DecisionRegisterStore, 'load'>;
  const runtime = {
    createSession: async (request: { developerInstructions?: string }) => { assert.match(request.developerInstructions ?? '', /只读/); return { id: 'session-1' }; },
    startRun: async (_sessionId: string, _request: { input: string }) => { return { id: 'run-1' }; },
    waitForRun: async () => runOutcome,
  };
  const api = new TaskApi({
    operatingCenter, taskCenter, g0DecisionStore, appendEvidence: (entry) => { evidence.push(entry); }, loadHarbor: () => harbor.load(), resolveRuntime: () => runtime, now: clock,
    findExecutionRun: (runId) => runId === 'run-1' ? { runId, agentId: 'agent-aeos-hub', capability: 'query.read', input: {}, state: 'completed', startedAt: NOW, endedAt: NOW, result: executionResult } : undefined,
  });
  const operatingCase = operatingCenter.upsertDashboardRisks([risk], 'dashboard', 1).created[0]!;
  const created = api.handle({ method: 'POST', pathname: `/api/operating-cases/${operatingCase.id}/tasks`, actor: manager, body: { priority: 'high', reason: '建立任务' } });
  assert.equal(created?.status, 201);
  const taskId = (created?.body as { task: { taskId: string } }).task.taskId;
  if (assignAgent) {
    const assigned = api.handle({ method: 'POST', pathname: `/api/tasks/${taskId}/assignments`, actor: manager, body: { assigneeKind: 'agent', agentId: 'agent-aeos-hub', reason: '派单' } });
    assert.equal(assigned?.status, 200);
  }
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { api, taskCenter, operatingCenter, evidence, taskId };
}

test('completes a governed Agent run and records an AWAITING_VERIFY result', async (t) => {
  const { api, taskCenter, operatingCenter, taskId } = fixture(t, { state: 'completed' });
  const response = await api.handleAgentRun({ method: 'POST', pathname: `/api/tasks/${taskId}/agent-runs`, actor: manager, body: {} });
  assert.equal(response?.status, 200);
  const body = response?.body as { task: { status: string; resultId?: string }; run: { outcome: { state: string } }; resultId?: string };
  assert.equal(body.task.status, 'AWAITING_VERIFY');
  assert.equal(body.run.outcome.state, 'completed');
  assert.ok(body.resultId, 'run result must be surfaced for Owner verification');
  const task = taskCenter.load().tasks.find((candidate) => candidate.taskId === taskId);
  assert.equal(task?.status, 'AWAITING_VERIFY');
  assert.equal(task?.resultId, body.resultId);
  assert.equal(task?.agentRun?.runtimeRunId, 'run-1');
  const pendingResult = operatingCenter.load().results.find((result) => result.result_id === body.resultId);
  assert.equal(pendingResult?.status, 'PENDING');
  assert.match(pendingResult?.summary ?? '', /存在物料齐套风险/);
  assert.ok(pendingResult?.evidence_refs.includes('control-platform://orders/SO-ELIGIBILITY-01@2026-10-10'));
  const detail = api.handle({ method: 'GET', pathname: `/api/tasks/${taskId}`, actor: manager });
  const detailTask = detail?.body.task as { agentRun?: { execution?: { state?: string; result?: { conclusion?: string } } } };
  assert.equal(detailTask.agentRun?.execution?.state, 'completed');
  assert.equal(detailTask.agentRun?.execution?.result?.conclusion, '存在物料齐套风险');
  const projectResponse = api.handle({ method: 'POST', pathname: '/api/projects', actor: manager, body: { name: '供应风险闭环项目' } });
  const projectId = (projectResponse?.body.project as { projectId: string }).projectId;
  const linked = api.handle({ method: 'PATCH', pathname: `/api/tasks/${taskId}/project`, actor: manager, body: { projectId } });
  assert.equal(linked?.status, 200);
  const projectDetail = api.handle({ method: 'GET', pathname: `/api/projects/${projectId}`, actor: manager });
  const projectTasks = projectDetail?.body.tasks as Array<{ taskId: string; agentRun?: { execution?: { result?: { conclusion?: string } } } }>;
  const projectTask = projectTasks[0];
  assert.equal(projectTask?.taskId, taskId);
  assert.equal(projectTask?.agentRun?.execution?.result?.conclusion, '存在物料齐套风险');
});

test('escalates low-confidence Agent output to human decision without creating a business result', async (t) => {
  const { api, taskCenter, operatingCenter, taskId } = fixture(t, { state: 'completed' }, true, {
    summary: '中台推理接口未接通',
    conclusions: [{ matter: '未接通', evidence_refs: ['control-platform://reasoning/not-connected'] }],
    data_confidence: 'low',
  });
  const response = await api.handleAgentRun({ method: 'POST', pathname: `/api/tasks/${taskId}/agent-runs`, actor: manager, body: {} });
  assert.equal(response?.status, 200);
  const body = response?.body as { task: { status: string; nextAction?: string }; resultId?: string };
  assert.equal(body.task.status, 'AWAITING_DECISION');
  assert.equal(body.resultId, undefined);
  assert.match(body.task.nextAction ?? '', /置信度不足/);
  assert.equal(operatingCenter.load().results.length, 0);
  assert.equal(taskCenter.load().tasks.find((task) => task.taskId === taskId)?.status, 'AWAITING_DECISION');
});

test('records FAILED and AWAITING_DECISION outcomes without creating a result', async (t) => {
  const failed = fixture(t, { state: 'failed', failure: { message: '运行超时' } });
  const failedResponse = await failed.api.handleAgentRun({ method: 'POST', pathname: `/api/tasks/${failed.taskId}/agent-runs`, actor: manager, body: {} });
  assert.equal(failedResponse?.status, 200);
  assert.equal((failedResponse?.body as { task: { status: string } }).task.status, 'FAILED');
  assert.equal((failedResponse?.body as { resultId?: string }).resultId, undefined);

  const awaiting = fixture(t, { state: 'failed', failure: { message: '上游依赖不可用' } });
  const awaitingResponse = await awaiting.api.handleAgentRun({ method: 'POST', pathname: `/api/tasks/${awaiting.taskId}/agent-runs`, actor: manager, body: {} });
  assert.equal(awaitingResponse?.status, 200);
  assert.equal((awaitingResponse?.body as { task: { status: string } }).task.status, 'AWAITING_DECISION');
});

test('rejects unauthenticated, cross-tenant, wrong-method, and non-agent-assigned runs', async (t) => {
  const { api, taskId } = fixture(t);
  assert.equal((await api.handleAgentRun({ method: 'POST', pathname: `/api/tasks/${taskId}/agent-runs`, actor: null, body: {} }))?.status, 401);
  assert.equal((await api.handleAgentRun({ method: 'POST', pathname: `/api/tasks/${taskId}/agent-runs`, actor: otherTenantManager, body: {} }))?.status, 403);
  assert.equal((await api.handleAgentRun({ method: 'GET', pathname: `/api/tasks/${taskId}/agent-runs`, actor: manager, body: {} }))?.status, 405);
  assert.equal(api.handle({ method: 'GET', pathname: `/api/tasks/${taskId}`, actor: otherTenantManager })?.status, 404);

  const unassigned = fixture(t, { state: 'completed' }, false);
  assert.equal((await unassigned.api.handleAgentRun({ method: 'POST', pathname: `/api/tasks/${unassigned.taskId}/agent-runs`, actor: manager, body: {} }))?.status, 403);
});
