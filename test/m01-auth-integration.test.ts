import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { ActorContext } from '../src/auth/actor-context.ts';
import type { AuthenticationAuditEvent } from '../src/authentication-audit.ts';
import { BrowserSessionAuth, createBrowserAuthGateway, isPublicLoginResource } from '../src/web-auth.ts';

const m01Actor: ActorContext = {
  actorId: 'm01:user:manager-42', actorType: 'human', tenantId: 'tenant-42', roles: ['manager'], authSource: 'm01',
};

function gatewayFixture(options: {
  postLogoutRedirectUri?: string;
  endSessionUrl?: () => Promise<string | null>;
  onAuthenticationAudit?: (event: AuthenticationAuditEvent) => void;
} = {}) {
  const calls: Array<Record<string, string | boolean>> = [];
  const oidc = {
    beginLogin: async ({ browserBinding, forceReauthentication }: { browserBinding: string; forceReauthentication?: boolean }) => {
      calls.push({ kind: 'begin', browserBinding, ...(forceReauthentication === true ? { forceReauthentication } : {}) });
      return { redirectUrl: 'https://id.example.test/authorize?state=opaque' };
    },
    completeLogin: async (input: { code: string; state: string; browserBinding: string }) => {
      calls.push({ kind: 'complete', ...input });
      return m01Actor;
    },
    endSessionUrl: async ({ postLogoutRedirectUri }: { postLogoutRedirectUri: string }) => {
      calls.push({ kind: 'end-session', postLogoutRedirectUri });
      return options.endSessionUrl
        ? options.endSessionUrl()
        : `https://id.example.test/logout?client_id=aeos-hub-web&post_logout_redirect_uri=${encodeURIComponent(postLogoutRedirectUri)}`;
    },
  };
  const auth = new BrowserSessionAuth('demo', 'replace-me');
  return {
    calls,
    auth,
    gateway: createBrowserAuthGateway({
      authMode: 'm01', webAuth: auth, oidc, allowedRoles: ['manager'], secureCookies: true, browserBindingFactory: () => 'binding-1234567890',
      postLogoutRedirectUri: options.postLogoutRedirectUri ?? 'http://127.0.0.1:8790/?logged_out=1',
      onAuthenticationAudit: options.onAuthenticationAudit,
    }),
  };
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

test('M01 gateway forwards an explicit failed-login retry as a forced reauthentication', async () => {
  const { calls, gateway } = gatewayFixture();
  const response = await gateway.login('GET', undefined, true);
  assert.equal(response.status, 302);
  assert.deepEqual(calls, [{ kind: 'begin', browserBinding: 'binding-1234567890', forceReauthentication: true }]);
});

test('M01 callback completes only through the browser binding and state route, then returns a safe actor session', async () => {
  const { calls, auth, gateway } = gatewayFixture();
  const previousSession = auth.createSession(m01Actor)!;
  const response = await gateway.callback('GET', `aeos_m01_binding=binding-1234567890; aeos_auth=${previousSession}`, 'code-value', 'state-value');
  assert.equal(response.status, 302);
  assert.equal(response.location, '/');
  assert.deepEqual(calls, [{ kind: 'complete', code: 'code-value', state: 'state-value', browserBinding: 'binding-1234567890' }]);
  const sessionCookie = response.cookies!.find((cookie) => cookie.startsWith('aeos_auth='))!;
  assert.match(response.cookies!.find((cookie) => cookie.startsWith('aeos_m01_binding='))!, /Max-Age=0/);
  const sessionId = /aeos_auth=([0-9a-f-]{36})/.exec(sessionCookie)![1]!;
  assert.equal(auth.isAuthorized(`aeos_auth=${previousSession}`), false);
  assert.equal(gateway.actorIdFromCookie(`aeos_auth=${sessionId}`), 'm01:user:manager-42');
  assert.deepEqual(gateway.session(`aeos_auth=${sessionId}`), {
    authenticated: true, authMode: 'm01', actorId: 'm01:user:manager-42', actorType: 'human', tenantId: 'tenant-42', roles: ['manager'], authSource: 'm01',
  });
});

test('M01 callback emits one safe audit event for success and generic authentication failure', async () => {
  const events: AuthenticationAuditEvent[] = [];
  const successful = gatewayFixture({ onAuthenticationAudit: (event) => events.push(event) });
  await successful.gateway.callback('GET', 'aeos_m01_binding=binding-1234567890', 'code-value', 'state-value');
  assert.deepEqual(events, [{ type: 'login_succeeded', authMode: 'm01', actor: m01Actor }]);

  const failed = gatewayFixture({ onAuthenticationAudit: (event) => events.push(event) });
  const response = await failed.gateway.callback('GET', undefined, 'code', 'state');
  assert.equal(response.location, '/?auth_error=1');
  assert.deepEqual(events, [
    { type: 'login_succeeded', authMode: 'm01', actor: m01Actor },
    { type: 'authentication_failed', authMode: 'm01' },
  ]);
});

test('callback failure and logout clear every authentication cookie without revealing upstream details', async () => {
  const { gateway } = gatewayFixture();
  const failure = await gateway.callback('GET', undefined, 'code', 'state');
  assert.equal(failure.status, 302);
  assert.equal(failure.location, '/?auth_error=1');
  for (const name of ['aeos_auth', 'hub_token', 'aeos_session', 'aeos_m01_binding']) {
    assert.match(failure.cookies!.join('\n'), new RegExp(`^${name}=`, 'm'));
  }
  const logout = await gateway.logout(undefined);
  assert.equal(logout.status, 200);
  for (const name of ['aeos_auth', 'hub_token', 'aeos_session', 'aeos_m01_binding']) {
    assert.match(logout.cookies!.join('\n'), new RegExp(`^${name}=`, 'm'));
  }
});

test('M01 callback refuses actors without an allowed role and creates no session', async () => {
  for (const roles of [[], ['reader']]) {
    const { auth, gateway } = gatewayFixture();
    const rejectedGateway = createBrowserAuthGateway({
      authMode: 'm01', webAuth: auth, allowedRoles: ['manager'], secureCookies: true,
      oidc: { beginLogin: async () => ({ redirectUrl: 'https://id.example.test/authorize' }), completeLogin: async () => ({ ...m01Actor, roles }) },
    });
    const response = await rejectedGateway.callback('GET', 'aeos_m01_binding=binding-1234567890', 'code-value', 'state-value');
    assert.equal(response.location, '/?auth_error=1');
    assert.equal(auth.isAuthorized(response.cookies?.find((cookie) => cookie.startsWith('aeos_auth='))), false);
    assert.match(response.cookies!.join('\n'), /^aeos_m01_binding=.*Max-Age=0/m);
  }
});

test('M01 role admission denial emits safe actor context and an audit sink cannot change login behavior', async () => {
  const events: AuthenticationAuditEvent[] = [];
  const auth = new BrowserSessionAuth('demo', 'replace-me');
  const rejectedGateway = createBrowserAuthGateway({
    authMode: 'm01', webAuth: auth, allowedRoles: ['manager'], secureCookies: true,
    oidc: { beginLogin: async () => ({ redirectUrl: 'https://id.example.test/authorize' }), completeLogin: async () => ({ ...m01Actor, roles: ['reader'] }) },
    onAuthenticationAudit: (event) => events.push(event),
  });
  const rejected = await rejectedGateway.callback('GET', 'aeos_m01_binding=binding-1234567890', 'code-value', 'state-value');
  assert.equal(rejected.location, '/?auth_error=1');
  assert.deepEqual(events, [{ type: 'admission_denied', authMode: 'm01', actor: { ...m01Actor, roles: ['reader'] } }]);

  const available = gatewayFixture({ onAuthenticationAudit: () => { throw new Error('Evidence unavailable'); } });
  const accepted = await available.gateway.callback('GET', 'aeos_m01_binding=binding-1234567890', 'code-value', 'state-value');
  assert.equal(accepted.location, '/');
  assert.equal(available.auth.isAuthorized(accepted.cookies?.find((cookie) => cookie.startsWith('aeos_auth='))), true);
});

test('gateway rejects unauthenticated protected HTTP/static/WebSocket access and never returns web-session actors', () => {
  const { auth, gateway } = gatewayFixture();
  assert.equal(gateway.actorIdFromCookie(undefined), null);
  assert.equal(gateway.canAccess('/api/harbor', 'GET', undefined), false);
  assert.equal(gateway.canAccess('/private.css', 'GET', undefined), false);
  assert.equal(gateway.isAuthorized(undefined), false);
  assert.equal(isPublicLoginResource('/app.js', 'GET'), true);
  assert.equal(isPublicLoginResource('/agent-registration.js', 'GET'), true);
  assert.equal(isPublicLoginResource('/task-center.js', 'GET'), true);
  assert.deepEqual(gateway.session(undefined), { authenticated: false, authMode: 'm01' });
  const sessionId = auth.createSession(m01Actor);
  const actorId = gateway.actorIdFromCookie(`aeos_auth=${sessionId}`);
  assert.equal(actorId, 'm01:user:manager-42');
  assert.doesNotMatch(actorId!, /^web-session:/);
});

test('client reconnects a closed WebSocket only after an explicitly authenticated session summary', () => {
  const appSource = readFileSync(join(process.cwd(), 'public', 'app.js'), 'utf8');
  assert.match(appSource, /session\?\.authenticated === true\) reconnectTimer = window\.setTimeout\(connect, 3000\)/);
  assert.match(appSource, /else showLoginRequired\('登录会话已结束，请重新登录'\)/);
});

