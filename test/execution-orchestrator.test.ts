import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ExecutionOrchestrationError,
  ExecutionOrchestrator,
  beijingDateString,
  buildHighestRiskReasoningRequest,
  rankOrdersFromResult,
} from '../src/execution-orchestrator.ts';
import type { ExecutionAgentRecord, ExecutionRunRecord } from '../src/execution-plane.ts';
import type { EvidenceInput } from '../src/evidence.ts';

const NOW = '2026-10-20T08:00:00.000Z';

function agent(overrides: Record<string, unknown>): ExecutionAgentRecord {
  return {
    agentId: 'agent', name: 'agent', version: '1.0.0', capabilities: [],
    connectionStatus: 'online', runtimeStatus: 'idle', lastSeenAt: NOW, currentRunId: null,
    registeredAt: NOW, local: false, systemId: 'control-platform', sourceSystem: 'control-platform',
    sourceSystemName: '公司中控平台', authMode: 'system-token', simulated: false, deregisteredAt: null,
    ...overrides,
  } as ExecutionAgentRecord;
}

const QUERY_AGENT = agent({
  agentId: 'query-agent',
  name: '查询智能体',
  capabilities: [{ name: 'query_control_platform', description: '', inputSchema: { type: 'object', properties: { path: { type: 'string', enum: ['/external/orders/list', '/external/material-kitting/results'] } } } }],
});
const REASON_AGENT = agent({
  agentId: 'reason-agent',
  name: '推理智能体',
  capabilities: [{ name: 'reason_control_platform', description: '', constraints: { readOnly: true } }],
});
const GATEWAY_AGENT = agent({
  agentId: 'gateway-agent',
  name: '统一网关',
  capabilities: [
    { name: 'query_control_platform', description: '', inputSchema: { type: 'object', properties: { path: { type: 'string', enum: ['/external/orders/list', '/external/material-kitting/results'] } } } },
    { name: 'reason_control_platform', description: '', constraints: { readOnly: true } },
  ],
});

function planeFixture(options: { failQuery?: boolean; failReason?: boolean; noQueryAgent?: boolean; singleGateway?: boolean; emptyOrders?: boolean; busyForMs?: number; busyForever?: boolean; agentIdleTimeoutMs?: number; pagedOrders?: boolean } = {}) {
  const runs = new Map<string, ExecutionRunRecord>();
  const dispatches: Array<{ agentId: string; capability: string; input: unknown }> = [];
  let sequence = 0;
  const audits: EvidenceInput[] = [];
  const agents = (options.singleGateway
    ? [GATEWAY_AGENT]
    : options.noQueryAgent ? [REASON_AGENT] : [QUERY_AGENT, REASON_AGENT]).map((item) => ({ ...item }));
  if (options.busyForever || options.busyForMs) {
    for (const item of agents) {
      item.currentRunId = 'busy-run';
      item.runtimeStatus = 'working';
    }
    if (options.busyForMs) {
      setTimeout(() => {
        for (const item of agents) {
          item.currentRunId = null;
          item.runtimeStatus = 'idle';
        }
      }, options.busyForMs);
    }
  }
  const plane = {
    list: () => ({ agents, runs: [] }),
    dispatch: (agentId: string, capability: string, input: unknown) => {
      dispatches.push({ agentId, capability, input });
      const runId = `run-${++sequence}`;
      const run: ExecutionRunRecord = { runId, agentId, capability, input, state: 'dispatched', startedAt: NOW, endedAt: null };
      runs.set(runId, run);
      setTimeout(() => {
        if (capability.startsWith('query')) {
          if (options.failQuery) {
            run.state = 'failed';
            run.error = { code: 'UPSTREAM_UNAVAILABLE', message: '查询不可达' };
          } else if (options.pagedOrders) {
            const page = Number((input as { params?: { page?: unknown } } | null)?.params?.page ?? 1);
            run.state = 'completed';
            run.result = page === 1
              ? {
                items: Array.from({ length: 200 }, (_, index) => ({ demand_no: `HJ-P1-${index}`, risk_level: 'red', affected_order_amount: 1 })),
                total: 201,
                data_as_of: '2026-10-25T20:33:59.415427',
                stale: true,
                data_confidence: 'low',
              }
              : {
                items: [{ demand_no: 'HJ-PAGE2-BIG', risk_level: 'red', affected_order_amount: 999 }],
                total: 201,
                data_as_of: '2026-10-25T20:33:59.415427',
                stale: true,
                data_confidence: 'low',
              };
          } else {
            run.state = 'completed';
            run.result = options.emptyOrders ? { items: [] } : {
              items: [
                { demand_no: 'HJ-GREEN', risk_level: 'green', affected_order_amount: 999 },
                { demand_no: 'HJ-RED-SMALL', risk_level: 'red', affected_order_amount: 5 },
                { demand_no: 'HJ-RED-BIG', risk_level: 'red', affected_order_amount: 100, required_date: '2026-10-25' },
              ],
            };
          }
        } else {
          run.state = options.failReason ? 'failed' : 'completed';
          run.result = { summary: '推理完成', conclusions: [] };
          if (options.failReason) run.error = { code: 'INTERNAL_ERROR', message: '推理失败' };
        }
      }, 0);
      return { runId, state: 'dispatched' as const };
    },
    getRun: (runId: string) => runs.get(runId),
    recall: () => ({ recalled: true, runId: null }),
  };
  const orchestrator = new ExecutionOrchestrator(plane, (entry) => { audits.push(entry); }, {
    queryTimeoutMs: 200,
    reasoningTimeoutMs: 200,
    pollIntervalMs: 1,
    agentIdleTimeoutMs: options.agentIdleTimeoutMs ?? 60_000,
    idFactory: () => 'test',
    clock: () => new Date('2026-10-29T08:00:00.000Z'),
  });
  return { orchestrator, audits, dispatches };
}

