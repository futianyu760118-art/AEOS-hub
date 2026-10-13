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

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-task-agent-candidates-'));
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
  const api = new TaskApi({ operatingCenter, taskCenter, g0DecisionStore, appendEvidence: (entry) => { evidence.push(entry); }, loadHarbor: () => harbor.load(), now: clock });
  const operatingCase = operatingCenter.upsertDashboardRisks([risk], 'dashboard', 1).created[0]!;
  const created = api.handle({ method: 'POST', pathname: `/api/operating-cases/${operatingCase.id}/tasks`, actor: manager, body: { priority: 'high', reason: '建立任务' } });
  assert.equal(created?.status, 201);
  const taskId = (created?.body as { task: { taskId: string } }).task.taskId;
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { api, taskCenter, harbor, evidence, taskId };
}

test('returns only safe, read-only governed Agent candidates for the authenticated task tenant', (t) => {
  const { api, taskCenter, harbor, evidence, taskId } = fixture(t);
  const beforeTasks = taskCenter.load();
  const beforeHarbor = harbor.load();

  const response = api.handle({ method: 'GET', pathname: `/api/tasks/${taskId}/agent-candidates`, actor: manager });

  assert.equal(response?.status, 200);
  const body = response?.body as { dispatchEnabled: boolean; taskType: string; candidates: Array<{ eligible: boolean; candidate: Record<string, unknown> }> };
  assert.equal(body.dispatchEnabled, false);
  assert.equal(body.taskType, 'operating-case-analysis');
  assert.equal(body.candidates[0]?.eligible, true);
  assert.equal('instructions' in (body.candidates[0]?.candidate ?? {}), false);
  assert.equal('endpoint' in ((body.candidates[0]?.candidate.runtime as Record<string, unknown> | undefined) ?? {}), false);
  assert.deepEqual(taskCenter.load(), beforeTasks);
  assert.deepEqual(harbor.load(), beforeHarbor);
  assert.equal(evidence.length, 1, 'candidate reads must not create audit evidence');
});

test('rejects unauthenticated, cross-tenant, unknown, and mutating candidate requests', (t) => {
  const { api, taskId } = fixture(t);

  assert.equal(api.handle({ method: 'GET', pathname: `/api/tasks/${taskId}/agent-candidates`, actor: null })?.status, 401);
  assert.equal(api.handle({ method: 'GET', pathname: `/api/tasks/${taskId}/agent-candidates`, actor: otherTenantManager })?.status, 404);
  assert.equal(api.handle({ method: 'GET', pathname: '/api/tasks/missing/agent-candidates', actor: manager })?.status, 404);
  assert.equal(api.handle({ method: 'POST', pathname: `/api/tasks/${taskId}/agent-candidates`, actor: manager, body: { tenantId: 'tenant-b', actor: 'agent:forged' } })?.status, 405);
});

test('confirms an eligible Agent assignment and records immutable dispatch history', (t) => {
  const { api, taskId } = fixture(t);

  const response = api.handle({ method: 'POST', pathname: `/api/tasks/${taskId}/assignments`, actor: manager, body: { assigneeKind: 'agent', agentId: 'agent-aeos-hub', reason: '人工确认派单' } });

  assert.equal(response?.status, 200);
  const body = response?.body as { task: { currentAssignee: { kind: string }; dispatchHistory: Array<{ agentId: string; confirmedBy: string }> } };
  assert.equal(body.task.currentAssignee.kind, 'agent');
  assert.equal(body.task.dispatchHistory.length, 1);
  assert.equal(body.task.dispatchHistory[0]?.agentId, 'agent-aeos-hub');
  assert.equal(body.task.dispatchHistory[0]?.confirmedBy, manager.actorId);
});

test('rejects an ineligible Agent assignment and a missing agentId', (t) => {
  const { api, harbor, taskId } = fixture(t);

  const snapshot = harbor.load();
  snapshot.agents[0]!.registration.taskServiceProfile.tenantIds = ['tenant-b'];
  harbor.save(snapshot);

  assert.equal(api.handle({ method: 'POST', pathname: `/api/tasks/${taskId}/assignments`, actor: manager, body: { assigneeKind: 'agent', agentId: 'agent-aeos-hub', reason: '越界派单' } })?.status, 403);
  assert.equal(api.handle({ method: 'POST', pathname: `/api/tasks/${taskId}/assignments`, actor: manager, body: { assigneeKind: 'agent', reason: '缺少目标' } })?.status, 403);
});
