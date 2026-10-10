import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActorContext } from '../src/auth/actor-context.ts';
import { BrowserSessionAuth, createBrowserAuthGateway, isPublicLoginResource } from '../src/web-auth.ts';

const m01Actor: ActorContext = {
  actorId: 'm01:user:manager-42', actorType: 'human', tenantId: 'tenant-42', roles: ['manager'], authSource: 'm01',
};

function gatewayFixture() {
  const calls: Array<Record<string, string>> = [];
  const oidc = {
    beginLogin: async ({ browserBinding }: { browserBinding: string }) => {
      calls.push({ kind: 'begin', browserBinding });
      return { redirectUrl: 'https://id.example.test/authorize?state=opaque' };
    },
    completeLogin: async (input: { code: string; state: string; browserBinding: string }) => {
      calls.push({ kind: 'complete', ...input });
      return m01Actor;
    },
  };
  const auth = new BrowserSessionAuth('demo', 'replace-me');
  return { calls, auth, gateway: createBrowserAuthGateway({ authMode: 'm01', webAuth: auth, oidc, secureCookies: true, browserBindingFactory: () => 'binding-1234567890' }) };
}

test('M01 gateway rejects password POST and starts browser-bound GET login without external Keycloak', async () => {
  const { calls, gateway } = gatewayFixture();
  assert.deepEqual(await gateway.login('POST', undefined), { status: 405, error: 'method not allowed' });
  const response = await gateway.login('GET', undefined);
  assert.equal(response.status, 302);
  assert.equal(response.location, 'https://id.example.test/authorize?state=opaque');
  assert.match(response.cookies![0]!, /aeos_m01_binding=binding-1234567890/);
  assert.match(response.cookies![0]!, /HttpOnly; SameSite=Lax; Secure; Max-Age=300/);
  assert.deepEqual(calls, [{ kind: 'begin', browserBinding: 'binding-1234567890' }]);
});

test('M01 callback completes only through the browser binding and state route, then returns a safe actor session', async () => {
  const { calls, gateway } = gatewayFixture();
  const response = await gateway.callback('GET', 'aeos_m01_binding=binding-1234567890', 'code-value', 'state-value');
  assert.equal(response.status, 302);
  assert.equal(response.location, '/');
  assert.deepEqual(calls, [{ kind: 'complete', code: 'code-value', state: 'state-value', browserBinding: 'binding-1234567890' }]);
  const sessionCookie = response.cookies!.find((cookie) => cookie.startsWith('aeos_auth='))!;
  assert.match(response.cookies!.find((cookie) => cookie.startsWith('aeos_m01_binding='))!, /Max-Age=0/);
  const sessionId = /aeos_auth=([0-9a-f-]{36})/.exec(sessionCookie)![1]!;
  assert.equal(gateway.actorIdFromCookie(`aeos_auth=${sessionId}`), 'm01:user:manager-42');
  assert.deepEqual(gateway.session(`aeos_auth=${sessionId}`), {
    authenticated: true, authMode: 'm01', actorId: 'm01:user:manager-42', actorType: 'human', tenantId: 'tenant-42', roles: ['manager'], authSource: 'm01',
  });
});

test('callback failure and logout clear every authentication cookie without revealing upstream details', async () => {
  const { gateway } = gatewayFixture();
  const failure = await gateway.callback('GET', undefined, 'code', 'state');
  assert.equal(failure.status, 302);
  assert.equal(failure.location, '/?auth_error=1');
  for (const name of ['aeos_auth', 'hub_token', 'aeos_session', 'aeos_m01_binding']) {
    assert.match(failure.cookies!.join('\n'), new RegExp(`^${name}=`, 'm'));
  }
  const logout = gateway.logout(undefined);
  assert.equal(logout.status, 200);
  for (const name of ['aeos_auth', 'hub_token', 'aeos_session', 'aeos_m01_binding']) {
    assert.match(logout.cookies!.join('\n'), new RegExp(`^${name}=`, 'm'));
  }
});

test('gateway rejects unauthenticated protected HTTP/static/WebSocket access and never returns web-session actors', () => {
  const { auth, gateway } = gatewayFixture();
  assert.equal(gateway.actorIdFromCookie(undefined), null);
  assert.equal(gateway.canAccess('/api/harbor', 'GET', undefined), false);
  assert.equal(gateway.canAccess('/private.css', 'GET', undefined), false);
  assert.equal(gateway.isAuthorized(undefined), false);
  assert.equal(isPublicLoginResource('/app.js', 'GET'), true);
  assert.deepEqual(gateway.session(undefined), { authenticated: false, authMode: 'm01' });
  const sessionId = auth.createSession(m01Actor);
  const actorId = gateway.actorIdFromCookie(`aeos_auth=${sessionId}`);
  assert.equal(actorId, 'm01:user:manager-42');
  assert.doesNotMatch(actorId!, /^web-session:/);
});
