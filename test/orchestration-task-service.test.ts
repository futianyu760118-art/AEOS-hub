import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionAgentRecord, ExecutionPlaneRegistry } from '../src/execution-plane.ts';
import { OrchestrationTaskService, OrchestrationTaskServiceError } from '../src/orchestration-task-service.ts';
import { OrchestrationTaskStore } from '../src/orchestration-task-store.ts';
import { ensureSystems } from '../src/system-registry.ts';

ensureSystems();

function fixture(t: { after: (fn: () => void) => void }, options: { agents?: ExecutionAgentRecord[]; openTaskLimit?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-orchestration-service-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new OrchestrationTaskStore({
    file: join(dir, 'orchestration-tasks.json'),
    clock: () => new Date('2026-10-21T06:00:00.000Z'),
    idFactory: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const agents = options.agents ?? [plmAgent()];
  const executionPlane = { list: () => ({ agents, runs: [] }) } as unknown as Pick<ExecutionPlaneRegistry, 'list'>;
  const service = new OrchestrationTaskService({
    store,
    executionPlane,
    tenantId: 'tenant-demo',
    openTaskLimit: options.openTaskLimit,
  });
  return { store, service, agents };
}

function agent(overrides: Partial<ExecutionAgentRecord> & {
  agentId: string;
  systemId: string;
  capabilities: ExecutionAgentRecord['capabilities'];
}): ExecutionAgentRecord {
  return {
    agentId: overrides.agentId,
    name: overrides.agentId,
    version: '1.0.0',
    protocolVersion: '1.0',
    sourceSystem: overrides.systemId,
    sourceSystemName: overrides.systemId,
    systemId: overrides.systemId,
    connectionStatus: 'online',
    runtimeStatus: 'idle',
    lastSeenAt: '2026-10-21T06:00:00.000Z',
    registeredAt: '2026-10-21T05:00:00.000Z',
    currentRunId: null,
    authMode: 'system-token',
    simulated: false,
    deregisteredAt: null,
    ...overrides,
  } as ExecutionAgentRecord;
}

function plmAgent(overrides: Partial<ExecutionAgentRecord> = {}) {
  return agent({
    agentId: 'runtime-execution-query',
    systemId: 'hengjian-plm',
    capabilities: [{
      name: 'query_plm',
      version: '1.0.0',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', enum: ['/project/page'] },
          params: { type: 'object' },
        },
        required: ['path'],
      },
      constraints: { readOnly: true },
    }],
    ...overrides,
  });
}

function controlAgent(overrides: Partial<ExecutionAgentRecord> = {}) {
  return agent({
    agentId: 'runtime-control-platform-query',
    systemId: 'control-platform',
    capabilities: [{
      name: 'query_control_platform',
      version: '1.0.0',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', enum: ['/external/orders/list'] },
          params: { type: 'object' },
        },
        required: ['path'],
      },
      constraints: { readOnly: true },
    }],
    ...overrides,
  });
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'task-1',
    conversationId: 'conv-1',
    turn: 2,
    plan: [{
      stepId: 1,
      capability: 'query_plm',
      systemId: 'hengjian-plm',
      input: { path: '/project/page', params: { keyword: 'P-1' } },
    }],
    context: {
      businessObjectRef: 'business://order/HJ-1',
      summary: '查询 PLM 进度',
      evidenceRefs: ['control-platform://order/HJ-1/line/0010'],
    },
    constraints: { readOnly: true, maxSteps: 8 },
    ...overrides,
  };
}

function expectError(fn: () => unknown, code: string, status: number) {
  assert.throws(fn, (error) => error instanceof OrchestrationTaskServiceError
    && error.code === code
    && error.httpStatus === status);
}

test('创建合法任务并规范化 systemId', (t) => {
  const { service } = fixture(t);
  const result = service.create('control-platform', body({
    plan: [{
      stepId: 1,
      capability: 'query_plm',
      systemId: '恒剑PLM',
      input: { path: '/project/page', params: { keyword: 'P-1' } },
    }],
  }));
  assert.equal(result.idempotent, false);
  assert.equal(result.task.status, 'pending');
  assert.equal(result.task.plan[0].systemId, 'hengjian-plm');
  assert.equal(result.task.runs[0].status, 'pending');
});

