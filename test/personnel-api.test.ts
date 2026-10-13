import assert from 'node:assert/strict';
import test from 'node:test';
import { PersonnelApi } from '../src/personnel-api.ts';
import {
  KeycloakPersonnelAdmin,
  KeycloakPersonnelError,
  KeycloakPersonnelPartialCommitError,
  type PersonnelUser,
} from '../src/keycloak-personnel-admin.ts';

const manager = {
  actorId: 'm01:user:manager-demo',
  actorType: 'human' as const,
  tenantId: 'demo-tenant',
  organizationId: '订单交付组',
  roles: ['manager'],
};

// Minimal structural store helper (type erased at runtime).
function store(load: () => any) {
  return { load } as any;
}

function userOf(id: string, roles: string[] = ['operator'], enabled = true): PersonnelUser {
  return { id, actorId: `m01:user:${id}`, username: id, enabled, tenantId: 'demo-tenant', organizationId: '订单交付组', roles: roles as PersonnelUser['roles'] };
}

function fakeAdmin(overrides: Record<string, unknown> = {}) {
  const base = {
    listUsers: async () => [userOf('op1')],
    getUser: async () => { throw new KeycloakPersonnelError('not_found'); },
    createUser: async (_scope: unknown, input: { username: string; roles: string[] }) => userOf('u-new', input.roles),
    updateUser: async (_scope: unknown, id: string, input: { enabled?: boolean }) => userOf(id, ['operator'], input.enabled ?? true),
    resetTemporaryPassword: async (_scope: unknown, id: string) => userOf(id),
    setHubRoles: async (_scope: unknown, id: string, roles: string[]) => userOf(id, roles),
  };
  return { ...base, ...overrides } as unknown as KeycloakPersonnelAdmin;
}

function fixture(overrides: { admin?: Record<string, unknown>; storeLoad?: () => unknown; appendEvidence?: (input: unknown) => unknown } = {}) {
  const evidence: unknown[] = [];
  const api = new PersonnelApi({
    admin: overrides.admin ? fakeAdmin(overrides.admin) : fakeAdmin(),
    g0DecisionStore: store(overrides.storeLoad ?? (() => ({
      readyForG1: true,
      decisions: {
        firstScenario: { value: 'order_delivery_risk' },
        scope: { value: { demoTenantId: 'demo-tenant', organizationScope: '订单交付组' } },
      },
    }))),
    appendEvidence: overrides.appendEvidence ?? ((entry) => { evidence.push(entry); }),
  });
  return { api, evidence };
}

test('returns null for non-personnel routes and requires an authenticated, enabled boundary', async () => {
  const { api } = fixture();
  assert.equal(await api.handle({ method: 'GET', pathname: '/api/tasks', actor: manager }), null);

  const unauthenticated = await api.handle({ method: 'GET', pathname: '/api/system/personnel/users', actor: null });
  assert.equal(unauthenticated?.status, 401);

  const disabled = new PersonnelApi({ admin: null, g0DecisionStore: store(() => ({})), appendEvidence: () => undefined });
  assert.equal((await disabled.handle({ method: 'GET', pathname: '/api/system/personnel/users', actor: manager }))?.status, 503);
});

test('list requires a manager in the G0 scope and returns scoped projections', async () => {
  const { api, evidence } = fixture();
  const response = await api.handle({ method: 'GET', pathname: '/api/system/personnel/users', actor: manager });
  assert.equal(response?.status, 200);
  assert.equal((response?.body.users as PersonnelUser[]).length, 1);

  const operator = { ...manager, roles: ['operator'] };
  const denied = await api.handle({ method: 'GET', pathname: '/api/system/personnel/users', actor: operator });
  assert.equal(denied?.status, 403);
  assert.equal((evidence.at(-1) as { payload: { policyCode: string } }).payload.policyCode, 'MANAGER_ROLE_REQUIRED');
});

