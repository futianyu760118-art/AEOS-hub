import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatHighestRiskAnswer,
  isHighestRiskOrderQuestion,
  selectHubReasoningAgent,
} from '../src/hub-execution-routing.ts';
import type { ExecutionAgentRecord } from '../src/execution-plane.ts';
import type { HighestRiskOrderResult } from '../src/execution-orchestrator.ts';

const NOW = '2026-10-20T08:00:00.000Z';

function agent(overrides: Record<string, unknown>): ExecutionAgentRecord {
  return {
    agentId: 'agent', name: 'agent', version: '1.0.0', capabilities: [{ name: 'reason_control_platform', description: '', constraints: { readOnly: true } }],
    connectionStatus: 'online', runtimeStatus: 'idle', lastSeenAt: NOW, currentRunId: null,
    registeredAt: NOW, local: false, systemId: 'control-platform', sourceSystem: 'control-platform',
    sourceSystemName: '公司中控平台', authMode: 'legacy-root', simulated: false, deregisteredAt: null,
    ...overrides,
  } as ExecutionAgentRecord;
}

test('识别中枢对话里的最高风险订单问题', () => {
  assert.equal(isHighestRiskOrderQuestion('分析今日风险最高的订单'), true);
  assert.equal(isHighestRiskOrderQuestion('当前风险最高的是哪单'), true);
  assert.equal(isHighestRiskOrderQuestion('分析订单 SO-2609-001 的交付风险'), false);
});

test('只选择在线、非模拟、有推理能力的中台 Agent', () => {
  assert.equal(selectHubReasoningAgent([
    agent({ agentId: 'offline', connectionStatus: 'offline' }),
    agent({ agentId: 'simulated', simulated: true }),
    agent({ agentId: 'query-only', capabilities: [{ name: 'query_control_platform', description: '', constraints: { readOnly: true } }] }),
    agent({ agentId: 'reasoner' }),
  ])?.agentId, 'reasoner');
  assert.equal(selectHubReasoningAgent([agent({ agentId: 'plm', systemId: 'hengjian-plm', sourceSystem: 'hengjian-plm' })]), null);
});

test('格式化结果包含订单、证据与两条 runId', () => {
  const result: HighestRiskOrderResult = {
    requestId: 'orch-1',
    order: { orderNo: 'HJ-1', riskLevel: 'red', riskRank: 3, amount: 100, promisedDate: null, businessObjectRef: 'business://order/HJ-1', raw: {} },
    queryRunId: 'run-q',
    reasoningRunId: 'run-r',
    result: {
      summary: '订单交付风险高。',
      conclusions: [{ matter: '交期紧张', risk: '延误', recommendation: '催料', evidence_refs: ['control-platform://order/HJ-1@1'] }],
      data_confidence: 'high',
    },
  };
  const answer = formatHighestRiskAnswer(result);
  assert.match(answer, /HJ-1/);
  assert.match(answer, /交期紧张/);
  assert.match(answer, /control-platform:\/\/order\/HJ-1@1/);
  assert.match(answer, /run-q/);
  assert.match(answer, /run-r/);
});