test('M01 logout revokes the Hub session and hands back the IdP logout URL', async () => {
  const { auth, gateway } = gatewayFixture();
  const sessionId = auth.createSession(m01Actor)!;
  const logout = await gateway.logout(`aeos_auth=${sessionId}`);
  assert.equal(logout.status, 200);
  assert.equal(
    logout.redirectTo,
    `https://id.example.test/logout?client_id=aeos-hub-web&post_logout_redirect_uri=${encodeURIComponent('http://127.0.0.1:8790/?logged_out=1')}`,
  );
  assert.equal(auth.isAuthorized(`aeos_auth=${sessionId}`), false);
  assert.match(logout.cookies.join('\n'), /^aeos_m01_binding=.*Max-Age=0/m);
});

test('M01 logout still clears the Hub session when the IdP logout URL is unavailable', async () => {
  const unavailable = [async () => null, async () => { throw new Error('idp unreachable'); }];
  for (const endSessionUrl of unavailable) {
    const { auth, gateway } = gatewayFixture({ endSessionUrl });
    const sessionId = auth.createSession(m01Actor)!;
    const logout = await gateway.logout(`aeos_auth=${sessionId}`);
    assert.equal(logout.status, 200);
    assert.equal(logout.redirectTo, undefined);
    assert.equal(auth.isAuthorized(`aeos_auth=${sessionId}`), false);
  }
});

