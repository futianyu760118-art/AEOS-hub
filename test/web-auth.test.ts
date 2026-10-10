import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrowserSessionAuth,
  SessionSocketRegistry,
  assertAuthModeAllowedInEnvironment,
  authRoutePolicy,
  DEFAULT_LOGIN_USERNAME,
  bindingCookie,
  buildLocalDevActor,
  cookieSecureFromEnvironment,
  credentialsMatch,
  expiredBindingCookie,
  passwordFromEnvironment,
  sessionSummary,
  usernameFromEnvironment,
} from '../src/web-auth.ts';

test('only the configured account and password receive a browser session', () => {
  const auth = new BrowserSessionAuth('operator', 'replace-me');
  assert.equal(auth.login('other', 'replace-me'), null);
  assert.equal(auth.login('operator', 'wrong'), null);
  const session = auth.login('operator', 'replace-me');
  assert.ok(session);
  assert.equal(auth.isAuthorized(`aeos_auth=${session}`), true);
});

test('browser session cookie has no persistent lifetime and logout revokes it', () => {
  const auth = new BrowserSessionAuth('operator', 'replace-me');
  const session = auth.login('operator', 'replace-me')!;
  const cookie = auth.sessionCookie(session);
  assert.doesNotMatch(cookie, /Max-Age|Expires/i);
  auth.revoke(cookie);
  assert.equal(auth.isAuthorized(cookie), false);
  assert.match(auth.expiredCookie(), /Max-Age=0/);
});

test('authenticated sessions retain a safe actor context instead of exposing session identifiers', () => {
  const actor = buildLocalDevActor({ AEOS_LOCAL_TENANT_ID: 'demo-tenant', AEOS_LOCAL_ROLES: 'manager,reader' }, 'operator');
  const auth = new BrowserSessionAuth('operator', 'replace-me', actor, true);
  const session = auth.login('operator', 'replace-me')!;
  assert.notEqual(session, actor.actorId);
  assert.deepEqual(auth.actorFromCookie(`aeos_auth=${session}`), actor);
  assert.match(auth.sessionCookie(session), /Secure/);
  assert.doesNotMatch(JSON.stringify(auth.actorFromCookie(`aeos_auth=${session}`)), /replace-me|aeos_auth/);
});

test('local development actor values are validated and legacy deployment environments fail closed', () => {
  assert.throws(() => buildLocalDevActor({ AEOS_LOCAL_TENANT_ID: 'bad tenant' }, 'operator'), /AEOS_LOCAL_TENANT_ID/);
  assert.throws(() => buildLocalDevActor({ AEOS_LOCAL_ROLES: 'manager, bad role' }, 'operator'), /AEOS_LOCAL_ROLES/);
  assert.equal(cookieSecureFromEnvironment({}), false);
  assert.equal(cookieSecureFromEnvironment({ AEOS_COOKIE_SECURE: '1' }), true);
  assert.equal(cookieSecureFromEnvironment({ AEOS_COOKIE_SECURE: '0' }), false);
  assert.throws(() => cookieSecureFromEnvironment({ AEOS_COOKIE_SECURE: 'yes' }), /AEOS_COOKIE_SECURE/);
  const strictEnvironments: NodeJS.ProcessEnv[] = [
    ...['uat', 'staging', 'production', 'unknown-environment', ''].map((NODE_ENV) => ({ NODE_ENV })),
    ...['uat', 'staging', 'production', 'unknown-environment', ''].map((AEOS_ENV) => ({ AEOS_ENV })),
    { NODE_ENV: 'development', AEOS_ENV: 'production' },
    { NODE_ENV: 'production', AEOS_ENV: 'development' },
  ];
  for (const environment of strictEnvironments) {
    assert.throws(() => assertAuthModeAllowedInEnvironment('local-dev', environment), /AEOS_AUTH_MODE=m01/);
    assert.throws(() => assertAuthModeAllowedInEnvironment('m01', environment), /AEOS_COOKIE_SECURE=1/);
    assert.throws(() => assertAuthModeAllowedInEnvironment('m01', { ...environment, AEOS_COOKIE_SECURE: '0' }), /AEOS_COOKIE_SECURE=1/);
    assert.doesNotThrow(() => assertAuthModeAllowedInEnvironment('m01', { ...environment, AEOS_COOKIE_SECURE: '1' }));
    assert.equal(cookieSecureFromEnvironment({ ...environment, AEOS_COOKIE_SECURE: '1' }), true);
    assert.throws(() => cookieSecureFromEnvironment(environment), /AEOS_COOKIE_SECURE=1/);
  }
  for (const environment of [{}, { AEOS_ENV: 'development' }, { NODE_ENV: 'local' }, { NODE_ENV: 'development', AEOS_ENV: 'development' }, { NODE_ENV: 'test', AEOS_ENV: 'local' }]) {
    assert.doesNotThrow(() => assertAuthModeAllowedInEnvironment('local-dev', environment));
    assert.equal(cookieSecureFromEnvironment(environment), false);
  }
});

