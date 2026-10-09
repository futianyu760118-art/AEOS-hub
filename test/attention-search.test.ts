import assert from 'node:assert/strict';
import test from 'node:test';
import { AttentionSearchRequestSchema, searchLiveDashboard } from '../src/attention-search.ts';
import type { DashboardRisk, DashboardSnapshot } from '../src/dashboard.ts';

const risk = (overrides: Partial<DashboardRisk> = {}): DashboardRisk => ({
  source: 'order', orderNo: 'SO-SEARCH-01', summary: '关键物料缺料', customer: '华东客户', product: 'P-01',
  orderQty: 10, completedQty: 2, amountCny: 100_000, probability: 0.8, riskScore: 80, dueDate: '2026-10-01',
  shippingPlan: '', owner: '张三', orderStatus: '进行中', riskLevel: '高风险', evidenceRef: 'control://order/SO-SEARCH-01',
  prompt: '', kitRateByItem: null, shortageItemCount: null, shortageQty: null, estimatedFullKitDate: '', ...overrides,
});

const snapshot = (overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot => ({
  generatedAt: '2026-09-30T00:00:00.000Z', dataAsOf: '2026-09-30T00:00:00.000Z', source: 'company-control',
  domains: { order: { dataAsOf: '2026-09-30T00:00:00.000Z', confidence: 'high', loaded: 1, total: 1, partial: false, queryScope: {} } },
  attentionSummary: { events: 1, businessObjects: 1 }, businessData: { source: 'company-control', available: true, confidence: 'high' },
  riskAssessment: { available: true }, kittingAssessment: { available: true, shortageCount: 0 }, qualityAssessment: { available: true, openCount: 0 },
  productionAssessment: { available: false, workOrders: [], operations: [], orderLinks: [], reports: [], capacities: [], evidenceRefs: [], warnings: [] },
  dataCompleteness: { activeOrderCount: 1, riskSignalCount: 1, probabilityCount: 1, riskLevelCount: 1, ownerCount: 1, dueDateCount: 1, shippingPlanCount: 0, evidenceRefCount: 1 },
  metrics: { capabilityCount: 1, mcpServerCount: 1, highRiskCount: 1, attentionCount: 1 }, risks: [risk()], attentionRisks: [risk()], closedAttentionRisks: [], kittingRisks: [], qualityRisks: [], decisions: [], mcpServers: [], warnings: [], ...overrides,
});

test('validates that live Attention search is explicit and bounded', () => {
  assert.deepEqual(AttentionSearchRequestSchema.parse({ query: ' SO-SEARCH-01 ', live: true }), { query: 'SO-SEARCH-01', source: 'all', live: true });
  assert.deepEqual(AttentionSearchRequestSchema.parse({ query: '', source: 'production', live: true }), { query: '', source: 'production', live: true });
  assert.throws(() => AttentionSearchRequestSchema.parse({ query: 'x', live: false }));
});

test('returns evidence-aware live matches and never turns unavailable data into an empty conclusion', () => {
  const complete = searchLiveDashboard('search-01', snapshot());
  assert.equal(complete.status, 'complete');
  assert.equal(complete.items[0]?.evidenceRefs[0], 'control://order/SO-SEARCH-01');
  const unavailable = searchLiveDashboard('search-01', snapshot({ businessData: { source: 'company-control', available: false, confidence: 'unknown' }, warnings: ['中控读取失败'] }));
  assert.equal(unavailable.status, 'unavailable');
  assert.match(unavailable.warnings.join(' '), /中控读取失败/);
});

test('includes recent closed Attention items without counting them as active queue records', () => {
  const closed = risk({ orderNo: 'SO-DONE-01', orderStatus: '已完成', evidenceRef: 'control://order/SO-DONE-01' });
  const result = searchLiveDashboard('done-01', snapshot({ attentionRisks: [], closedAttentionRisks: [closed], metrics: { capabilityCount: 1, mcpServerCount: 1, highRiskCount: 0, attentionCount: 0 } }));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.summary.includes('已完成'), true);
});

test('allows an explicit blank live browse without misreporting it as no match', () => {
  const result = searchLiveDashboard({ query: '', source: 'order' }, snapshot());
  assert.equal(result.status, 'complete');
  assert.equal(result.items.length, 1);
  assert.equal(result.sources[0]?.source, 'order');
});

test('returns a production overview from returned production data without inventing a risk', () => {
  const result = searchLiveDashboard({ query: '', source: 'production' }, snapshot({
    domains: { production: { dataAsOf: '2026-09-30T00:00:00.000Z', confidence: 'high', loaded: 2, total: null, partial: false, queryScope: {} } },
    productionAssessment: { available: true, confidence: 'high', dataAsOf: '2026-09-30T00:00:00.000Z', workOrderCount: 1, inProgressCount: 1, operationCount: 0, linkedCount: 0, reportCount: 0, capacityCount: 1, evidenceRefCount: 1, evidenceRefs: ['control://production/WO-1'], workOrders: [{ work_order_no: 'WO-1' }], warnings: [] },
  }));
  assert.equal(result.status, 'complete');
  assert.equal(result.items[0]?.source, 'production');
  assert.equal(result.items[0]?.risk, undefined);
  assert.match(result.items[0]?.summary ?? '', /产能记录 1 条/);
});

test('matches a returned work-order number when production is the selected scope', () => {
  const result = searchLiveDashboard({ query: 'WO-1', source: 'production' }, snapshot({
    domains: { production: { dataAsOf: '2026-09-30T00:00:00.000Z', confidence: 'high', loaded: 1, total: null, partial: false, queryScope: {} } },
    productionAssessment: { available: true, confidence: 'high', dataAsOf: '2026-09-30T00:00:00.000Z', workOrderCount: 1, inProgressCount: 0, operationCount: 0, linkedCount: 0, reportCount: 0, capacityCount: 0, evidenceRefCount: 1, evidenceRefs: ['control://production/WO-1'], workOrders: [{ work_order_no: 'WO-1' }], warnings: [] },
  }));
  assert.equal(result.items[0]?.source, 'production');
});
