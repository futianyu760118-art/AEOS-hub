import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');
const css = readFileSync(join(root, 'public', 'style.css'), 'utf8');

test('AI 观测导航与两个标签页存在', () => {
  assert.match(html, /data-view="ai-obs"/);
  assert.match(html, /id="view-ai-obs"/);
  assert.match(html, /data-ai-tab="runs"/);
  assert.match(html, /data-ai-tab="assistants"/);
  assert.match(html, /id="ai-run-list"/);
  assert.match(html, /id="ai-run-detail"/);
  assert.match(html, /id="assistant-traces"/);
  assert.match(html, /id="assistant-status-filter"/);
  assert.match(html, /id="assistant-time-filter"/);
  assert.match(html, /id="assistant-search"/);
  assert.match(html, /id="btn-ai-obs-refresh"/);
});

test('助手会话列表与详情重新设计', () => {
  assert.match(app, /assistant-trace-item/);
  assert.match(app, /assistantTraceTitle/);
  assert.match(app, /assistantTraceDuration/);
  assert.match(app, /assistant-detail-summary/);
  assert.match(app, /assistantFilters/);
  assert.match(app, /用量未上报/);
  assert.match(html, /id="assistant-failures"/);
  assert.match(html, /id="assistant-failures-count"/);
  assert.match(app, /function renderAssistantFailures/);
  assert.match(app, /data-failure-trace/);
});

test('视图注册、两个标签页数据加载与轮询', () => {
  assert.match(app, /view: 'ai-obs', label: 'AI 观测'/);
  assert.match(app, /if \(view === 'ai-obs'\) loadAiObs\(\);/);
  assert.match(app, /function loadAiRuns\(\)/);
  assert.match(app, /function loadAssistantEvents\(\)/);
  assert.match(app, /function syncAiObsRefresh\(\)/);
  assert.match(app, /\/api\/execution\/agents/);
  assert.match(app, /\/api\/borrow-orders/);
});

test('AI 观测为只读：没有写请求', () => {
  const start = app.indexOf('// ---------- AI 观测（统一总览：Hub 派单任务 / 各系统助手） ----------');
  const end = app.indexOf('let routeControlsWired');
  assert.ok(start > 0 && end > start);
  const block = app.slice(start, end);
  assert.doesNotMatch(block, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
});

test('Hub 派单任务复用执行步骤时间线', () => {
  assert.match(app, /function renderAiRunDetail\(\)/);
  assert.match(app, /executionTimelineHtml\(events\)/);
  assert.match(app, /fetchRunEvents\(run\.runId\)/);
});

test('样式与版本号', () => {
  assert.match(css, /\.ai-obs-tabs/);
  assert.match(css, /\.ai-run-table/);
  assert.match(css, /\.assistant-trace-item/);
  assert.match(css, /\.assistant-failure-item/);
  assert.match(html, /ai-obs-one-failure-20261019/);
});
