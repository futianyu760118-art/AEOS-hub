// Hub 中枢对话的通用意图识别：业务域 + 动作 + 可用 Agent。
// 只做识别与路由建议，不虚构未接入的 Agent；最高风险订单仍走已有编排。
import type { ExecutionAgentRecord } from './execution-plane.ts';

export type HubIntentDomain = 'order' | 'kitting' | 'quality' | 'production' | 'plm' | 'cross-domain' | 'general';
export type HubIntentAction = 'highest-risk' | 'query' | 'reasoning' | 'chat';
export type HubIntentConfidence = 'high' | 'medium' | 'low';

export interface HubIntent {
  domain: HubIntentDomain;
  action: HubIntentAction;
  confidence: HubIntentConfidence;
  matchedKeywords: string[];
  /** 问题里是否已经带有订单号/需求号/异常号等业务标识。 */
  hasIdentifier: boolean;
}

export interface HubAgentSelection {
  agentId: string;
  name: string;
  systemId: string;
  capability: string;
}

const DOMAIN_KEYWORDS: Array<{ domain: Exclude<HubIntentDomain, 'general'>; keywords: string[] }> = [
  { domain: 'order', keywords: ['订单', '交期', '客户', '合同', '催交', '交付', '发货', '出货'] },
  { domain: 'kitting', keywords: ['齐套', '缺料', '短缺', '库存', '供给', '物料', '采购', '供应商', 'bom'] },
  { domain: 'quality', keywords: ['质量', '异常', '追溯', '检验', '缺陷', '客诉', '批次', '返工', '报废'] },
  { domain: 'production', keywords: ['生产', '工单', '工序', '报工', '产能', '车间', '排产'] },
  { domain: 'plm', keywords: ['plm', '研发', '图纸', '立项', '跟踪表', '工作表'] },
  { domain: 'cross-domain', keywords: ['跨系统', '综合', '整体', '全局'] },
];

const REASONING_KEYWORDS = ['分析', '评估', '判断', '建议', '预测', '影响', '为什么', '怎么办', '是否', '风险'];
const QUERY_KEYWORDS = ['查询', '查一下', '查查', '看看', '列出', '多少', '有哪些', '状态', '情况', '进度'];
const HIGHEST_RISK_PATTERN = /(风险最高|最高风险|风险最高的订单|今日.*风险|当前.*风险最高)/i;
const IDENTIFIER_PATTERN = /business:\/\/(?:order|product|batch)\/[^\s，。；,;]+|\b(?:HJY\d{8}-\d+|SO-\d{4,}-\d+|MO-\d{4,}|WO-\d{4,}|QC-\d{4,}|[A-Z]{2,}[-_]\d{2,})\b/i;

export const DOMAIN_LABELS: Record<HubIntentDomain, string> = {
  order: '订单交付',
  kitting: '物料齐套',
  quality: '质量异常',
  production: '生产进度',
  plm: 'PLM 研发',
  'cross-domain': '跨系统协同',
  general: '通用',
};

export const ACTION_LABELS: Record<HubIntentAction, string> = {
  'highest-risk': '最高风险扫描',
  query: '查询',
  reasoning: '分析/推理',
  chat: '普通对话',
};

function countMatches(text: string, keywords: string[]): string[] {
  const normalized = text.toLowerCase();
  return keywords.filter((keyword) => normalized.includes(keyword.toLowerCase()));
}

export function recognizeHubIntent(text: string): HubIntent {
  const value = String(text || '').trim();
  const hasIdentifier = IDENTIFIER_PATTERN.test(value);
  if (!value) return { domain: 'general', action: 'chat', confidence: 'low', matchedKeywords: [], hasIdentifier: false };

  const highestRisk = HIGHEST_RISK_PATTERN.test(value);
  const reasoning = countMatches(value, REASONING_KEYWORDS);
  const query = countMatches(value, QUERY_KEYWORDS);

  let domain: HubIntentDomain = 'general';
  let matched: string[] = [];
  let bestScore = 0;
  for (const candidate of DOMAIN_KEYWORDS) {
    const hits = countMatches(value, candidate.keywords);
    if (hits.length > bestScore) {
      bestScore = hits.length;
      domain = candidate.domain;
      matched = hits;
    }
  }
  if (domain === 'general' && highestRisk) domain = 'cross-domain';

  let action: HubIntentAction = 'chat';
  if (highestRisk) action = 'highest-risk';
  else if (reasoning.length) action = 'reasoning';
  else if (query.length) action = 'query';
  else if (domain !== 'general') action = 'query';

  if (domain === 'general' && action !== 'chat') {
    return { domain: 'general', action: 'chat', confidence: 'low', matchedKeywords: [...reasoning, ...query], hasIdentifier };
  }

  const actionHits = action === 'reasoning' ? reasoning : action === 'query' ? query : highestRisk ? ['风险最高'] : [];
  const confidence: HubIntentConfidence = bestScore >= 2 || (bestScore >= 1 && actionHits.length >= 1)
    ? 'high'
    : domain !== 'general' || actionHits.length
      ? 'medium'
      : 'low';

  return {
    domain,
    action,
    confidence,
    matchedKeywords: [...new Set([...matched, ...actionHits])],
    hasIdentifier,
  };
}

export function selectAgentForIntent(intent: HubIntent, agents: ExecutionAgentRecord[]): HubAgentSelection | null {
  if (intent.action === 'chat') return null;
  const needsReasoning = intent.action === 'highest-risk' || intent.action === 'reasoning';
  const capability = intent.domain === 'plm'
    ? (needsReasoning ? 'reason_plm' : 'query_plm')
    : (needsReasoning ? 'reason_control_platform' : 'query_control_platform');
  const systemId = intent.domain === 'plm' ? 'hengjian-plm' : 'control-platform';
  const agent = agents.find((candidate) => candidate.connectionStatus === 'online'
    && !candidate.deregisteredAt
    && !candidate.simulated
    && (candidate.systemId === systemId || candidate.sourceSystem === systemId)
    && candidate.capabilities.some((item) => item.name === capability
      || (needsReasoning ? item.name.startsWith('reason') : item.name.startsWith('query')))) ?? null;
  return agent ? { agentId: agent.agentId, name: agent.name, systemId, capability } : null;
}

export function formatIntentRoutingReply(intent: HubIntent, selection: HubAgentSelection | null): string {
  const domain = DOMAIN_LABELS[intent.domain];
  const action = ACTION_LABELS[intent.action];
  const hits = intent.matchedKeywords.length ? `；命中：${intent.matchedKeywords.join('、')}` : '';
  const lines = [`已识别：${domain} · ${action}（置信度：${intent.confidence === 'high' ? '高' : intent.confidence === 'medium' ? '中' : '低'}${hits}）。`];
  if (selection) {
    lines.push('', `可用智能体：${selection.name}（${selection.agentId} · ${selection.capability}）。`);
    if (intent.hasIdentifier) {
      lines.push('已识别到问题中的业务标识；当前为意图识别结果，完整派单能力按系统接入情况逐步开放。');
    } else {
      if (intent.action === 'query') lines.push('请补充订单号/需求编号/异常编号等具体标识，我会按该标识发起只读查询。');
      if (intent.action === 'reasoning') lines.push('请补充订单号/产品编码/批次号等业务锚点，我会带锚点发起只读分析。');
    }
  } else {
    lines.push('', `当前没有在线的${domain}${action}智能体。意图已识别，等对应系统接入后即可自动路由。`);
  }
  lines.push('', '当前为意图识别结果；完整派单能力按系统接入情况逐步开放。');
  return lines.join('\n');
}
