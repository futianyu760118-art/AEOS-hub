import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const app = readFileSync(join(process.cwd(), 'public', 'app.js'), 'utf8');
const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8');

test('证据列表中文化：类型与摘要用中文展示', () => {
  assert.match(app, /EVIDENCE_KIND_LABELS/);
  assert.match(app, /app_event: '业务事件'/);
  assert.match(app, /function humanizeEvidenceSummary/);
  assert.match(app, /'borrow order created', '借调单创建'/);
  assert.match(app, /'write request approved', '写请求已批准'/);
  assert.match(app, /humanizeEvidenceSummary\(row\.summary/);
});

test('证据页指标与视图存在', () => {
  assert.match(html, /id="view-evidence"/);
  assert.match(html, /id="evidence-list"/);
  assert.doesNotMatch(html, /JSONL 事件/);
});
