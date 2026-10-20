import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildIntentDispatch,
  formatIntentExecutionAnswer,
  formatIntentRoutingReply,
  recognizeHubIntent,
  selectAgentForIntent,
} from '../src/hub-intent-router.ts';
import type { ExecutionAgentRecord } from '../src/execution-plane.ts';

const NOW = '2026-10-20T08:00:00.000Z';

function agent(overrides: Record<string, unknown>): ExecutionAgentRecord {
  return {
    agentId: 'agent', name: 'agent', version: '1.0.0', capabilities: [],
    connectionStatus: 'online', runtimeStatus: 'idle', lastSeenAt: NOW, currentRunId: null,
    registeredAt: NOW, local: false, systemId: 'control-platform', sourceSystem: 'control-platform',
    sourceSystemName: '公司中控平台', authMode: 'legacy-root', simulated: false, deregisteredAt: null,
    ...overrides,
  } as ExecutionAgentRecord;
}

const QUERY = agent({
  agentId: 'q', name: '中台查询智能体',
  capabilities: [{ name: 'query_control_platform', description: '', constraints: { readOnly: true } }],
});
const REASON = agent({
  agentId: 'r', name: '中台推理智能体',
  capabilities: [{ name: 'reason_control_platform', description: '', constraints: { readOnly: true } }],
});
const PLM = agent({
  agentId: 'p', name: 'PLM 执行面智能体', systemId: 'hengjian-plm', sourceSystem: 'hengjian-plm',
  capabilities: [{ name: 'query_plm', description: '', constraints: { readOnly: true } }, { name: 'reason_plm', description: '', constraints: { readOnly: true } }],
});

test('识别订单、齐套、质量、生产、PLM、跨系统与普通对话', () => {
  assert.deepEqual(
    [recognizeHubIntent('分析订单交期风险').domain, recognizeHubIntent('分析订单交期风险').action],
    ['order', 'reasoning'],
  );
  assert.equal(recognizeHubIntent('齐套情况怎么样').domain, 'kitting');
  assert.equal(recognizeHubIntent('今天有哪些质量异常').domain, 'quality');
  assert.equal(recognizeHubIntent('生产工单进度').domain, 'production');
  assert.equal(recognizeHubIntent('PLM 研发项目进展').domain, 'plm');
  assert.equal(recognizeHubIntent('分析今日风险最高的订单').action, 'highest-risk');
  assert.equal(recognizeHubIntent('帮我写一段欢迎语').action, 'chat');
});

test('按意图选择在线 Agent；缺失时返回 null', () => {
  const queryIntent = recognizeHubIntent('查一下订单情况');
  const reasoningIntent = recognizeHubIntent('分析订单交期风险');
  assert.equal(selectAgentForIntent(queryIntent, [QUERY, REASON, PLM])?.agentId, 'q');
  assert.equal(selectAgentForIntent(reasoningIntent, [QUERY, REASON, PLM])?.agentId, 'r');
  assert.equal(selectAgentForIntent(recognizeHubIntent('PLM 研发项目进展'), [QUERY, REASON, PLM])?.agentId, 'p');
  assert.equal(selectAgentForIntent(reasoningIntent, [agent({ ...QUERY, connectionStatus: 'offline' })]), null);
});

test('识别问题中是否已带业务标识', () => {
  assert.equal(recognizeHubIntent('分析订单 SO-2609-001 的交付风险').hasIdentifier, true);
  assert.equal(recognizeHubIntent('分析订单交付风险').hasIdentifier, false);
  assert.equal(recognizeHubIntent('看看 business://order/SO-1 的齐套').hasIdentifier, true);
});

test('有 Agent 时提示补充业务锚点，无 Agent 时说明意图已识别但暂不可路由', () => {
  const intent = recognizeHubIntent('分析订单交期风险');
  const withAgent = formatIntentRoutingReply(intent, selectAgentForIntent(intent, [QUERY, REASON]));
  assert.match(withAgent, /订单交付 · 分析\/推理/);
  assert.match(withAgent, /可用智能体：中台推理智能体/);
  assert.match(withAgent, /业务锚点/);

  const anchored = recognizeHubIntent('分析订单 SO-2609-001 的交付风险');
  const anchoredReply = formatIntentRoutingReply(anchored, selectAgentForIntent(anchored, [QUERY, REASON]));
  assert.doesNotMatch(anchoredReply, /请补充订单号/);
  assert.match(anchoredReply, /已识别到问题中的业务标识/);

  const withoutAgent = formatIntentRoutingReply(intent, null);
  assert.match(withoutAgent, /当前没有在线的订单交付分析\/推理智能体/);
  assert.match(withoutAgent, /意图已识别/);
});

test('构建订单/齐套/质量/生产的查询输入与分析输入', () => {
  const order = recognizeHubIntent('查一下订单 SO-2609-001');
  assert.deepEqual(buildIntentDispatch(order, '查一下订单 SO-2609-001')?.input, {
    path: '/external/orders/list', params: { keyword: 'SO-2609-001' },
  });
  const kitting = recognizeHubIntent('查一下齐套 HJY20260903-261');
  assert.deepEqual(buildIntentDispatch(kitting, '查一下齐套 HJY20260903-261')?.input, {
    path: '/external/material-kitting/results', params: { demand_no: 'HJY20260903-261' },
  });
  const quality = recognizeHubIntent('查一下质量 SQ-2609-001');
  assert.deepEqual(buildIntentDispatch(quality, '查一下质量 SQ-2609-001')?.input, {
    path: '/external/quality-issues/list', params: { order_no: 'SQ-2609-001' },
  });
  const production = recognizeHubIntent('查一下生产 WO-2609-001');
  assert.deepEqual(buildIntentDispatch(production, '查一下生产 WO-2609-001')?.input, {
    path: '/external/production/work-orders/list', params: { work_order_no: 'WO-2609-001' },
  });
  const reasoning = recognizeHubIntent('分析订单 SO-2609-001 的交付风险');
  assert.deepEqual(buildIntentDispatch(reasoning, '分析订单 SO-2609-001 的交付风险')?.input.context, {
    businessObjectRef: 'business://order/SO-2609-001',
  });
  assert.equal(buildIntentDispatch(order, '查一下订单情况'), null);
  assert.equal(buildIntentDispatch(recognizeHubIntent('PLM 研发项目进展'), 'PLM 项目 HJ-1'), null);
});

test('格式化查询结果与分析结论', () => {
  const query = recognizeHubIntent('查一下订单 SO-2609-001');
  const queryAnswer = formatIntentExecutionAnswer(query, {
    total: 1,
    items: [{ order_no: 'SO-2609-001', customer: '客户甲', status: 'in_progress', risk_level: 'red', promised_date: '2026-10-30' }],
  });
  assert.match(queryAnswer, /SO-2609-001/);
  assert.match(queryAnswer, /客户甲/);
  assert.match(queryAnswer, /风险 red/);

  const reasoning = recognizeHubIntent('分析订单 SO-2609-001 的交付风险');
  const reasonAnswer = formatIntentExecutionAnswer(reasoning, {
    summary: '存在交付风险。',
    conclusions: [{ matter: '交期紧张', risk: '延误', recommendation: '催料', evidence_refs: ['control-platform://order/SO-2609-001@1'] }],
    data_confidence: 'high',
  });
  assert.match(reasonAnswer, /交期紧张/);
  assert.match(reasonAnswer, /control-platform:\/\/order\/SO-2609-001@1/);
  assert.match(reasonAnswer, /数据置信度：high/);
});
