import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { OperatingCenterStore } from '../src/operating-center.ts';
import { TaskCenterStore } from '../src/task-center.ts';
import { TaskApi } from '../src/task-api.ts';
import type { DashboardRisk } from '../src/dashboard.ts';

const risk: DashboardRisk = {
  source: 'quality', orderNo: 'SO-TASK-01', issueNo: 'QI-TASK-01', summary: '来料质量异常待确认', customer: '', product: 'P-01',
  orderQty: null, completedQty: null, amountCny: null, probability: null, riskScore: null, dueDate: '2026-10-16', shippingPlan: '', owner: '',
  orderStatus: 'open', riskLevel: '高', evidenceRef: 'control-platform://quality/issue/QI-TASK-01@2026-10-10',
  prompt: '使用 quality_issues_list 核查异常，并引用 evidence_refs。', kitRateByItem: null, shortageItemCount: null, shortageQty: null,
  estimatedFullKitDate: '', occurredAt: '2026-10-10T09:00:00+08:00',
};

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-task-api-'));
  const clock = () => new Date('2026-10-10T01:00:00.000Z');
  const operatingCenter = new OperatingCenterStore(join(dir, 'operating-center.json'), clock);
  const taskCenter = new TaskCenterStore({ file: join(dir, 'task-center.json'), clock, idFactory: (() => { let id = 0; return () => `test-${++id}`; })() });
  const evidence: Array<Record<string, unknown>> = [];
  const api = new TaskApi({ operatingCenter, taskCenter, appendEvidence: (entry) => { evidence.push(entry as Record<string, unknown>); } });
  const operatingCase = operatingCenter.upsertDashboardRisks([risk], 'dashboard', 1).created[0]!;
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { api, operatingCenter, taskCenter, evidence, operatingCase };
}

const manager = { actorId: 'm01:user:manager-01', actorType: 'human' as const, tenantId: 'tenant-a' };

test('creates a task only from an existing evidence-bound case and ignores a forged browser actor', (t) => {
  const { api, evidence, operatingCase } = fixture(t);
  const created = api.handle({
    method: 'POST', pathname: `/api/operating-cases/${encodeURIComponent(operatingCase.id)}/tasks`, actor: manager,
    body: { actor: 'agent:forged', priority: 'high', reason: '请质量负责人跟进' },
  });

  assert.equal(created?.status, 201);
  const task = (created?.body as { task: { initiatedBy: string; tenantId: string; caseId: string } }).task;
  assert.equal(task.initiatedBy, manager.actorId);
  assert.equal(task.tenantId, 'tenant-a');
  assert.equal(task.caseId, operatingCase.id);
  assert.equal(evidence[0]?.actor_id, manager.actorId);
  assert.equal(evidence[0]?.actor_type, 'human');
  assert.equal((evidence[0]?.payload as { action: string }).action, 'task_created');

  const replay = api.handle({
    method: 'POST', pathname: `/api/operating-cases/${encodeURIComponent(operatingCase.id)}/tasks`, actor: manager,
    body: { priority: 'high', reason: '网络重试，不得重复建任务' },
  });
  assert.equal(replay?.status, 200);
  assert.equal((replay?.body as { task: { taskId: string } }).task.taskId, task.taskId);
  assert.equal((evidence.at(-1)?.payload as { action: string }).action, 'task_create_replayed');

  assert.equal(api.handle({ method: 'POST', pathname: '/api/operating-cases/missing/tasks', actor: manager, body: { reason: 'x' } })?.status, 404);
  assert.equal(api.handle({ method: 'POST', pathname: `/api/operating-cases/${operatingCase.id}/tasks`, actor: null, body: { reason: 'x' } })?.status, 401);
});

test('keeps results pending until a non-agent actor verifies both Result and task', (t) => {
  const { api, operatingCase, evidence } = fixture(t);
  const created = api.handle({ method: 'POST', pathname: `/api/operating-cases/${operatingCase.id}/tasks`, actor: manager, body: { priority: 'high', reason: '建立质量闭环' } });
  const taskId = (created?.body as { task: { taskId: string } }).task.taskId;
  api.handle({ method: 'POST', pathname: `/api/tasks/${taskId}/assignments`, actor: manager, body: { assigneeRole: '质量负责人', reason: '分派质量责任' } });
  api.handle({ method: 'POST', pathname: `/api/tasks/${taskId}/transitions`, actor: manager, body: { toStatus: 'ACCEPTED', reason: '接受任务' } });
  api.handle({ method: 'POST', pathname: `/api/tasks/${taskId}/transitions`, actor: manager, body: { toStatus: 'IN_PROGRESS', reason: '开始核查' } });

  const pending = api.handle({
    method: 'POST', pathname: `/api/tasks/${taskId}/results`, actor: { actorId: 'agent:quality-analysis', actorType: 'agent', tenantId: 'tenant-a' },
    body: { resultType: 'risk_analysis', summary: '已完成只读分析，等待业务 Owner 核验。' },
  });
  assert.equal(pending?.status, 201);
  const resultId = (pending?.body as { result: { result_id: string; status: string }; task: { status: string } }).result.result_id;
  assert.equal((pending?.body as { result: { status: string } }).result.status, 'PENDING');
  assert.equal((pending?.body as { result: { tenant_id: string } }).result.tenant_id, 'tenant-a');
  assert.equal((pending?.body as { task: { status: string } }).task.status, 'AWAITING_VERIFY');

  const blocked = api.handle({
    method: 'POST', pathname: `/api/tasks/${taskId}/results/${resultId}/verify`, actor: { actorId: 'agent:quality-analysis', actorType: 'agent', tenantId: 'tenant-a' },
    body: { outcome: 'VERIFIED', reason: 'Agent 不能自证' },
  });
  assert.equal(blocked?.status, 403);
  const verified = api.handle({
    method: 'POST', pathname: `/api/tasks/${taskId}/results/${resultId}/verify`, actor: manager,
    body: { outcome: 'VERIFIED', reason: '业务负责人已核验' },
  });
  assert.equal(verified?.status, 200);
  assert.equal((verified?.body as { task: { status: string } }).task.status, 'COMPLETED');
  assert.equal((verified?.body as { result: { status: string } }).result.status, 'VERIFIED');
  assert.equal(evidence.at(-1)?.actor_id, manager.actorId);
});

test('refuses an out-of-sequence Result before it can create an orphan pending record', (t) => {
  const { api, operatingCenter, operatingCase } = fixture(t);
  const created = api.handle({ method: 'POST', pathname: `/api/operating-cases/${operatingCase.id}/tasks`, actor: manager, body: { priority: 'high', reason: '建立质量闭环' } });
  const taskId = (created?.body as { task: { taskId: string } }).task.taskId;

  const result = api.handle({
    method: 'POST', pathname: `/api/tasks/${taskId}/results`, actor: manager,
    body: { resultType: 'risk_analysis', summary: '尚未处理就尝试提交结果' },
  });
  assert.equal(result?.status, 409);
  assert.equal(operatingCenter.load().results.length, 0);
});