test('相同 taskId 与相同请求体幂等返回原任务', (t) => {
  const { service } = fixture(t);
  const first = service.create('control-platform', body());
  const second = service.create('control-platform', body());
  assert.equal(second.idempotent, true);
  assert.equal(second.task.hubTaskId, first.task.hubTaskId);
});

test('相同 taskId 与不同请求体返回 TASK_CONFLICT', (t) => {
  const { service } = fixture(t);
  service.create('control-platform', body());
  expectError(() => service.create('control-platform', body({ turn: 3 })), 'TASK_CONFLICT', 409);
});

test('同系统步骤被拒绝', (t) => {
  const { service } = fixture(t, { agents: [controlAgent()] });
  expectError(() => service.create('control-platform', body({
    plan: [{
      stepId: 1,
      capability: 'query_control_platform',
      systemId: 'control-platform',
      input: { path: '/external/orders/list', params: {} },
    }],
  })), 'SAME_SYSTEM_STEP_FORBIDDEN', 403);
});

test('未知能力返回 CAPABILITY_NOT_FOUND', (t) => {
  const { service } = fixture(t);
  expectError(() => service.create('control-platform', body({
    plan: [{
      stepId: 1,
      capability: 'query_unknown',
      systemId: 'hengjian-plm',
      input: {},
    }],
  })), 'CAPABILITY_NOT_FOUND', 404);
});

test('非只读能力返回 WRITE_FORBIDDEN', (t) => {
  const writeAgent = plmAgent({
    capabilities: [{
      name: 'update_plm',
      version: '1.0.0',
      constraints: { readOnly: false },
      inputSchema: { type: 'object' },
    }],
  });
  const { service } = fixture(t, { agents: [writeAgent] });
  expectError(() => service.create('control-platform', body({
    plan: [{
      stepId: 1,
      capability: 'update_plm',
      systemId: 'hengjian-plm',
      input: {},
    }],
  })), 'WRITE_FORBIDDEN', 403);
});

test('提供方离线返回 NO_PROVIDER', (t) => {
  const { service } = fixture(t, { agents: [plmAgent({ connectionStatus: 'offline' })] });
  expectError(() => service.create('control-platform', body()), 'NO_PROVIDER', 409);
});

test('输入 schema 不匹配返回 INVALID_ARGUMENT', (t) => {
  const { service } = fixture(t);
  expectError(() => service.create('control-platform', body({
    plan: [{
      stepId: 1,
      capability: 'query_plm',
      systemId: 'hengjian-plm',
      input: { path: '/bad', params: {} },
    }],
  })), 'INVALID_ARGUMENT', 400);
});

test('stepId 必须从 1 连续递增', (t) => {
  const { service } = fixture(t);
  expectError(() => service.create('control-platform', body({
    plan: [
      { stepId: 1, capability: 'query_plm', systemId: 'hengjian-plm', input: { path: '/project/page' } },
      { stepId: 3, capability: 'query_plm', systemId: 'hengjian-plm', input: { path: '/project/page' } },
    ],
  })), 'INVALID_ARGUMENT', 400);
});

test('plan 超过 maxSteps 被拒绝', (t) => {
  const { service } = fixture(t);
  expectError(() => service.create('control-platform', body({
    plan: [
      { stepId: 1, capability: 'query_plm', systemId: 'hengjian-plm', input: { path: '/project/page' } },
      { stepId: 2, capability: 'query_plm', systemId: 'hengjian-plm', input: { path: '/project/page' } },
    ],
    constraints: { readOnly: true, maxSteps: 1 },
  })), 'INVALID_ARGUMENT', 400);
});

test('请求体超过 64 KB 返回 PAYLOAD_TOO_LARGE', (t) => {
  const { service } = fixture(t);
  expectError(() => service.create('control-platform', body({
    plan: [{
      stepId: 1,
      capability: 'query_plm',
      systemId: 'hengjian-plm',
      input: { path: '/project/page', params: { data: 'x'.repeat(70_000) } },
    }],
  })), 'ORCHESTRATION_TASK_INPUT_TOO_LARGE', 413);
});

test('未完成任务达到上限返回 TOO_MANY_OPEN_TASKS', (t) => {
  const { service } = fixture(t, { openTaskLimit: 1 });
  service.create('control-platform', body({ taskId: 'task-1' }));
  expectError(() => service.create('control-platform', body({ taskId: 'task-2' })), 'TOO_MANY_OPEN_TASKS', 429);
});