test('M01 logout without a registered post logout redirect only ends the Hub session', async () => {
  const auth = new BrowserSessionAuth('demo', 'replace-me');
  const gateway = createBrowserAuthGateway({
    authMode: 'm01', webAuth: auth, allowedRoles: ['manager'], secureCookies: true,
    oidc: {
      beginLogin: async () => ({ redirectUrl: 'https://id.example.test/authorize' }),
      completeLogin: async () => m01Actor,
      endSessionUrl: async () => 'https://id.example.test/logout',
    },
  });
  const sessionId = auth.createSession(m01Actor)!;
  const logout = await gateway.logout(`aeos_auth=${sessionId}`);
  assert.equal(logout.redirectTo, undefined);
  assert.equal(auth.isAuthorized(`aeos_auth=${sessionId}`), false);
});

test('local-dev logout never returns an IdP redirect', async () => {
  const auth = new BrowserSessionAuth('demo', 'replace-me');
  const gateway = createBrowserAuthGateway({ authMode: 'local-dev', webAuth: auth, secureCookies: false });
  const sessionId = auth.createSession({ ...m01Actor, authSource: 'local-dev' })!;
  const logout = await gateway.logout(`aeos_auth=${sessionId}`);
  assert.equal(logout.status, 200);
  assert.equal(logout.redirectTo, undefined);
});
