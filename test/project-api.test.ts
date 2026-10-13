import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TaskApi, type TaskApiActor } from '../src/task-api.ts';
import { TaskCenterStore } from '../src/task-center.ts';

const manager: TaskApiActor = { actorId: 'm01:user:manager-01', actorType: 'human', tenantId: 'tenant-a', organizationId: 'org-a', roles: ['manager'] };
const operator: TaskApiActor = { actorId: 'm01:user:operator-01', actorType: 'human', tenantId: 'tenant-a', organizationId: 'org-a', roles: ['operator'] };
const outsider: TaskApiActor = { ...manager, actorId: 'm01:user:manager-b', tenantId: 'tenant-b', organizationId: 'org-b' };

function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-project-api-'));
  const taskCenter = new TaskCenterStore({ file: join(dir, 'task-center.json'), clock: () => new Date('2026-10-13T01:00:00.000Z'), idFactory: (() => { let n = 0; return () => `test-${++n}`; })() });
  const api = new TaskApi({
    taskCenter,
    operatingCenter: { load: () => ({ cases: [], results: [] }), createPendingResult: () => { throw new Error('unused'); }, verifyResult: () => { throw new Error('unused'); } },
    appendEvidence: () => undefined,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return api;
}

function call(api: TaskApi, method: string, pathname: string, actor: TaskApiActor, body: Record<string, unknown> = {}) {
  return api.handle({ method, pathname, actor, body });
}

test('creates a tenant-scoped project and a manual task with derived progress', (t) => {
  const api = fixture(t);
  const created = call(api, 'POST', '/api/projects', manager, { name: '交付提升', priority: 'high', dueDate: '2026-10-31' });
  assert.equal(created?.status, 201);
  const projectId = (created?.body.project as { projectId: string }).projectId;
  const task = call(api, 'POST', '/api/tasks/manual', manager, { title: '确认供应计划', dueAt: '2026-10-20', projectId });
  assert.equal(task?.status, 201);
  const createdTask = task?.body.task as { taskId: string; status: string; currentAssignee: { actorId: string } };
  assert.equal(createdTask.status, 'ASSIGNED');
  assert.equal(createdTask.currentAssignee.actorId, manager.actorId);
  const taskId = createdTask.taskId;
  const reassigned = call(api, 'POST', `/api/tasks/${taskId}/assignments`, manager, { assigneeRole: '交付经办人', assigneeActorId: operator.actorId, reason: '交由项目成员跟进' });
  assert.equal(reassigned?.status, 200);
  assert.equal(((reassigned?.body.task as { currentAssignee: { actorId: string } }).currentAssignee.actorId), operator.actorId);
  assert.equal(call(api, 'PATCH', `/api/tasks/${taskId}/collaboration`, operator, { status: 'IN_PROGRESS', reason: '开始协同处理' })?.status, 200);
  assert.equal(call(api, 'PATCH', `/api/tasks/${taskId}/collaboration`, manager, { status: 'COMPLETED', reason: '已完成核对' })?.status, 200);
  const detail = call(api, 'GET', `/api/projects/${projectId}`, manager);
  assert.equal(detail?.status, 200);
  assert.deepEqual((detail?.body.project as { progress: unknown }).progress, { total: 1, completed: 1, percent: 100 });
  assert.equal((detail?.body.tasks as unknown[]).length, 1);
});

test('keeps projects and manual tasks inaccessible across tenants and non-manager creation denied', (t) => {
  const api = fixture(t);
  const created = call(api, 'POST', '/api/projects', manager, { name: '隔离项目' });
  const projectId = (created?.body.project as { projectId: string }).projectId;
  assert.equal(call(api, 'GET', `/api/projects/${projectId}`, outsider)?.status, 404);
  assert.equal(call(api, 'POST', '/api/projects', operator, { name: '无权项目' })?.status, 403);
  assert.equal(call(api, 'POST', '/api/tasks/manual', operator, { title: '无权任务', dueAt: '2026-10-20' })?.status, 403);
});
