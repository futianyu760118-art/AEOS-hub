import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ExecutionOrchestrationError,
  ExecutionOrchestrator,
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

function planeFixture(options: { failQuery?: boolean; failReason?: boolean; noQueryAgent?: boolean; emptyOrders?: boolean } = {}) {
  const runs = new Map<string, ExecutionRunRecord>();
  let sequence = 0;
  const audits: EvidenceInput[] = [];
  const plane = {
    list: () => ({ agents: options.noQueryAgent ? [REASON_AGENT] : [QUERY_AGENT, REASON_AGENT], runs: [] }),
    dispatch: (agentId: string, capability: string, input: unknown) => {
      const runId = `run-${++sequence}`;
      const run: ExecutionRunRecord = { runId, agentId, capability, input, state: 'dispatched', startedAt: NOW, endedAt: null };
      runs.set(runId, run);
      setTimeout(() => {
        if (agentId === 'query-agent') {
          if (options.failQuery) {
            run.state = 'failed';
            run.error = { code: 'UPSTREAM_UNAVAILABLE', message: '查询不可达' };
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
    idFactory: () => 'test',
  });
  return { orchestrator, audits };
}

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

test('构造推理请求时写入订单锚点与只读约束', () => {
  const [order] = rankOrdersFromResult([{ demand_no: 'SO-1', risk_level: 'red', affected_order_amount: 12 }]);
  const request = buildHighestRiskReasoningRequest('分析今日风险最高的订单', order!, 'orch-1');
  assert.equal(request.task_type, 'order_delivery_analysis');
  assert.equal(request.request_id, 'orch-1');
  assert.deepEqual(request.context, { businessObjectRef: 'business://order/SO-1' });
  assert.match(String(request.prompt), /SO-1/);
});