test('北京时间日期串按东八区计算', () => {
  assert.equal(beijingDateString(new Date('2026-10-29T08:00:00.000Z')), '2026-10-29');
  assert.equal(beijingDateString(new Date('2026-10-29T16:30:00.000Z')), '2026-10-30');
});

test('按需求日期筛选并翻页汇总后再选最高风险', async () => {
  const { orchestrator, dispatches } = planeFixture({ pagedOrders: true });
  const result = await orchestrator.highestRiskOrder({ reasoningAgentId: 'reason-agent', text: '查询今天风险最高的订单' });

  const firstQuery = dispatches[0]?.input as { params?: Record<string, unknown> } | undefined;
  assert.equal(firstQuery?.params?.required_date_end, '2026-10-29');
  assert.equal(firstQuery?.params?.risk_level, 'red');
  const secondQuery = dispatches[1]?.input as { params?: Record<string, unknown> } | undefined;
  assert.equal(secondQuery?.params?.page, 2);
  assert.equal(result.order.orderNo, 'HJ-PAGE2-BIG');
  assert.equal(result.query?.scanned, 201);
  assert.equal(result.query?.total, 201);
  assert.deepEqual(result.query?.runIds, ['run-1', 'run-2']);
  assert.equal(result.query?.dataAsOf, '2026-10-25T20:33:59.415427');
  assert.equal(result.query?.stale, true);
  assert.equal(result.query?.confidence, 'low');
  assert.equal(result.reasoningRunId, 'run-3');
});

test('订单排序：红色优先，同等级金额降序', () => {
  const orders = rankOrdersFromResult({
    data: { items: [
      { demand_no: 'O-1', risk_level: 'green', affected_order_amount: 999 },
      { demand_no: 'O-2', risk_level: 'red', affected_order_amount: 5 },
      { demand_no: 'O-3', risk_level: 'red', affected_order_amount: 100 },
    ] },
  });
  assert.deepEqual(orders.map((order) => order.orderNo), ['O-3', 'O-2', 'O-1']);
  assert.equal(orders[0]?.businessObjectRef, 'business://order/O-3');
});

test('最高风险订单编排：查询后自动带 businessObjectRef 调推理', async () => {
  const { orchestrator, audits } = planeFixture();
  const result = await orchestrator.highestRiskOrder({ reasoningAgentId: 'reason-agent', text: '分析今日风险最高的订单' });

  assert.equal(result.requestId, 'orch-test');
  assert.equal(result.order.orderNo, 'HJ-RED-BIG');
  assert.equal(result.order.businessObjectRef, 'business://order/HJ-RED-BIG');
  assert.equal(result.queryRunId, 'run-1');
  assert.equal(result.reasoningRunId, 'run-2');
  assert.deepEqual(result.result, { summary: '推理完成', conclusions: [] });
  assert.equal(audits.length, 1);
  assert.equal((audits[0]?.payload as Record<string, unknown>).orderNo, 'HJ-RED-BIG');
});

