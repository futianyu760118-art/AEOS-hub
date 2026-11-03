import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BorrowOrderRecord } from '../src/borrow-order-store.ts';
import type { ExecutionAgentRecord, ExecutionPlaneRegistry } from '../src/execution-plane.ts';
import { BorrowOrderExecutionAdapter } from '../src/orchestration-task-borrow-adapter.ts';
import { OrchestrationTaskApi } from '../src/orchestration-task-api.ts';
import { OrchestrationTaskExecutor } from '../src/orchestration-task-executor.ts';
import { OrchestrationTaskService } from '../src/orchestration-task-service.ts';
import { OrchestrationTaskStore } from '../src/orchestration-task-store.ts';
import { deriveSystemToken } from '../src/system-token.ts';

const ROOT = 'e2e-root-secret';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-orchestration-e2e-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new OrchestrationTaskStore({
    file: join(dir, 'orchestration-tasks.json'),
    clock: () => new Date('2026-10-21T06:00:00.000Z'),
    idFactory: (() => { let n = 0; return () => `id-${++n}`; })(),
  });
  const plmAgent = {
    agentId: 'runtime-execution-query',
    name: '恒剑 PLM 查询智能体',
    version: '1.0.0',
    protocolVersion: '1.0',
    sourceSystem: 'hengjian-plm',
    sourceSystemName: '恒剑 PLM',
    systemId: 'hengjian-plm',
    connectionStatus: 'online',
    runtimeStatus: 'idle',
    lastSeenAt: '2026-10-21T06:00:00.000Z',
    registeredAt: '2026-10-21T05:00:00.000Z',
    currentRunId: null,
    authMode: 'system-token',
    simulated: false,
    deregisteredAt: null,
    capabilities: [{
      name: 'query_plm',
      version: '1.0.0',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', enum: ['/project/page'] }, params: { type: 'object' } },
        required: ['path'],
      },
      constraints: { readOnly: true },
    }],
  } as unknown as ExecutionAgentRecord;
  const executionPlane = {
    list: () => ({ agents: [plmAgent], runs: [] }),
  } as unknown as Pick<ExecutionPlaneRegistry, 'list'>;
  const service = new OrchestrationTaskService({ store, executionPlane, tenantId: 'tenant-demo' });
  return { store, service };
}

function borrowOrder(overrides: Partial<BorrowOrderRecord> = {}): BorrowOrderRecord {
  return {
    orderId: 'borrow-1',
    tenantId: 'tenant-demo',
    requestId: 'task-e2e:1',
    requestHash: 'a'.repeat(64),
    fromSystem: 'control-platform',
    fromAgentId: null,
    capability: 'query_plm',
    capabilityVersion: '1.0.0',
    inputSchemaHash: null,
    outputSchemaHash: null,
    input: {},
    toSystem: 'hengjian-plm',
    toAgent: null,
    providerSystem: 'hengjian-plm',
    providerAgentId: 'runtime-execution-query',
    runId: 'run-1',
    status: 'completed',
    error: null,
    result: { items: [{ project_no: 'P-1' }], evidence_refs: ['plm://project/P-1'], data_as_of: '2026-10-21' },
    resultBytes: 80,
    resultTruncated: false,
    createdAt: '2026-10-21T06:00:00.000Z',
    updatedAt: '2026-10-21T06:00:01.000Z',
    dispatchedAt: '2026-10-21T06:00:00.000Z',
    startedAt: '2026-10-21T06:00:00.000Z',
    endedAt: '2026-10-21T06:00:01.000Z',
    ...overrides,
  };
}

function fakeBorrowService() {
  let createCount = 0;
  return {
    calls: [] as Array<{ fromSystem: string; body: Record<string, unknown> }>,
    get createCount() { return createCount; },
    create(input: { fromSystem: string; body: Record<string, unknown> }) {
      createCount += 1;
      this.calls.push(input);
      return {
        order: borrowOrder({
          orderId: `borrow-${createCount}`,
          requestId: String(input.body.requestId),
          runId: `run-${createCount}`,
          status: 'dispatched',
          result: null,
        }),
        idempotent: false,
        auditStatus: 'recorded',
      };
    },
    getForSystem() {
      return borrowOrder({ result: { items: [{ project_no: 'P-1' }], evidence_refs: ['plm://project/P-1'], data_as_of: '2026-10-21' } });
    },
  };
}

async function waitTerminal(store: OrchestrationTaskStore, hubTaskId: string) {
  for (let i = 0; i < 100; i += 1) {
    const task = store.get(hubTaskId);
    if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('task did not finish');
}

test('API → 服务 → 执行器 → 借调适配器 全链路 mock 通过', async (t) => {
  const { store, service } = fixture(t);
  const borrow = fakeBorrowService();
  const executor = new OrchestrationTaskExecutor({
    store,
    borrowPort: new BorrowOrderExecutionAdapter({ borrowOrderService: borrow as never, pollIntervalMs: 10 }),
  });
  const api = new OrchestrationTaskApi({
    rootSecret: ROOT,
    enabled: true,
    service,
    store,
    executor,
  });
  const token = deriveSystemToken(ROOT, 'control-platform');
  const body = {
    taskId: 'task-e2e',
    conversationId: 'conv-e2e',
    turn: 1,
    plan: [
      { stepId: 1, capability: 'query_plm', systemId: 'hengjian-plm', input: { path: '/project/page', params: { keyword: 'P-1' } } },
      { stepId: 2, capability: 'query_plm', systemId: 'hengjian-plm', input: { path: '/project/page', params: { keyword: 'P-2' } } },
    ],
    context: { businessObjectRef: 'business://order/HJ-1', summary: 'e2e', evidenceRefs: [] },
    constraints: { readOnly: true, maxSteps: 8 },
  };
  const created = api.handle({
    method: 'POST', pathname: '/api/system/orchestration-tasks', systemId: 'control-platform', token, body,
  });
  assert.equal(created?.status, 202);
  const hubTaskId = String(created?.body.hubTaskId);
  const task = await waitTerminal(store, hubTaskId);
  assert.equal(task.status, 'completed');
  assert.deepEqual(task.completedStepIds, [1, 2]);
  assert.equal(borrow.createCount, 2);
  assert.equal(borrow.calls[0].body.toSystem, 'hengjian-plm');

  const detail = api.handle({
    method: 'GET', pathname: `/api/system/orchestration-tasks/${hubTaskId}`, systemId: 'control-platform', token,
  });
  assert.equal(detail?.status, 200);
  assert.equal(detail?.body.status, 'completed');
  const runs = detail?.body.runs as Array<Record<string, unknown>>;
  assert.equal(runs.length, 2);
  assert.equal(runs[0].status, 'completed');
  assert.equal(runs[0].runId, 'run-1');
  assert.deepEqual(runs[0].evidenceRefs, ['plm://project/P-1']);

  const replay = api.handle({
    method: 'POST', pathname: '/api/system/orchestration-tasks', systemId: 'control-platform', token, body,
  });
  assert.equal(replay?.status, 200);
  assert.equal(replay?.body.idempotent, true);
  assert.equal(borrow.createCount, 2);
});
