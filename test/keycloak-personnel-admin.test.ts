import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KeycloakPersonnelAdmin,
  KeycloakPersonnelError,
  KeycloakPersonnelPartialCommitError,
  readPersonnelAdminConfig,
} from '../src/keycloak-personnel-admin.ts';

const ISSUER = 'https://idp.example.test:9443/realms/aeos';
const scope = { demoTenantId: 'demo-tenant', organizationScope: '订单交付组' };

type FakeResponse = {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
};

function response(status: number, body: unknown, headers: Record<string, string> = {}): FakeResponse {
  return {
    ok: status >= 200 && status < 400,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}

type Handler = (method: string, pathname: string, url: URL, init: RequestInit) => FakeResponse | Error;
type RecordedCall = { method: string; pathname: string; url: URL; init: RequestInit };

function makeFetch(handler: Handler) {
  const calls: RecordedCall[] = [];
  const fetch = async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    calls.push({ method: init.method ?? 'GET', pathname: url.pathname, url, init });
    const result = handler(init.method ?? 'GET', url.pathname, url, init);
    if (result instanceof Error) throw result;
    return result as unknown as Response;
  };
  return { fetch, calls };
}

function rawUser(id: string, username: string, tenantId = 'demo-tenant', organizationId = '订单交付组') {
  return {
    id,
    username,
    enabled: true,
    email: `${username}@example.test`,
    firstName: 'First',
    lastName: 'Last',
    attributes: { tenant_id: [tenantId], organization_id: [organizationId] },
  };
}

test('acquires and caches a client-credentials token without leaking the secret', async () => {
  const { fetch, calls } = makeFetch((method, pathname) => {
    if (pathname.endsWith('/protocol/openid-connect/token')) return response(200, { access_token: 'tok-1', expires_in: 300 });
    if (pathname === '/admin/realms/aeos/users') return response(200, []);
    return new Error(`unexpected ${method} ${pathname}`);
  });

  const admin = new KeycloakPersonnelAdmin(
    { issuer: ISSUER, clientId: 'aeos-hub-personnel-admin', clientSecret: 'client-secret' },
    { fetch, now: () => 1_000_000 },
  );
  await admin.listUsers(scope);
  await admin.listUsers(scope);

  const tokenCalls = calls.filter((call) => call.pathname.endsWith('/protocol/openid-connect/token'));
  assert.equal(tokenCalls.length, 1, 'token should be cached across calls');
  const basic = Buffer.from('aeos-hub-personnel-admin:client-secret').toString('base64');
  assert.equal(tokenCalls[0]?.init.headers?.['authorization'], `Basic ${basic}`);
  assert.match(String(tokenCalls[0]?.init.body), /grant_type=client_credentials/);

  const userCalls = calls.filter((call) => call.pathname === '/admin/realms/aeos/users');
  assert.equal(userCalls[0]?.init.headers?.['authorization'], 'Bearer tok-1');
  assert.doesNotMatch(JSON.stringify(calls), /client-secret/);
});

test('filters to the G0 scope and projects only safe, allow-listed fields', async () => {
  const { fetch } = makeFetch((method, pathname) => {
    if (pathname.endsWith('/protocol/openid-connect/token')) return response(200, { access_token: 'tok', expires_in: 300 });
    if (pathname === '/admin/realms/aeos/users') {
      return response(200, [rawUser('u1', 'op1'), rawUser('u2', 'outsider', 'other-tenant')]);
    }
    if (pathname === '/admin/realms/aeos/users/u1/role-mappings/realm') {
      return response(200, [{ id: 'r1', name: 'manager' }, { id: 'r2', name: 'realm-admin' }, { id: 'r3', name: 'operator' }]);
    }
    if (pathname === '/admin/realms/aeos/users/u2/role-mappings/realm') return response(200, [{ id: 'r4', name: 'manager' }]);
    return new Error(`unexpected ${method} ${pathname}`);
  });

  const admin = new KeycloakPersonnelAdmin({ issuer: ISSUER, clientId: 'c', clientSecret: 's' }, { fetch });
  const users = await admin.listUsers(scope);

  assert.equal(users.length, 1, 'out-of-scope users must not appear');
  assert.equal(users[0]?.actorId, 'm01:user:u1');
  assert.deepEqual(users[0]?.roles, ['manager', 'operator'], 'realm-admin must be dropped');
  assert.equal(users[0]?.tenantId, 'demo-tenant');
  assert.equal(users[0]?.organizationId, '订单交付组');
  assert.doesNotMatch(JSON.stringify(users[0]), /attributes|realm-admin|client-secret/);
});

