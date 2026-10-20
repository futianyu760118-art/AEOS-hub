import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('Agent 小队导航、页面与加入弹窗已退役', () => {
  const html = readFileSync(join(root, 'public', 'index.html'), 'utf8');
  const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');

  assert.doesNotMatch(html, /data-view="squad"/);
  assert.doesNotMatch(html, /id="view-squad"/);
  assert.doesNotMatch(html, /id="squad-modal"/);
  assert.doesNotMatch(html, /Agent 小队/);

  assert.doesNotMatch(app, /function renderSquad\(/);
  assert.doesNotMatch(app, /function renderBusinessSquadDetail\(/);
  assert.doesNotMatch(app, /function openSquadConversationSpace\(/);
  assert.doesNotMatch(app, /submitBusinessSquadDetail/);
  assert.doesNotMatch(app, /data-business-squad-id/);
});

test('派单校验改为服务业务域，不再依赖小队归属', () => {
  const server = readFileSync(join(root, 'src', 'server.ts'), 'utf8');
  assert.match(server, /harborAgent\?\.domainIds\?\.includes\(domainId\)/);
  assert.doesNotMatch(server, /member\?\.squadId === 'business-squad-/);
  assert.match(server, /服务域包含订单交付/);
});

test('小队存储不再自愈补种四个业务小队', () => {
  const store = readFileSync(join(root, 'src', 'agent-squad-store.ts'), 'utf8');
  assert.doesNotMatch(store, /migrateBusinessSquads/);
  assert.doesNotMatch(store, /business-squad-orders/);
  assert.doesNotMatch(store, /squadMemories: \[/);
});
