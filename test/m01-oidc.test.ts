import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { normalizeActorContext } from '../src/auth/actor-context.ts';
import { M01OidcAuth, readM01Config } from '../src/auth/m01-oidc.ts';

const m01Environment: NodeJS.ProcessEnv = {
  AEOS_AUTH_MODE: 'm01',
  M01_ISSUER: 'https://login.example.test/',
  M01_CLIENT_ID: 'aeos-hub',
  M01_CLIENT_SECRET: 'not-a-real-secret',
  M01_REDIRECT_URI: 'http://localhost:3000/auth/callback',
  M01_AUDIENCE: 'aeos-api',
};

const oidcConfig = {
  authMode: 'm01' as const,
  issuer: 'https://login.example.test/realms/aeos',
  clientId: 'aeos-hub',
  clientSecret: 'not-a-real-secret',
  redirectUri: 'http://localhost:3000/auth/callback',
  audience: 'aeos-hub',
};
const authorizationEndpoint = 'https://login.example.test/realms/aeos/protocol/openid-connect/auth';
const tokenEndpoint = 'https://login.example.test/realms/aeos/protocol/openid-connect/token';
const jwksUri = 'https://login.example.test/realms/aeos/protocol/openid-connect/certs';
const browserBinding = 'browser-binding-a';
const signingKey = await generateKeyPair('RS256');
const publicJwk = await exportJWK(signingKey.publicKey);
Object.assign(publicJwk, { kid: 'm01-test-key', use: 'sig', alg: 'RS256' });

type IdTokenOptions = {
  issuer?: string;
  audience?: string | string[];
  azp?: string | null;
  expiresAt?: number;
  notBefore?: number;
  nonce?: string;
  tenantId?: string;
  signingKey?: CryptoKey;
};

async function createIdToken(nonce: string, options: IdTokenOptions = {}): Promise<string> {
  const claims: Record<string, unknown> = {
    tenant_id: options.tenantId === undefined ? 'tenant-a' : options.tenantId,
    roles: ['manager'],
    nonce: options.nonce === undefined ? nonce : options.nonce,
  };
  if (options.azp !== undefined) claims.azp = options.azp;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'm01-test-key' })
    .setIssuer(options.issuer ?? oidcConfig.issuer)
    .setAudience(options.audience ?? oidcConfig.audience)
    .setSubject('user-123')
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? Math.floor(Date.now() / 1000) + 120)
    .setNotBefore(options.notBefore ?? Math.floor(Date.now() / 1000) - 1)
    .sign(options.signingKey ?? signingKey.privateKey);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function createOidcFixture(options: {
  now?: () => number; discovery?: Record<string, unknown>; idToken?: string; config?: typeof oidcConfig;
} = {}) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let token = options.idToken;
  const config = options.config ?? oidcConfig;
  const auth = new M01OidcAuth(config, {
    now: options.now,
    fetch: async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/.well-known/openid-configuration')) {
        return jsonResponse(options.discovery ?? {
          issuer: config.issuer,
          authorization_endpoint: authorizationEndpoint,
          token_endpoint: tokenEndpoint,
          jwks_uri: jwksUri,
        });
      }
      if (url === tokenEndpoint) return jsonResponse({ id_token: token });
      if (url === jwksUri) return jsonResponse({ keys: [publicJwk] });
      return jsonResponse({}, 404);
    },
  });
  return { auth, config, requests, setIdToken: (value: string) => { token = value; } };
}

