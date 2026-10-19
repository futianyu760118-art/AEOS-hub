import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');
const css = readFileSync(join(root, 'public', 'style.css'), 'utf8');

test('助手观测导航与视图存在', () => {
  assert.match(html, /data-view="assistant"/);
  assert.match(html, /id="view-assistant"/);
  assert.match(html, /id="btn-assistant-refresh"/);
  assert.match(html, /id="assistant-traces"/);
  assert.match(html, /id="assistant-detail"/);
  assert.match(html, /id="assistant-system-filter"/);
});

test('视图注册、懒加载与轮询', () => {
  assert.match(app, /view: 'assistant', label: '助手观测'/);
  assert.match(app, /if \(view === 'assistant'\) loadAssistantEvents\(\);/);
  assert.match(app, /function syncAssistantRefresh\(\)/);
  assert.match(app, /\/api\/assistant-events/);
});

test('助手观测为只读：没有写请求', () => {
  const start = app.indexOf('// ---------- 助手观测（中台自有助手主动上报） ----------');
  const end = app.indexOf('let routeControlsWired');
  assert.ok(start > 0 && end > start);
  const block = app.slice(start, end);
  assert.doesNotMatch(block, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
});

test('时间线展示模型用量', () => {
  assert.match(app, /event\.usage/);
  assert.match(app, /formatUsageCost/);
});

test('样式与版本号', () => {
  assert.match(css, /\.assistant-trace-table/);
  assert.match(html, /assistant-obs-20261019/);
});
