import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const app = readFileSync(join(process.cwd(), 'public', 'app.js'), 'utf8');
const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8');
const helperStart = app.indexOf('export function g0CanRecord');
const helperEnd = app.indexOf('\nfunction g0ManagerCanRecord', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'G0 pure helper block must be available to UI tests');
const helpers = new Function(`${app.slice(helperStart, helperEnd).replaceAll('export ', '')}\nreturn { g0CanRecord, g0ConfigEntryVisible, g0DecisionDisplay, escapeG0Text, renderG0HistoryMarkup, buildG0DecisionRequest, g0ApiFailureReason, g0SaveFeedback };`)();

test('G0 decision view presents missing choices and a readiness result', () => {
  assert.match(html, /id="view-g0-governance"/);
  const incomplete = helpers.g0DecisionDisplay({ readyForG1: false, decisions: {}, history: [] });
  const ready = helpers.g0DecisionDisplay({ readyForG1: true, decisions: { firstScenario: { value: 'order_delivery_risk' } }, history: [] });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.entries.filter(([, choice]) => !choice).length, 5);
  assert.equal(ready.ready, true);
  assert.match(app, /已完成初始化/);
});

test('G0 governance is a manager-only system setting, not day-to-day navigation', () => {
  assert.equal(helpers.g0CanRecord({ roles: ['operator'] }), false);
  assert.equal(helpers.g0CanRecord({ roles: ['manager'] }), true);
  assert.equal(helpers.g0CanRecord({ roles: 'manager' }), false);
  assert.equal(helpers.g0ConfigEntryVisible({ roles: ['operator'] }), false);
  assert.equal(helpers.g0ConfigEntryVisible({ roles: ['manager'] }), true);
  assert.match(html, /id="g0-config-entry"[\s\S]*打开试点初始化/);
  assert.match(html, /id="g0-config-entry"[^>]*\bhidden\b/);
  const navigation = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  assert.doesNotMatch(navigation, /data-view="g0-governance"/);
  const commandCatalog = app.slice(app.indexOf('const commands = ['), app.indexOf('];', app.indexOf('const commands = [')));
  assert.doesNotMatch(commandCatalog, /g0-governance/);
  assert.match(html, /id="g0-business-owner"/);
  assert.match(html, /不创建账号、不分配角色/);
  assert.doesNotMatch(html, /已创建 Keycloak 账号|已对接 M02|已派发 Agent|已执行业务操作/);
});

test('G0 PUT request includes only controlled decision fields and no browser identity assertion', () => {
  const request = helpers.buildG0DecisionRequest({
    firstScenario: 'order_delivery_risk', businessOwnerActorId: 'owner-demo', verifyActorId: 'verify-demo',
    demoTenantId: 'demo-tenant', organizationScope: '订单交付', managerActorId: 'manager-demo',
    operatorActorId: 'operator-demo', ownerActorId: 'owner-demo', m02OwnerActorId: 'owner-demo',
    taskStoreDecision: 'reuse_existing_task_center', g4Admission: 'blocked_until_g1', note: '冻结 G0 决策',
    actorId: 'forged', tenantId: 'forged-tenant', roles: ['manager'],
  });
  const body = JSON.stringify(request);
  assert.deepEqual(Object.keys(request).sort(), ['note', 'patch']);
  assert.doesNotMatch(body, /"actorId"|"tenantId"|"roles"/);
  assert.equal(request.patch.businessOwnerActorId, 'owner-demo');
  assert.throws(() => helpers.buildG0DecisionRequest({ businessOwnerActorId: 'same', verifyActorId: 'same', note: 'x' }), /必须不同/);
});

test('G0 UI retains API 400/403 reasons and makes audit failure a warning rather than success feedback', () => {
  assert.equal(helpers.g0ApiFailureReason({ error: 'invalid governance request' }, 400), 'invalid governance request');
  assert.equal(helpers.g0ApiFailureReason({ error: 'manager role required' }, 403), 'manager role required');
  const feedback = helpers.g0SaveFeedback('failed');
  assert.match(feedback.status, /登记已保存/);
  assert.match(feedback.toast, /待核查/);
  assert.equal(feedback.isError, true);
  assert.equal(helpers.g0SaveFeedback('recorded').isError, false);
});

test('G0 history values are escaped before being placed in rendered markup', () => {
  const markup = helpers.renderG0HistoryMarkup([{
    field: '<script>', decidedAt: '<time>', note: '<img src=x onerror=1>', actorId: '<actor>', tenantId: '<tenant>', revision: '<revision>',
  }]);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /&lt;img src=x onerror=1&gt;/);
  assert.doesNotMatch(markup, /<script>|<img/);
});