test('统一网关：同一 Agent 兼查询与推理时允许编排', async () => {
  const { orchestrator } = planeFixture({ singleGateway: true });
  const result = await orchestrator.highestRiskOrder({ reasoningAgentId: 'gateway-agent', text: '分析今天风险最高的订单' });
  assert.equal(result.queryRunId, 'run-1');
  assert.equal(result.reasoningRunId, 'run-2');
  assert.equal(result.order.orderNo, 'HJ-RED-BIG');
});

test('查询失败时不派推理', async () => {
  const { orchestrator } = planeFixture({ failQuery: true });
  await assert.rejects(
    () => orchestrator.highestRiskOrder({ reasoningAgentId: 'reason-agent', text: '分析今日风险最高的订单' }),
    (error: unknown) => error instanceof ExecutionOrchestrationError && error.code === 'QUERY_FAILED' && error.queryRunId === 'run-1' && error.reasoningRunId === null,
  );
});

test('没有候选订单时返回 NO_ELIGIBLE_ORDER', async () => {
  const { orchestrator } = planeFixture({ emptyOrders: true });
  await assert.rejects(
    () => orchestrator.highestRiskOrder({ reasoningAgentId: 'reason-agent', text: '分析今日风险最高的订单' }),
    (error: unknown) => error instanceof ExecutionOrchestrationError && error.code === 'NO_ELIGIBLE_ORDER',
  );
});

test('同系统没有查询智能体时拒绝编排', async () => {
  const { orchestrator } = planeFixture({ noQueryAgent: true });
  await assert.rejects(
    () => orchestrator.highestRiskOrder({ reasoningAgentId: 'reason-agent', text: '分析今日风险最高的订单' }),
    (error: unknown) => error instanceof ExecutionOrchestrationError && error.code === 'QUERY_AGENT_UNAVAILABLE',
  );
});

test('推理失败时带回两条 runId 并尝试召回', async () => {
  const { orchestrator } = planeFixture({ failReason: true });
  await assert.rejects(
    () => orchestrator.highestRiskOrder({ reasoningAgentId: 'reason-agent', text: '分析今日风险最高的订单' }),
    (error: unknown) => error instanceof ExecutionOrchestrationError
      && error.code === 'REASONING_FAILED'
      && error.queryRunId === 'run-1'
      && error.reasoningRunId === 'run-2',
  );
});

test('通用 runCapability：派单并等待完成结果', async () => {
  const { orchestrator } = planeFixture();
  const result = await orchestrator.runCapability({
    agentId: 'query-agent',
    capability: 'query_control_platform',
    input: { path: '/external/orders/list', params: {} },
    timeoutMs: 200,
  }) as { items?: unknown[] };
  assert.equal(result.items?.length, 3);
});

test('构造推理请求时写入订单锚点与只读约束', () => {
  const [order] = rankOrdersFromResult([{ demand_no: 'SO-1', risk_level: 'red', affected_order_amount: 12 }]);
  const request = buildHighestRiskReasoningRequest('分析今日风险最高的订单', order!, 'orch-1');
  assert.equal(request.task_type, 'order_delivery_analysis');
  assert.equal(request.request_id, 'orch-1');
  assert.deepEqual(request.context, { businessObjectRef: 'business://order/SO-1' });
  assert.match(String(request.prompt), /SO-1/);
});

test('目标执行面忙碌时先等空闲再编排', async () => {
  const { orchestrator } = planeFixture({ busyForMs: 30, agentIdleTimeoutMs: 1000 });
  const result = await orchestrator.highestRiskOrder({ reasoningAgentId: 'reason-agent', text: '分析今日风险最高的订单' });
  assert.equal(result.order.orderNo, 'HJ-RED-BIG');
  assert.equal(result.queryRunId, 'run-1');
});

test('目标执行面持续忙碌时返回 AGENT_BUSY 而不是直接撞上游', async () => {
  const { orchestrator } = planeFixture({ busyForever: true, agentIdleTimeoutMs: 30 });
  await assert.rejects(
    () => orchestrator.highestRiskOrder({ reasoningAgentId: 'reason-agent', text: '分析今日风险最高的订单' }),
    (error: unknown) => error instanceof ExecutionOrchestrationError && error.code === 'AGENT_BUSY',
  );
});

test('排除已分析订单后选择下一条高风险订单', async () => {
  const { orchestrator } = planeFixture();
  const result = await orchestrator.highestRiskOrder({
    reasoningAgentId: 'reason-agent',
    text: '下一条高风险订单',
    excludeOrderNos: ['HJ-RED-BIG'],
  });
  assert.equal(result.order.orderNo, 'HJ-RED-SMALL');
});
