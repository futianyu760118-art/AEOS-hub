import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8');
const app = readFileSync(join(process.cwd(), 'public', 'app.js'), 'utf8');

test('role management exposes scoped metrics, search, permissions and guarded deletion', () => {
  const view = html.slice(html.indexOf('id="view-role-admin"'), html.indexOf('id="view-permission-admin"'));
  assert.match(view, /role-metrics/);
  assert.match(view, /role-search/);
  assert.match(view, /新增角色/);
  assert.match(app, /data-role-permission/);
  assert.match(app, /data-role-delete/);
  assert.match(app, /role\.protected \|\| role\.userCount > 0/);
});

test('permission management renders the required resource-tree columns and mutations', () => {
  assert.match(app, /<th>名称<\/th><th>编码<\/th><th>路由<\/th><th>操作集<\/th><th>排序<\/th><th>启用<\/th><th>操作<\/th>/);
  assert.match(app, /\['create', 'read', 'update', 'delete'\]/);
  assert.match(app, /data-permission-child/);
  assert.match(app, /data-permission-expand/);
  assert.match(app, /data-permission-toggle/);
  assert.match(app, /data-permission-edit/);
  assert.match(app, /data-permission-delete/);
  assert.match(html, /id="permission-edit-parent"/);
});

test('user management identifies OA projections as read-only and prevents OA deletion', () => {
  assert.match(html, /OA 人员字段只读展示/);
  assert.match(app, /user\.identitySource === 'oa'/);
  assert.match(app, /OA 同步用户不可在 Hub 删除/);
  assert.match(app, /departmentName/);
  assert.match(app, /positionName/);
});