test('M01 OIDC authorization URL carries PKCE and exact callback parameters', async () => {
  const { auth, requests, setIdToken } = createOidcFixture();
  const { redirectUrl } = await auth.beginLogin({ browserBinding });
  const url = new URL(redirectUrl);
  assert.equal(url.origin + url.pathname, authorizationEndpoint);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), oidcConfig.clientId);
  assert.equal(url.searchParams.get('redirect_uri'), oidcConfig.redirectUri);
  assert.match(url.searchParams.get('scope') ?? '', /(^| )openid( |$)/);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('state') ?? '', /^[A-Za-z0-9_-]{32,}$/);
  assert.match(url.searchParams.get('nonce') ?? '', /^[A-Za-z0-9_-]{32,}$/);

  setIdToken(await createIdToken(url.searchParams.get('nonce')!));
  await auth.completeLogin({ code: 'authorization-code', state: url.searchParams.get('state')!, browserBinding });
  const tokenRequest = requests.find((request) => request.url === tokenEndpoint)!;
  const body = new URLSearchParams(String(tokenRequest.init?.body));
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('redirect_uri'), oidcConfig.redirectUri);
  assert.equal(body.get('client_id'), null);
  assert.equal(body.get('client_secret'), null);
  assert.equal(body.get('code'), 'authorization-code');
  assert.equal((tokenRequest.init?.headers as Record<string, string>).authorization, `Basic ${Buffer.from(`${oidcConfig.clientId}:${oidcConfig.clientSecret}`).toString('base64')}`);
  assert.equal(
    createHash('sha256').update(body.get('code_verifier')!).digest('base64url'),
    url.searchParams.get('code_challenge'),
  );
  for (const request of requests) {
    assert.equal(request.init?.redirect, 'error');
    assert.ok(request.init?.signal instanceof AbortSignal);
  }
});

test('M01 OIDC completes a valid signed token into an actor context', async () => {
  const { auth, setIdToken } = createOidcFixture();
  const { redirectUrl } = await auth.beginLogin({ browserBinding });
  const parameters = new URL(redirectUrl).searchParams;
  setIdToken(await createIdToken(parameters.get('nonce')!));
  assert.deepEqual(await auth.completeLogin({ code: 'code-123', state: parameters.get('state')!, browserBinding }), {
    actorId: 'm01:user:user-123', actorType: 'human', tenantId: 'tenant-a', roles: ['manager'], authSource: 'm01',
  });
});

test('M01 OIDC discovery requires the configured issuer and safe HTTPS endpoints', async () => {
  const invalidDocuments = [
    { issuer: `${oidcConfig.issuer}/`, authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint, jwks_uri: jwksUri },
    { issuer: oidcConfig.issuer, authorization_endpoint: 'http://login.example.test/auth', token_endpoint: tokenEndpoint, jwks_uri: jwksUri },
    { issuer: oidcConfig.issuer, authorization_endpoint: authorizationEndpoint, token_endpoint: `${tokenEndpoint}?debug=1`, jwks_uri: jwksUri },
    { issuer: oidcConfig.issuer, authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint, jwks_uri: 'https://user:pass@login.example.test/certs' },
  ];
  for (const discovery of invalidDocuments) {
    const { auth } = createOidcFixture({ discovery });
    await assert.rejects(auth.beginLogin({ browserBinding }), /authentication failed/i);
  }
});

test('M01 OIDC rejects missing, mismatched, expired, and reused states', async () => {
  let time = Date.now();
  const { auth, setIdToken } = createOidcFixture({ now: () => time });
  await assert.rejects(auth.completeLogin({ code: 'code', state: 'missing-state-value', browserBinding }), /authentication failed/i);
  const { redirectUrl } = await auth.beginLogin({ browserBinding });
  const parameters = new URL(redirectUrl).searchParams;
  await assert.rejects(auth.completeLogin({ code: 'code', state: 'different-state-value', browserBinding }), /authentication failed/i);
  time += 300_001;
  await assert.rejects(auth.completeLogin({ code: 'code', state: parameters.get('state')!, browserBinding }), /authentication failed/i);

  const second = new URL((await auth.beginLogin({ browserBinding })).redirectUrl).searchParams;
  setIdToken(await createIdToken(second.get('nonce')!, { expiresAt: Math.floor(Date.now() / 1000) + 900 }));
  await auth.completeLogin({ code: 'code', state: second.get('state')!, browserBinding });
  await assert.rejects(auth.completeLogin({ code: 'code', state: second.get('state')!, browserBinding }), /authentication failed/i);
});

