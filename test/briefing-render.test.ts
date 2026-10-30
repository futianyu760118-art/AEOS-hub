import assert from 'node:assert/strict';
import test from 'node:test';
import { renderBriefingMarkdown } from '../public/briefing-render.js';
import { buildDailyBriefing, formatDailyBriefingMarkdown } from '../src/daily-briefing.ts';

const ROWS = [
  { demand_no: 'HJ202609-0017-0207', demand_line_no: '1', required_date: '2026-10-30', affected_order_amount: 115600, shortage_item_count: 18, kit_rate_by_item: 41.94 },
  { demand_no: 'HJ202608-0011-0176', demand_line_no: '1', required_date: '2026-10-30', affected_order_amount: 9360, shortage_item_count: 12, kit_rate_by_item: 69.23 },
];

function renderSampleBriefing(): string {
  const brief = buildDailyBriefing({
    rows: ROWS,
    windowEnd: '2026-10-30',
    dataAsOf: '2026-10-30T08:00:00+08:00',
    confidence: 'high',
    generatedAt: '2026-10-30T08:05:00.000Z',
  });
  return renderBriefingMarkdown(formatDailyBriefingMarkdown(brief));
}

test('简报渲染成真实表格，表头与数据列一一对应', () => {
  const html = renderSampleBriefing();
  assert.match(html, /<table class="briefing-table">/);
  const headers = [...html.matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1]);
  assert.deepEqual(headers, ['订单号', '行', '需求日期', '影响金额', '缺料项', '齐套率', '预计齐套', '依据']);

  const tbody = /<tbody>(.*?)<\/tbody>/.exec(html)?.[1] ?? '';
  const bodyRows = tbody.split('</tr>').filter((row) => row.includes('<td'));
  assert.equal(bodyRows.length, 2);
  for (const row of bodyRows) {
    assert.equal((row.match(/<td/g) ?? []).length, headers.length, '每行列数必须与表头一致');
  }

  const cells = [...(bodyRows[0] ?? '').matchAll(/<td([^>]*)>(.*?)<\/td>/g)];
  assert.equal(cells[0]?.[2], 'HJ202609-0017-0207');
  assert.match(cells[3]?.[1] ?? '', /num/, '金额列右对齐');
  assert.equal(cells[3]?.[2], '¥115,600.00');
  assert.match(cells[7]?.[1] ?? '', /evidence/, '依据列使用等宽样式');
  assert.equal(cells[7]?.[2], 'control-platform://kitting/result/HJ202609-0017-0207:1');
});

test('正文转义 HTML，单元格内的竖线不被当成列分隔', () => {
  const html = renderBriefingMarkdown([
    '## 数据说明',
    '',
    '- 含 <script>alert(1)</script>',
    '',
    '| A | B |',
    '| --- | --- |',
    '| x\\|y | <img src=x> |',
  ].join('\n'));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const cells = [...html.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((match) => match[1]);
  assert.deepEqual(cells, ['x|y', '&lt;img src=x&gt;']);
});

test('空简报不产生表格', () => {
  assert.equal(renderBriefingMarkdown(''), '');
  assert.equal(renderBriefingMarkdown('   \n\n'), '');
});
