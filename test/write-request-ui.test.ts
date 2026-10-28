import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const app = readFileSync(join(process.cwd(), 'public', 'app.js'), 'utf8');
const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8');

test('写操作页面与导航存在', () => {
  assert.match(html, /data-view="writes"/);
  assert.match(html, /id="view-writes"/);
  assert.match(html, /id="write-request-form"/);
  assert.match(html, /id="write-pending-list"/);
  assert.match(html, /id="write-history-list"/);
  assert.match(app, /view: 'writes'/);
  assert.match(app, /LOCALLY_HIDDEN_VIEWS = new Set\(\[[^\]]*'writes'/);
  assert.match(app, /if \(view === 'writes'\) loadWrites\(\)/);
});

test('写操作调用能力、提交与审批接口', () => {
  assert.match(app, /\/api\/write-requests\/capabilities/);
  assert.match(app, /\/api\/write-requests'/);
  assert.match(app, /function decideWriteRequest/);
  assert.match(app, /action === 'approve'/);
  assert.match(app, /action === 'reject'/);
  assert.match(app, /data-write-approve/);
  assert.match(app, /data-write-reject/);
  assert.match(app, /type: 'write_decision'/);
  assert.match(app, /writeConfirmation/);
  assert.match(app, /data-write-confirm/);
  assert.match(app, /write-confirm-actions/);
});

test('写操作状态与操作类型有中文文案', () => {
  assert.match(app, /pending_approval: '待审批'/);
  assert.match(app, /completed: '已完成'/);
  assert.match(app, /'order.update_note': '订单备注'/);
  assert.match(app, /'order.update_status': '订单状态'/);
});