test('M01 OIDC consumes state before a failed token exchange', async () => {
  const { auth } = createOidcFixture({ idToken: undefined });
  const parameters = new URL((await auth.beginLogin({ browserBinding })).redirectUrl).searchParams;
  await assert.rejects(auth.completeLogin({ code: 'code', state: parameters.get('state')!, browserBinding }), /authentication failed/i);
  await assert.rejects(auth.completeLogin({ code: 'code', state: parameters.get('state')!, browserBinding }), /authentication failed/i);
});

test('M01 OIDC performs actual JWT/JWKS verification and rejects invalid claims', async () => {
  const cases: Array<[string, IdTokenOptions]> = [
    ['issuer', { issuer: 'https://other.example.test/realms/aeos' }],
    ['audience', { audience: 'other-api' }],
    ['signature', { signingKey: (await generateKeyPair('RS256')).privateKey }],
    ['expiry', { expiresAt: Math.floor(Date.now() / 1000) - 60 }],
    ['not-before', { notBefore: Math.floor(Date.now() / 1000) + 60 }],
    ['nonce', { nonce: 'wrong-nonce' }],
    ['tenant_id', { tenantId: '' }],
  ];
  for (const [name, options] of cases) {
    const { auth, setIdToken } = createOidcFixture();
    const parameters = new URL((await auth.beginLogin({ browserBinding })).redirectUrl).searchParams;
    setIdToken(await createIdToken(parameters.get('nonce')!, options));
    await assert.rejects(auth.completeLogin({ code: 'code', state: parameters.get('state')!, browserBinding }), /authentication failed/i, name);
  }
});

test('M01 OIDC gives concurrent login attempts distinct states', async () => {
  const { auth } = createOidcFixture();
  const logins = await Promise.all(Array.from({ length: 8 }, () => auth.beginLogin({ browserBinding })));
  assert.equal(new Set(logins.map(({ redirectUrl }) => new URL(redirectUrl).searchParams.get('state'))).size, logins.length);
});

test('M01 OIDC binds a state to its initiating browser binding and consumes it on mismatch', async () => {
  const { auth, setIdToken } = createOidcFixture();
  const parameters = new URL((await auth.beginLogin({ browserBinding })).redirectUrl).searchParams;
  const state = parameters.get('state')!;
  setIdToken(await createIdToken(parameters.get('nonce')!));
  await assert.rejects(auth.completeLogin({ code: 'code', state, browserBinding: 'browser-binding-b' }), /authentication failed/i);
  await assert.rejects(auth.completeLogin({ code: 'code', state, browserBinding }), /authentication failed/i);
});

test('M01 OIDC prunes expired transactions and rejects browser-binding capacity overflow', async () => {
  let time = Date.now();
  const { auth } = createOidcFixture({ now: () => time });
  await Promise.all(Array.from({ length: 10 }, () => auth.beginLogin({ browserBinding })));
  await assert.rejects(auth.beginLogin({ browserBinding }), /authentication failed/i);
  time += 300_000;
  await auth.beginLogin({ browserBinding });
  auth.dispose();
});

test('M01 OIDC enforces a global transaction cap', async () => {
  const { auth } = createOidcFixture();
  for (let index = 0; index < 1_024; index += 1) {
    await auth.beginLogin({ browserBinding: `browser-binding-${index}` });
  }
  await assert.rejects(auth.beginLogin({ browserBinding: 'browser-binding-overflow' }), /authentication failed/i);
  auth.dispose();
});

