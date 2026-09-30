import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCapabilityRegistry } from '../src/capability-registry.ts';
import { buildDashboardSnapshot } from '../src/dashboard.ts';

function toolResponse(payload: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

test('builds manager metrics, ranked risks, and decisions from MCP results', () => {
  const registry = buildCapabilityRegistry(['demo-erp', 'company-control'], {
    data: [
      { name: 'demo-erp', runtimeStatus: 'connected', tools: {
        list_order_risks: { name: 'list_order_risks', inputSchema: {}, annotations: { readOnlyHint: true } },
        check_material_shortages: { name: 'check_material_shortages', inputSchema: {}, annotations: { readOnlyHint: true } },
      } },
      { name: 'company-control', runtimeStatus: 'connected', tools: {
        get_system_health: { name: 'get_system_health', inputSchema: {}, annotations: { readOnlyHint: true } },
      } },
    ],
  });
  const snapshot = buildDashboardSnapshot({
    registry,
    orderRiskResponse: toolResponse({
      source: 'demo-erp', generated_at: '2026-09-03T08:00:00Z', data_confidence: 'high', orders: [
        { order_no: 'SO-LOW', amount_cny: 500000, risk_probability: 0.45, due_date: '2026-09-20', risk_type: '产能', blocking_reason: '产能偏高', evidence_ref: 'demo://low' },
        { order_no: 'SO-HIGH', amount_cny: 2000000, risk_probability: 0.8, due_date: '2026-09-25', risk_type: '物料', blocking_reason: 'MO-1 缺料', evidence_ref: 'demo://high' },
      ],
    }),
    shortageResponse: toolResponse({
      source: 'demo-erp', shortages: [
        { material_code: 'MO-1', shortage_qty: 3200, gap_days: 8, affected_orders: ['SO-HIGH'] },
      ],
    }),
  });

  assert.deepEqual(snapshot.metrics, { capabilityCount: 3, mcpServerCount: 2, highRiskCount: 1, attentionCount: 2 });
  assert.deepEqual(snapshot.risks.map((risk) => risk.orderNo), ['SO-HIGH', 'SO-LOW']);
  assert.equal(snapshot.decisions[0]?.title, 'MO-1 缺料处置路径选择');
  assert.match(snapshot.decisions[0]?.detail ?? '', /3,200/);
  assert.equal(snapshot.dataAsOf, '2026-09-03T08:00:00Z');
  assert.deepEqual(snapshot.businessData, { source: 'demo-erp', available: true, confidence: 'unknown' });
  assert.deepEqual(snapshot.riskAssessment, { available: true });
  assert.deepEqual(snapshot.dataCompleteness, {
    activeOrderCount: 2, riskSignalCount: 2, probabilityCount: 2, riskLevelCount: 0,
    ownerCount: 0, dueDateCount: 2, shippingPlanCount: 0, evidenceRefCount: 2,
  });
});

test('returns a safe empty dashboard when MCP business data is unavailable', () => {
  const registry = buildCapabilityRegistry(['company-control'], null, 'runtime unavailable');
  const snapshot = buildDashboardSnapshot({ registry, source: 'company-control', warnings: ['订单风险读取失败'] });
  assert.equal(snapshot.risks.length, 0);
  assert.equal(snapshot.decisions.length, 0);
  assert.equal(snapshot.metrics.highRiskCount, 0);
  assert.equal(snapshot.source, 'company-control');
  assert.deepEqual(snapshot.businessData, { source: 'company-control', available: false, confidence: 'unknown' });
  assert.equal(snapshot.riskAssessment.available, false);
  assert.deepEqual(snapshot.warnings, ['订单风险读取失败', '中控未返回可解析的订单数组，无法评估订单风险', 'runtime unavailable']);
});

test('maps company-control order envelopes without falling back to demo data', () => {
  const registry = buildCapabilityRegistry(['company-control', 'demo-erp'], null);
  const snapshot = buildDashboardSnapshot({
    registry,
    source: 'company-control',
    orderRiskResponse: toolResponse({
      source: 'company-control',
      data_as_of: '2026-09-21T08:00:00Z',
      data_confidence: 'high',
      evidence_refs: ['control-platform://order/CC-001@2026-09-21T08:00:00Z'],
      data: [
        {
          order_no: 'CC-001', customer: '华东照明', product_name: '商业照明灯', product_code: 'P-100',
          order_qty: 120, completed_qty: 45, amount_cny: 880000, risk_probability: 0.76, risk_score: 82.5,
          due_date: '2026-09-28', shipping_plan: '2026-09-26', owner: '张三', status: 'open', erp_status: 1,
          risk_type: '交付', blocking_reason: '关键工序延期',
        },
        { order_no: 'CC-SAFE', amount_cny: 100000, risk_probability: 0.1, due_date: '2026-10-01' },
      ],
    }),
  });
  assert.equal(snapshot.source, 'company-control');
  assert.equal(snapshot.risks.length, 1);
  assert.equal(snapshot.risks[0]?.orderNo, 'CC-001');
  assert.equal(snapshot.risks[0]?.evidenceRef, 'control-platform://order/CC-001@2026-09-21T08:00:00Z');
  assert.equal(snapshot.dataAsOf, '2026-09-21T08:00:00Z');
  assert.deepEqual(snapshot.risks[0] && {
    customer: snapshot.risks[0].customer,
    product: snapshot.risks[0].product,
    orderQty: snapshot.risks[0].orderQty,
    completedQty: snapshot.risks[0].completedQty,
    riskScore: snapshot.risks[0].riskScore,
    dueDate: snapshot.risks[0].dueDate,
    shippingPlan: snapshot.risks[0].shippingPlan,
    owner: snapshot.risks[0].owner,
    orderStatus: snapshot.risks[0].orderStatus,
  }, {
    customer: '华东照明', product: '商业照明灯 · P-100', orderQty: 120, completedQty: 45,
    riskScore: 82.5, dueDate: '2026-09-28', shippingPlan: '2026-09-26', owner: '张三', orderStatus: '已审核',
  });
  assert.deepEqual(snapshot.businessData, { source: 'company-control', available: true, confidence: 'high' });
  assert.deepEqual(snapshot.riskAssessment, { available: true });
});

test('interprets timezone-less company-control timestamps as Asia/Shanghai', () => {
  const registry = buildCapabilityRegistry(['company-control'], null);
  const snapshot = buildDashboardSnapshot({
    registry,
    source: 'company-control',
    now: Date.parse('2026-09-29T01:00:00Z'),
    orderRiskResponse: toolResponse({
      source: 'company-control',
      data_as_of: '2026-09-29T08:45:00',
      data_confidence: 'high',
      data: [{ order_no: 'CC-TZ-001', risk_probability: 0.8, erp_status: 1 }],
    }),
  });
  assert.equal(snapshot.domains.order?.confidence, 'high');
  assert.equal(snapshot.businessData.confidence, 'high');
  assert.ok(!snapshot.warnings.some((warning) => warning.includes('order：数据置信度不足')));
});

test('exposes company-control errors as low-confidence empty state', () => {
  const registry = buildCapabilityRegistry(['company-control', 'demo-erp'], null);
  const snapshot = buildDashboardSnapshot({
    registry,
    source: 'company-control',
    orderRiskResponse: toolResponse({
      source: 'company-control',
      error: { code: 'UPSTREAM_UNAVAILABLE', message: '订单端点尚未开放', retryable: true },
    }),
  });
  assert.equal(snapshot.source, 'company-control');
  assert.equal(snapshot.risks.length, 0);
  assert.match(snapshot.warnings[0] ?? '', /订单端点尚未开放/);
  assert.deepEqual(snapshot.businessData, {
    source: 'company-control', available: false, confidence: 'unknown', message: 'UPSTREAM_UNAVAILABLE · 订单端点尚未开放',
  });
  assert.deepEqual(snapshot.riskAssessment, { available: false, message: '订单风险数据不可用' });
});

test('does not present ordinary company-control orders as a completed risk assessment', () => {
  const registry = buildCapabilityRegistry(['company-control'], null);
  const snapshot = buildDashboardSnapshot({
    registry,
    source: 'company-control',
    orderRiskResponse: toolResponse({
      source: 'company-control',
      data_as_of: '2026-09-21T08:00:00Z',
      data: [{ order_no: 'CC-BASE-001', amount_cny: 880000, due_date: '2026-09-28', order_status: 'in_production' }],
    }),
  });
  assert.deepEqual(snapshot.businessData, { source: 'company-control', available: true, confidence: 'unknown' });
  assert.equal(snapshot.risks.length, 0);
  assert.equal(snapshot.riskAssessment.available, false);
  assert.match(snapshot.riskAssessment.message ?? '', /未提供有效的 risk_probability 或 risk_level/);
  assert.ok(snapshot.warnings.some((warning) => warning.includes('风险未评估')));
});

test('uses risk_level without inventing probability when company-control has no probability field', () => {
  const registry = buildCapabilityRegistry(['company-control'], null);
  const snapshot = buildDashboardSnapshot({
    registry,
    source: 'company-control',
    orderRiskResponse: toolResponse({
      source: 'company-control',
      data_as_of: '2026-09-22T01:00:00Z',
      data_confidence: 'high',
      evidence_refs: [
        'control-platform://order/CC-RED@2026-09-22T01:00:00Z',
        'control-platform://order/CC-YELLOW@2026-09-22T01:00:00Z',
      ],
      data: [
        { order_no: 'CC-YELLOW', amount_cny: 900000, due_date: '2026-09-26', risk_level: 'yellow' },
        { order_no: 'CC-RED', amount_cny: 200000, due_date: '2026-09-25', risk_level: 'red' },
        { order_no: 'CC-GREEN', amount_cny: 1000000, due_date: '2026-09-24', risk_level: 'green' },
        { order_no: 'CC-BLUE', amount_cny: 800000, due_date: '2026-09-23', risk_level: 'blue' },
      ],
    }),
  });

  assert.equal(snapshot.riskAssessment.available, true);
  assert.match(snapshot.riskAssessment.message ?? '', /已按 4 条订单的 risk_level 识别风险/);
  assert.deepEqual(snapshot.risks.map((risk) => risk.orderNo), ['CC-RED', 'CC-YELLOW']);
  assert.deepEqual(snapshot.risks.map((risk) => risk.probability), [null, null]);
  assert.deepEqual(snapshot.risks.map((risk) => risk.riskLevel), ['高风险', '需关注']);
  assert.equal(snapshot.metrics.highRiskCount, 1);
  assert.equal(snapshot.metrics.attentionCount, 2);
  assert.equal(snapshot.decisions[0]?.level, 'L4');
  assert.equal(snapshot.decisions[0]?.probability, null);
  assert.ok(snapshot.risks.every((risk) => !risk.prompt.includes('%')));
});

test('maps ERP order status and excludes completed or cancelled closed orders from active risks', () => {
  const registry = buildCapabilityRegistry(['company-control'], null);
  const snapshot = buildDashboardSnapshot({
    registry,
    source: 'company-control',
    orderRiskResponse: toolResponse({
      source: 'company-control',
      data_confidence: 'high',
      data: [
        { order_no: 'CC-AUDITED', amount_cny: 100000, risk_probability: 0.8, due_date: '2026-09-25', erp_status: 1 },
        { order_no: 'CC-PARTIAL', amount_cny: 200000, risk_probability: 0.8, due_date: '2026-09-24', erp_status: 2 },
        { order_no: 'CC-DONE', amount_cny: 900000, risk_probability: 0.9, due_date: '2026-09-23', erp_status: 3, delivery_completed_date: '2026-09-21' },
        { order_no: 'CC-CANCELLED', amount_cny: 900000, risk_probability: 0.9, due_date: '2026-09-23', erp_status: 3 },
        { order_no: 'CC-LEGACY-CLOSED', amount_cny: 900000, risk_probability: 0.9, due_date: '2026-09-23', is_closed: 1 },
      ],
    }),
  });

  assert.deepEqual(snapshot.risks.map((risk) => risk.orderNo), ['CC-PARTIAL', 'CC-AUDITED']);
  assert.deepEqual(snapshot.risks.map((risk) => risk.orderStatus), ['部分关闭', '已审核']);
  assert.equal(snapshot.metrics.attentionCount, 2);
  assert.equal(snapshot.metrics.highRiskCount, 2);
});

test('reports a clear empty state when the query only contains ERP-closed orders', () => {
  const registry = buildCapabilityRegistry(['company-control'], null);
  const snapshot = buildDashboardSnapshot({
    registry,
    source: 'company-control',
    orderRiskResponse: toolResponse({
      source: 'company-control',
      data: [
        { order_no: 'CC-DONE', amount_cny: 900000, risk_probability: 0.9, erp_status: 3, delivery_completed_date: '2026-09-21' },
        { order_no: 'CC-CANCELLED', amount_cny: 900000, risk_probability: 0.9, erp_status: 3 },
      ],
    }),
  });

  assert.equal(snapshot.risks.length, 0);
  assert.equal(snapshot.closedAttentionRisks.length, 2);
  assert.deepEqual([...snapshot.closedAttentionRisks.map((risk) => risk.orderStatus)].sort(), ['已取消', '已完成'].sort());
  assert.equal(snapshot.riskAssessment.available, true);
  assert.match(snapshot.riskAssessment.message ?? '', /已关闭订单（已完成或已取消）/);
});

test('surfaces non-full company-control kitting results and joins their shortage evidence', () => {
  const registry = buildCapabilityRegistry(['company-control'], null);
  const snapshot = buildDashboardSnapshot({
    registry,
    source: 'company-control',
    shortageResponse: toolResponse({
      source: 'company-control',
      data: [{ demand_no: 'SO-KIT-001', material_code: 'M-100', shortage_qty: 12, shortage_days: 4 }],
    }),
    kittingResponse: toolResponse({
      source: 'company-control',
      data_as_of: '2026-09-23T01:00:00Z',
      data_confidence: 'high',
      evidence_refs: ['control-platform://kitting-result/SALES_ORDER/SO-KIT-001/1@2026-09-23T01:00:00Z'],
      data: [{
        demand_type: 'SALES_ORDER', demand_no: 'SO-KIT-001', demand_line_no: '1', kit_status: 'SHORTAGE',
        required_date: '2026-09-28', demand_qty: 120, affected_order_amount: 500000,
        kit_rate_by_item: 75, shortage_item_count: 2, shortage_qty: 12, estimated_full_kit_date: '2026-09-30',
      }],
    }),
  });

  assert.deepEqual(snapshot.kittingAssessment, { available: true, shortageCount: 1 });
  assert.equal(snapshot.kittingRisks.length, 1);
  assert.equal(snapshot.kittingRisks[0]?.orderNo, 'SO-KIT-001');
  assert.equal(snapshot.kittingRisks[0]?.source, 'kitting');
  assert.equal(snapshot.kittingRisks[0]?.kitRateByItem, 75);
  assert.equal(snapshot.kittingRisks[0]?.shortageItemCount, 2);
  assert.equal(snapshot.kittingRisks[0]?.estimatedFullKitDate, '2026-09-30');
  assert.equal(snapshot.risks.length, 0);
  assert.equal(snapshot.attentionRisks[0]?.orderNo, 'SO-KIT-001');
  assert.match(snapshot.attentionRisks[0]?.summary ?? '', /SHORTAGE/);
  assert.match(snapshot.attentionRisks[0]?.evidenceRef ?? '', /kitting-result/);
  assert.equal(snapshot.decisions.length, 1);
  assert.match(snapshot.decisions[0]?.title ?? '', /齐套缺口/);
});

test('deduplicates repeated Attention events for the same kitting demand object', () => {
  const registry = buildCapabilityRegistry(['company-control'], null);
  const snapshot = buildDashboardSnapshot({
    registry,
    source: 'company-control',
    kittingResponse: toolResponse({
      source: 'company-control', data_confidence: 'high',
      data: [
        { demand_type: 'SALES_ORDER', demand_no: 'SO-DUP-001', demand_line_no: '1', kit_status: 'PENDING', required_date: '2026-09-30', affected_order_amount: 100000, evidence_ref: 'control-platform://kitting/older' },
        { demand_type: 'SALES_ORDER', demand_no: 'SO-DUP-001', demand_line_no: '2', kit_status: 'SHORTAGE', required_date: '2026-09-29', affected_order_amount: 100000, evidence_ref: 'control-platform://kitting/current' },
      ],
    }),
  });

  assert.equal(snapshot.kittingRisks.length, 2);
  assert.equal(snapshot.attentionRisks.length, 1);
  assert.equal(snapshot.attentionSummary.events, 1);
  assert.equal(snapshot.metrics.attentionCount, 1);
  assert.equal(snapshot.attentionRisks[0]?.orderStatus, 'SHORTAGE');
});

test('never assigns another order evidence when top-level refs arrive out of order', () => {
  const registry = buildCapabilityRegistry(['company-control'], null);
  const snapshot = buildDashboardSnapshot({
    registry,
    source: 'company-control',
    orderRiskResponse: toolResponse({
      source: 'company-control', data_confidence: 'high', data_as_of: '2026-09-23T01:00:00Z',
      evidence_refs: [
        'control-platform://order/SO-B@2026-09-23T01:00:00Z',
        'control-platform://order/SO-A@2026-09-23T01:00:00Z',
      ],
      data: [
        { order_no: 'SO-A', risk_probability: 0.8, amount_cny: 10 },
        { order_no: 'SO-B', risk_probability: 0.8, amount_cny: 10 },
        { order_no: 'SO-NO-REF', risk_probability: 0.8, amount_cny: 10 },
      ],
    }),
  });
  assert.equal(snapshot.risks.find((risk) => risk.orderNo === 'SO-A')?.evidenceRef.includes('/SO-A@'), true);
  assert.equal(snapshot.risks.find((risk) => risk.orderNo === 'SO-B')?.evidenceRef.includes('/SO-B@'), true);
  assert.equal(snapshot.risks.find((risk) => risk.orderNo === 'SO-NO-REF')?.evidenceRef, '');
  assert.ok(snapshot.warnings.some((warning) => warning.includes('未能唯一绑定证据')));
});

test('surfaces open quality issues without fabricating absent quality fields', () => {
  const registry = buildCapabilityRegistry(['company-control'], null);
  const snapshot = buildDashboardSnapshot({
    registry,
    source: 'company-control',
    qualityResponse: toolResponse({
      source: 'company-control',
      data_as_of: '2026-09-23T02:00:00Z',
      data_confidence: 'high',
      evidence_refs: ['control-platform://quality-issue/QI-20260922-0001@2026-09-23T02:00:00Z'],
      data: [{
        issue_no: 'QI-20260922-0001', title: '来料尺寸超差', status: 'open',
        order_no: 'SO-2609-001', product_code: 'P-100', severity: null,
        inspection_result: null, owner: '李四', owner_org: '品质部', occurred_at: '2026-09-22',
      }, {
        issue_no: 'QI-CLOSED', title: '已闭环异常', status: 'closed', order_no: 'SO-2609-002',
      }],
    }),
  });

  assert.deepEqual(snapshot.qualityAssessment, { available: true, openCount: 1 });
  assert.equal(snapshot.qualityRisks.length, 1);
  assert.equal(snapshot.qualityRisks[0]?.source, 'quality');
  assert.equal(snapshot.qualityRisks[0]?.issueNo, 'QI-20260922-0001');
  assert.equal(snapshot.qualityRisks[0]?.orderNo, 'SO-2609-001');
  assert.equal(snapshot.qualityRisks[0]?.product, 'P-100');
  assert.equal(snapshot.qualityRisks[0]?.riskLevel, '风险等级未知');
  assert.equal(snapshot.qualityRisks[0]?.inspectionResult, '');
  assert.equal(snapshot.attentionRisks[0]?.issueNo, 'QI-20260922-0001');
  assert.match(snapshot.attentionRisks[0]?.evidenceRef ?? '', /quality-issue/);
  assert.equal(snapshot.metrics.attentionCount, 1);
  assert.equal(snapshot.dataAsOf, '2026-09-23T02:00:00Z');
});
