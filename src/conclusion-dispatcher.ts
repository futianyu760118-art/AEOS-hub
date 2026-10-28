// 结论自动分发器：智能助手出结论后，把需要继续深挖的业务对象按策略分发给「其他系统」的执行面能力。
// 边界：只做只读分析派单；不注册目标系统内部 Agent、不落库业务数据、不解析模型自由文本。
// 目标系统内部的 Agent 路由由系统网关自己完成；本模块只认「系统 + 能力」。
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CallerContext } from './caller-context.ts';
import type { EvidenceInput } from './evidence.ts';
import type { ExecutionAgentRecord, ExecutionPlaneRegistry, ExecutionRunRecord } from './execution-plane.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const conclusionDispatchPolicyFile = process.env.AEOS_CONCLUSION_DISPATCH_POLICY_FILE?.trim()
  || join(root, 'config', 'conclusion-dispatch-policy.json');
export const conclusionDispatchStoreFile = process.env.AEOS_CONCLUSION_DISPATCH_STORE_FILE?.trim()
  || join(root, 'data', 'conclusion-dispatches.json');

export type DispatchDomain = 'order' | 'kitting' | 'quality' | 'production';
const DISPATCH_DOMAINS: readonly DispatchDomain[] = ['order', 'kitting', 'quality', 'production'];

export const DOMAIN_LABELS: Record<DispatchDomain, string> = {
  order: '订单交付',
  kitting: '物料齐套',
  quality: '质量异常',
  production: '生产进度',
};

export interface ConclusionDispatchTarget {
  systemId: string;
  capability: string;
  taskType: string;
}

export interface ConclusionDispatchPolicy {
  version: 1;
  revision: number;
  updatedAt: string;
  enabled: boolean;
  maxItemsPerAnalysis: number;
  perItemTimeoutMs: number;
  dedupeHours: number;
  dispatchDomains: DispatchDomain[];
  targets: Partial<Record<DispatchDomain, ConclusionDispatchTarget>>;
}

/** 文件缺失或损坏时的安全默认值：不自动分发。 */
export const DEFAULT_CONCLUSION_DISPATCH_POLICY: ConclusionDispatchPolicy = {
  version: 1,
  revision: 0,
  updatedAt: '1970-01-01T00:00:00.000Z',
  enabled: false,
  maxItemsPerAnalysis: 0,
  perItemTimeoutMs: 120_000,
  dedupeHours: 24,
  dispatchDomains: [],
  targets: {},
};

export interface ConclusionDispatchItem {
  domain: DispatchDomain;
  businessObjectRef: string;
  orderNo?: string;
  title?: string;
  /** 覆盖默认分析提示词。 */
  prompt?: string;
}

export type ConclusionDispatchItemStatus = 'completed' | 'failed' | 'timeout' | 'skipped';

/** 分析结论的精简条目：只保留面向管理者的字段，依据引用仍在「处理记录」查看。 */
export interface ConclusionHighlight {
  matter: string;
  risk?: string;
  recommendation?: string;
  confidence?: string;
}

export interface ConclusionDispatchResultItem {
  domain: DispatchDomain;
  businessObjectRef: string;
  status: ConclusionDispatchItemStatus;
  reason?: string;
  systemId?: string;
  /** 系统显示名（来自系统注册表）；缺省时用 systemId。 */
  systemName?: string;
  agentId?: string;
  runId?: string;
  conclusions?: number;
  summary?: string;
  conclusionHighlights?: ConclusionHighlight[];
  handledBy?: unknown;
  error?: { code: string; message: string } | null;
}

export interface ConclusionDispatchReport {
  dispatchId: string;
  traceId: string | null;
  status: 'completed' | 'partial' | 'failed' | 'skipped' | 'disabled';
  items: ConclusionDispatchResultItem[];
  counts: { dispatched: number; completed: number; failed: number; skipped: number };
  startedAt: string;
  endedAt: string;
}

/** 分发过程中的进度事件，供会话实时展示。 */
export interface ConclusionDispatchProgress {
  phase: 'started' | 'item_started' | 'item_completed';
  index: number;
  total: number;
  domain?: DispatchDomain;
  status?: ConclusionDispatchItemStatus;
  conclusions?: number;
}

