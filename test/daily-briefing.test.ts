import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDailyBriefing, formatDailyBriefingMarkdown } from '../src/daily-briefing.ts';

const WINDOW_END = '2026-10-29';

const ROWS = [
  { demand_no: 'A', demand_line_no: '1', required_date: '2026-10-29', affected_order_amount: 100, shortage_item_count: 3, kit_rate_by_item: 50, estimated_kit_date: null },
  { demand_no: 'A', demand_line_no: '2', required_date: '2026-10-20', affected_order_amount: 150, shortage_item_count: 4, kit_rate_by_item: 40 },
  { demand_no: 'B', demand_line_no: '1', required_date: '2026-06-30', affected_order_amount: 300, shortage_item_count: 6 },
  { demand_no: 'C', demand_line_no: '1', required_date: '2026-11-05', affected_order_amount: 999 },
  { demand_no: 'D', demand_line_no: '1', required_date: '', affected_order_amount: 1 },
];

test('简报只统计今天到期与已逾期，并按订单去重金额', () => {
  const brief = buildDailyBriefing({
    rows: ROWS,
    windowEnd: WINDOW_END,
    dataAsOf: '2026-10-25T20:33:59.415427',
    confidence: 'low',
    stale: true,
    generatedAt: '2026-10-29T08:00:00.000Z',
  });
  assert.equal(brief.totals.rows, 3);
  assert.equal(brief.totals.orders, 2);
  assert.equal(brief.totals.affectedAmount, 450);
  assert.equal(brief.totals.dueToday, 1);
  assert.equal(brief.totals.overdue, 2);
  assert.deepEqual(brief.top.map((item) => `${item.orderNo}:${item.lineNo}`), ['B:1', 'A:2', 'A:1']);
  assert.equal(brief.top[0]?.evidenceRef, 'control-platform://kitting/result/B:1');
  assert.ok(brief.warnings.some((warning) => warning.includes('缺少需求日期')));
  assert.ok(brief.warnings.some((warning) => warning.includes('需求日期在 2026-10-29 之后')));
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
  assert.match(markdown, /需求日期 ≤ 2026-10-29/);
  assert.match(markdown, /2026-10-25T20:33:59.415427（已过期）/);
  assert.match(markdown, /查询置信度：low/);
  assert.match(markdown, /¥450\.00/);
  assert.match(markdown, /control-platform:\/\/kitting\/result\/B:1/);
  assert.match(markdown, /只读生成，未修改任何业务数据/);
});

test('窗口日期非法时拒绝生成', () => {
  assert.throws(() => buildDailyBriefing({ rows: [], windowEnd: '2026/10/29' }), /windowEnd/);
});
