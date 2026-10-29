// Hub 中枢对话 → 执行面 Agent 的窄路由规则与结果格式化。
import type { ExecutionAgentRecord } from './execution-plane.ts';
import type { HighestRiskOrderResult } from './execution-orchestrator.ts';
import { orderAgentsByPolicy, type ExecutionRoutingPolicy } from './execution-routing-policy.ts';

export function isHighestRiskOrderQuestion(text: string): boolean {
  return /(风险最高|最高风险|风险最高的订单|今日.*风险|当前.*风险最高)/i.test(String(text || ''));
}

export function selectHubReasoningAgent(agents: ExecutionAgentRecord[], policy?: ExecutionRoutingPolicy): ExecutionAgentRecord | null {
  const ordered = orderAgentsByPolicy(agents, {
    systemId: 'control-platform',
    capability: 'reason_control_platform',
    policy,
  });
  return ordered.find((agent) => agent.connectionStatus === 'online'
    && !agent.deregisteredAt
    && !agent.simulated
    && (agent.systemId === 'control-platform' || agent.sourceSystem === 'control-platform')
    && agent.capabilities.some((capability) => typeof capability.name === 'string' && capability.name.startsWith('reason'))) ?? null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function formatHighestRiskAnswer(result: HighestRiskOrderResult): string {
  const order = result.order;
  const payload = record(result.result) ?? {};
  const query = result.query;
  const head = query?.windowEnd
    ? `已按需求日期 ≤ ${query.windowEnd}（含今天到期与已逾期）筛选红色齐套风险，定位风险最高订单：${order.orderNo}（风险等级：${order.riskLevel || '未知'}${order.amount !== null ? `，影响金额：${order.amount}` : ''}）。`
    : `已定位当前风险最高订单：${order.orderNo}（风险等级：${order.riskLevel || '未知'}${order.amount !== null ? `，影响金额：${order.amount}` : ''}）。`;
  const lines = [head];
  if (query) {
    const snapshot = query.dataAsOf ? `快照 ${query.dataAsOf}` : '快照时间未知';
    const staleText = query.stale === true ? '（已过期）' : '';
    const scanned = query.total !== null ? `；扫描 ${query.scanned}/${query.total} 条红色风险` : `；扫描 ${query.scanned} 条红色风险`;
    lines.push('', `数据口径：${snapshot}${staleText}；查询置信度 ${query.confidence ?? '未知'}${scanned}。`);
  }
  const summary = text(payload.summary);
  if (summary) lines.push('', summary);
  const conclusions = Array.isArray(payload.conclusions) ? payload.conclusions.slice(0, 5) : [];
  if (conclusions.length) {
    lines.push('', '结论：');
    conclusions.forEach((item, index) => {
      const conclusion = record(item);
      if (!conclusion) return;
      const matter = text(conclusion.matter) || `结论 ${index + 1}`;
      const refs = Array.isArray(conclusion.evidence_refs) ? conclusion.evidence_refs.filter((ref) => typeof ref === 'string') : [];
      lines.push(`${index + 1}. ${matter}`);
      if (text(conclusion.risk)) lines.push(`   风险：${text(conclusion.risk)}`);
      if (text(conclusion.recommendation)) lines.push(`   建议：${text(conclusion.recommendation)}`);
      if (refs.length) lines.push(`   依据：${refs.slice(0, 5).join('、')}`);
    });
  }
  const confidence = text(payload.data_confidence);
  if (confidence || query) {
    const parts: string[] = [];
    if (query) parts.push(`查询 ${query.confidence ?? '未知'}${query.stale === true ? '（快照已过期）' : ''}`);
    if (confidence) parts.push(`推理 ${confidence}`);
    const warning = query?.stale === true || query?.confidence === 'low'
      ? '。数据源可能不是最新，请以中台最新数据为准。'
      : confidence === 'low' ? '（部分数据可能不是最新，请以中台最新数据为准）' : '';
    lines.push('', `数据置信度：${parts.join(' · ')}${warning}`);
  }
  const queryRuns = query?.runIds?.length ? query.runIds.join('、') : result.queryRunId;
  lines.push('', `请求：${result.requestId}；查询 run：${queryRuns}；推理 run：${result.reasoningRunId}。`);
  return lines.join('\n').slice(0, 12_000);
}