test('caps the list page size', async () => {
  const { fetch, calls } = makeFetch((method, pathname) => {
    if (pathname.endsWith('/protocol/openid-connect/token')) return response(200, { access_token: 'tok', expires_in: 300 });
    if (pathname === '/admin/realms/aeos/users') return response(200, []);
    return new Error(`unexpected ${method} ${pathname}`);
  });
  const admin = new KeycloakPersonnelAdmin({ issuer: ISSUER, clientId: 'c', clientSecret: 's' }, { fetch });
  await admin.listUsers(scope, { max: 9999 });
  const userCall = calls.find((call) => call.pathname === '/admin/realms/aeos/users');
  assert.equal(userCall?.url.searchParams.get('max'), '500');
});

test('createUser sends credentials and scope attributes but returns a redacted projection', async () => {
  const posted: unknown[] = [];
  const { fetch } = makeFetch((method, pathname, url, init) => {
    if (pathname.endsWith('/protocol/openid-connect/token')) return response(200, { access_token: 'tok', expires_in: 300 });
    if (pathname === '/admin/realms/aeos/users' && method === 'POST') {
      posted.push(JSON.parse(String(init.body)));
      return response(201, undefined, { location: `${url.origin}/admin/realms/aeos/users/u9` });
    }
    if (pathname === '/admin/realms/aeos/users/u9') return response(200, rawUser('u9', 'newbie'));
    if (pathname === '/admin/realms/aeos/users/u9/role-mappings/realm') return response(200, []);
    if (pathname === '/admin/realms/aeos/roles/operator') return response(200, { id: 'r-op', name: 'operator' });
    return new Error(`unexpected ${method} ${pathname}`);
  });

  const admin = new KeycloakPersonnelAdmin({ issuer: ISSUER, clientId: 'c', clientSecret: 's' }, { fetch });
  const user = await admin.createUser(scope, {
    username: 'newbie', roles: ['operator'], temporaryPassword: 's3cret-pw',
  });

  assert.equal(posted.length, 1);
  assert.equal((posted[0] as Record<string, unknown>).username, 'newbie');
  assert.deepEqual((posted[0] as Record<string, unknown>).attributes, { tenant_id: ['demo-tenant'], organization_id: ['订单交付组'] });
  assert.deepEqual((posted[0] as Record<string, unknown>).credentials, [{ type: 'password', value: 's3cret-pw', temporary: true }]);

  assert.equal(user.actorId, 'm01:user:u9');
  assert.doesNotMatch(JSON.stringify(user), /s3cret-pw|attributes|credentials|access_token/);
});

test('maps upstream failures to stable user-safe messages', async () => {
  const { fetch } = makeFetch((method, pathname) => {
    if (pathname.endsWith('/protocol/openid-connect/token')) return response(200, { access_token: 'tok', expires_in: 300 });
    if (pathname === '/admin/realms/aeos/users') {
      return response(500, { error: 'upstream exploded: internal connection refused to db-01.example.test' });
    }
    return new Error(`unexpected ${method} ${pathname}`);
  });
  const admin = new KeycloakPersonnelAdmin({ issuer: ISSUER, clientId: 'c', clientSecret: 's' }, { fetch });
  await assert.rejects(
    () => admin.listUsers(scope),
    (error: unknown) => error instanceof KeycloakPersonnelError
      && error.message === '身份服务暂不可用，请稍后重试'
      && !error.message.includes('db-01'),
  );
});

test('resetTemporaryPassword forces the temporary flag and never returns the value', async () => {
  const resets: unknown[] = [];
  const { fetch } = makeFetch((method, pathname, url, init) => {
    if (pathname.endsWith('/protocol/openid-connect/token')) return response(200, { access_token: 'tok', expires_in: 300 });
    if (pathname === '/admin/realms/aeos/users/u1') return response(200, rawUser('u1', 'op1'));
    if (pathname === '/admin/realms/aeos/users/u1/role-mappings/realm') return response(200, [{ id: 'r1', name: 'operator' }]);
    if (pathname === '/admin/realms/aeos/users/u1/reset-password' && method === 'PUT') {
      resets.push(JSON.parse(String(init.body)));
      return response(204, undefined);
    }
    return new Error(`unexpected ${method} ${pathname}`);
  });
  const admin = new KeycloakPersonnelAdmin({ issuer: ISSUER, clientId: 'c', clientSecret: 's' }, { fetch });
  const user = await admin.resetTemporaryPassword(scope, 'u1', 'fresh-temp');
  assert.deepEqual(resets[0], { type: 'password', value: 'fresh-temp', temporary: true });
  assert.doesNotMatch(JSON.stringify(user), /fresh-temp/);
});

