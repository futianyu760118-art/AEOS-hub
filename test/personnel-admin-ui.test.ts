import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildPersonnelCreateRequest,
  buildPersonnelResetRequest,
  buildPersonnelRolesRequest,
  onboardingConfigEntryVisible,
  personnelConfigEntryVisible,
  personnelFailureReason,
  personnelRolesAllowed,
  personnelSaveFeedback,
  personnelUiGate,
  PERSONNEL_PILOT_ROLES,
} from '../public/personnel-admin.js';

const app = readFileSync(join(process.cwd(), 'public', 'app.js'), 'utf8');
const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8');

const managerSession = { actorId: 'm01:user:manager-demo', actorType: 'human', tenantId: 'demo-tenant', organizationId: '订单交付组', roles: ['manager'] };
const g0Ready = { readyForG1: true, decisions: { firstScenario: { value: 'order_delivery_risk' }, scope: { value: { demoTenantId: 'demo-tenant', organizationScope: '订单交付组' } } } };

test('exposes personnel controls only to a human manager in the exact G0 scope', () => {
  assert.equal(personnelConfigEntryVisible(managerSession, g0Ready), true);
  assert.equal(personnelConfigEntryVisible({ ...managerSession, roles: ['operator'] }, g0Ready), false);
  assert.equal(personnelConfigEntryVisible({ ...managerSession, actorType: 'service' }, g0Ready), false);
  assert.equal(personnelConfigEntryVisible({ ...managerSession, actorType: 'agent' }, g0Ready), false);
  assert.equal(personnelConfigEntryVisible(managerSession, null), false);
  assert.equal(personnelConfigEntryVisible(managerSession, { ...g0Ready, readyForG1: false }), false);
  assert.equal(personnelConfigEntryVisible(managerSession, { ...g0Ready, decisions: { firstScenario: { value: 'other' }, scope: { value: { demoTenantId: 'demo-tenant', organizationScope: '订单交付组' } } } }), false);
  assert.equal(personnelConfigEntryVisible(managerSession, { ...g0Ready, decisions: { scope: { value: { demoTenantId: 'other', organizationScope: '订单交付组' } } } }), false);
  assert.equal(personnelConfigEntryVisible({ ...managerSession, organizationId: 'other-org' }, g0Ready), false);
  assert.equal(personnelUiGate({ ...managerSession, roles: ['operator'] }, g0Ready).code, 'MANAGER_ROLE_REQUIRED');
  assert.equal(personnelUiGate(managerSession, { ...g0Ready, decisions: { firstScenario: null, scope: g0Ready.decisions.scope } }).code, 'G0_SCENARIO_MISMATCH');
});

test('exposes three manager-only access-control modules under System Configuration', () => {
  assert.match(html, /id="personnel-config-entry"[\s\S]*打开用户管理/);
  assert.match(html, /id="role-config-entry"[\s\S]*打开角色管理/);
  assert.match(html, /id="permission-config-entry"[\s\S]*打开权限管理/);
  assert.match(html, /id="personnel-config-entry"[^>]*\bhidden\b/);
  assert.match(html, /id="view-personnel-admin"/);
  assert.match(html, /id="view-role-admin"/);
  assert.match(html, /id="view-permission-admin"/);
  const navigation = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  assert.doesNotMatch(navigation, /data-view="personnel-admin"/);
  assert.doesNotMatch(navigation, /data-view="role-admin"|data-view="permission-admin"/);
  assert.match(html, /OA 人员字段只读展示/);
  assert.match(html, /不显示、不保存、不记录密码/);
  assert.match(app, /data-role-permission/);
  assert.match(app, /data-role-delete/);
  assert.match(app, /data-permission-child/);
});

test('keeps browser identity and scope claims out of every request payload', () => {
  const create = buildPersonnelCreateRequest({
    username: 'newbie', temporaryPassword: 'pw', roles: ['operator'], email: 'a@b.c',
    actorId: 'agent:forged', tenantId: 'forged-tenant', organizationId: 'forged-org',
  });
  assert.deepEqual(Object.keys(create).sort(), ['email', 'roles', 'temporaryPassword', 'username']);
  assert.equal(Object.hasOwn(create, 'actorId'), false);
  assert.equal(Object.hasOwn(create, 'tenantId'), false);
  assert.equal(Object.hasOwn(create, 'organizationId'), false);

  const roles = buildPersonnelRolesRequest({ roles: ['manager'], actorId: 'forged', tenantId: 'forged' });
  assert.deepEqual(roles, { roles: ['manager'] });

  const reset = buildPersonnelResetRequest({ temporaryPassword: 'pw', actorId: 'forged' });
  assert.deepEqual(reset, { temporaryPassword: 'pw' });
});