type DispatchPlane = Pick<ExecutionPlaneRegistry, 'list' | 'dispatch' | 'getRun' | 'recall'>;

export interface ConclusionDispatcherOptions {
  policyFile?: string;
  storeFile?: string;
  now?: () => Date;
  idFactory?: () => string;
  pollIntervalMs?: number;
  /** 系统显示名解析（如 control-platform → 公司中控平台）；缺省用 systemId。 */
  systemLabel?: (systemId: string) => string;
  appendEvidence?: (input: EvidenceInput) => unknown;
}

type DispatchStoreRecord = {
  key: string;
  at: string;
  domain: DispatchDomain;
  systemId: string;
  agentId: string;
  runId: string;
  status: ConclusionDispatchItemStatus;
};

type DispatchStore = { version: 1; records: DispatchStoreRecord[] };

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function parseDomain(value: unknown): DispatchDomain | null {
  return typeof value === 'string' && (DISPATCH_DOMAINS as readonly string[]).includes(value)
    ? value as DispatchDomain
    : null;
}

function parseTarget(value: unknown): ConclusionDispatchTarget | null {
  if (!isRecord(value)) return null;
  const systemId = typeof value.systemId === 'string' ? value.systemId.trim() : '';
  const capability = typeof value.capability === 'string' ? value.capability.trim() : '';
  const taskType = typeof value.taskType === 'string' ? value.taskType.trim() : '';
  if (!systemId || !capability || !taskType) return null;
  return { systemId, capability, taskType };
}

/** 读取分发策略；文件缺失/损坏时回落到「不自动分发」。 */
export function loadConclusionDispatchPolicy(file = conclusionDispatchPolicyFile): ConclusionDispatchPolicy {
  if (!existsSync(file)) return DEFAULT_CONCLUSION_DISPATCH_POLICY;
  const raw = readJson(file);
  if (!isRecord(raw) || raw.version !== 1) return DEFAULT_CONCLUSION_DISPATCH_POLICY;
  const targets: Partial<Record<DispatchDomain, ConclusionDispatchTarget>> = {};
  const rawTargets = isRecord(raw.targets) ? raw.targets : {};
  for (const domain of DISPATCH_DOMAINS) {
    const target = parseTarget(rawTargets[domain]);
    if (target) targets[domain] = target;
  }
  const dispatchDomains: DispatchDomain[] = [];
  if (Array.isArray(raw.dispatchDomains)) {
    for (const value of raw.dispatchDomains) {
      const domain = parseDomain(value);
      if (domain && !dispatchDomains.includes(domain)) dispatchDomains.push(domain);
    }
  }
  return {
    version: 1,
    revision: positiveInt(raw.revision, 1),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : 'unknown',
    enabled: raw.enabled === true,
    maxItemsPerAnalysis: Math.min(positiveInt(raw.maxItemsPerAnalysis, 0), 10),
    perItemTimeoutMs: Math.min(positiveInt(raw.perItemTimeoutMs, 120_000), 600_000),
    dedupeHours: Math.min(nonNegativeNumber(raw.dedupeHours, 24), 24 * 30),
    dispatchDomains,
    targets,
  };
}

