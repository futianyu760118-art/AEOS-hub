import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');
const css = readFileSync(join(root, 'public', 'style.css'), 'utf8');

test('执行步骤 API 与时间线已接入', () => {
  assert.match(app, /\/api\/execution\/runs\//);
  assert.match(app, /async function fetchRunEvents/);
  assert.match(app, /function executionTimelineHtml/);
  assert.match(app, /function attachExecutionSteps/);
  assert.match(app, /function renderAiRunDetail/);
});

test('借调详情提供运行详情与链路跳转，不再重复执行步骤', () => {
  assert.match(app, /btn-borrow-open-run/);
  assert.match(app, /btn-borrow-open-trace/);
  assert.doesNotMatch(app, /id="borrow-steps"/);
});

test('执行面等待中显示进度并支持取消', () => {
  assert.match(app, /execution-cancel-row/);
  assert.match(app, /取消分析/);
  assert.match(app, /\/recall/);
  assert.match(app, /execution-trace-link/);
  assert.match(app, /查看处理记录/);
  assert.match(app, /appendResultActions/);
  assert.match(app, /复制结论/);
  assert.match(app, /导出结论/);
});

test('链路追踪页时间线已接入，run 明细移至 AI 观测', () => {
  assert.match(app, /function renderTrace/);
  assert.match(app, /trace-timeline/);
  assert.match(app, /btn-trace-open-run/);
  assert.doesNotMatch(app, /class="trace-runs"/);
});

test('业务视图分层：管理模块可隐藏，技术信息可折叠', () => {
  assert.match(app, /const MANAGEMENT_VIEWS = new Set/);
  assert.match(app, /btn-view-mode/);
  assert.match(app, /function humanizeError/);
  assert.match(app, /borrow-tech/);
});

test('时间线只读：没有写请求', () => {
  const start = app.indexOf('// ---------- 执行步骤（中台上报的工序回执） ----------');
  const end = app.indexOf('function openPrompt');
  assert.ok(start > 0 && end > start);
  const block = app.slice(start, end);
  assert.doesNotMatch(block, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
});

test('时间线样式存在', () => {
  assert.match(css, /\.execution-timeline/);
  assert.match(css, /\.execution-step/);
});