test('rejects G0-not-ready or scope-mismatched actors', async () => {
  const { api } = fixture({ storeLoad: () => ({ readyForG1: false, decisions: { scope: { value: null } } }) });
  const response = await api.handle({ method: 'GET', pathname: '/api/system/personnel/users', actor: manager });
  assert.equal(response?.status, 403);
  assert.equal((response?.body as { error: string }).error, 'personnel action forbidden');
});

test('create uses only the server scope and ignores forged body identity and scope', async () => {
  const created: Array<{ scope: unknown; input: Record<string, unknown> }> = [];
  const { api, evidence } = fixture({
    admin: {
      createUser: async (scope: unknown, input: Record<string, unknown>) => {
        created.push({ scope, input });
        return userOf('u-new', input.roles as string[]);
      },
    },
  });

  const response = await api.handle({
    method: 'POST',
    pathname: '/api/system/personnel/users',
    actor: manager,
    body: {
      username: 'newbie',
      temporaryPassword: 's3cret-pw',
      roles: ['operator'],
      // Forged identity/scope must be ignored.
      actorId: 'agent:forged',
      tenantId: 'forged-tenant',
      organizationId: 'forged-org',
    },
  });

  assert.equal(response?.status, 201);
  assert.deepEqual(created[0]?.scope, { demoTenantId: 'demo-tenant', organizationScope: '订单交付组' });
  assert.equal(created[0]?.input.username, 'newbie');
  assert.equal(created[0]?.input.roles[0], 'operator');
  assert.doesNotMatch(JSON.stringify(created), /forged-tenant|forged-org|agent:forged/);
  assert.doesNotMatch(JSON.stringify(evidence), /forged-tenant|forged-org|agent:forged|s3cret-pw/);
  assert.doesNotMatch(JSON.stringify(response?.body), /s3cret-pw/);
});

test('treats a cross-scope target user as nonexistent with a user-safe 404', async () => {
  const { api } = fixture({ admin: { getUser: async () => { throw new KeycloakPersonnelError('not_found'); } } });
  const response = await api.handle({
    method: 'PATCH', pathname: '/api/system/personnel/users/outsider', actor: manager,
    body: { enabled: false },
  });
  assert.equal(response?.status, 404);
  assert.equal((response?.body as { error: string }).error, '目标用户不存在或不在当前范围');
});

test('denies self-disable and self-de-role', async () => {
  const selfUser = userOf('manager-demo', ['manager']);
  const { api } = fixture({
    admin: {
      getUser: async () => selfUser,
      listUsers: async () => [selfUser],
    },
  });

  const disable = await api.handle({
    method: 'PATCH', pathname: '/api/system/personnel/users/manager-demo', actor: manager, body: { enabled: false },
  });
  assert.equal(disable?.status, 403);
  assert.equal((disable?.body as { error: string }).error, 'personnel action forbidden');

  const deRole = await api.handle({
    method: 'PUT', pathname: '/api/system/personnel/users/manager-demo/roles', actor: manager, body: { roles: ['operator'] },
  });
  assert.equal(deRole?.status, 403);
});

test('protects the last active manager in scope from disable and de-role', async () => {
  const otherManager = userOf('other-manager', ['manager']);
  const { api } = fixture({
    admin: {
      getUser: async () => otherManager,
      listUsers: async () => [otherManager],
    },
  });

  const disable = await api.handle({
    method: 'PATCH', pathname: '/api/system/personnel/users/other-manager', actor: manager, body: { enabled: false },
  });
  assert.equal(disable?.status, 403);

  const deRole = await api.handle({
    method: 'PUT', pathname: '/api/system/personnel/users/other-manager/roles', actor: manager, body: { roles: ['operator'] },
  });
  assert.equal(deRole?.status, 403);
});

