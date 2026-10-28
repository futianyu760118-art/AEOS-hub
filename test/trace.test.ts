import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTrace, type TraceSources } from '../src/trace.ts';
import type { BorrowOrderRecord } from '../src/borrow-order-store.ts';
import type { EvidenceEntry } from '../src/evidence.ts';
import type { ExecutionRunRecord } from '../src/execution-plane.ts';
import type { UsageEvent } from '../src/usage-ledger-store.ts';

const NOW = '2026-10-26T05:43:56.000Z';

function borrow(overrides: Record<string, unknown> = {}): BorrowOrderRecord {
  return {
    orderId: 'borrow-1', tenantId: 'tenant-demo', requestId: 'p4-reason-1', requestHash: 'a'.repeat(64),
    fromSystem: 'aeos-hub', fromAgentId: null, capability: 'reason_control_platform',
    caller: { systemId: 'aeos-hub', agentId: 'AG-1', userId: 'u-1', taskId: 'AT-1', traceId: 'borrow-1' },
    capabilityVersion: '1.0.0', inputSchemaHash: null, outputSchemaHash: null,
    input: { prompt: '分析订单', task_type: 'order_delivery_analysis', context: { businessObjectRef: 'business://order/O-1' } },
    toSystem: 'control-platform', toAgent: null, providerSystem: 'control-platform',
    providerAgentId: 'gateway-control-platform', runId: 'exec-run-1', status: 'completed',
    error: null, result: { summary: '存在风险', data_confidence: 'high', conclusions: [] },
    resultBytes: 10, resultTruncated: false,
    createdAt: NOW, updatedAt: NOW, dispatchedAt: NOW, startedAt: NOW, endedAt: '2026-10-26T05:44:25.000Z',
    ...overrides,
  } as BorrowOrderRecord;
}

function run(overrides: Record<string, unknown> = {}): ExecutionRunRecord {
  return {
    runId: 'exec-run-1', traceId: 'borrow-1', agentId: 'gateway-control-platform', capability: 'reason_control_platform',
    caller: { systemId: 'aeos-hub', agentId: 'AG-1', userId: 'u-1', taskId: 'AT-1', traceId: 'borrow-1' },
    input: {}, state: 'completed', startedAt: '2026-10-26T05:43:56.100Z', endedAt: '2026-10-26T05:44:25.000Z',
    result: {
      summary: '存在风险', data_confidence: 'high',
      conclusions: [{ matter: '缺料', evidence_refs: ['control-platform://kitting/result/O-1:1'] }],
    },
    ...overrides,
  } as ExecutionRunRecord;
}

function usage(overrides: Record<string, unknown> = {}): UsageEvent {
  return {
    id: 'usage-1', tenantId: 'tenant-demo', agentId: 'gateway-control-platform', systemId: 'control-platform',
    modelId: 'deepseek-flash', runId: 'exec-run-1', traceId: 'borrow-1', consumerSystemId: 'aeos-hub',
    callerAgentId: 'AG-1', callerUserId: 'u-1',
    borrowOrderId: 'borrow-1', tokensIn: 100, cachedTokens: 10, tokensOut: 50, cost: 0.01,
    metering: 'reported', usageKind: 'model', startedAt: NOW, endedAt: '2026-10-26T05:44:25.000Z',
    ...overrides,
  } as UsageEvent;
}

function evidence(correlationId: string, payload: Record<string, unknown>, occurredAt = NOW): EvidenceEntry {
  return {
    event_id: '00000000-0000-4000-8000-000000000000', occurred_at: occurredAt, tenant_id: 'tenant-demo',
    object_ref: 'hub://test', source_system: 'aeos-hub', correlation_id: correlationId, version: '1.0', kind: 'app_event',
    actor_id: 'hub-broker:hub', actor_type: 'system', summary: correlationId, evidence_refs: [], payload_hash: 'b'.repeat(64),
    payload,
  } as unknown as EvidenceEntry;
}

function sources(overrides: Partial<TraceSources> = {}): TraceSources {
  const orders = [borrow()];
  const runs = [run()];
  const events = [usage()];
  const entries = [
    evidence('borrow-order-created', { orderId: 'borrow-1', requestId: 'p4-reason-1', status: 'pending' }, '2026-10-26T05:43:56.000Z'),
    evidence('borrow-order-dispatched', { orderId: 'borrow-1', runId: 'exec-run-1', status: 'dispatched' }, '2026-10-26T05:43:56.500Z'),
    evidence('borrow-order-completed', { orderId: 'borrow-1', runId: 'exec-run-1', status: 'completed' }, '2026-10-26T05:44:25.100Z'),
  ];
  return {
    borrowOrderById: (id) => orders.find((order) => order.orderId === id) ?? null,
    borrowOrders: () => orders,
    runById: (id) => runs.find((item) => item.runId === id),
    allRuns: () => runs,
    usageEvents: () => events,
    evidenceEntries: () => entries,
    ...overrides,
  };
}