test('limits account creation to pilot roles but permits safe custom-role assignment', () => {
  assert.deepEqual(PERSONNEL_PILOT_ROLES, ['manager', 'operator', 'owner']);
  assert.equal(personnelRolesAllowed(['manager', 'operator', 'owner']), true);
  assert.equal(personnelRolesAllowed(['realm-admin']), false);
  assert.equal(personnelRolesAllowed([]), false);
  assert.equal(personnelRolesAllowed('manager'), false);
  assert.throws(() => buildPersonnelCreateRequest({ username: 'x', temporaryPassword: 'pw', roles: ['realm-admin'] }), /只能分配/);
  assert.deepEqual(buildPersonnelRolesRequest({ roles: ['manager', 'quality_reviewer'] }), { roles: ['manager', 'quality_reviewer'] });
  assert.throws(() => buildPersonnelRolesRequest({ roles: ['realm-admin'] }), /有效角色/);
});

test('clears password fields after building create and reset requests', () => {
  // The DOM handlers must clear the temporary password immediately after the
  // request body is constructed so the value never lingers in the page.
  const createBlock = app.slice(app.indexOf('function submitPersonnelCreate'), app.indexOf('function submitPersonnelReset'));
  assert.match(createBlock, /buildPersonnelCreateRequest\([\s\S]*els\.personnelCreatePassword\.value = ''/);
  const resetBlock = app.slice(app.indexOf('function submitPersonnelReset'), app.indexOf('function togglePersonnelEnabled'));
  assert.match(resetBlock, /buildPersonnelResetRequest\([\s\S]*els\.personnelResetPassword\.value = ''/);
});

test('turns server denials and audit failure into safe, non-credential feedback', () => {
  assert.equal(personnelFailureReason({ error: 'personnel action forbidden' }, 403), 'personnel action forbidden');
  assert.equal(personnelFailureReason({ error: '目标用户不存在或不在当前范围' }, 404), '目标用户不存在或不在当前范围');
  assert.equal(personnelFailureReason({}, 503), 'HTTP 503');
  const failed = personnelSaveFeedback('failed');
  assert.match(failed.status, /Evidence 留痕未确认/);
  assert.match(failed.toast, /待核查/);
  assert.equal(failed.isError, true);
  assert.equal(personnelSaveFeedback('recorded').isError, false);
});

test('first-time onboarding appears only while G0 is not ready for a human manager', () => {
  const notReady = { ...g0Ready, readyForG1: false };
  assert.equal(onboardingConfigEntryVisible(managerSession, notReady), true);
  assert.equal(onboardingConfigEntryVisible(managerSession, g0Ready), false);
  assert.equal(onboardingConfigEntryVisible({ ...managerSession, roles: ['operator'] }, notReady), false);
  assert.equal(onboardingConfigEntryVisible({ ...managerSession, actorType: 'service' }, notReady), false);

  assert.match(html, /id="onboarding-config-entry"[\s\S]*开始应急开通/);
  assert.match(html, /id="onboarding-config-entry"[^>]*\bhidden\b/);
  assert.match(html, /id="view-personnel-onboarding"/);
  assert.match(html, /第 1 步 · 创建账号/);
  assert.match(html, /第 2 步 · 登记 G0 决策/);
});

test('onboarding and G0 scope use the authenticated session, never editable browser scope', () => {
  // G0 scope fields are read-only and derived from the session.
  assert.match(html, /id="g0-demo-tenant"[^>]*\breadonly\b/);
  assert.match(html, /id="g0-organization-scope"[^>]*\breadonly\b/);
  // The onboarding G0 form shows manager/tenant/organization as read-only code, not editable inputs.
  assert.match(html, /<code id="ob-g0-manager"/);
  assert.match(html, /<code id="ob-g0-tenant"/);
  assert.match(html, /<code id="ob-g0-organization"/);
  // The onboarding create rows never collect scope/actor identity.
  const createForm = html.slice(html.indexOf('id="onboarding-create-form"'), html.indexOf('id="onboarding-g0-form"'));
  assert.doesNotMatch(createForm, /tenant|organization|actorId/);
  assert.match(createForm, /ob-password/);
});

test('onboarding create step labels accounts by G0 role (Owner / Verify / operator), not Keycloak pilot role', () => {
  const createForm = html.slice(html.indexOf('id="onboarding-create-form"'), html.indexOf('id="onboarding-g0-form"'));
  assert.match(createForm, /业务 Owner/);
  assert.match(createForm, /核验人 Verify/);
  assert.match(createForm, /操作员 operator/);
  assert.match(createForm, /data-pilot-role="owner"/);
  assert.match(createForm, /data-pilot-role="operator"/);
  assert.doesNotMatch(createForm, /class="ob-role"/);
});

test('personnel list shows name with role badges, login name, and a delete action in a scrollable panel', () => {
  assert.match(app, /role-badge/);
  assert.match(app, /登录名/);
  assert.match(app, /data-personnel-delete/);
  const style = readFileSync(join(process.cwd(), 'public', 'style.css'), 'utf8');
  assert.match(style, /\.personnel-list\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(style, /\.btn\.danger/);
});
