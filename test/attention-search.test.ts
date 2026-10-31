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
  assert.deepEqual(AttentionSearchRequestSchema.parse({ query: ' SO-SEARCH-01 ', live: true }), { query: 'SO-SEARCH-01', live: true });
  assert.throws(() => AttentionSearchRequestSchema.parse({ query: '', live: true }));
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
