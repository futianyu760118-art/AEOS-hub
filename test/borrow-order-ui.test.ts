import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');
const css = readFileSync(join(root, 'public', 'style.css'), 'utf8');

test('导航与视图存在', () => {
  assert.match(html, /data-view="borrow"/);
  assert.match(html, /id="view-borrow"/);
  assert.match(html, /id="btn-borrow-refresh"/);
  assert.match(html, /id="btn-borrow-collapse"/);
  assert.match(html, /id="borrow-list"/);
  assert.match(html, /id="borrow-detail"/);
  assert.match(html, /id="borrow-status-filter"/);
});

test('详情可收起且结果表格化', () => {
  assert.match(app, /function clearBorrowSelection\(\)/);
  assert.match(app, /function renderBorrowResultTable\(/);
  assert.match(app, /再次点击或点「收起」关闭/);
});

test('视图注册与懒加载', () => {
  assert.match(app, /view: 'borrow', label: '跨系统借调'/);
  assert.match(app, /if \(view === 'borrow'\) loadBorrowOrders\(\);/);
  assert.match(app, /function syncBorrowRefresh\(\)/);
  assert.match(app, /'route', 'borrow'/);
});

test('借调视图只读：没有写请求与操作按钮', () => {
  const start = app.indexOf('// ---------- 跨系统借调（只读监控） ----------');
  const end = app.indexOf('let routeControlsWired');
  assert.ok(start > 0 && end > start);
  const block = app.slice(start, end);
  assert.doesNotMatch(block, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
  assert.doesNotMatch(block, /btn-borrow-(create|cancel|retry)/);
});

test('缓存版本号符合约定', () => {
  assert.match(html, /style\.css\?v=[a-z0-9-]+/);
  assert.match(html, /app\.js\?v=[a-z0-9-]+/);
  assert.match(html, /borrow-ui-20261019/);
});

test('借调视图样式存在', () => {
  assert.match(css, /\.borrow-table/);
  assert.match(css, /\.borrow-row/);
  assert.match(css, /\.borrow-json/);
});