test('M01 OIDC rejects a token that lacks the client audience or valid multi-audience azp', async () => {
  const onlyBusiness = createOidcFixture();
  const businessParameters = new URL((await onlyBusiness.auth.beginLogin({ browserBinding })).redirectUrl).searchParams;
  onlyBusiness.setIdToken(await createIdToken(businessParameters.get('nonce')!, { audience: 'aeos-api' }));
  await assert.rejects(onlyBusiness.auth.completeLogin({ code: 'code', state: businessParameters.get('state')!, browserBinding }), /authentication failed/i);

  const multiAudienceConfig = { ...oidcConfig, audience: 'aeos-api' };
  for (const azp of [undefined, 'other-client']) {
    const fixture = createOidcFixture({ config: multiAudienceConfig });
    const parameters = new URL((await fixture.auth.beginLogin({ browserBinding })).redirectUrl).searchParams;
    fixture.setIdToken(await createIdToken(parameters.get('nonce')!, { audience: [oidcConfig.clientId, 'aeos-api'], azp }));
    await assert.rejects(fixture.auth.completeLogin({ code: 'code', state: parameters.get('state')!, browserBinding }), /authentication failed/i);
  }
});

test('M01 OIDC rejects incompatible token endpoint authentication and sanitizes fetch failures', async () => {
  const unsupported = createOidcFixture({ discovery: {
    issuer: oidcConfig.issuer, authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint, jwks_uri: jwksUri,
    token_endpoint_auth_methods_supported: ['none'],
  } });
  await assert.rejects(unsupported.auth.beginLogin({ browserBinding }), /authentication failed/i);

  const auth = new M01OidcAuth(oidcConfig, {
    fetch: async () => { throw new Error(`timeout ${oidcConfig.clientSecret} authorization-code`); },
  });
  await assert.rejects(auth.beginLogin({ browserBinding }), (error: Error) => {
    assert.equal(error.message, 'M01 authentication failed');
    return true;
  });
});

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

test('M01 configuration accepts only unset and local-dev non-M01 modes', () => {
  assert.deepEqual(readM01Config({}), { authMode: 'local-dev' });
  assert.deepEqual(readM01Config({ AEOS_AUTH_MODE: 'local-dev' }), { authMode: 'local-dev' });
});

test('M01 configuration rejects unsupported auth modes without echoing their values', () => {
  for (const mode of ['M01', ' m01', 'm01 ', 'staging']) {
    assert.throws(
      () => readM01Config({ AEOS_AUTH_MODE: mode }),
      (error: Error) => error.message === 'AEOS_AUTH_MODE must be unset, local-dev, or m01',
    );
  }
});

test('M01 configuration rejects unsafe issuer URLs', () => {
  for (const issuer of [
    'https://username:password@login.example.test/',
    'https://login.example.test/?tenant=tenant-a',
    'https://login.example.test/#callback',
  ]) {
    assert.throws(() => readM01Config({ ...m01Environment, M01_ISSUER: issuer }), /M01_ISSUER/);
  }
});

test('M01 configuration rejects unsafe redirect URLs while accepting loopback HTTP development callbacks', () => {
  for (const redirectUri of [
    'file:///tmp/callback',
    'http://example.test/auth/callback',
    'https://username:password@login.example.test/auth/callback',
    'https://login.example.test/auth/callback?code=secret',
    'https://login.example.test/auth/callback#fragment',
  ]) {
    assert.throws(() => readM01Config({ ...m01Environment, M01_REDIRECT_URI: redirectUri }), /M01_REDIRECT_URI/);
  }

  assert.equal(
    readM01Config({ ...m01Environment, M01_REDIRECT_URI: 'http://localhost:3000/auth/callback' }).redirectUri,
    'http://localhost:3000/auth/callback',
  );
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

test('actor context maps explicitly marked UUID service accounts to client-scoped service actors', () => {
  assert.deepEqual(normalizeActorContext({
    sub: 'c0a8016a-1f5f-4f06-9b36-00d8c343f6a4',
    tenant_id: 'tenant-a',
    client_id: 'keycloak-service',
    aeos_actor_type: 'service',
  }, 'm01'), {
    actorId: 'm01:service:keycloak-service',
    actorType: 'service',
    tenantId: 'tenant-a',
    roles: [],
    clientId: 'keycloak-service',
    authSource: 'm01',
  });
});
