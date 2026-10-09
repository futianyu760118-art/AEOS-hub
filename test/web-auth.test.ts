import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserSessionAuth, DEFAULT_LOGIN_USERNAME, credentialsMatch, passwordFromEnvironment, usernameFromEnvironment } from '../src/web-auth.ts';

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

test('configured credentials default the username to demo and require a password', () => {
  assert.throws(() => passwordFromEnvironment({}), /AEOS_LOGIN_PASSWORD/);
  assert.equal(passwordFromEnvironment({ AEOS_LOGIN_PASSWORD: 'secret' }), 'secret');
  assert.equal(usernameFromEnvironment({}), DEFAULT_LOGIN_USERNAME);
  assert.equal(usernameFromEnvironment({ AEOS_LOGIN_USERNAME: 'manager' }), 'manager');
  assert.equal(credentialsMatch('manager', 'secret', 'manager', 'secret'), true);
  assert.equal(credentialsMatch('manager', 'demo', 'manager', 'secret'), false);
});
