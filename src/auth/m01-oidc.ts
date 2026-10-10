import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import { isLocalDevelopmentEnvironment, m01AllowedRolesFromEnvironment, normalizeActorContext, type ActorContext } from './actor-context.ts';

export type M01Config =
  | { authMode: 'local-dev' }
  | {
    authMode: 'm01';
    issuer: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    audience: string;
    allowedRoles: string[];
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

function validateRedirectUri(redirectUri: string, environment: NodeJS.ProcessEnv): void {
  const url = validUrl(redirectUri, 'M01_REDIRECT_URI');
  assertNoUrlCredentialsQueryOrHash(url, redirectUri, 'M01_REDIRECT_URI');
  if (!url.host) {
    throw new Error('M01_REDIRECT_URI must include a host');
  }
  if (url.pathname !== '/api/auth/callback') {
    throw new Error('M01_REDIRECT_URI must target /api/auth/callback');
  }
  if (url.protocol === 'https:') return;

  if (!isLocalDevelopmentEnvironment(environment)) {
    throw new Error('M01_REDIRECT_URI must use HTTPS outside local development');
  }

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
  const allowedRoles = m01AllowedRolesFromEnvironment(environment);
  validateIssuer(issuer);
  validateRedirectUri(redirectUri, environment);

  return { authMode: 'm01', issuer, clientId, clientSecret, redirectUri, audience, allowedRoles };
}

type M01EnabledConfig = Extract<M01Config, { authMode: 'm01' }>;

type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
};

