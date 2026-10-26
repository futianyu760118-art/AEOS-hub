import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');
const css = readFileSync(join(root, 'public', 'style.css'), 'utf8');

test('运行监控导航与视图存在', () => {
  assert.match(html, /data-view="ops"/);
  assert.match(html, /id="view-ops"/);
  assert.match(html, /id="btn-ops-refresh"/);
  assert.match(html, /id="ops-checks"/);
  assert.match(html, /id="ops-alerts"/);
  assert.match(html, /id="ops-agents"/);
});

test('视图注册、懒加载与轮询', () => {
  assert.match(app, /view: 'ops', label: '运行状态'/);
  assert.match(app, /if \(view === 'ops'\) loadOps\(\);/);
  assert.match(app, /function syncOpsRefresh\(\)/);
  assert.match(app, /\/api\/ops\/status/);
  assert.match(app, /OPS_LIVE_REFRESH_MS/);
});

test('运行监控为只读：没有写请求', () => {
  const start = app.indexOf('// ---------- 运行监控（只读） ----------');
  const end = app.indexOf('let routeControlsWired');
  assert.ok(start > 0 && end > start);
  const block = app.slice(start, end);
  assert.doesNotMatch(block, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
});

test('监控样式存在', () => {
  assert.match(css, /\.ops-check-table/);
  assert.match(css, /\.ops-alert-table/);
});

test('资源版本号已更新', () => {
  assert.match(html, /href="\/style\.css\?v=[^"]+"/);
  assert.match(html, /src="\/app\.js\?v=[^"]+"/);
});

test('模型解析失败会提示用户', () => {
  assert.match(app, /模型解析失败：/);
  assert.match(app, /已使用关键词规则回退/);
});
