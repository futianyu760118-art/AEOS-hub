import { z } from 'zod';
import type { DashboardRisk, DashboardSnapshot } from './dashboard.ts';

export const AttentionSearchRequestSchema = z.object({
  query: z.string().trim().max(160, '搜索关键词不能超过 160 个字符'),
  source: z.enum(['all', 'order', 'kitting', 'quality', 'production']).optional().default('all'),
  live: z.literal(true),
}).strict();

export type AttentionSearchRequest = z.infer<typeof AttentionSearchRequestSchema>;

export interface AttentionLiveSearchItem {
  id: string;
  source: 'order' | 'kitting' | 'quality' | 'production';
  title: string;
  summary: string;
  evidenceRefs: string[];
  dataAsOf: string | null;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  risk?: DashboardRisk;
}

export interface AttentionLiveSearchResult {
  status: 'complete' | 'partial' | 'unavailable';
  items: AttentionLiveSearchItem[];
  warnings: string[];
  sources: Array<{
    source: AttentionLiveSearchItem['source'];
    dataAsOf: string | null;
    loaded: number;
    total: number | null;
    partial: boolean;
    confidence: AttentionLiveSearchItem['confidence'];
  }>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function matches(query: string, ...values: unknown[]): boolean {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  return !needle || values.some((value) => text(value).toLocaleLowerCase('zh-CN').includes(needle));
}

function confidence(snapshot: DashboardSnapshot, source: AttentionLiveSearchItem['source']): AttentionLiveSearchItem['confidence'] {
  const domain = source === 'order' ? snapshot.domains.order
    : source === 'kitting' ? snapshot.domains.kitting
      : source === 'quality' ? snapshot.domains.quality
        : snapshot.domains.production;
  const value = domain?.confidence;
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'unknown';
}

function riskItem(risk: DashboardRisk, snapshot: DashboardSnapshot, index: number): AttentionLiveSearchItem {
  return {
    id: `${risk.source}:${risk.issueNo || risk.orderNo}:${index}`,
    source: risk.source,
    title: risk.issueNo ? `${risk.issueNo} · ${risk.summary}` : `${risk.orderNo} · ${risk.summary}`,
    summary: `${risk.owner || '责任人待确认'} · ${risk.orderStatus || '状态待回传'}`,
    evidenceRefs: risk.evidenceRef ? [risk.evidenceRef] : [],
    dataAsOf: snapshot.domains[risk.source === 'order' ? 'order' : risk.source]?.dataAsOf ?? snapshot.dataAsOf,
    confidence: confidence(snapshot, risk.source),
    risk,
  };
}

function sourceStates(snapshot: DashboardSnapshot, source: AttentionSearchRequest['source']): AttentionLiveSearchResult['sources'] {
  const names = source === 'all' ? ['order', 'kitting', 'quality', 'production'] as const : [source];
  return names.flatMap((name) => {
    const domain = snapshot.domains[name];
    if (!domain) return [];
    return [{
      source: name,
      dataAsOf: domain.dataAsOf,
      loaded: domain.loaded,
      total: domain.total,
      partial: domain.partial,
      confidence: confidence(snapshot, name),
    }];
  });
}

function productionOverview(query: string, snapshot: DashboardSnapshot): AttentionLiveSearchItem | null {
  const production = snapshot.productionAssessment;
  if (!production.available && !production.dataAsOf && !production.warnings.length && !production.evidenceRefs.length) return null;
  const workOrderTerms = production.workOrders.flatMap((row) => [row.work_order_no, row.work_order_id, row.order_no, row.status]);
  if (!matches(query, '生产协同', '生产工单', '产能', ...workOrderTerms)) return null;
  return {
    id: 'production:overview',
    source: 'production',
    title: '生产协同概览',
    summary: `生产工单 ${production.workOrderCount} 张（进行中 ${production.inProgressCount} 张）· 产能记录 ${production.capacityCount} 条`,
    evidenceRefs: production.evidenceRefs,
    dataAsOf: production.dataAsOf,
    confidence: confidence(snapshot, 'production'),
  };
}

/** Converts a freshly-read dashboard snapshot into a bounded, evidence-aware live-search response. */
export function searchLiveDashboard(request: Pick<AttentionSearchRequest, 'query' | 'source'> | string, snapshot: DashboardSnapshot): AttentionLiveSearchResult {
  const query = typeof request === 'string' ? request : request.query;
  const source: AttentionSearchRequest['source'] = typeof request === 'string' ? 'all' : request.source;
  const warnings = [...new Set(snapshot.warnings || [])];
  const risks = [
    ...(snapshot.attentionRisks || []),
    ...(snapshot.closedAttentionRisks || []),
    ...(snapshot.kittingRisks || []),
    ...(snapshot.qualityRisks || []),
  ];
  const deduped = new Map<string, DashboardRisk>();
  for (const risk of risks) {
    const key = `${risk.source}:${risk.issueNo || risk.orderNo}:${risk.demandLineNo || ''}`;
    if (!deduped.has(key)) deduped.set(key, risk);
  }
  const items = [...deduped.values()]
    .filter((risk) => source === 'all' || risk.source === source)
    .filter((risk) => matches(query, risk.orderNo, risk.issueNo, risk.summary, risk.customer, risk.product, risk.owner, risk.orderStatus, risk.evidenceRef))
    .slice(0, 40)
    .map((risk, index) => riskItem(risk, snapshot, index));
  if (source === 'all' || source === 'production') {
    const overview = productionOverview(query, snapshot);
    if (overview) items.unshift(overview);
  }
  const sources = sourceStates(snapshot, source);
  const unavailable = source === 'all' ? !snapshot.businessData?.available : sources.length === 0;
  const partial = unavailable || warnings.length > 0 || items.some((item) => !item.evidenceRefs.length || ['low', 'unknown'].includes(item.confidence));
  if (items.some((item) => !item.evidenceRefs.length)) warnings.push('部分实时结果未能唯一绑定 evidence_ref，数据置信度不足，请回到中台复核。');
  return { status: unavailable ? 'unavailable' : partial ? 'partial' : 'complete', items, warnings: [...new Set(warnings)], sources };
}
