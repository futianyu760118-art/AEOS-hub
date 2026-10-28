// 统一链路（trace）只读视图：把借调单、执行 run、用量、evidence 按同一组标识串起来。
// 关联键：borrowOrderId / requestId / runId（= 中台 task_id）/ evidence payload 中的 run id。
// MVP 不改写入链路，只做聚合读取，便于先把"可追溯"跑通，再逐步把 traceId 写进各存储。
import { readFileSync, statSync } from 'node:fs';
import type { BorrowOrderRecord } from './borrow-order-store.ts';
import type { EvidenceEntry } from './evidence.ts';
import { evidenceFile } from './evidence.ts';
import type { ExecutionRunRecord } from './execution-plane.ts';
import type { UsageEvent } from './usage-ledger-store.ts';

export type TraceSources = {
  borrowOrderById: (orderId: string) => BorrowOrderRecord | null;
  borrowOrders: () => BorrowOrderRecord[];
  runById: (runId: string) => ExecutionRunRecord | undefined;
  allRuns: () => ExecutionRunRecord[];
  usageEvents: () => UsageEvent[];
  evidenceEntries: () => EvidenceEntry[];
};

export type TraceRun = {
  runId: string;
  traceId: string;
  taskId: string | null;
  caller: { systemId: string; agentId: string | null; userId: string | null; taskId: string | null; traceId: string | null } | null;
  agentId: string;
  capability: string;
  /** 分析类型（input.task_type）；查询 run 为 null，用于区分同一网关上并行分发的多笔分析。 */
  taskType: string | null;
  /** 提供方内部实际处理的 Agent（result.handled_by）；系统级/查询任务为 null。 */
  handledBy: { agentId: string | null; agentName: string | null } | null;
  state: string;
  startedAt: string;
  endedAt: string | null;
  dataConfidence: string | null;
  summary: string | null;
  conclusions: number;
  evidenceRefs: string[];
  error: { code: string; message: string } | null;
};

export type TraceUsage = {  runId: string | null;
  traceId: string | null;
  callerAgentId: string | null;
  callerUserId: string | null;
  systemId: string;
  consumerSystemId: string | null;
  borrowOrderId: string | null;
  modelId: string | null;
  usageKind: string | null;
  metering: string;
  tokensIn: number;
  cachedTokens: number;
  tokensOut: number;
  cost: number;
  endedAt: string;
};

export type TraceTimelineEntry = {
  at: string;
  kind: 'borrow' | 'run' | 'usage' | 'evidence';
  title: string;
  detail: string;
};

export type TraceResult = {
  traceId: string;
  resolvedBy: 'borrow-order' | 'run' | 'request' | 'trace' | 'none';
  borrowOrder: {
    orderId: string;
    requestId: string;
    status: string;
    fromSystem: string;
    providerSystem: string | null;
    providerAgentId: string | null;
    capability: string;
    runId: string | null;
    input: unknown;
    error: { code: string; message: string } | null;
    createdAt: string;
    dispatchedAt: string | null;
    startedAt: string | null;
    endedAt: string | null;
  } | null;
  runs: TraceRun[];
  usage: TraceUsage[];
  evidence: Array<{
    occurredAt: string;
    summary: string;
    correlationId: string;
    actorId: string | null;
    sourceSystem: string;
    payload: Record<string, unknown>;
  }>;
  evidenceRefs: string[];
  timeline: TraceTimelineEntry[];
};

const MAX_EVIDENCE_LINES = 20_000;
let evidenceCache: { file: string; mtimeMs: number; entries: EvidenceEntry[] } | null = null;