test('session expiry, capacity, and replacement revoke old sessions without exposing their values', () => {
  let now = 1_000;
  const revoked: string[] = [];
  const auth = new BrowserSessionAuth('operator', 'replace-me', buildLocalDevActor({}, 'operator'), {
    now: () => now, idleTtlMs: 10, absoluteTtlMs: 25, maxSessions: 1, onSessionRevoked: (sessionId) => revoked.push(sessionId),
  });
  const first = auth.login('operator', 'replace-me')!;
  assert.equal(auth.createSession(buildLocalDevActor({}, 'other')), null);
  now += 5;
  assert.ok(auth.actorFromCookie(`aeos_auth=${first}`));
  now += 9;
  assert.ok(auth.actorFromCookie(`aeos_auth=${first}`));
  now += 11;
  assert.equal(auth.actorFromCookie(`aeos_auth=${first}`), null);
  assert.deepEqual(revoked, [first]);
  const second = auth.login('operator', 'replace-me')!;
  const replacement = auth.loginReplacing(`aeos_auth=${second}`, 'operator', 'replace-me')!;
  assert.equal(auth.isAuthorized(`aeos_auth=${second}`), false);
  assert.equal(auth.isAuthorized(`aeos_auth=${replacement}`), true);
  assert.ok(revoked.includes(second));
});

test('session-scoped WebSocket registry closes only the revoked session sockets', () => {
  const registry = new SessionSocketRegistry();
  const sockets = [{ closeCalls: 0, close() { this.closeCalls += 1; } }, { closeCalls: 0, close() { this.closeCalls += 1; } }];
  const auth = new BrowserSessionAuth('operator', 'replace-me', buildLocalDevActor({}, 'operator'), { onSessionRevoked: (sessionId) => registry.closeSession(sessionId) });
  const first = auth.login('operator', 'replace-me')!;
  const second = auth.createSession(buildLocalDevActor({}, 'operator'))!;
  registry.attach(first, sockets[0]!);
  registry.attach(second, sockets[1]!);
  auth.revoke(`aeos_auth=${first}`);
  assert.equal(sockets[0]!.closeCalls, 1);
  assert.equal(sockets[1]!.closeCalls, 0);
  assert.equal(auth.isAuthorized(`aeos_auth=${second}`), true);
});

test('M01 browser binding cookie is short-lived, HttpOnly, SameSite=Lax, and safely cleared', () => {
  const cookie = bindingCookie('trusted-binding', true);
  assert.match(cookie, /aeos_m01_binding=trusted-binding/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=300/);
  assert.match(cookie, /Secure/);
  assert.match(expiredBindingCookie(true), /Max-Age=0/);
});

test('authentication route policy exposes only the mode-appropriate login and callback methods', () => {
  assert.deepEqual(authRoutePolicy('local-dev', '/api/auth/login'), { public: true, method: 'POST' });
  assert.equal(authRoutePolicy('local-dev', '/api/auth/callback'), null);
  assert.deepEqual(authRoutePolicy('m01', '/api/auth/login'), { public: true, method: 'GET' });
  assert.deepEqual(authRoutePolicy('m01', '/api/auth/callback'), { public: true, method: 'GET' });
});

test('session summary is identity-only and excludes credential and session material', () => {
  const actor = buildLocalDevActor({ AEOS_LOCAL_TENANT_ID: 'demo' }, 'operator');
  const summary = JSON.stringify(sessionSummary(actor, 'local-dev'));
  assert.match(summary, /actorId/);
  assert.doesNotMatch(summary, /password|secret|token|cookie|aeos_auth|operator/i);
});

test('configured credentials default the username to demo and require a password', () => {
  assert.throws(() => passwordFromEnvironment({}), /AEOS_LOGIN_PASSWORD/);
  assert.equal(passwordFromEnvironment({ AEOS_LOGIN_PASSWORD: 'secret' }), 'secret');
  assert.equal(usernameFromEnvironment({}), DEFAULT_LOGIN_USERNAME);
  assert.equal(usernameFromEnvironment({ AEOS_LOGIN_USERNAME: 'manager' }), 'manager');
  assert.equal(credentialsMatch('manager', 'secret', 'manager', 'secret'), true);
  assert.equal(credentialsMatch('manager', 'demo', 'manager', 'secret'), false);
});
