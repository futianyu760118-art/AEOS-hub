// 窄范围编排：今日/当前风险最高的订单 → 查询智能体定位订单 → 推理智能体只读分析。
// 只做同系统、只读、确定性排序；不猜测订单号，不使用模拟执行面。
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExecutionAgentRecord, ExecutionPlaneRegistry, ExecutionRunRecord } from './execution-plane.ts';
import type { EvidenceInput } from './evidence.ts';
import type { CallerContext } from './caller-context.ts';

const KITTING_RESULTS_PATH = '/external/material-kitting/results';
const QUALITY_ISSUES_PATH = '/external/quality-issues/list';
const DEFAULT_QUERY_TIMEOUT_MS = 15_000;
const DEFAULT_REASONING_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 200;
/** 齐套/质量结果单页上限 200；按需翻页，最多 5 页。 */
const KITTING_PAGE_SIZE = 200;
const MAX_QUERY_PAGES = 5;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const riskScoringPolicyFile = process.env.AEOS_RISK_SCORING_POLICY_FILE?.trim()
  || join(root, 'config', 'risk-scoring.json');

export interface RiskScoringWeights {
  kittingAmount: number;
  shortageItems: number;
  qualityOpen: number;
  urgency: number;
}

export const DEFAULT_RISK_SCORING_WEIGHTS: RiskScoringWeights = {
  kittingAmount: 0.4,
  shortageItems: 0.2,
  qualityOpen: 0.2,
  urgency: 0.2,
};

export interface RiskScoringPolicy {
  weights: RiskScoringWeights;
  /** 计入“未闭环质量异常”的状态（逗号分隔）。 */
  qualityStatuses: string;
}

/** 读取权重配置；缺失或非法时回落默认值，并归一化到合计 1。 */
export function loadRiskScoringPolicy(file = riskScoringPolicyFile): RiskScoringPolicy {
  const fallback: RiskScoringPolicy = { weights: { ...DEFAULT_RISK_SCORING_WEIGHTS }, qualityStatuses: 'open,in_progress' };
  try {
    if (!existsSync(file)) return fallback;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const rawWeights = raw && typeof raw.weights === 'object' && raw.weights !== null ? raw.weights as Record<string, unknown> : {};
    const weights: RiskScoringWeights = { ...DEFAULT_RISK_SCORING_WEIGHTS };
    let sum = 0;
    for (const key of Object.keys(weights) as Array<keyof RiskScoringWeights>) {
      const value = rawWeights[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        weights[key] = value;
      }
      sum += weights[key];
    }
    if (sum <= 0) return fallback;
    for (const key of Object.keys(weights) as Array<keyof RiskScoringWeights>) weights[key] = weights[key] / sum;
    const statuses = typeof raw.qualityStatuses === 'string' && raw.qualityStatuses.trim()
      ? raw.qualityStatuses.trim()
      : fallback.qualityStatuses;
    return { weights, qualityStatuses: statuses };
  } catch {
    return fallback;
  }
}

type ExecutionPlaneLike = Pick<ExecutionPlaneRegistry, 'list' | 'dispatch' | 'getRun' | 'recall'>;

export interface HighestRiskOrder {
  orderNo: string;
  riskLevel: string;
  riskRank: number;
  amount: number | null;
  promisedDate: string | null;
  businessObjectRef: string;
  raw: Record<string, unknown>;
  /** 多域综合评分（齐套金额 / 缺料项 / 质量未闭环 / 交期紧急度）。 */
  composite?: {
    score: number;
    kittingAmount: number | null;
    shortageItems: number | null;
    qualityOpen: number;
    urgency: number;
    overdueDays: number;
  };
}

export interface HighestRiskQualityMeta {
  runIds: string[];
  dataAsOf: string | null;
  confidence: string | null;
  openIssues: number;
  warning: string | null;
}

