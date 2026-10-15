import assert from 'node:assert/strict';
import test from 'node:test';
import { describeExecutionQuery, parseExecutionQuery, parseExecutionQueryByIntent } from '../public/execution-query-intent.js';

const now = new Date('2026-10-14T08:00:00.000Z');

test('maps the seven supported query types to bounded, documented control-platform requests', () => {
  assert.deepEqual(parseExecutionQuery('查询 HJY20260903-261 的缺料'), {
    path: '/external/material-kitting/shortages',
    params: { demand_no: 'HJY20260903-261', page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询 HJY20260903-261:18 的齐套'), {
    path: '/external/material-kitting/results',
    params: { demand_no: 'HJY20260903-261', demand_line_no: '18', page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询近3天的订单', now), {
    path: '/external/orders/list',
    params: { promised_date_start: '2026-10-12', promised_date_end: '2026-10-14', page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询物料 ABC-123 的库存'), {
    path: '/external/inventory/availability',
    params: { material_code: 'ABC-123', page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询近7天的供给', now), {
    path: '/external/material-supplies/list',
    params: { expected_date_start: '2026-10-08', expected_date_end: '2026-10-14', page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询近7天质量异常', now), {
    path: '/external/quality-issues/list',
    params: { occurred_start: '2026-10-08', occurred_end: '2026-10-14', page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询近7天生产工单', now), {
    path: '/external/production/work-orders/list',
    params: { planned_end_start: '2026-10-08', planned_end_end: '2026-10-14', page: 1, page_size: 20 },
  });
});

test('routes suppliers before generic supply and preserves explicit limits and pages', () => {
  assert.deepEqual(parseExecutionQuery('查询前5个供应商列表'), {
    path: '/external/suppliers/list', params: { page: 1, page_size: 5 },
  });
  assert.deepEqual(parseExecutionQuery('查询第2页前5个供应商列表'), {
    path: '/external/suppliers/list', params: { page: 2, page_size: 5 },
  });
});

test('maps complete, type-specific filters without truncating dotted model identifiers', () => {
  assert.deepEqual(parseExecutionQuery('查询型号为 3.1.JFX27-B1WA45-ZJ2-10-001 的库存，仓库 WH-01'), {
    path: '/external/inventory/availability',
    params: { keyword: '3.1.JFX27-B1WA45-ZJ2-10-001', wh_code: 'WH-01', page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询型号为3.1.JFX27-B1WA45-ZJ2-10-001的库存'), {
    path: '/external/inventory/availability',
    params: { keyword: '3.1.JFX27-B1WA45-ZJ2-10-001', page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询物料编码 3.1.JFX27-B1WA45-ZJ2-10-001 的缺料，只看关键料'), {
    path: '/external/material-kitting/shortages',
    params: { material_code: '3.1.JFX27-B1WA45-ZJ2-10-001', is_key_material: true, page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询订单 SO-2609-001 的高风险待评审订单'), {
    path: '/external/orders/list',
    params: { keyword: 'SO-2609-001', status: 'pending_review', risk_level: 'red', page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询物料编码 ABC-123 的采购和调拨供给，近7天', now), {
    path: '/external/material-supplies/list',
    params: { material_code: 'ABC-123', supply_type: 'PURCHASE,TRANSFER', expected_date_start: '2026-10-08', expected_date_end: '2026-10-14', page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询产品编码 P-100 的未关闭质量异常，近7天', now), {
    path: '/external/quality-issues/list',
    params: { product_code: 'P-100', status: 'open,in_progress', occurred_start: '2026-10-08', occurred_end: '2026-10-14', page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询工单 WO-001 的生产工单，车间 WS-01，进行中'), {
    path: '/external/production/work-orders/list',
    params: { work_order_no: 'WO-001', workshop: 'WS-01', status: 'in_progress', page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询订单 HJY20260903-261 的齐套，阻塞，高风险'), {
    path: '/external/material-kitting/results',
    params: { demand_no: 'HJY20260903-261', kit_status: 'BLOCKED', risk_level: 'red', page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询订单 HJY20260903-261 的齐套，缺料状态，2026-10-01 至 2026-10-07'), {
    path: '/external/material-kitting/results',
    params: { demand_no: 'HJY20260903-261', kit_status: 'SHORTAGE', required_date_start: '2026-10-01', required_date_end: '2026-10-07', page: 1, page_size: 20 },
  });
  assert.deepEqual(parseExecutionQuery('查询供应商 HJGY.877'), {
    path: '/external/suppliers/list', params: { keyword: 'HJGY.877', page: 1, page_size: 20 },
  });
});

test('rejects a model filter for endpoints that only support exact material codes', () => {
  assert.match(parseExecutionQuery('查询型号为 JFX27 的供给').error, /物料编码/);
});

test('rejects requests that would otherwise become an unbounded query', () => {
  for (const text of ['查询订单', '查询库存', '查询供给', '查询质量', '查询生产', '查询缺料', '查询齐套']) {
    const result = parseExecutionQuery(text, now);
    assert.ok('error' in result, text);
  }
  assert.match(parseExecutionQuery('查询近0天订单', now).error, /1–90/);
  assert.match(parseExecutionQuery('查询前101个供应商', now).error, /1–100/);
});

test('describes the bounded query scope before dispatch', () => {
  const result = parseExecutionQuery('查询近3天的订单', now);
  assert.ok(!('error' in result));
  assert.match(describeExecutionQuery(result), /2026-10-12/);
  assert.match(describeExecutionQuery(result), /最多 20 条/);
});

test('parseExecutionQueryByIntent 按 intent 关键词匹配非中台路径', () => {
  const intent = { paths: [{ path: '/api/boss/orders', label: '订单', keywords: ['订单', 'order'], params: [{ name: 'order_no', label: '订单号' }] }] };
  assert.deepEqual(parseExecutionQueryByIntent('查订单 BO-1001', intent), { path: '/api/boss/orders', params: { order_no: 'BO-1001' } });
});

test('parseExecutionQueryByIntent 无匹配时返回 null', () => {
  const intent = { paths: [{ path: '/api/boss/orders', label: '订单' }] };
  assert.equal(parseExecutionQueryByIntent('随便说点什么', intent), null);
});
