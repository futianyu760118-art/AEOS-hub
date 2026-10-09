import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeActorContext } from '../src/auth/actor-context.ts';
import { readM01Config } from '../src/auth/m01-oidc.ts';

const m01Environment: NodeJS.ProcessEnv = {
  AEOS_AUTH_MODE: 'm01',
  M01_ISSUER: 'https://login.example.test/',
  M01_CLIENT_ID: 'aeos-hub',
  M01_CLIENT_SECRET: 'not-a-real-secret',
  M01_REDIRECT_URI: 'http://localhost:3000/auth/callback',
  M01_AUDIENCE: 'aeos-api',
};

test('M01 configuration reports every missing required setting without exposing values', () => {
  for (const name of ['M01_ISSUER', 'M01_CLIENT_ID', 'M01_CLIENT_SECRET', 'M01_REDIRECT_URI', 'M01_AUDIENCE']) {
    const environment = { ...m01Environment, [name]: '   ' };
    assert.throws(() => readM01Config(environment), new RegExp(name));
  }
});

test('M01 configuration accepts complete valid M01 settings', () => {
  assert.deepEqual(readM01Config(m01Environment), {
    authMode: 'm01',
    issuer: 'https://login.example.test/',
    clientId: 'aeos-hub',
    clientSecret: 'not-a-real-secret',
    redirectUri: 'http://localhost:3000/auth/callback',
    audience: 'aeos-api',
  });
});

test('M01 configuration does not read M01 settings outside M01 mode', () => {
  assert.deepEqual(readM01Config({ AEOS_AUTH_MODE: 'local-dev' }), { authMode: 'local-dev' });
});

test('actor context rejects non-object claims and missing identity claims', () => {
  assert.throws(() => normalizeActorContext(null, 'm01'), /object/i);
  assert.throws(() => normalizeActorContext([], 'm01'), /object/i);
  assert.throws(() => normalizeActorContext({ tenant_id: 'tenant-a' }, 'm01'), /sub/);
  assert.throws(() => normalizeActorContext({ sub: 'user-a' }, 'm01'), /tenant_id/);
});

test('actor context normalizes human claims and de-duplicates non-blank roles', () => {
  assert.deepEqual(normalizeActorContext({
    sub: ' user-123 ', tenant_id: ' tenant-a ', organization_id: ' org-a ',
    roles: [' manager ', '', 'manager', ' analyst ', '   '], azp: ' browser-client ', client_id: 'ignored-client',
  }, 'm01'), {
    actorId: 'm01:user:user-123',
    actorType: 'human',
    tenantId: 'tenant-a',
    organizationId: 'org-a',
    roles: ['manager', 'analyst'],
    clientId: 'browser-client',
    authSource: 'm01',
  });
});

test('actor context maps service-account subjects to client-scoped service actors', () => {
  assert.deepEqual(normalizeActorContext({
    sub: 'service-account-sync', tenant_id: 'tenant-a', client_id: 'sync-service', roles: ['automation'],
  }, 'm01'), {
    actorId: 'm01:service:sync-service',
    actorType: 'service',
    tenantId: 'tenant-a',
    roles: ['automation'],
    clientId: 'sync-service',
    authSource: 'm01',
  });
});