/** 本次“最高风险”查询的数据侧信息：窗口、快照时间、置信度、翻页覆盖范围。 */
export interface HighestRiskQueryMeta {
  /** 需求日期窗口右端（YYYY-MM-DD，北京时间）；本次只取 required_date ≤ 该日期。 */
  windowEnd: string;
  /** 实际派发的查询 run（翻页时可能多条）。 */
  runIds: string[];
  /** 中台返回的快照时间（原样）。 */
  dataAsOf: string | null;
  stale: boolean | null;
  confidence: string | null;
  /** 中台报告的总行数（无该字段时为 null）。 */
  total: number | null;
  /** 实际参与排序的行数。 */
  scanned: number;
}

export interface HighestRiskOrderResult {
  requestId: string;
  order: HighestRiskOrder;
  queryRunId: string;
  reasoningRunId: string;
  result: unknown;
  query?: HighestRiskQueryMeta;
  /** 多域评分用到的质量异常数据；查询失败时为 warning，不影响主结论。 */
  quality?: HighestRiskQualityMeta;
}

/** 北京时间的日期串（YYYY-MM-DD），用于“今天”口径，避免服务器时区/UTC 偏移算错。 */
export function beijingDateString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export class ExecutionOrchestrationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly queryRunId: string | null;
  readonly reasoningRunId: string | null;

  constructor(
    code: string,
    message: string,
    options: { status?: number; requestId?: string | null; queryRunId?: string | null; reasoningRunId?: string | null } = {},
  ) {
    super(message);
    this.name = 'ExecutionOrchestrationError';
    this.code = code;
    this.status = options.status ?? 400;
    this.requestId = options.requestId ?? null;
    this.queryRunId = options.queryRunId ?? null;
    this.reasoningRunId = options.reasoningRunId ?? null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rowsFromResult(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result.filter((row) => record(row) !== null) as Array<Record<string, unknown>>;
  const root = record(result);
  if (!root) return [];
  const direct = ['items', 'rows', 'list', 'orders'];
  for (const key of direct) {
    if (Array.isArray(root[key])) return (root[key] as unknown[]).filter((row) => record(row) !== null) as Array<Record<string, unknown>>;
  }
  for (const key of ['data', 'body', 'result']) {
    if (Array.isArray(root[key])) return (root[key] as unknown[]).filter((row) => record(row) !== null) as Array<Record<string, unknown>>;
    const nested = record(root[key]);
    if (!nested) continue;
    for (const child of direct) {
      if (Array.isArray(nested[child])) return (nested[child] as unknown[]).filter((row) => record(row) !== null) as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function textOf(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function numberOf(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function riskRank(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (['red', 'high', '高', '高风险'].includes(normalized)) return 3;
  if (['yellow', 'medium', '中', '中风险'].includes(normalized)) return 2;
  if (['green', 'low', '低', '低风险'].includes(normalized)) return 1;
  return 0;
}

/** 从查询结果里提取订单并按“风险等级 → 金额降序 → 交期升序”排序。 */
export function rankOrdersFromResult(result: unknown): HighestRiskOrder[] {
  const orders = rowsFromResult(result).flatMap((row): HighestRiskOrder[] => {
    const orderNo = textOf(row, ['demand_no', 'order_no', 'orderNo', 'order_id', 'orderId', 'sales_order_no']);
    if (!orderNo) return [];
    const riskLevel = textOf(row, ['risk_level', 'riskLevel', 'risk']);
    const amount = numberOf(row, ['affected_order_amount', 'order_amount', 'orderAmount', 'shortage_amount', 'amount']);
    const promisedDate = textOf(row, ['required_date', 'promised_date', 'promisedDate', 'delivery_date', 'due_date']) || null;
    return [{
      orderNo,
      riskLevel,
      riskRank: riskRank(riskLevel),
      amount,
      promisedDate,
      businessObjectRef: `business://order/${orderNo}`,
      raw: row,
    }];
  });
  return orders.sort((left, right) => {
    if (left.riskRank !== right.riskRank) return right.riskRank - left.riskRank;
    const amountDiff = (right.amount ?? -1) - (left.amount ?? -1);
    if (amountDiff !== 0) return amountDiff;
    const leftDate = left.promisedDate ? Date.parse(left.promisedDate) : Number.POSITIVE_INFINITY;
    const rightDate = right.promisedDate ? Date.parse(right.promisedDate) : Number.POSITIVE_INFINITY;
    if (leftDate !== rightDate) return leftDate - rightDate;
    return left.orderNo.localeCompare(right.orderNo, 'zh-CN');
  });
}

function daysBetween(date: string, end: string): number | null {
  const startMs = Date.parse(`${date}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.round((endMs - startMs) / 86_400_000);
}

/** 交期紧急度：7 天内到期/逾期最高，越久远的逾期逐步降权，避免陈年订单霸榜。 */
function urgencyFor(days: number): number {
  if (days <= 7) return 1;
  if (days <= 30) return 0.8;
  if (days <= 90) return 0.6;
  return 0.4;
}

/**
 * 多域综合排序：齐套金额、缺料项数、质量未闭环数、交期紧急度加权。
 * 只统计 required_date ≤ windowEnd 的齐套行；同一订单取行级最大值，避免多行重复放大。
 */
export function rankOrdersByCompositeScore(
  result: unknown,
  qualityByOrder: Map<string, number>,
  windowEnd: string,
  weights: RiskScoringWeights = DEFAULT_RISK_SCORING_WEIGHTS,
): HighestRiskOrder[] {
  const window = String(windowEnd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(window)) return [];
  const grouped = new Map<string, { orderNo: string; riskLevel: string; amount: number | null; shortage: number | null; date: string; row: Record<string, unknown> }>();
  for (const row of rowsFromResult(result)) {
    const date = textOf(row, ['required_date', 'requiredDate', 'due_date', 'demand_date']).slice(0, 10);
    if (!date || date > window) continue;
    const orderNo = textOf(row, ['demand_no', 'order_no', 'orderNo', 'order_id', 'orderId', 'sales_order_no']);
    if (!orderNo) continue;
    const amount = numberOf(row, ['affected_order_amount', 'order_amount', 'orderAmount', 'shortage_amount', 'amount']);
    const shortage = numberOf(row, ['shortage_item_count', 'shortage_items']);
    const riskLevel = textOf(row, ['risk_level', 'riskLevel', 'risk']);
    if (riskLevel && riskRank(riskLevel) < 3) continue;
    const existing = grouped.get(orderNo);
    if (!existing) {
      grouped.set(orderNo, { orderNo, riskLevel, amount, shortage, date, row });
      continue;
    }
    if (!existing.riskLevel && riskLevel) existing.riskLevel = riskLevel;
    if (amount !== null && (existing.amount === null || amount > existing.amount)) {
      existing.amount = amount;
      existing.row = row;
    }
    if (shortage !== null && (existing.shortage === null || shortage > existing.shortage)) existing.shortage = shortage;
    if (date < existing.date) existing.date = date;
  }
  const entries = [...grouped.values()];
  if (!entries.length) return [];
  const maxAmount = Math.max(0, ...entries.map((entry) => entry.amount ?? 0));
  const maxShortage = Math.max(0, ...entries.map((entry) => entry.shortage ?? 0));
  const scored: HighestRiskOrder[] = entries.map((entry) => {
    const days = daysBetween(entry.date, window) ?? 0;
    const urgency = urgencyFor(days);
    const amountScore = maxAmount > 0 ? (entry.amount ?? 0) / maxAmount : 0;
    const shortageScore = maxShortage > 0 ? (entry.shortage ?? 0) / maxShortage : 0;
    const qualityOpen = qualityByOrder.get(entry.orderNo) ?? 0;
    const qualityScore = Math.min(qualityOpen, 5) / 5;
    const rawScore = amountScore * weights.kittingAmount
      + shortageScore * weights.shortageItems
      + qualityScore * weights.qualityOpen
      + urgency * weights.urgency;
    return {
      orderNo: entry.orderNo,
      riskLevel: entry.riskLevel,
      riskRank: riskRank(entry.riskLevel),
      amount: entry.amount,
      promisedDate: entry.date,
      businessObjectRef: `business://order/${entry.orderNo}`,
      raw: entry.row,
      composite: {
        score: Math.round(rawScore * 1000) / 10,
        kittingAmount: entry.amount,
        shortageItems: entry.shortage,
        qualityOpen,
        urgency,
        overdueDays: Math.max(0, days),
      },
    };
  });
  return scored.sort((left, right) => {
    const scoreDiff = (right.composite?.score ?? 0) - (left.composite?.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const amountDiff = (right.amount ?? -1) - (left.amount ?? -1);
    if (amountDiff !== 0) return amountDiff;
    const leftDate = left.promisedDate ? Date.parse(left.promisedDate) : Number.POSITIVE_INFINITY;
    const rightDate = right.promisedDate ? Date.parse(right.promisedDate) : Number.POSITIVE_INFINITY;
    if (leftDate !== rightDate) return leftDate - rightDate;
    return left.orderNo.localeCompare(right.orderNo, 'zh-CN');
  });
}

export function buildHighestRiskReasoningRequest(
  text: string,
  order: HighestRiskOrder,
  requestId: string,
  meta?: Pick<HighestRiskQueryMeta, 'windowEnd' | 'dataAsOf' | 'stale' | 'confidence' | 'scanned' | 'total'> & {
    qualityOpen?: number;
    compositeScore?: number;
    weights?: RiskScoringWeights;
  },
): Record<string, unknown> {
  const details = [
    `订单号：${order.orderNo}`,
    `风险等级：${order.riskLevel || '未知'}`,
    order.amount !== null ? `影响金额：${order.amount}` : '',
    order.promisedDate ? `需求日期：${order.promisedDate}` : '',
  ].filter(Boolean).join('；');
  const freshness = meta
    ? [
      meta.windowEnd ? `筛选口径：需求日期 ≤ ${meta.windowEnd}（含今天到期与已逾期）` : '',
      meta.dataAsOf ? `齐套数据快照时间：${meta.dataAsOf}${meta.stale ? '（已过期）' : ''}` : '',
      meta.confidence ? `查询数据置信度：${meta.confidence}` : '',
      meta.total !== null ? `本次扫描 ${meta.scanned}/${meta.total} 条红色风险` : `本次扫描 ${meta.scanned} 条红色风险`,
    ].filter(Boolean).join('；')
    : '';
  const weights = meta?.weights ?? DEFAULT_RISK_SCORING_WEIGHTS;
  const scoring = meta && meta.compositeScore !== undefined
    ? `综合风险分：${meta.compositeScore}（齐套金额 ${Math.round(weights.kittingAmount * 100)}% · 缺料 ${Math.round(weights.shortageItems * 100)}% · 质量 ${Math.round(weights.qualityOpen * 100)}% · 交期 ${Math.round(weights.urgency * 100)}%）；质量未闭环：${meta.qualityOpen ?? 0} 项。`
    : '';
  const prompt = `${text}\n\n${freshness ? `${freshness}。\n` : ''}已从物料齐套红色风险中定位影响最大的订单：${details}。${scoring ? `${scoring}\n` : ''}请仅基于该订单做只读交付风险分析，结论必须引用 evidence_refs；数据缺失或过期时明确说明数据置信度不足；不要仅凭“计算时间”判断数据是否最新，须以快照时间为准。`;
  return {
    prompt: prompt.slice(0, 2000),
    task_type: 'order_delivery_analysis',
    context: { businessObjectRef: order.businessObjectRef },
    constraints: { read_only: true, require_evidence: true },
    request_id: requestId,
  };
}

function capabilityName(agent: ExecutionAgentRecord, prefix: 'query' | 'reason'): string | null {
  return agent.capabilities.find((capability) => typeof capability.name === 'string' && capability.name.startsWith(prefix))?.name ?? null;
}

function supportsQueryPath(agent: ExecutionAgentRecord, capability: string, path: string): boolean {
  const cap = agent.capabilities.find((item) => item.name === capability);
  const allowed = cap?.inputSchema?.properties?.path?.enum;
  return !Array.isArray(allowed) || allowed.includes(path);
}

export interface ExecutionOrchestratorOptions {
  queryTimeoutMs?: number;
  reasoningTimeoutMs?: number;
  pollIntervalMs?: number;
  /** 目标执行面忙碌时的最长等待时间（后台分发会占用同一网关）。 */
  agentIdleTimeoutMs?: number;
  idFactory?: () => string;
  clock?: () => Date;
}

export class ExecutionOrchestrator {
  private readonly plane: ExecutionPlaneLike;
  private readonly appendEvidence: (input: EvidenceInput) => unknown;
  private readonly queryTimeoutMs: number;
  private readonly reasoningTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly agentIdleTimeoutMs: number;
  private readonly idFactory: () => string;
  private readonly clock: () => Date;

  constructor(
    plane: ExecutionPlaneLike,
    appendEvidence: (input: EvidenceInput) => unknown,
    options: ExecutionOrchestratorOptions = {},
  ) {
    this.plane = plane;
    this.appendEvidence = appendEvidence;
    this.queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    this.reasoningTimeoutMs = options.reasoningTimeoutMs ?? DEFAULT_REASONING_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.agentIdleTimeoutMs = options.agentIdleTimeoutMs ?? 60_000;
    this.idFactory = options.idFactory ?? randomUUID;
    this.clock = options.clock ?? (() => new Date());
  }

  async highestRiskOrder(input: { reasoningAgentId: string; text: string; excludeOrderNos?: string[]; caller?: CallerContext | null }): Promise<HighestRiskOrderResult> {
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    const reasoningAgentId = typeof input.reasoningAgentId === 'string' ? input.reasoningAgentId.trim() : '';
    if (!text || text.length > 2000) throw new ExecutionOrchestrationError('INVALID_ARGUMENT', 'text 必填且不超过 2000 字符', { status: 400 });
    if (!reasoningAgentId) throw new ExecutionOrchestrationError('INVALID_ARGUMENT', 'reasoningAgentId 必填', { status: 400 });

    const agents = this.plane.list().agents;
    const reasoner = agents.find((agent) => agent.agentId === reasoningAgentId);
    if (!reasoner || reasoner.connectionStatus !== 'online' || reasoner.deregisteredAt || reasoner.simulated) {
      throw new ExecutionOrchestrationError('REASONING_AGENT_UNAVAILABLE', '推理智能体不在线或不可用', { status: 409 });
    }
    const reasonCapability = capabilityName(reasoner, 'reason');
    if (!reasonCapability) throw new ExecutionOrchestrationError('CAPABILITY_UNSUPPORTED', '推理智能体未声明推理能力', { status: 409 });

    const reasonerSystem = reasoner.systemId ?? reasoner.sourceSystem;
    const sameSystem = (agent: ExecutionAgentRecord) => (agent.systemId ?? agent.sourceSystem) === reasonerSystem;
    const available = (agent: ExecutionAgentRecord) => agent.connectionStatus === 'online' && !agent.deregisteredAt && !agent.simulated;
    const canQuery = (agent: ExecutionAgentRecord) => available(agent) && sameSystem(agent) && Boolean(capabilityName(agent, 'query'));
    // 优先用独立的查询智能体；统一网关模式下同一个 Agent 同时声明查询与推理，允许复用自身。
    const queryer = agents.find((agent) => agent.agentId !== reasoner.agentId && canQuery(agent))
      ?? (canQuery(reasoner) ? reasoner : undefined);
    if (!queryer) {
      throw new ExecutionOrchestrationError('QUERY_AGENT_UNAVAILABLE', '同系统内没有可用的查询智能体', { status: 409 });
    }
    const queryCapability = capabilityName(queryer, 'query')!;
    if (!supportsQueryPath(queryer, queryCapability, KITTING_RESULTS_PATH)) {
      throw new ExecutionOrchestrationError('QUERY_PATH_UNSUPPORTED', '查询智能体未开放物料齐套查询路径', { status: 409 });
    }

    const requestId = `orch-${this.idFactory()}`;
    const windowEnd = beijingDateString(this.clock());
    const queryRunIds: string[] = [];
    const scannedRows: Array<Record<string, unknown>> = [];
    let queryMeta: HighestRiskQueryMeta = { windowEnd, runIds: queryRunIds, dataAsOf: null, stale: null, confidence: null, total: null, scanned: 0 };
    let queryRunId: string | null = null;
    let reasoningRunId: string | null = null;
    try {
      // 按“需求日期 ≤ 今天（北京时间）”筛选：包含今天到期与已逾期订单，作为每日检查口径。
      let page = 1;
      for (;;) {
        await this.requireAgentIdle(queryer.agentId, requestId, queryRunId);
        const queryDispatch = this.plane.dispatch(queryer.agentId, queryCapability, {
          path: KITTING_RESULTS_PATH,
          params: { page, page_size: KITTING_PAGE_SIZE, risk_level: 'red', required_date_end: windowEnd },
        }, { traceId: requestId, requestId, caller: input.caller ?? null });
        queryRunId = queryDispatch.runId;
        queryRunIds.push(queryRunId);
        const queryRun = await this.waitForRun(queryRunId, this.queryTimeoutMs, 'QUERY_TIMEOUT');
        if (queryRun.state !== 'completed') {
          throw new ExecutionOrchestrationError('QUERY_FAILED', queryRun.error?.message || '订单查询未完成', {
            status: 502, requestId, queryRunId,
          });
        }
        const pageRows = rowsFromResult(queryRun.result);
        scannedRows.push(...pageRows);
        if (page === 1) {
          const root = record(queryRun.result);
          queryMeta = {
            windowEnd,
            runIds: queryRunIds,
            dataAsOf: root ? textOf(root, ['data_as_of', 'dataAsOf']) || null : null,
            stale: root && typeof root.stale === 'boolean' ? root.stale : null,
            confidence: root ? textOf(root, ['data_confidence', 'dataConfidence']) || null : null,
            total: root ? numberOf(root, ['total']) : null,
            scanned: 0,
          };
        }
        const total = queryMeta.total;
        if (total === null || scannedRows.length >= total || pageRows.length < KITTING_PAGE_SIZE || page >= MAX_QUERY_PAGES) break;
        page += 1;
      }
      queryMeta = { ...queryMeta, runIds: [...queryRunIds], scanned: scannedRows.length };

      // 多域评分：补充质量未闭环数；质量查询失败只降级评分，不阻断主分析。
      const scoringPolicy = loadRiskScoringPolicy();
      const qualityByOrder = new Map<string, number>();
      const qualityMeta: HighestRiskQualityMeta = { runIds: [], dataAsOf: null, confidence: null, openIssues: 0, warning: null };
      const hasCandidate = scannedRows.some((row) => {
        const date = textOf(row, ['required_date', 'requiredDate', 'due_date', 'demand_date']).slice(0, 10);
        return Boolean(date) && date <= windowEnd;
      });
      if (hasCandidate && supportsQueryPath(queryer, queryCapability, QUALITY_ISSUES_PATH)) {
        try {
          let qualityPage = 1;
          let qualityLoaded = 0;
          for (;;) {
            await this.requireAgentIdle(queryer.agentId, requestId, queryRunId);
            const qualityDispatch = this.plane.dispatch(queryer.agentId, queryCapability, {
              path: QUALITY_ISSUES_PATH,
              params: { page: qualityPage, page_size: KITTING_PAGE_SIZE, status: scoringPolicy.qualityStatuses },
            }, { traceId: requestId, requestId, caller: input.caller ?? null });
            const qualityRunId = qualityDispatch.runId;
            qualityMeta.runIds.push(qualityRunId);
            const qualityRun = await this.waitForRun(qualityRunId, this.queryTimeoutMs, 'QUERY_TIMEOUT');
            if (qualityRun.state !== 'completed') throw new Error(qualityRun.error?.message || '质量异常查询未完成');
            const pageRows = rowsFromResult(qualityRun.result);
            qualityLoaded += pageRows.length;
            if (qualityPage === 1) {
              const root = record(qualityRun.result);
              qualityMeta.dataAsOf = root ? textOf(root, ['data_as_of', 'dataAsOf']) || null : null;
              qualityMeta.confidence = root ? textOf(root, ['data_confidence', 'dataConfidence']) || null : null;
            }
            for (const row of pageRows) {
              const orderNo = textOf(row, ['order_no', 'demand_no', 'orderNo']);
              if (!orderNo) continue;
              const status = textOf(row, ['status', 'issue_status']).toLowerCase();
              if (['closed', 'resolved', 'cancelled', 'canceled'].includes(status)) continue;
              qualityByOrder.set(orderNo, (qualityByOrder.get(orderNo) ?? 0) + 1);
              qualityMeta.openIssues += 1;
            }
            const root = record(qualityRun.result);
            const total = root ? numberOf(root, ['total']) : null;
            if (total === null || qualityLoaded >= total || pageRows.length < KITTING_PAGE_SIZE || qualityPage >= MAX_QUERY_PAGES) break;
            qualityPage += 1;
          }
        } catch (error) {
          qualityMeta.warning = `质量异常读取失败：${(error as Error).message}`;
        }
      } else if (hasCandidate && !supportsQueryPath(queryer, queryCapability, QUALITY_ISSUES_PATH)) {
        qualityMeta.warning = '查询智能体未开放质量异常查询，综合分仅按齐套与交期计算';
      }

      const excluded = new Set((input.excludeOrderNos ?? []).map((value) => value.trim()).filter(Boolean));
      const compositeRanked = rankOrdersByCompositeScore({ items: scannedRows }, qualityByOrder, windowEnd, scoringPolicy.weights)
        .filter((candidate) => !excluded.has(candidate.orderNo));
      const [order] = (compositeRanked.length ? compositeRanked : rankOrdersFromResult({ items: scannedRows }))
        .filter((candidate) => !excluded.has(candidate.orderNo));
      if (!order) {
        throw new ExecutionOrchestrationError('NO_ELIGIBLE_ORDER', `需求日期 ≤ ${windowEnd} 的红色齐套风险中没有可用于分析的订单`, {
          status: 422, requestId, queryRunId,
        });
      }

      await this.requireAgentIdle(reasoner.agentId, requestId, queryRunId);
      const reasonDispatch = this.plane.dispatch(reasoner.agentId, reasonCapability, buildHighestRiskReasoningRequest(text, order, requestId, {
        ...queryMeta,
        qualityOpen: order.composite?.qualityOpen ?? 0,
        compositeScore: order.composite?.score,
        weights: scoringPolicy.weights,
      }), { traceId: requestId, requestId, caller: input.caller ?? null });
      reasoningRunId = reasonDispatch.runId;
      const reasonRun = await this.waitForRun(reasoningRunId, this.reasoningTimeoutMs, 'REASONING_TIMEOUT');
      if (reasonRun.state !== 'completed') {
        throw new ExecutionOrchestrationError('REASONING_FAILED', reasonRun.error?.message || '推理未完成', {
          status: 502, requestId, queryRunId, reasoningRunId,
        });
      }

      this.audit('completed', {
        requestId,
        traceId: requestId,
        queryRunId,
        queryRunIds,
        reasoningRunId,
        orderNo: order.orderNo,
        queryAgentId: queryer.agentId,
        reasoningAgentId: reasoner.agentId,
        windowEnd,
        dataAsOf: queryMeta.dataAsOf,
        queryStale: queryMeta.stale,
        queryConfidence: queryMeta.confidence,
        scanned: queryMeta.scanned,
        total: queryMeta.total,
        qualityRunIds: qualityMeta.runIds,
        qualityOpenIssues: qualityMeta.openIssues,
        qualityWarning: qualityMeta.warning,
        compositeScore: order.composite?.score ?? null,
      });
      return { requestId, order, queryRunId, reasoningRunId, result: reasonRun.result, query: queryMeta, quality: qualityMeta };
    } catch (error) {
      const mapped = error instanceof ExecutionOrchestrationError
        ? error
        : new ExecutionOrchestrationError('ORCHESTRATION_FAILED', (error as Error).message || '编排失败', {
          status: 502, requestId, queryRunId, reasoningRunId,
        });
      if (reasoningRunId) {
        try { this.plane.recall(reasoner.agentId); } catch { /* 已结束或已召回 */ }
      }
      this.audit('failed', { requestId, traceId: requestId, queryRunId, reasoningRunId, code: mapped.code });
      throw mapped;
    }
  }

  /** 通用单能力派单：供中枢意图路由调用；失败时尝试召回。 */
  async runCapability(input: {
    agentId: string;
    capability: string;
    input: unknown;
    timeoutMs?: number;
    caller?: CallerContext | null;
  }): Promise<unknown> {
    await this.requireAgentIdle(input.agentId, null);
    const dispatch = this.plane.dispatch(input.agentId, input.capability, input.input, { caller: input.caller ?? null });
    try {
      const run = await this.waitForRun(dispatch.runId, input.timeoutMs ?? this.reasoningTimeoutMs, 'EXECUTION_TIMEOUT');
      if (run.state !== 'completed') {
        throw new ExecutionOrchestrationError('EXECUTION_FAILED', run.error?.message || '执行面未完成', { status: 502 });
      }
      return run.result;
    } catch (error) {
      try { this.plane.recall(input.agentId); } catch { /* 已结束或已召回 */ }
      throw error instanceof ExecutionOrchestrationError
        ? error
        : new ExecutionOrchestrationError('EXECUTION_FAILED', (error as Error).message || '执行失败', { status: 502 });
    }
  }

  /** 目标执行面同一时刻只跑一个任务：等空闲再派；超时返回 AGENT_BUSY，不直接撞上游。 */
  private async requireAgentIdle(agentId: string, requestId: string | null, queryRunId: string | null = null): Promise<void> {
    const deadline = Date.now() + this.agentIdleTimeoutMs;
    for (;;) {
      const agent = this.plane.list().agents.find((item) => item.agentId === agentId);
      // 离线/不存在交给 dispatch 按原逻辑报错。
      if (!agent || agent.connectionStatus !== 'online') return;
      if (!agent.currentRunId && agent.runtimeStatus !== 'working') return;
      if (Date.now() >= deadline) {
        throw new ExecutionOrchestrationError('AGENT_BUSY', '目标执行面持续忙碌，请稍后重试', {
          status: 409, requestId, queryRunId,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  private async waitForRun(runId: string, timeoutMs: number, timeoutCode: string): Promise<ExecutionRunRecord> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = this.plane.getRun(runId);
      if (run && ['completed', 'failed', 'recalled'].includes(run.state)) return run;
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new ExecutionOrchestrationError(timeoutCode, '执行超时', { status: 504 });
  }

  private audit(status: 'completed' | 'failed', payload: Record<string, unknown>): void {
    try {
      this.appendEvidence({
        kind: 'app_event',
        actor_id: 'hub-execution-orchestrator',
        actor_type: 'system',
        object_ref: 'hub://execution-orchestration/highest-risk-order',
        source_system: 'aeos-hub',
        correlation_id: 'execution-orchestration-highest-risk',
        summary: `highest risk order orchestration ${status}`,
        payload: { status, ...payload },
      });
    } catch {
      // 审计失败不改变编排结果。
    }
  }
}
