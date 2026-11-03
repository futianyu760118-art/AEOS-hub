import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDailyBriefing, formatBriefingOrderPrompt, formatDailyBriefingMarkdown, selectBriefingDispatchOrders } from '../src/daily-briefing.ts';

const WINDOW_END = '2026-10-29';

const ROWS = [
  { demand_no: 'A', demand_line_no: '1', required_date: '2026-10-29', affected_order_amount: 100, shortage_item_count: 3, kit_rate_by_item: 50, estimated_kit_date: null },
  { demand_no: 'E', demand_line_no: '1', required_date: '2026-10-29 00:00:00', affected_order_amount: 50, shortage_item_count: 1, kit_rate_by_item: 80 },
  { demand_no: 'A', demand_line_no: '2', required_date: '2026-10-20', affected_order_amount: 150, shortage_item_count: 4, kit_rate_by_item: 40 },
  { demand_no: 'B', demand_line_no: '1', required_date: '2026-06-30', affected_order_amount: 300, shortage_item_count: 6 },
  { demand_no: 'C', demand_line_no: '1', required_date: '2026-11-05', affected_order_amount: 999 },
  { demand_no: 'D', demand_line_no: '1', required_date: '', affected_order_amount: 1 },
];

test('简报只统计今天到期的齐套行，逾期与未来日期都不纳入', () => {
  const brief = buildDailyBriefing({
    rows: ROWS,
    windowEnd: WINDOW_END,
    dataAsOf: '2026-10-25T20:33:59.415427',
    confidence: 'low',
    stale: true,
    generatedAt: '2026-10-29T08:00:00.000Z',
  });
  assert.equal(brief.totals.rows, 2);
  assert.equal(brief.totals.orders, 2);
  assert.equal(brief.totals.affectedAmount, 150);
  assert.deepEqual(brief.top.map((item) => `${item.orderNo}:${item.lineNo}`), ['A:1', 'E:1']);
  assert.equal(brief.top[0]?.evidenceRef, 'control-platform://kitting/result/A:1');
  assert.ok(brief.warnings.some((warning) => warning.includes('缺少需求日期')));
  assert.ok(brief.warnings.some((warning) => warning.includes('需求日期在 2026-10-29 之后')));
  assert.ok(brief.warnings.some((warning) => warning.includes('需求日期早于 2026-10-29')));
});

test('Markdown 简报写明口径、快照与依据', () => {
  const brief = buildDailyBriefing({
    rows: ROWS,
    windowEnd: WINDOW_END,
    dataAsOf: '2026-10-25T20:33:59.415427',
    confidence: 'low',
    stale: true,
    generatedAt: '2026-10-29T08:00:00.000Z',
  });
  const markdown = formatDailyBriefingMarkdown(brief);
  assert.match(markdown, /需求日期 = 2026-10-29（仅统计今天到期）/);
  assert.doesNotMatch(markdown, /已逾期/);
  assert.match(markdown, /2026-10-25T20:33:59.415427（已过期）/);
  assert.match(markdown, /查询置信度：low/);
  assert.match(markdown, /¥150\.00/);
  assert.match(markdown, /control-platform:\/\/kitting\/result\/A:1/);
  assert.match(markdown, /只读生成，未修改任何业务数据/);
});

test('分发按订单去重、按影响金额排序并受上限约束', () => {
  const brief = buildDailyBriefing({ rows: ROWS, windowEnd: WINDOW_END });
  assert.deepEqual(selectBriefingDispatchOrders(brief, 3), ['A', 'E']);
  assert.deepEqual(selectBriefingDispatchOrders(brief, 1), ['A']);
});

test('单订单分发的提示词只带该订单的风险行与只读约束', () => {
  const brief = buildDailyBriefing({
    rows: ROWS,
    windowEnd: WINDOW_END,
    dataAsOf: '2026-10-25T20:33:59.415427',
    confidence: 'low',
    stale: true,
  });
  const prompt = formatBriefingOrderPrompt(brief, 'A');
  assert.match(prompt, /需求日期 = 2026-10-29，仅统计今天到期/);
  assert.match(prompt, /订单 A 的风险行/);
  assert.match(prompt, /影响金额合计 ¥150\.00/);
  assert.match(prompt, /行 1，需求日期 2026-10-29，影响金额 ¥100\.00/);
  assert.match(prompt, /control-platform:\/\/kitting\/result\/A:1/);
  assert.doesNotMatch(prompt, /订单 E 的风险行/);
  assert.match(prompt, /不得执行任何写操作/);
  assert.match('business://order/A', /^business:\/\/(order|product|batch)\/[^\s]+$/);
});

test('窗口日期非法时拒绝生成', () => {
  assert.throws(() => buildDailyBriefing({ rows: [], windowEnd: '2026/10/29' }), /windowEnd/);
});
