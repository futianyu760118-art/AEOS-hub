import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserSessionAuth, LOGIN_USERNAME, credentialsMatch, passwordFromEnvironment } from '../src/web-auth.ts';

test('only the demo account and configured password receive a browser session', () => {
  const auth = new BrowserSessionAuth('replace-me');
  assert.equal(auth.login('other', 'replace-me'), null);
  assert.equal(auth.login(LOGIN_USERNAME, 'wrong'), null);
  const session = auth.login(LOGIN_USERNAME, 'replace-me');
  assert.ok(session);
  assert.equal(auth.isAuthorized(`aeos_auth=${session}`), true);
});

test('browser session cookie has no persistent lifetime and logout revokes it', () => {
  const auth = new BrowserSessionAuth('replace-me');
  const session = auth.login(LOGIN_USERNAME, 'replace-me')!;
  const cookie = auth.sessionCookie(session);
  assert.doesNotMatch(cookie, /Max-Age|Expires/i);
  auth.revoke(cookie);
  assert.equal(auth.isAuthorized(cookie), false);
  assert.match(auth.expiredCookie(), /Max-Age=0/);
});

test('configured password is required and compared without a plaintext fallback', () => {
  assert.throws(() => passwordFromEnvironment({}), /AEOS_LOGIN_PASSWORD/);
  assert.equal(passwordFromEnvironment({ AEOS_LOGIN_PASSWORD: 'secret' }), 'secret');
  assert.equal(credentialsMatch('demo', 'secret', 'secret'), true);
  assert.equal(credentialsMatch('demo', 'demo', 'secret'), false);
});