test('按借调单号构建：borrow + run + usage + evidence + 时间线', () => {
  const trace = buildTrace('borrow-1', sources());
  assert.equal(trace.resolvedBy, 'borrow-order');
  assert.equal(trace.borrowOrder?.orderId, 'borrow-1');
  assert.equal(trace.borrowOrder?.caller?.userId, 'u-1');
  assert.equal(trace.runs.length, 1);
  assert.equal(trace.runs[0]?.caller?.agentId, 'AG-1');
  assert.equal(trace.usage[0]?.callerAgentId, 'AG-1');
  assert.equal(trace.usage[0]?.callerUserId, 'u-1');
  assert.equal(trace.runs[0]?.taskId, 'exec-run-1');
  assert.equal(trace.runs[0]?.conclusions, 1);
  assert.equal(trace.usage.length, 1);
  assert.equal(trace.usage[0]?.consumerSystemId, 'aeos-hub');
  assert.equal(trace.usage[0]?.cost, 0.01);
  assert.deepEqual(trace.evidenceRefs, ['control-platform://kitting/result/O-1:1']);
  assert.equal(trace.evidence.length, 3);
  assert.equal(trace.timeline[0]?.kind, 'borrow');
  assert.ok(trace.timeline.some((item) => item.kind === 'usage'));
  // 时间线按时间升序
  const times = trace.timeline.map((item) => Date.parse(item.at));
  assert.deepEqual(times, [...times].sort((left, right) => left - right));
});

test('按 runId 构建：能反查到借调单与请求方归属', () => {
  const trace = buildTrace('exec-run-1', sources());
  assert.equal(trace.resolvedBy, 'run');
  assert.equal(trace.borrowOrder?.orderId, 'borrow-1');
  assert.equal(trace.usage[0]?.consumerSystemId, 'aeos-hub');
});

test('按编排 requestId 构建：从 evidence 反查两条 run', () => {
  const runs = [
    run({ runId: 'exec-run-q', traceId: 'orch-1', capability: 'query_control_platform', startedAt: '2026-10-26T05:41:14.000Z', endedAt: '2026-10-26T05:41:15.000Z' }),
    run({ runId: 'exec-run-r', traceId: 'orch-1', capability: 'reason_control_platform', startedAt: '2026-10-26T05:41:15.000Z', endedAt: '2026-10-26T05:41:36.000Z' }),
  ];
  const entries = [
    evidence('execution-orchestration-highest-risk', {
      status: 'completed', requestId: 'orch-1', traceId: 'orch-1', queryRunId: 'exec-run-q', reasoningRunId: 'exec-run-r', orderNo: 'O-1',
    }, '2026-10-26T05:41:36.000Z'),
  ];
  const trace = buildTrace('orch-1', sources({
    borrowOrderById: () => null,
    borrowOrders: () => [],
    runById: (id) => runs.find((item) => item.runId === id),
    allRuns: () => runs,
    usageEvents: () => [],
    evidenceEntries: () => entries,
  }));
  assert.equal(trace.resolvedBy, 'request');
  assert.equal(trace.borrowOrder, null);
  assert.deepEqual(trace.runs.map((item) => item.runId), ['exec-run-q', 'exec-run-r']);
  assert.equal(trace.evidence.length, 1);
});

test('按 traceId 构建：run 写入 traceId 后可直接反查', () => {
  const runs = [run({ runId: 'exec-run-t', traceId: 'trace-x' })];
  const trace = buildTrace('trace-x', sources({
    borrowOrderById: () => null,
    borrowOrders: () => [],
    runById: (id) => runs.find((item) => item.runId === id),
    allRuns: () => runs,
    usageEvents: () => [],
    evidenceEntries: () => [],
  }));
  assert.equal(trace.resolvedBy, 'trace');
  assert.equal(trace.runs.length, 1);
  assert.equal(trace.runs[0]?.runId, 'exec-run-t');
  assert.equal(trace.runs[0]?.traceId, 'trace-x');
});

test('未知标识返回空链路而不是抛错', () => {
  const trace = buildTrace('not-found', sources());
  assert.equal(trace.resolvedBy, 'none');
  assert.equal(trace.borrowOrder, null);
  assert.equal(trace.runs.length, 0);
  assert.equal(trace.usage.length, 0);
  assert.equal(trace.timeline.length, 0);
});

test('同一 trace 下按 task_type 区分分析类型', () => {
  const runs = [
    run({ runId: 'exec-run-q', capability: 'query_control_platform', input: { path: '/external/orders/list' }, traceId: 'trace-multi' }),
    run({ runId: 'exec-run-k', capability: 'reason_control_platform', input: { task_type: 'material_kitting_analysis' }, traceId: 'trace-multi' }),
    run({ runId: 'exec-run-q2', capability: 'reason_control_platform', input: { task_type: 'quality_analysis' }, traceId: 'trace-multi' }),
  ];
  const trace = buildTrace('trace-multi', sources({
    borrowOrders: () => [],
    allRuns: () => runs,
    runById: (id) => runs.find((item) => item.runId === id),
    usageEvents: () => [],
    evidenceEntries: () => [],
  }));
  const titles = trace.timeline.filter((item) => item.kind === 'run').map((item) => item.title);
  assert.ok(titles.some((title) => title.startsWith('查询开始')));
  assert.ok(titles.some((title) => title.startsWith('齐套分析开始')));
  assert.ok(titles.some((title) => title.startsWith('质量分析完成')));
  assert.equal(trace.runs.find((item) => item.runId === 'exec-run-k')?.taskType, 'material_kitting_analysis');
});