test('audits accepted and denied mutations with redacted payloads', async () => {
  const { api, evidence } = fixture();
  const created = await api.handle({
    method: 'POST', pathname: '/api/system/personnel/users', actor: manager,
    body: { username: 'op2', temporaryPassword: 'temp-123', roles: ['operator'] },
  });
  assert.equal(created?.status, 201);
  assert.equal((created?.body as { committed: boolean; auditStatus: string }).committed, true);
  assert.equal((created?.body as { auditStatus: string }).auditStatus, 'recorded');
  assert.equal((evidence.at(-1) as { actor_id: string }).actor_id, manager.actorId);
  assert.equal((evidence.at(-1) as { payload: { action: string } }).payload.action, 'personnel_user_created');
  assert.doesNotMatch(JSON.stringify(evidence), /temp-123/);

  const denied = await api.handle({ method: 'GET', pathname: '/api/system/personnel/users', actor: { ...manager, roles: ['owner'] } });
  assert.equal(denied?.status, 403);
  assert.equal((evidence.at(-1) as { payload: { action: string } }).payload.action, 'personnel_action_denied');
});

test('reports committed/auditStatus=failed when the Evidence sink is unavailable', async () => {
  const { api } = fixture({ appendEvidence: () => { throw new Error('evidence sink down'); } });
  const response = await api.handle({
    method: 'POST', pathname: '/api/system/personnel/users', actor: manager,
    body: { username: 'op3', temporaryPassword: 'temp-456', roles: ['operator'] },
  });
  assert.equal(response?.status, 201);
  assert.equal((response?.body as { committed: boolean }).committed, true);
  assert.equal((response?.body as { auditStatus: string }).auditStatus, 'failed');
  assert.match(String((response?.body as { warning: string }).warning), /audit event was not appended/);
});

test('redacts Keycloak failures into stable messages without upstream details', async () => {
  const { api } = fixture({
    admin: { listUsers: async () => { throw new KeycloakPersonnelError('unavailable'); } },
  });
  const response = await api.handle({ method: 'GET', pathname: '/api/system/personnel/users', actor: manager });
  assert.equal(response?.status, 503);
  assert.equal((response?.body as { error: string }).error, '身份服务暂不可用，请稍后重试');
  assert.doesNotMatch(JSON.stringify(response?.body), /token|secret|Bearer|upstream/);
});

test('rejects malformed JSON mutations without consulting Keycloak', async () => {
  const { api } = fixture();
  const response = await api.handle({
    method: 'POST', pathname: '/api/system/personnel/users', actor: manager, bodyParseFailed: true,
  });
  assert.equal(response?.status, 400);
  assert.equal((response?.body as { error: string }).error, 'invalid personnel request');
});

test('rejects unknown roles at the API boundary before any Keycloak call', async () => {
  const { api } = fixture();
  const response = await api.handle({
    method: 'POST', pathname: '/api/system/personnel/users', actor: manager,
    body: { username: 'op4', temporaryPassword: 'temp-789', roles: ['realm-admin'] },
  });
  assert.equal(response?.status, 400);
  assert.match((response?.body as { error: string }).error, /只能分配/);
});

test('reports a committed create with partial semantics when role assignment fails', async () => {
  const { api } = fixture({
    admin: { createUser: async () => { throw new KeycloakPersonnelPartialCommitError('u-partial'); } },
  });
  const response = await api.handle({
    method: 'POST', pathname: '/api/system/personnel/users', actor: manager,
    body: { username: 'op-partial', temporaryPassword: 'temp-000', roles: ['operator'] },
  });
  assert.equal(response?.status, 201);
  assert.equal((response?.body as { committed: boolean }).committed, true);
  assert.equal((response?.body as { partial: boolean }).partial, true);
  assert.equal((response?.body as { actorId: string }).actorId, 'm01:user:u-partial');
  assert.doesNotMatch(JSON.stringify(response?.body), /temp-000/);
});

test('finds the last active manager beyond the first list page', async () => {
  const otherManager = userOf('other-manager', ['manager']);
  const filler = Array.from({ length: 500 }, (_, index) => userOf(`filler-${index}`, ['operator']));
  const { api } = fixture({
    admin: {
      getUser: async () => otherManager,
      listUsers: async (_scope: unknown, options: { first?: number }) => (options.first && options.first >= 500 ? [otherManager] : filler),
    },
  });
  const disable = await api.handle({
    method: 'PATCH', pathname: '/api/system/personnel/users/other-manager', actor: manager, body: { enabled: false },
  });
  assert.equal(disable?.status, 403);
});