test('deleteUser verifies scope before issuing the Keycloak delete', async () => {
  const deletions: string[] = [];
  const { fetch } = makeFetch((method, pathname, url, init) => {
    if (pathname.endsWith('/protocol/openid-connect/token')) return response(200, { access_token: 'tok', expires_in: 300 });
    if (pathname === '/admin/realms/aeos/users/u1' && method === 'DELETE') {
      deletions.push(url.toString());
      return response(204, undefined);
    }
    if (pathname === '/admin/realms/aeos/users/u1') return response(200, rawUser('u1', 'op1'));
    if (pathname === '/admin/realms/aeos/users/u1/role-mappings/realm') return response(200, [{ id: 'r1', name: 'operator' }]);
    return new Error(`unexpected ${method} ${pathname}`);
  });
  const admin = new KeycloakPersonnelAdmin({ issuer: ISSUER, clientId: 'c', clientSecret: 's' }, { fetch });
  const result = await admin.deleteUser(scope, 'u1');
  assert.deepEqual(result, { actorId: 'm01:user:u1' });
  assert.equal(deletions.length, 1);
});

test('createUser reports a partial commit when role assignment fails after the user is created', async () => {
  const { fetch } = makeFetch((method, pathname, url) => {
    if (pathname.endsWith('/protocol/openid-connect/token')) return response(200, { access_token: 'tok', expires_in: 300 });
    if (pathname === '/admin/realms/aeos/users' && method === 'POST') return response(201, undefined, { location: `${url.origin}/admin/realms/aeos/users/u9` });
    if (pathname === '/admin/realms/aeos/users/u9') return response(200, rawUser('u9', 'newbie'));
    if (pathname === '/admin/realms/aeos/users/u9/role-mappings/realm') return response(500, {});
    if (pathname === '/admin/realms/aeos/roles/operator') return response(200, { id: 'r-op', name: 'operator' });
    return new Error(`unexpected ${method} ${pathname}`);
  });
  const admin = new KeycloakPersonnelAdmin({ issuer: ISSUER, clientId: 'c', clientSecret: 's' }, { fetch });
  await assert.rejects(
    () => admin.createUser(scope, { username: 'newbie', roles: ['operator'], temporaryPassword: 'pw' }),
    KeycloakPersonnelPartialCommitError,
  );
});

test('drops a cached token after an upstream 401 so the next request re-authenticates', async () => {
  let tokenRequests = 0;
  let userRequests = 0;
  const { fetch } = makeFetch((method, pathname) => {
    if (pathname.endsWith('/protocol/openid-connect/token')) { tokenRequests += 1; return response(200, { access_token: `tok-${tokenRequests}`, expires_in: 300 }); }
    if (pathname === '/admin/realms/aeos/users') { userRequests += 1; return userRequests === 1 ? response(401, {}) : response(200, []); }
    return new Error(`unexpected ${method} ${pathname}`);
  });
  const admin = new KeycloakPersonnelAdmin({ issuer: ISSUER, clientId: 'c', clientSecret: 's' }, { fetch, now: () => 1_000_000 });
  await assert.rejects(() => admin.listUsers(scope), KeycloakPersonnelError);
  await admin.listUsers(scope);
  assert.equal(tokenRequests, 2);
});

test('rejects non-HTTPS issuers and fails closed on sentinel secrets', () => {
  assert.throws(() => new KeycloakPersonnelAdmin({ issuer: 'http://idp.example.test/realms/aeos', clientId: 'c', clientSecret: 's' }), KeycloakPersonnelError);
  assert.throws(() => new KeycloakPersonnelAdmin({ issuer: ISSUER, clientId: 'c', clientSecret: '__REPLACE_BEFORE_START__' }), KeycloakPersonnelError);
});

test('readPersonnelAdminConfig disables unless the flag and a non-sentinel secret are present', () => {
  const issuer = ISSUER;
  assert.equal(readPersonnelAdminConfig({}, issuer).enabled, false);
  assert.equal(readPersonnelAdminConfig({ M01_PERSONNEL_ADMIN_ENABLED: '1' }, issuer).enabled, false);
  assert.equal(readPersonnelAdminConfig({ M01_PERSONNEL_ADMIN_ENABLED: '1', M01_PERSONNEL_ADMIN_CLIENT_SECRET: '__REPLACE_BEFORE_START__' }, issuer).enabled, false);
  const enabled = readPersonnelAdminConfig({ M01_PERSONNEL_ADMIN_ENABLED: 'true', M01_PERSONNEL_ADMIN_CLIENT_SECRET: 's' }, issuer);
  assert.equal(enabled.enabled, true);
  if (enabled.enabled) assert.equal(enabled.clientId, 'aeos-hub-personnel-admin');
});
