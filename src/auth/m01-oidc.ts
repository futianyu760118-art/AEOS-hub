import { createHash, randomBytes } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { normalizeActorContext, type ActorContext } from './actor-context.ts';

export type M01Config =
  | { authMode: 'local-dev' }
  | {
    authMode: 'm01';
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    audience: string;
  };

function requiredEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required when AEOS_AUTH_MODE is m01`);
  }
  return value.trim();
}

function validUrl(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

function assertNoUrlCredentialsQueryOrHash(url: URL, value: string, name: string): void {
  if (url.username || url.password || value.includes('?') || value.includes('#')) {
    throw new Error(`${name} must not include credentials, query, or hash`);
  }
}

function readAuthMode(environment: NodeJS.ProcessEnv): 'local-dev' | 'm01' {
  const authMode = environment.AEOS_AUTH_MODE;
  if (authMode === undefined || authMode === 'local-dev' || authMode === 'm01') {
    return authMode === 'm01' ? 'm01' : 'local-dev';
  }
  throw new Error('AEOS_AUTH_MODE must be unset, local-dev, or m01');
}

function validateIssuer(issuer: string): void {
  const url = validUrl(issuer, 'M01_ISSUER');
  assertNoUrlCredentialsQueryOrHash(url, issuer, 'M01_ISSUER');
  if (url.protocol !== 'https:' || !url.host) {
    throw new Error('M01_ISSUER must be an HTTPS URL with a host');
  }
}

function validateRedirectUri(redirectUri: string): void {
  const url = validUrl(redirectUri, 'M01_REDIRECT_URI');
  assertNoUrlCredentialsQueryOrHash(url, redirectUri, 'M01_REDIRECT_URI');
  if (!url.host) {
    throw new Error('M01_REDIRECT_URI must include a host');
  }
  if (url.protocol === 'https:') return;

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname)) {
    throw new Error('M01_REDIRECT_URI must use HTTPS or loopback HTTP');
  }
}

export function readM01Config(environment: NodeJS.ProcessEnv = process.env): M01Config {
  if (readAuthMode(environment) !== 'm01') return { authMode: 'local-dev' };

  const issuer = requiredEnvironmentValue(environment, 'M01_ISSUER');
  const clientId = requiredEnvironmentValue(environment, 'M01_CLIENT_ID');
  const clientSecret = requiredEnvironmentValue(environment, 'M01_CLIENT_SECRET');
  const redirectUri = requiredEnvironmentValue(environment, 'M01_REDIRECT_URI');
  const audience = requiredEnvironmentValue(environment, 'M01_AUDIENCE');
  validateIssuer(issuer);
  validateRedirectUri(redirectUri);

  return { authMode: 'm01', issuer, clientId, clientSecret, redirectUri, audience };
}

type M01EnabledConfig = Extract<M01Config, { authMode: 'm01' }>;

type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

type LoginTransaction = {
  nonce: string;
  verifier: string;
  createdAt: number;
};

export type M01OidcDependencies = {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
};

const LOGIN_TRANSACTION_TTL_MS = 5 * 60 * 1000;
const OIDC_CACHE_TTL_MS = 5 * 60 * 1000;
const RANDOM_VALUE_BYTES = 32;

function authenticationFailed(): Error {
  return new Error('M01 authentication failed');
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function secureOidcUrl(value: unknown): string {
  if (typeof value !== 'string') throw authenticationFailed();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw authenticationFailed();
  }
  if (url.protocol !== 'https:' || !url.host || url.username || url.password || url.search || url.hash || value.includes('?') || value.includes('#')) {
    throw authenticationFailed();
  }
  return url.toString();
}

function configuredIssuer(issuer: string): string {
  return secureOidcUrl(issuer);
}

function discoveryUrl(issuer: string): string {
  const base = issuer.endsWith('/') ? issuer : `${issuer}/`;
  return new URL('.well-known/openid-configuration', base).toString();
}

function validAuthorizationCode(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 4096
    && /^[\x21-\x7e]+$/.test(value);
}

function validState(value: unknown): value is string {
  return typeof value === 'string'
    && /^[A-Za-z0-9_-]{16,512}$/.test(value);
}

function isOidcDiscovery(value: unknown, issuer: string): value is OidcDiscovery {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  if (document.issuer !== issuer) return false;
  try {
    secureOidcUrl(document.authorization_endpoint);
    secureOidcUrl(document.token_endpoint);
    secureOidcUrl(document.jwks_uri);
    return true;
  } catch {
    return false;
  }
}

function isJwks(value: unknown): value is JSONWebKeySet {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Array.isArray((value as { keys?: unknown }).keys);
}

/**
 * Minimal OIDC Authorization Code + PKCE client for the M01 browser login.
 * It deliberately owns only short-lived login state and never exposes tokens.
 */
export class M01OidcAuth {
  private readonly config: M01EnabledConfig;
  private readonly fetcher: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly clock: () => number;
  private readonly entropy: (size: number) => Uint8Array;
  private readonly transactions = new Map<string, LoginTransaction>();
  private discoveryCache?: { value: OidcDiscovery; expiresAt: number };
  private discoveryInFlight?: Promise<OidcDiscovery>;
  private jwksCache?: { uri: string; value: ReturnType<typeof createLocalJWKSet>; expiresAt: number };
  private jwksInFlight?: Promise<ReturnType<typeof createLocalJWKSet>>;

  constructor(config: M01Config, dependencies: M01OidcDependencies = {}) {
    if (config.authMode !== 'm01') throw authenticationFailed();
    configuredIssuer(config.issuer);
    this.config = config;
    this.fetcher = dependencies.fetch ?? ((input, init) => fetch(input, init));
    this.clock = dependencies.now ?? Date.now;
    this.entropy = dependencies.randomBytes ?? randomBytes;
  }

  async beginLogin(): Promise<{ redirectUrl: string }> {
    try {
      const discovery = await this.getDiscovery();
      this.removeExpiredTransactions();
      const state = this.randomValue();
      const nonce = this.randomValue();
      const verifier = this.randomValue();
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      this.transactions.set(state, { nonce, verifier, createdAt: this.clock() });

      const redirect = new URL(discovery.authorization_endpoint);
      redirect.searchParams.set('response_type', 'code');
      redirect.searchParams.set('client_id', this.config.clientId);
      redirect.searchParams.set('redirect_uri', this.config.redirectUri);
      redirect.searchParams.set('scope', 'openid');
      redirect.searchParams.set('state', state);
      redirect.searchParams.set('nonce', nonce);
      redirect.searchParams.set('code_challenge', challenge);
      redirect.searchParams.set('code_challenge_method', 'S256');
      return { redirectUrl: redirect.toString() };
    } catch {
      throw authenticationFailed();
    }
  }

  async completeLogin(input: { code: string; state: string }): Promise<ActorContext> {
    try {
      if (!validAuthorizationCode(input?.code) || !validState(input?.state)) {
        throw authenticationFailed();
      }
      const transaction = this.consumeTransaction(input.state);
      const discovery = await this.getDiscovery();
      const idToken = await this.exchangeCode(discovery.token_endpoint, input.code, transaction.verifier);
      const jwks = await this.getJwks(discovery.jwks_uri);
      const { payload } = await jwtVerify(idToken, jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        currentDate: new Date(this.clock()),
      });
      if (typeof payload.exp !== 'number' || payload.nonce !== transaction.nonce) throw authenticationFailed();
      return normalizeActorContext(payload, 'm01');
    } catch {
      throw authenticationFailed();
    }
  }

  private randomValue(): string {
    return base64Url(this.entropy(RANDOM_VALUE_BYTES));
  }

  private removeExpiredTransactions(): void {
    const now = this.clock();
    for (const [state, transaction] of this.transactions) {
      if (now - transaction.createdAt >= LOGIN_TRANSACTION_TTL_MS) this.transactions.delete(state);
    }
  }

  private consumeTransaction(state: string): LoginTransaction {
    const transaction = this.transactions.get(state);
    if (!transaction) throw authenticationFailed();
    this.transactions.delete(state);
    if (this.clock() - transaction.createdAt >= LOGIN_TRANSACTION_TTL_MS) throw authenticationFailed();
    return transaction;
  }

  private async getDiscovery(): Promise<OidcDiscovery> {
    if (this.discoveryCache && this.discoveryCache.expiresAt > this.clock()) return this.discoveryCache.value;
    if (this.discoveryInFlight) return this.discoveryInFlight;
    this.discoveryInFlight = this.fetchDiscovery().finally(() => { this.discoveryInFlight = undefined; });
    return this.discoveryInFlight;
  }

  private async fetchDiscovery(): Promise<OidcDiscovery> {
    const issuer = configuredIssuer(this.config.issuer);
    const response = await this.fetcher(discoveryUrl(issuer));
    if (!response.ok) throw authenticationFailed();
    const document: unknown = await response.json();
    if (!isOidcDiscovery(document, this.config.issuer)) throw authenticationFailed();
    const value: OidcDiscovery = {
      issuer: document.issuer,
      authorization_endpoint: secureOidcUrl(document.authorization_endpoint),
      token_endpoint: secureOidcUrl(document.token_endpoint),
      jwks_uri: secureOidcUrl(document.jwks_uri),
    };
    this.discoveryCache = { value, expiresAt: this.clock() + OIDC_CACHE_TTL_MS };
    return value;
  }

  private async exchangeCode(tokenEndpoint: string, code: string, verifier: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code_verifier: verifier,
    });
    const response = await this.fetcher(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    if (!response.ok) throw authenticationFailed();
    const result: unknown = await response.json();
    if (result === null || typeof result !== 'object' || typeof (result as { id_token?: unknown }).id_token !== 'string') {
      throw authenticationFailed();
    }
    return (result as { id_token: string }).id_token;
  }

  private async getJwks(uri: string): Promise<ReturnType<typeof createLocalJWKSet>> {
    if (this.jwksCache && this.jwksCache.uri === uri && this.jwksCache.expiresAt > this.clock()) {
      return this.jwksCache.value;
    }
    if (this.jwksInFlight) return this.jwksInFlight;
    this.jwksInFlight = this.fetchJwks(uri).finally(() => { this.jwksInFlight = undefined; });
    return this.jwksInFlight;
  }

  private async fetchJwks(uri: string): Promise<ReturnType<typeof createLocalJWKSet>> {
    const response = await this.fetcher(uri);
    if (!response.ok) throw authenticationFailed();
    const document: unknown = await response.json();
    if (!isJwks(document)) throw authenticationFailed();
    const value = createLocalJWKSet(document);
    this.jwksCache = { uri, value, expiresAt: this.clock() + OIDC_CACHE_TTL_MS };
    return value;
  }
}