type LoginTransaction = {
  nonce: string;
  verifier: string;
  browserBinding: string;
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
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TRANSACTIONS = 1_024;
const MAX_TRANSACTIONS_PER_BROWSER = 10;

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

function validBrowserBinding(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 512
    && /^[\x21-\x7e]+$/.test(value);
}

function equalBrowserBindings(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isOidcDiscovery(value: unknown, issuer: string): value is OidcDiscovery {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  if (document.issuer !== issuer) return false;
  if (document.token_endpoint_auth_methods_supported !== undefined
    && (!Array.isArray(document.token_endpoint_auth_methods_supported)
      || document.token_endpoint_auth_methods_supported.some((method) => typeof method !== 'string'))) return false;
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
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private discoveryCache?: { value: OidcDiscovery; expiresAt: number };
  private discoveryInFlight?: Promise<OidcDiscovery>;
  private jwksCache?: { uri: string; value: ReturnType<typeof createLocalJWKSet>; expiresAt: number };
  private readonly jwksInFlight = new Map<string, Promise<ReturnType<typeof createLocalJWKSet>>>();

  constructor(config: M01Config, dependencies: M01OidcDependencies = {}) {
    if (config.authMode !== 'm01') throw authenticationFailed();
    configuredIssuer(config.issuer);
    this.config = config;
    this.fetcher = dependencies.fetch ?? ((input, init) => fetch(input, init));
    this.clock = dependencies.now ?? Date.now;
    this.entropy = dependencies.randomBytes ?? randomBytes;
  }

  /** browserBinding must come from a server-trusted, HttpOnly browser cookie. */
  async beginLogin(input: { browserBinding: string }): Promise<{ redirectUrl: string }> {
    try {
      if (!validBrowserBinding(input?.browserBinding)) throw authenticationFailed();
      const discovery = await this.getDiscovery();
      this.pruneExpiredTransactions();
      this.assertTransactionCapacity(input.browserBinding);
      const state = this.randomValue();
      const nonce = this.randomValue();
      const verifier = this.randomValue();
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      this.transactions.set(state, { nonce, verifier, browserBinding: input.browserBinding, createdAt: this.clock() });
      this.ensureCleanupTimer();

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

  async completeLogin(input: { code: string; state: string; browserBinding: string }): Promise<ActorContext> {
    try {
      if (!validAuthorizationCode(input?.code) || !validState(input?.state) || !validBrowserBinding(input?.browserBinding)) {
        throw authenticationFailed();
      }
      this.pruneExpiredTransactions();
      const transaction = this.consumeTransaction(input.state);
      if (!equalBrowserBindings(transaction.browserBinding, input.browserBinding)) throw authenticationFailed();
      const discovery = await this.getDiscovery();
      const idToken = await this.exchangeCode(discovery, input.code, transaction.verifier);
      const jwks = await this.getJwks(discovery.jwks_uri);
      const { payload } = await jwtVerify(idToken, jwks, {
        issuer: this.config.issuer,
        currentDate: new Date(this.clock()),
      });
      if (typeof payload.exp !== 'number' || payload.nonce !== transaction.nonce || !this.hasRequiredAudience(payload)) {
        throw authenticationFailed();
      }
      return normalizeActorContext(payload, 'm01');
    } catch {
      throw authenticationFailed();
    }
  }

  dispose(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
    this.transactions.clear();
  }

  private randomValue(): string {
    return base64Url(this.entropy(RANDOM_VALUE_BYTES));
  }

  private pruneExpiredTransactions(): void {
    const now = this.clock();
    for (const [state, transaction] of this.transactions) {
      if (now - transaction.createdAt >= LOGIN_TRANSACTION_TTL_MS) this.transactions.delete(state);
    }
    if (this.transactions.size === 0 && this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private ensureCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.pruneExpiredTransactions(), LOGIN_TRANSACTION_TTL_MS);
    this.cleanupTimer.unref();
  }

  private assertTransactionCapacity(browserBinding: string): void {
    if (this.transactions.size >= MAX_TRANSACTIONS) throw authenticationFailed();
    let bindingTransactions = 0;
    for (const transaction of this.transactions.values()) {
      if (equalBrowserBindings(transaction.browserBinding, browserBinding)) bindingTransactions += 1;
    }
    if (bindingTransactions >= MAX_TRANSACTIONS_PER_BROWSER) throw authenticationFailed();
  }

  private consumeTransaction(state: string): LoginTransaction {
    const transaction = this.transactions.get(state);
    if (!transaction) throw authenticationFailed();
    this.transactions.delete(state);
    if (this.transactions.size === 0 && this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
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
    const response = await this.fetchWithSecurity(discoveryUrl(issuer));
    if (!response.ok) throw authenticationFailed();
    const document: unknown = await response.json();
    if (!isOidcDiscovery(document, this.config.issuer)) throw authenticationFailed();
    if (document.token_endpoint_auth_methods_supported
      && !document.token_endpoint_auth_methods_supported.includes('client_secret_basic')) throw authenticationFailed();
    const value: OidcDiscovery = {
      issuer: document.issuer,
      authorization_endpoint: secureOidcUrl(document.authorization_endpoint),
      token_endpoint: secureOidcUrl(document.token_endpoint),
      jwks_uri: secureOidcUrl(document.jwks_uri),
      ...(document.token_endpoint_auth_methods_supported === undefined
        ? {} : { token_endpoint_auth_methods_supported: document.token_endpoint_auth_methods_supported }),
    };
    this.discoveryCache = { value, expiresAt: this.clock() + OIDC_CACHE_TTL_MS };
    return value;
  }

  private async exchangeCode(discovery: OidcDiscovery, code: string, verifier: string): Promise<string> {
    if (discovery.token_endpoint_auth_methods_supported
      && !discovery.token_endpoint_auth_methods_supported.includes('client_secret_basic')) throw authenticationFailed();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: verifier,
    });
    const basicCredentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const response = await this.fetchWithSecurity(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: `Basic ${basicCredentials}`,
      },
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
    const inFlight = this.jwksInFlight.get(uri);
    if (inFlight) return inFlight;
    const request = this.fetchJwks(uri).finally(() => { this.jwksInFlight.delete(uri); });
    this.jwksInFlight.set(uri, request);
    return request;
  }

  private async fetchJwks(uri: string): Promise<ReturnType<typeof createLocalJWKSet>> {
    const response = await this.fetchWithSecurity(uri);
    if (!response.ok) throw authenticationFailed();
    const document: unknown = await response.json();
    if (!isJwks(document)) throw authenticationFailed();
    const value = createLocalJWKSet(document);
    this.jwksCache = { uri, value, expiresAt: this.clock() + OIDC_CACHE_TTL_MS };
    return value;
  }

  private async fetchWithSecurity(url: string, init: RequestInit = {}): Promise<Response> {
    return this.fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }

  private hasRequiredAudience(payload: { aud?: unknown; azp?: unknown }): boolean {
    const audiences = typeof payload.aud === 'string'
      ? [payload.aud]
      : Array.isArray(payload.aud) && payload.aud.every((audience) => typeof audience === 'string')
        ? payload.aud : [];
    const requiredAudiences = new Set([this.config.clientId, this.config.audience]);
    if (!Array.from(requiredAudiences).every((audience) => audiences.includes(audience))) return false;
    if (payload.azp !== undefined && payload.azp !== this.config.clientId) return false;
    return audiences.length === 1 || payload.azp === this.config.clientId;
  }
}