test('onboarding creates G0-needed accounts in the session scope before G0 is ready', async () => {
  const created: Array<{ scope: unknown; input: Record<string, unknown> }> = [];
  const { api, evidence } = fixture({
    storeLoad: () => ({ readyForG1: false, decisions: { firstScenario: { value: null }, scope: { value: null } } }),
    admin: {
      createUser: async (scope: unknown, input: Record<string, unknown>) => {
        created.push({ scope, input });
        return userOf('u-zhangsan', input.roles as string[]);
      },
      listUsers: async () => [],
    },
  });

  const response = await api.handle({
    method: 'POST', pathname: '/api/system/personnel/onboarding/users', actor: manager,
    body: {
      username: 'zhangsan', temporaryPassword: 'onboard-pw', roles: ['owner'], firstName: '张三',
      // Forged scope must be ignored.
      tenantId: 'forged-tenant', organizationId: 'forged-org', actorId: 'agent:forged',
    },
  });

  assert.equal(response?.status, 201);
  assert.deepEqual(created[0]?.scope, { demoTenantId: 'demo-tenant', organizationScope: '订单交付组' });
  assert.equal(created[0]?.input.username, 'zhangsan');
  assert.equal((response?.body as { user: { actorId: string } }).user.actorId, 'm01:user:u-zhangsan');
  assert.doesNotMatch(JSON.stringify(created), /forged-tenant|forged-org|agent:forged/);
  assert.doesNotMatch(JSON.stringify(evidence), /onboard-pw/);
  assert.doesNotMatch(JSON.stringify(response?.body), /onboard-pw/);
});

test('onboarding lists existing in-scope accounts and rejects non-manager actors', async () => {
  const { api } = fixture({
    storeLoad: () => ({ readyForG1: false, decisions: { scope: { value: null } } }),
    admin: { listUsers: async () => [userOf('u-zhangsan', ['owner'])] },
  });

  const list = await api.handle({ method: 'GET', pathname: '/api/system/personnel/onboarding/users', actor: manager });
  assert.equal(list?.status, 200);
  assert.equal((list?.body as { users: PersonnelUser[] }).users.length, 1);

  const operator = { ...manager, roles: ['operator'] };
  const denied = await api.handle({ method: 'GET', pathname: '/api/system/personnel/onboarding/users', actor: operator });
  assert.equal(denied?.status, 403);
});

test('onboarding is unavailable when the personnel service client is disabled', async () => {
  const api = new PersonnelApi({ admin: null, g0DecisionStore: store(() => ({})), appendEvidence: () => undefined });
  const response = await api.handle({ method: 'GET', pathname: '/api/system/personnel/onboarding/users', actor: manager });
  assert.equal(response?.status, 503);
});

test('delete forbids self-deletion and last-active-manager, and audits a successful delete', async () => {
  const selfUser = userOf('manager-demo', ['manager']);
  const denied = await fixture({
    admin: {
      getUser: async () => selfUser,
      listUsers: async () => [selfUser],
    },
  }).api.handle({
    method: 'DELETE', pathname: '/api/system/personnel/users/manager-demo', actor: manager,
  });
  assert.equal(denied?.status, 403);

  const operator = userOf('op1', ['operator']);
  const { api, evidence } = fixture({
    admin: {
      getUser: async () => operator,
      listUsers: async () => [userOf('manager-demo', ['manager']), operator],
      deleteUser: async () => ({ actorId: operator.actorId }),
    },
  });
  const ok = await api.handle({
    method: 'DELETE', pathname: '/api/system/personnel/users/op1', actor: manager,
  });
  assert.equal(ok?.status, 200);
  assert.equal((ok?.body as { committed: boolean }).committed, true);
  assert.equal((evidence.at(-1) as { payload: { action: string } }).payload.action, 'personnel_user_deleted');
});
