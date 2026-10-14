import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeExecutionResult } from '../public/execution-query-summary.js';

test('renders key inventory quantities instead of only the material title', () => {
  const summary = summarizeExecutionResult('/external/inventory/availability', {
    total: 1,
    items: [{ material_code: '3.1.JFX27-B1WA45-ZJ2-10-001', material_name: 'X系列投光灯', on_hand_qty: 60, locked_qty: 5, available_qty: 55, qty_in_transit: 12 }],
  });
  assert.match(summary, /现存量：60/);
  assert.match(summary, /锁定量：5/);
  assert.match(summary, /可用量：55/);
  assert.match(summary, /在途量：12/);
});

test('renders type-specific fields for all other query result categories', () => {
  const examples = [
    ['/external/material-kitting/results', { demand_no: 'SO-1', demand_line_no: '2', kit_status: 'BLOCKED', kit_rate_by_qty: 60, shortage_item_count: 3, risk_level: 'red' }, /齐套率（按数量）：60/],
    ['/external/orders/list', { order_no: 'SO-1', customer: '客户A', product_name: '产品A', status: 'in_progress', promised_date: '2026-10-20', order_amount: 100 }, /合同交期：2026-10-20/],
    ['/external/material-supplies/list', { supply_no: 'PO-1', material_code: 'M-1', supply_type: 'PURCHASE', supply_qty: 20, available_qty: 18, expected_available_date: '2026-10-20' }, /预计可用日期：2026-10-20/],
    ['/external/quality-issues/list', { issue_no: 'QI-1', product_code: 'P-1', status: 'open', defect_type: '外观', submit_dept: '品管', occurred_at: '2026-10-14' }, /缺陷类型：外观/],
    ['/external/production/work-orders/list', { work_order_no: 'WO-1', order_no: 'SO-1', product_code: 'P-1', status: 'in_progress', workshop: 'WS-1', planned_end_date: '2026-10-20' }, /计划完工日期：2026-10-20/],
    ['/external/suppliers/list', { supplier_code: 'SUP-1', supplier_name: '供应商A', supplier_short: 'A厂' }, /供应商编码：SUP-1/],
  ];
  for (const [path, item, expected] of examples) {
    assert.match(summarizeExecutionResult(path, { total: 1, items: [item] }), expected, String(path));
  }
});
