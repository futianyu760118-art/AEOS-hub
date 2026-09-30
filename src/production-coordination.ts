type RecordValue = Record<string, unknown>;

export type ProductionResponse = unknown;

export interface ProductionSummary {
  available: boolean;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  dataAsOf: string | null;
  workOrderCount: number;
  inProgressCount: number;
  operationCount: number;
  linkedCount: number;
  reportCount: number;
  capacityCount: number;
  evidenceRefCount: number;
  evidenceRefs: string[];
  workOrders: RecordValue[];
  warnings: string[];
  message?: string;
}

function record(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

function payloadOf(response: ProductionResponse): RecordValue {
  const envelope = record(response);
  const structured = record(envelope.structuredContent);
  if (Object.keys(structured).length) return record(structured.result ?? structured);
  for (const item of Array.isArray(envelope.content) ? envelope.content : []) {
    const block = record(item);
    if (block.type !== 'text' || typeof block.text !== 'string') continue;
    try { return record(JSON.parse(block.text)); } catch { /* Continue to the next block. */ }
  }
  return envelope;
}

function rows(payload: RecordValue): RecordValue[] {
  return Array.isArray(payload.data) ? payload.data.filter((item): item is RecordValue => item !== null && typeof item === 'object' && !Array.isArray(item)).map(record) : [];
}

function stamp(payload: RecordValue): string {
  return typeof payload.data_as_of === 'string' ? payload.data_as_of : typeof payload.generated_at === 'string' ? payload.generated_at : '';
}

function confidence(payload: RecordValue): 'high' | 'medium' | 'low' | 'unknown' {
  const value = typeof payload.data_confidence === 'string' ? payload.data_confidence.toLowerCase() : '';
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'unknown';
}

function errorText(payload: RecordValue): string {
  const error = record(payload.error);
  return typeof error.message === 'string' ? `${typeof error.code === 'string' ? error.code + ' · ' : ''}${error.message}` : '';
}

/** Parse the five production read-only envelopes without turning an empty result into a risk conclusion. */
export function parseProductionSummary(input: {
  workOrders?: ProductionResponse;
  operations?: ProductionResponse;
  orderLinks?: ProductionResponse;
  reports?: ProductionResponse;
  capacity?: ProductionResponse;
}): ProductionSummary {
  const payloads = [input.workOrders, input.operations, input.orderLinks, input.reports, input.capacity].map(payloadOf);
  const [workOrders, operations, orderLinks, reports, capacity] = payloads;
  const allRows = payloads.flatMap(rows);
  const levels = payloads.map(confidence).filter((value) => value !== 'unknown');
  const level = levels.includes('low') ? 'low' : levels.includes('medium') ? 'medium' : levels.length ? 'high' : 'unknown';
  const stamps = payloads.map(stamp).filter(Boolean).sort();
  const warnings = payloads.flatMap((payload, index) => {
    const label = ['生产工单', '工序进度', '订单关联', '生产报工', '产能'][index];
    const messages: string[] = [];
    const error = errorText(payload);
    if (error) messages.push(`${label}不可用：${error}`);
    if (confidence(payload) === 'low' || payload.stale === true) messages.push(`${label}数据置信度不足`);
    if (Array.isArray(payload.warnings)) messages.push(...payload.warnings.filter((item): item is string => typeof item === 'string').map((item) => `${label}：${item}`));
    return messages;
  });
  const workOrderRows = rows(workOrders);
  const inProgressCount = workOrderRows.filter((row) => ['in_progress', 'released', '进行中', '已下达'].includes(String(row.status ?? '').toLowerCase())).length;
  const evidenceRefCount = new Set(payloads.flatMap((payload) => Array.isArray(payload.evidence_refs) ? payload.evidence_refs.filter((item): item is string => typeof item === 'string') : [])).size;
  const evidenceRefs = [...new Set(payloads.flatMap((payload) => Array.isArray(payload.evidence_refs) ? payload.evidence_refs.filter((item): item is string => typeof item === 'string') : []))];
  const available = payloads.some((payload) => Object.keys(payload).length > 0 && !errorText(payload));
  const message = !available ? '中控未返回可解析的生产协同数据' : undefined;
  return {
    available,
    confidence: level,
    dataAsOf: stamps[0] ?? null,
    workOrderCount: workOrderRows.length,
    inProgressCount,
    operationCount: rows(operations).length,
    linkedCount: rows(orderLinks).length,
    reportCount: rows(reports).length,
    capacityCount: rows(capacity).length,
    evidenceRefCount,
    evidenceRefs,
    workOrders: workOrderRows.slice(0, 20),
    warnings: [...new Set(warnings)],
    ...(message ? { message } : {}),
  };
}