/** 保存分发策略（系统配置页）；只允许改开关、分发域与上限，目标系统仍由配置文件维护。 */
export function saveConclusionDispatchPolicy(input: unknown, file = conclusionDispatchPolicyFile): ConclusionDispatchPolicy {
  if (!isRecord(input)) throw new Error('分发配置无效');
  const current = loadConclusionDispatchPolicy(file);
  const enabled = input.enabled === true;
  const rawDomains = Array.isArray(input.dispatchDomains) ? input.dispatchDomains : current.dispatchDomains;
  const dispatchDomains: DispatchDomain[] = [];
  for (const value of rawDomains) {
    const domain = parseDomain(value);
    if (domain && !dispatchDomains.includes(domain)) dispatchDomains.push(domain);
  }
  if (enabled && !dispatchDomains.length) throw new Error('启用自动分发时至少要选择一个分析域');
  const rawMax = typeof input.maxItemsPerAnalysis === 'number' && Number.isFinite(input.maxItemsPerAnalysis)
    ? Math.trunc(input.maxItemsPerAnalysis)
    : current.maxItemsPerAnalysis;
  const maxItemsPerAnalysis = Math.max(0, Math.min(10, rawMax));
  if (enabled && maxItemsPerAnalysis < 1) throw new Error('最多分发项数至少为 1');
  const next: ConclusionDispatchPolicy = {
    ...current,
    enabled,
    dispatchDomains,
    maxItemsPerAnalysis,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  const temp = `${file}.tmp-${randomUUID().slice(0, 8)}`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  renameSync(temp, file);
  return next;
}

function readStore(file: string): DispatchStore {
  const raw = readJson(file);
  if (!isRecord(raw) || !Array.isArray(raw.records)) return { version: 1, records: [] };
  const records = raw.records.filter((entry): entry is DispatchStoreRecord => isRecord(entry)
    && typeof entry.key === 'string'
    && typeof entry.at === 'string'
    && typeof entry.domain === 'string'
    && typeof entry.systemId === 'string'
    && typeof entry.agentId === 'string'
    && typeof entry.runId === 'string'
    && typeof entry.status === 'string');
  return { version: 1, records };
}

function writeStore(file: string, store: DispatchStore): void {
  const temp = `${file}.tmp-${randomUUID().slice(0, 8)}`;
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(temp, file);
}

function dispatchKey(target: ConclusionDispatchTarget, businessObjectRef: string): string {
  return `${target.systemId}|${target.capability}|${target.taskType}|${businessObjectRef}`;
}

function defaultPrompt(domain: DispatchDomain, item: ConclusionDispatchItem): string {
  const subject = item.orderNo ? `订单 ${item.orderNo}` : item.businessObjectRef;
  switch (domain) {
    case 'kitting':
      return `请从物料齐套角度分析${subject}：核查齐套状态、缺料明细、库存可用量与预计齐套日期，说明影响、建议动作与需人工确认事项。`;
    case 'quality':
      return `请从质量角度分析${subject}：核查关联质量异常、订单行与 BOM 关系，说明影响、建议动作与需人工确认事项。`;
    case 'production':
      return `请从生产进度角度分析${subject}：核查工单、工序进度与阻塞信息，说明影响、建议动作与需人工确认事项。`;
    case 'order':
    default:
      return `请分析${subject}的交付风险：说明影响、建议动作与需人工确认事项。`;
  }
}

function textField(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function digestOf(result: unknown): { count: number; summary: string; highlights: ConclusionHighlight[] } {
  const root = isRecord(result) ? result : {};
  const list = Array.isArray(root.conclusions) ? root.conclusions : [];
  const highlights: ConclusionHighlight[] = [];
  for (const entry of list.slice(0, 4)) {
    if (!isRecord(entry)) continue;
    const matter = textField(entry.matter, 200);
    if (!matter) continue;
    const risk = textField(entry.risk, 120);
    const recommendation = textField(entry.recommendation, 120);
    const confidence = textField(entry.confidence, 20);
    highlights.push({
      matter,
      ...(risk ? { risk } : {}),
      ...(recommendation ? { recommendation } : {}),
      ...(confidence ? { confidence } : {}),
    });
  }
  return {
    count: list.length,
    summary: textField(root.summary, 200),
    highlights,
  };
}

function handledByOf(result: unknown): unknown {
  if (!isRecord(result)) return null;
  return result.handled_by ?? result.handledBy ?? null;
}

/** 实际处理方显示名：优先 agentName/name，其次 agentId。 */
function handledByLabel(value: unknown): string {
  if (!isRecord(value)) return '';
  return textField(value.agentName, 80) || textField(value.name, 80) || textField(value.agentId, 80);
}

function failureLine(item: ConclusionDispatchResultItem): string {
  const label = DOMAIN_LABELS[item.domain];
  const code = item.error?.code ?? '';
  const message = item.error?.message ?? '';
  if (item.reason === 'TIMEOUT') return `${label}超时`;
  if (item.reason === 'AGENT_BUSY' || /busy|忙碌/i.test(message)) return `${label}：目标系统忙碌，请稍后重试`;
  if (/UPSTREAM_UNAVAILABLE/.test(code)) return `${label}：上游不可用`;
  if (/UPSTREAM_TIMEOUT/.test(code)) return `${label}：上游超时`;
  if (item.reason === 'RUN_FAILED' || item.reason === 'RECALLED') return `${label}：${message || '执行失败'}`;
  return `${label}：${message || item.reason || '未完成'}`;
}

/** 把分发结果格式化为一份可读报告（完成后直接展示在对话里）；没有可展示信息时返回空串。 */
export function formatConclusionDispatchReport(report: ConclusionDispatchReport): string {
  if (report.status === 'disabled') return '';
  const completed = report.items.filter((item) => item.status === 'completed');
  const failed = report.items.filter((item) => item.status === 'failed' || item.status === 'timeout');
  const duplicate = report.items.filter((item) => item.reason === 'DUPLICATE');
  const noProvider = report.items.filter((item) => item.reason === 'NO_PROVIDER');
  const noTarget = report.items.filter((item) => item.reason === 'NO_TARGET');
  const notes: string[] = [];
  if (failed.length) notes.push(`未完成：${failed.map(failureLine).join('；')}`);
  if (noProvider.length) notes.push(`暂无提供方：${[...new Set(noProvider.map((item) => DOMAIN_LABELS[item.domain]))].join('、')}`);
  if (noTarget.length) notes.push(`未配置目标：${[...new Set(noTarget.map((item) => DOMAIN_LABELS[item.domain]))].join('、')}`);
  if (duplicate.length) notes.push(`已分发过：${[...new Set(duplicate.map((item) => DOMAIN_LABELS[item.domain]))].join('、')}（如需重新分析，请回复“重新分析”）`);

  if (!completed.length) {
    return notes.length ? `本次自动分发未执行：${notes.join('；')}。` : '';
  }

  // 一次分析的多份结论合并成一份报告，管理者不需要再逐个点开执行记录。
  const lines: string[] = [`已自动分发给其他系统 Agent（${completed.length} 项）：`];
  for (const item of completed) {
    const system = item.systemName || item.systemId || '其他系统';
    const handler = handledByLabel(item.handledBy);
    lines.push(`【${DOMAIN_LABELS[item.domain]} · ${system}${handler ? ` · ${handler}` : ''}】${item.conclusions ?? 0} 条结论`);
    if (item.summary) lines.push(`摘要：${item.summary}`);
    const highlights = item.conclusionHighlights ?? [];
    if (highlights.length) {
      highlights.forEach((conclusion, index) => {
        const extra = [
          conclusion.risk ? `风险：${conclusion.risk}` : '',
          conclusion.recommendation ? `建议：${conclusion.recommendation}` : '',
          conclusion.confidence ? `置信度：${conclusion.confidence}` : '',
        ].filter(Boolean).join('；');
        lines.push(`${index + 1}. ${conclusion.matter}${extra ? `（${extra}）` : ''}`);
      });
      const remaining = (item.conclusions ?? 0) - highlights.length;
      if (remaining > 0) lines.push(`…其余 ${remaining} 条见「处理记录」。`);
    } else {
      lines.push('未返回明确结论，需人工复核。');
    }
  }
  lines.push('完整依据与执行步骤见「处理记录」。');
  return [...lines, ...notes].join('\n');
}

/**
 * 结论分发器：按策略把结构化事项派给目标系统的执行面能力，串行执行（执行面同一 Agent 只记一个当前任务），
 * 失败逐项降级，不影响主回答。
 */
export class ConclusionDispatcher {
  private readonly plane: DispatchPlane;
  private readonly policyFile: string;
  private readonly storeFile: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly pollIntervalMs: number;
  private readonly systemLabel: (systemId: string) => string;
  private readonly appendEvidence?: (input: EvidenceInput) => unknown;

  constructor(plane: DispatchPlane, options: ConclusionDispatcherOptions = {}) {
    this.plane = plane;
    this.policyFile = options.policyFile ?? conclusionDispatchPolicyFile;
    this.storeFile = options.storeFile ?? conclusionDispatchStoreFile;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.systemLabel = options.systemLabel ?? ((systemId) => systemId);
    this.appendEvidence = options.appendEvidence;
  }

  /** 对单个业务对象按策略分发（默认使用策略里的 dispatchDomains）。 */
  async dispatchForObject(
    input: { businessObjectRef: string; orderNo?: string; title?: string; domains?: DispatchDomain[] },
    context: { traceId?: string | null; caller?: CallerContext | null; force?: boolean; onProgress?: (event: ConclusionDispatchProgress) => void } = {},
  ): Promise<ConclusionDispatchReport> {
    const policy = loadConclusionDispatchPolicy(this.policyFile);
    const domains = (input.domains ?? policy.dispatchDomains)
      .filter((domain): domain is DispatchDomain => parseDomain(domain) !== null);
    const items = domains.map((domain): ConclusionDispatchItem => ({
      domain,
      businessObjectRef: input.businessObjectRef,
      orderNo: input.orderNo,
      title: input.title,
    }));
    return this.dispatch(items, { ...context, policy });
  }

  /** 近 N 小时内分发过的业务对象引用，用于“下一条高风险订单”排除已分析对象。 */
  recentBusinessObjectRefs(withinHours = 24): string[] {
    const cutoff = this.now().getTime() - withinHours * 3600_000;
    const store = readStore(this.storeFile);
    const refs = new Set<string>();
    for (const record of store.records) {
      const at = new Date(record.at).getTime();
      if (Number.isNaN(at) || at < cutoff) continue;
      const parts = record.key.split('|');
      const ref = parts[parts.length - 1];
      if (ref) refs.add(ref);
    }
    return [...refs];
  }

  /** 分发一组结构化事项；逐项出结果，整体不抛错。 */
  async dispatch(
    items: ConclusionDispatchItem[],
    context: { traceId?: string | null; caller?: CallerContext | null; policy?: ConclusionDispatchPolicy; force?: boolean; onProgress?: (event: ConclusionDispatchProgress) => void } = {},
  ): Promise<ConclusionDispatchReport> {
    const policy = context.policy ?? loadConclusionDispatchPolicy(this.policyFile);
    const startedAt = this.now().toISOString();
    const dispatchId = `dispatch-${this.idFactory()}`;
    const traceId = typeof context.traceId === 'string' && context.traceId.trim() ? context.traceId.trim() : null;
    const report: ConclusionDispatchReport = {
      dispatchId,
      traceId,
      status: 'skipped',
      items: [],
      counts: { dispatched: 0, completed: 0, failed: 0, skipped: 0 },
      startedAt,
      endedAt: startedAt,
    };
    if (!policy.enabled) {
      report.status = 'disabled';
      return report;
    }

    const store = readStore(this.storeFile);
    const recentCutoff = this.now().getTime() - policy.dedupeHours * 3600_000;
    const selected = items
      .filter((item) => typeof item.businessObjectRef === 'string' && item.businessObjectRef.trim())
      .slice(0, policy.maxItemsPerAnalysis || 0);
    const agents = this.plane.list().agents;
    const total = selected.length;
    if (total > 0) context.onProgress?.({ phase: 'started', index: 0, total });

    for (const [offset, item] of selected.entries()) {
      const index = offset + 1;
      context.onProgress?.({ phase: 'item_started', index, total, domain: item.domain });
      const result = await this.dispatchItem(item, {
        policy,
        traceId,
        caller: context.caller ?? null,
        force: context.force === true,
        agents,
        store,
        recentCutoff,
      });
      context.onProgress?.({
        phase: 'item_completed',
        index,
        total,
        domain: result.domain,
        status: result.status,
        ...(typeof result.conclusions === 'number' ? { conclusions: result.conclusions } : {}),
      });
      report.items.push(result);
      if (result.systemId && result.systemName === undefined) {
        result.systemName = this.systemLabel(result.systemId);
      }
      if (result.status === 'skipped') report.counts.skipped += 1;
      else {
        report.counts.dispatched += 1;
        if (result.status === 'completed') report.counts.completed += 1;
        else report.counts.failed += 1;
      }
    }

    report.endedAt = this.now().toISOString();
    report.status = report.counts.dispatched === 0
      ? 'skipped'
      : report.counts.failed === 0 ? 'completed' : report.counts.completed === 0 ? 'failed' : 'partial';

    if (report.counts.dispatched > 0) {
      this.pruneStore(store, policy);
      try {
        writeStore(this.storeFile, store);
      } catch {
        // 去重台账写入失败不影响本次分发结果。
      }
    }
    this.audit(report);
    return report;
  }

  private async dispatchItem(
    item: ConclusionDispatchItem,
    context: {
      policy: ConclusionDispatchPolicy;
      traceId: string | null;
      caller: CallerContext | null;
      force: boolean;
      agents: ExecutionAgentRecord[];
      store: DispatchStore;
      recentCutoff: number;
    },
  ): Promise<ConclusionDispatchResultItem> {
    const domain = parseDomain(item.domain);
    if (!domain) return { domain: item.domain, businessObjectRef: item.businessObjectRef, status: 'skipped', reason: 'INVALID_DOMAIN' };
    const target = context.policy.targets[domain];
    if (!target) return { domain, businessObjectRef: item.businessObjectRef, status: 'skipped', reason: 'NO_TARGET' };
    const agent = this.resolveAgent(target, context.agents);
    if (!agent) {
      return {
        domain,
        businessObjectRef: item.businessObjectRef,
        status: 'skipped',
        reason: 'NO_PROVIDER',
        systemId: target.systemId,
      };
    }
    const key = dispatchKey(target, item.businessObjectRef);
    const duplicate = !context.force && context.store.records.some((entry) => entry.key === key
      && new Date(entry.at).getTime() >= context.recentCutoff
      && entry.status !== 'failed' && entry.status !== 'timeout');
    if (duplicate) {
      return {
        domain,
        businessObjectRef: item.businessObjectRef,
        status: 'skipped',
        reason: 'DUPLICATE',
        systemId: target.systemId,
        agentId: agent.agentId,
      };
    }

    const input = {
      prompt: item.prompt ?? defaultPrompt(domain, item),
      task_type: target.taskType,
      context: { businessObjectRef: item.businessObjectRef },
      constraints: { read_only: true, require_evidence: true },
    };
    // 目标系统同一时刻只处理一个任务（网关会返回 agent busy）；先等到空闲再派。
    const idle = await this.waitForAgentIdle(agent.agentId, context.policy.perItemTimeoutMs);
    if (!idle) {
      return {
        domain,
        businessObjectRef: item.businessObjectRef,
        status: 'failed',
        reason: 'AGENT_BUSY',
        systemId: target.systemId,
        agentId: agent.agentId,
        error: { code: 'AGENT_BUSY', message: '目标系统执行面持续忙碌，本次未派发' },
      };
    }
    let runId: string | null = null;
    try {
      const dispatch = this.plane.dispatch(agent.agentId, target.capability, input, {
        ...(context.traceId ? { traceId: context.traceId } : {}),
        ...(context.traceId ? { requestId: `${context.traceId}:${target.taskType}` } : {}),
        caller: context.caller,
      });
      runId = dispatch.runId;
      const run = await this.waitForRun(runId, context.policy.perItemTimeoutMs);
      const outcome = this.outcomeOf(run, domain, item, target, agent.agentId, runId);
      this.record(context.store, key, domain, target, agent.agentId, runId, outcome.status);
      return outcome;
    } catch (error) {
      const timeout = error instanceof Error && error.name === 'ConclusionDispatchTimeout';
      const status: ConclusionDispatchItemStatus = timeout ? 'timeout' : 'failed';
      if (runId) {
        try { this.plane.recall(agent.agentId); } catch { /* 已结束或已召回 */ }
        this.record(context.store, key, domain, target, agent.agentId, runId, status);
      }
      return {
        domain,
        businessObjectRef: item.businessObjectRef,
        status,
        reason: timeout ? 'TIMEOUT' : 'DISPATCH_ERROR',
        systemId: target.systemId,
        agentId: agent.agentId,
        ...(runId ? { runId } : {}),
        error: {
          code: timeout ? 'DISPATCH_TIMEOUT' : 'DISPATCH_FAILED',
          message: (error as Error).message || '分发失败',
        },
      };
    }
  }

  private outcomeOf(
    run: ExecutionRunRecord,
    domain: DispatchDomain,
    item: ConclusionDispatchItem,
    target: ConclusionDispatchTarget,
    agentId: string,
    runId: string,
  ): ConclusionDispatchResultItem {
    if (run.state === 'completed') {
      const digest = digestOf(run.result);
      return {
        domain,
        businessObjectRef: item.businessObjectRef,
        status: 'completed',
        systemId: target.systemId,
        agentId,
        runId,
        conclusions: digest.count,
        ...(digest.summary ? { summary: digest.summary } : {}),
        ...(digest.highlights.length ? { conclusionHighlights: digest.highlights } : {}),
        handledBy: handledByOf(run.result),
      };
    }
    return {
      domain,
      businessObjectRef: item.businessObjectRef,
      status: 'failed',
      reason: run.state === 'recalled' ? 'RECALLED' : 'RUN_FAILED',
      systemId: target.systemId,
      agentId,
      runId,
      error: run.error ?? { code: 'RUN_FAILED', message: `执行面未完成：${run.state}` },
    };
  }

  private resolveAgent(target: ConclusionDispatchTarget, agents: ExecutionAgentRecord[]): ExecutionAgentRecord | null {
    const candidates = agents.filter((agent) => agent.connectionStatus === 'online'
      && !agent.deregisteredAt
      && !agent.simulated
      && (agent.systemId ?? agent.sourceSystem) === target.systemId
      && agent.capabilities.some((capability) => capability.name === target.capability));
    return candidates.find((agent) => agent.agentKind === 'system-gateway') ?? candidates[0] ?? null;
  }

  private record(
    store: DispatchStore,
    key: string,
    domain: DispatchDomain,
    target: ConclusionDispatchTarget,
    agentId: string,
    runId: string,
    status: ConclusionDispatchItemStatus,
  ): void {
    store.records.push({
      key,
      at: this.now().toISOString(),
      domain,
      systemId: target.systemId,
      agentId,
      runId,
      status,
    });
  }

  private pruneStore(store: DispatchStore, policy: ConclusionDispatchPolicy): void {
    // 去重台账只保留最近窗口（去重窗口的两倍，至少 24 小时），并限制总条数。
    const keepHours = Math.max(policy.dedupeHours * 2, 24);
    const keepAfter = this.now().getTime() - keepHours * 3600_000;
    store.records = store.records
      .filter((entry) => new Date(entry.at).getTime() >= keepAfter)
      .slice(-500);
  }

  /** 目标执行面同一时刻只跑一个任务：等到空闲再派，超时则放弃。 */
  private async waitForAgentIdle(agentId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + Math.min(timeoutMs, 60_000);
    for (;;) {
      const agent = this.plane.list().agents.find((item) => item.agentId === agentId);
      if (!agent || agent.connectionStatus !== 'online') return false;
      if (!agent.currentRunId && agent.runtimeStatus !== 'working') return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  private waitForRun(runId: string, timeoutMs: number): Promise<ExecutionRunRecord> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const tick = (): void => {
        const run = this.plane.getRun(runId);
        if (run && ['completed', 'failed', 'recalled'].includes(run.state)) {
          resolve(run);
          return;
        }
        if (Date.now() >= deadline) {
          const error = new Error(`分发执行超时（${timeoutMs}ms）`);
          error.name = 'ConclusionDispatchTimeout';
          reject(error);
          return;
        }
        setTimeout(tick, this.pollIntervalMs);
      };
      tick();
    });
  }

  private audit(report: ConclusionDispatchReport): void {
    if (!this.appendEvidence) return;
    try {
      this.appendEvidence({
        kind: 'app_event',
        actor_id: 'hub-conclusion-dispatcher',
        actor_type: 'system',
        object_ref: 'hub://conclusion-dispatch',
        source_system: 'aeos-hub',
        correlation_id: 'conclusion-dispatch',
        summary: `conclusion dispatch ${report.status}`,
        payload: {
          dispatchId: report.dispatchId,
          traceId: report.traceId,
          status: report.status,
          counts: report.counts,
          items: report.items.map((item) => ({
            domain: item.domain,
            status: item.status,
            reason: item.reason ?? null,
            systemId: item.systemId ?? null,
            agentId: item.agentId ?? null,
            runId: item.runId ?? null,
          })),
        },
      });
    } catch {
      // 审计失败不改变分发结果。
    }
  }
}