/** 读取 evidence.jsonl（按 mtime 缓存），只保留最后 2 万条，避免大文件拖慢查询。 */
export function readEvidenceEntries(file = evidenceFile): EvidenceEntry[] {
  try {
    const stat = statSync(file);
    if (evidenceCache && evidenceCache.file === file && evidenceCache.mtimeMs === stat.mtimeMs) return evidenceCache.entries;
    const lines = readFileSync(file, 'utf8').split('\n');
    const start = Math.max(0, lines.length - MAX_EVIDENCE_LINES);
    const entries: EvidenceEntry[] = [];
    for (let index = start; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (!line) continue;
      try {
        entries.push(JSON.parse(line) as EvidenceEntry);
      } catch {
        // 坏行跳过，不影响其余链路查询。
      }
    }
    evidenceCache = { file, mtimeMs: stat.mtimeMs, entries };
    return entries;
  } catch {
    return [];
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function evidenceKeys(entry: EvidenceEntry): string[] {
  const payload = record(entry.payload);
  return [payload.orderId, payload.requestId, payload.traceId, payload.runId, payload.queryRunId, payload.reasoningRunId]
    .map(text)
    .filter((value): value is string => Boolean(value));
}

function collectRunIds(entry: EvidenceEntry, target: Set<string>): void {
  const payload = record(entry.payload);
  for (const key of ['runId', 'queryRunId', 'reasoningRunId']) {
    const value = text(payload[key]);
    if (value) target.add(value);
  }
}

function runToTrace(run: ExecutionRunRecord): TraceRun {
  const result = record(run.result);
  const input = record(run.input);
  const conclusions = Array.isArray(result.conclusions) ? result.conclusions : [];
  const refs = new Set<string>();
  for (const item of conclusions) {
    const conclusion = record(item);
    if (!Array.isArray(conclusion.evidence_refs)) continue;
    for (const ref of conclusion.evidence_refs) {
      if (typeof ref === 'string' && ref.trim()) refs.add(ref.trim());
    }
  }
  const handledByRecord = record(result.handled_by);
  const handledBy = Object.keys(handledByRecord).length
    ? {
      agentId: text(handledByRecord.agentId),
      agentName: text(handledByRecord.agentName) ?? text(handledByRecord.name),
    }
    : null;
  return {
    runId: run.runId,
    traceId: run.traceId ?? run.runId,
    caller: run.caller ?? null,
    // 推理能力的 task_id 与 runId 一致（适配器按 ctx.runId 传给中台），这里显式标出来。
    taskId: run.capability.startsWith('reason') ? run.runId : null,
    agentId: run.agentId,
    capability: run.capability,
    taskType: text(input.task_type),
    handledBy,
    state: run.state,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    dataConfidence: text(result.data_confidence),
    summary: text(result.summary),
    conclusions: conclusions.length,
    evidenceRefs: [...refs],
    error: run.error ? { code: run.error.code, message: run.error.message } : null,
  };
}

function borrowToSummary(order: BorrowOrderRecord) {
  return {
    orderId: order.orderId,
    requestId: order.requestId,
    status: order.status,
    fromSystem: order.fromSystem,
    providerSystem: order.providerSystem,
    providerAgentId: order.providerAgentId,
    capability: order.capability,
    runId: order.runId,
    caller: order.caller ?? null,
    input: order.input,
    error: order.error ? { code: order.error.code, message: order.error.message } : null,
    createdAt: order.createdAt,
    dispatchedAt: order.dispatchedAt,
    startedAt: order.startedAt,
    endedAt: order.endedAt,
  };
}

/** 分析类型 → 时间线可读标签；未登记的类型回退「查询/推理」。 */
const ANALYSIS_LABELS: Record<string, string> = {
  order_delivery_analysis: '订单交付分析',
  material_kitting_analysis: '齐套分析',
  quality_analysis: '质量分析',
  production_analysis: '生产分析',
};

function analysisLabel(run: TraceRun): string {
  const label = run.taskType ? ANALYSIS_LABELS[run.taskType] : undefined;
  return label ?? (run.capability.startsWith('query') ? '查询' : '推理');
}

/** 按任一关联标识构建链路视图。找不到任何关联时 resolvedBy='none'，返回空链路而不是报错。 */
export function buildTrace(traceId: string, sources: TraceSources): TraceResult {
  const id = String(traceId ?? '').trim();
  const allBorrows = sources.borrowOrders();
  const allRuns = sources.allRuns();
  const borrow = sources.borrowOrderById(id)
    ?? allBorrows.find((order) => order.requestId === id)
    ?? allBorrows.find((order) => order.runId === id)
    ?? null;

  const known = new Set<string>([id]);
  if (borrow) {
    known.add(borrow.orderId);
    known.add(borrow.requestId);
    if (borrow.runId) known.add(borrow.runId);
  }
  // 写入链路时 traceId 已落到 run 上：借调单号 / 编排 requestId 可直接反查 run。
  for (const run of allRuns) {
    if ((run.traceId ?? run.runId) === id) known.add(run.runId);
  }

  const allEvidence = sources.evidenceEntries();
  let matchedEvidence: EvidenceEntry[] = [];
  for (let pass = 0; pass < 4; pass += 1) {
    const next = new Set(known);
    matchedEvidence = allEvidence.filter((entry) => evidenceKeys(entry).some((key) => known.has(key)));
    for (const entry of matchedEvidence) {
      for (const key of evidenceKeys(entry)) next.add(key);
      collectRunIds(entry, next);
    }
    if (next.size === known.size) break;
    for (const key of next) known.add(key);
  }
  for (const run of allRuns) {
    if (known.has(run.traceId ?? run.runId)) known.add(run.runId);
  }

  const runIds = new Set<string>();
  if (borrow?.runId) runIds.add(borrow.runId);
  if (id.startsWith('exec-run-')) runIds.add(id);
  for (const entry of matchedEvidence) collectRunIds(entry, runIds);
  for (const run of allRuns) {
    if (known.has(run.runId) || known.has(run.traceId ?? run.runId)) runIds.add(run.runId);
  }

  const runs = [...runIds]
    .map((runId) => sources.runById(runId))
    .filter((run): run is ExecutionRunRecord => Boolean(run))
    .map(runToTrace)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));

  const usage = sources.usageEvents()
    .filter((event) => (event.runId ? runIds.has(event.runId) : false)
      || (event.traceId ? known.has(event.traceId) : false)
      || (borrow ? event.borrowOrderId === borrow.orderId : false))
    .map((event): TraceUsage => ({
      runId: event.runId,
      traceId: event.traceId ?? null,
      callerAgentId: event.callerAgentId ?? null,
      callerUserId: event.callerUserId ?? null,
      systemId: event.systemId,
      consumerSystemId: event.consumerSystemId,
      borrowOrderId: event.borrowOrderId,
      modelId: event.modelId,
      usageKind: event.usageKind,
      metering: event.metering,
      tokensIn: event.tokensIn,
      cachedTokens: event.cachedTokens,
      tokensOut: event.tokensOut,
      cost: event.cost,
      endedAt: event.endedAt,
    }))
    .sort((left, right) => left.endedAt.localeCompare(right.endedAt));

  const evidenceRefs = [...new Set(runs.flatMap((run) => run.evidenceRefs))];

  const timeline: TraceTimelineEntry[] = [];
  if (borrow) {
    timeline.push({
      at: borrow.createdAt,
      kind: 'borrow',
      title: `借调单创建：${borrow.fromSystem} → ${borrow.providerSystem ?? borrow.toSystem ?? '?'}`,
      detail: `${borrow.capability} · ${borrow.orderId}${borrow.caller?.userId || borrow.caller?.agentId ? ` · 发起人 ${borrow.caller?.userId ?? borrow.caller?.agentId}` : ''}`,
    });
    if (borrow.dispatchedAt) {
      timeline.push({ at: borrow.dispatchedAt, kind: 'borrow', title: '派单到执行面', detail: borrow.runId ?? borrow.providerAgentId ?? '' });
    }
    if (borrow.endedAt) {
      timeline.push({ at: borrow.endedAt, kind: 'borrow', title: `借调单${borrow.status === 'completed' ? '完成' : borrow.status === 'cancelled' ? '取消' : '结束'}：${borrow.status}`, detail: borrow.error?.message ?? '' });
    }
  }
  for (const run of runs) {
    timeline.push({
      at: run.startedAt,
      kind: 'run',
      title: `${analysisLabel(run)}开始：${run.agentId}`,
      detail: [run.capability, run.taskType].filter(Boolean).join(' · '),
    });
    if (run.endedAt) {
      timeline.push({
        at: run.endedAt,
        kind: 'run',
        title: `${analysisLabel(run)}${run.state === 'completed' ? '完成' : '结束'}：${run.state}`,
        detail: [
          run.dataConfidence ? `置信度 ${run.dataConfidence}` : '',
          run.conclusions ? `${run.conclusions} 条结论` : '',
          run.error ? `${run.error.code}: ${run.error.message}` : '',
        ].filter(Boolean).join(' · '),
      });
    }
  }
  for (const event of usage) {
    timeline.push({
      at: event.endedAt,
      kind: 'usage',
      title: `用量入账：${event.usageKind === 'query' ? '查询' : event.modelId ?? '模型'}`,
      detail: [
        event.metering,
        event.tokensIn || event.tokensOut ? `in ${event.tokensIn} / out ${event.tokensOut}` : '',
        event.cost ? `¥${event.cost.toFixed(4)}` : '',
        event.consumerSystemId ? `请求方 ${event.consumerSystemId}` : '',
      ].filter(Boolean).join(' · '),
    });
  }
  for (const entry of matchedEvidence) {
    timeline.push({
      at: entry.occurred_at,
      kind: 'evidence',
      title: `审计：${entry.summary || entry.correlation_id}`,
      detail: [entry.source_system, entry.actor_id ?? ''].filter(Boolean).join(' · '),
    });
  }
  timeline.sort((left, right) => {
    const leftAt = Date.parse(left.at);
    const rightAt = Date.parse(right.at);
    return (Number.isNaN(leftAt) ? 0 : leftAt) - (Number.isNaN(rightAt) ? 0 : rightAt);
  });

  const resolvedBy: TraceResult['resolvedBy'] = sources.borrowOrderById(id) ? 'borrow-order'
    : id.startsWith('exec-run-') && sources.runById(id) ? 'run'
      : matchedEvidence.length ? 'request'
        : allRuns.some((run) => (run.traceId ?? run.runId) === id) ? 'trace' : 'none';

  return {
    traceId: id,
    resolvedBy,
    borrowOrder: borrow ? borrowToSummary(borrow) : null,
    runs,
    usage,
    evidence: matchedEvidence
      .map((entry) => ({
        occurredAt: entry.occurred_at,
        summary: entry.summary ?? entry.correlation_id,
        correlationId: entry.correlation_id,
        actorId: entry.actor_id ?? null,
        sourceSystem: entry.source_system,
        payload: record(entry.payload),
      }))
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)),
    evidenceRefs,
    timeline,
  };
}
