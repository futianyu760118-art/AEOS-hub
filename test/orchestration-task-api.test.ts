import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrchestrationTaskApi } from '../src/orchestration-task-api.ts';
import { OrchestrationTaskServiceError } from '../src/orchestration-task-service.ts';
import {
  OrchestrationTaskStore,
  orchestrationRequestHash,
  type OrchestrationTaskRecord,
} from '../src/orchestration-task-store.ts';
import { deriveSystemToken } from '../src/system-token.ts';

const ROOT = 'test-root-secret';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-orchestration-api-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new OrchestrationTaskStore({
    file: join(dir, 'orchestration-tasks.json'),
    clock: () => new Date('2026-10-21T06:00:00.000Z'),
    idFactory: () => 'id-1',
  });
  const plan = [{ stepId: 1, capability: 'query_plm', systemId: 'hengjian-plm', input: { path: '/project/page' } }];
  const context = {
    userId: null,
    userDisplayName: null,
    businessObjectRef: 'business://order/HJ-1',
    summary: '测试',
    evidenceRefs: [],
  };
  const constraints = { readOnly: true, maxSteps: 8 };
  const task = store.create({
    tenantId: 'tenant-demo',
    fromSystem: 'control-platform',
    taskId: 'task-1',
    requestHash: orchestrationRequestHash({ taskId: 'task-1', conversationId: 'conv-1', turn: 2, plan, context, constraints }),
    conversationId: 'conv-1',
    turn: 2,
    plan,
    context,
    constraints,
  });
  return {
    store,
    task,
    token: (systemId: string) => deriveSystemToken(ROOT, systemId),
  };
}

function apiFor(
  task: OrchestrationTaskRecord,
  store: OrchestrationTaskStore,
  options: { enabled?: boolean; create?: () => unknown; started?: string[] } = {},
) {
  const started = options.started ?? [];
  return new OrchestrationTaskApi({
    rootSecret: ROOT,
    enabled: options.enabled ?? true,
    service: {
      create: options.create ?? (() => ({ task, idempotent: false })),
    } as never,
    store,
    executor: { startTask: (hubTaskId: string) => { started.push(hubTaskId); } },
  });
}

test('开关关闭返回 503', (t) => {
  const { task, store, token } = fixture(t);
  const api = apiFor(task, store, { enabled: false });
  const result = api.handle({
    method: 'POST', pathname: '/api/system/orchestration-tasks', systemId: 'control-platform',
    token: token('control-platform'), body: {},
  });
  assert.equal(result?.status, 503);
  assert.equal(result?.body.code, 'NOT_CONFIGURED');
});

test('鉴权失败返回 401', (t) => {
  const { task, store } = fixture(t);
  const api = apiFor(task, store);
  const result = api.handle({
    method: 'POST', pathname: '/api/system/orchestration-tasks', systemId: 'control-platform', token: 'wrong', body: {},
  });
  assert.equal(result?.status, 401);
});

test('创建任务返回 202 并启动执行', (t) => {
  const { task, store, token } = fixture(t);
  const started: string[] = [];
  const api = apiFor(task, store, { started });
  const result = api.handle({
    method: 'POST', pathname: '/api/system/orchestration-tasks', systemId: 'control-platform',
    token: token('control-platform'), body: {},
  });
  assert.equal(result?.status, 202);
  assert.equal(result?.body.hubTaskId, task.hubTaskId);
  assert.deepEqual(started, [task.hubTaskId]);
});

test('幂等重放返回 200', (t) => {
  const { task, store, token } = fixture(t);
  const api = apiFor(task, store, { create: () => ({ task, idempotent: true }) });
  const result = api.handle({
    method: 'POST', pathname: '/api/system/orchestration-tasks', systemId: 'control-platform',
    token: token('control-platform'), body: {},
  });
  assert.equal(result?.status, 200);
  assert.equal(result?.body.idempotent, true);
});

test('查询本系统任务返回 200，其他系统返回 404', (t) => {
  const { task, store, token } = fixture(t);
  const api = apiFor(task, store);
  const own = api.handle({
    method: 'GET', pathname: `/api/system/orchestration-tasks/${task.hubTaskId}`, systemId: 'control-platform',
    token: token('control-platform'),
  });
  assert.equal(own?.status, 200);
  assert.equal(own?.body.taskId, 'task-1');
  const other = api.handle({
    method: 'GET', pathname: `/api/system/orchestration-tasks/${task.hubTaskId}`, systemId: 'hengjian-plm',
    token: token('hengjian-plm'),
  });
  assert.equal(other?.status, 404);
});

test('服务错误映射为 HTTP 状态', (t) => {
  const { task, store, token } = fixture(t);
  const api = apiFor(task, store, {
    create: () => { throw new OrchestrationTaskServiceError('SAME_SYSTEM_STEP_FORBIDDEN', 403, '同系统'); },
  });
  const result = api.handle({
    method: 'POST', pathname: '/api/system/orchestration-tasks', systemId: 'control-platform',
    token: token('control-platform'), body: {},
  });
  assert.equal(result?.status, 403);
  assert.equal(result?.body.code, 'SAME_SYSTEM_STEP_FORBIDDEN');
});

test('bodyParseFailed 返回 400', (t) => {
  const { task, store, token } = fixture(t);
  const api = apiFor(task, store);
  const result = api.handle({
    method: 'POST', pathname: '/api/system/orchestration-tasks', systemId: 'control-platform',
    token: token('control-platform'), bodyParseFailed: true,
  });
  assert.equal(result?.status, 400);
});

test('非本任务路径返回 404', (t) => {
  const { task, store, token } = fixture(t);
  const api = apiFor(task, store);
  const result = api.handle({
    method: 'GET', pathname: '/api/system/orchestration-tasks/missing', systemId: 'control-platform',
    token: token('control-platform'),
  });
  assert.equal(result?.status, 404);
});
