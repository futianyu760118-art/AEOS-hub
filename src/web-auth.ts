import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { isLocalDevelopmentEnvironment, type ActorContext } from './auth/actor-context.ts';
import type { AuthenticationAuditEvent } from './authentication-audit.ts';

export const DEFAULT_LOGIN_USERNAME = 'demo';
export const AUTH_COOKIE_NAME = 'aeos_auth';
export const M01_BINDING_COOKIE_NAME = 'aeos_m01_binding';
const AUTH_COOKIE_RE = /(?:^|;\s*)aeos_auth=([0-9a-f-]{36})(?:;|$)/;
const M01_BINDING_COOKIE_RE = /(?:^|;\s*)aeos_m01_binding=([A-Za-z0-9_-]{16,512})(?:;|$)/;
const LOCAL_CONTEXT_VALUE_RE = /^[A-Za-z0-9._:@/-]{1,128}$/;
const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 10_000;

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Compare fixed-length hashes so authentication does not leak a password prefix by timing. */
export function credentialsMatch(account: string, password: string, expectedUsername: string, expectedPassword: string): boolean {
  return timingSafeEqual(digest(account), digest(expectedUsername))
    && timingSafeEqual(digest(password), digest(expectedPassword));
}

export function usernameFromEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  return (env.AEOS_LOGIN_USERNAME ?? DEFAULT_LOGIN_USERNAME).trim() || DEFAULT_LOGIN_USERNAME;
}

export function passwordFromEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const password = env.AEOS_LOGIN_PASSWORD ?? '';
  if (!password.trim()) throw new Error('必须设置 AEOS_LOGIN_PASSWORD，服务不会以未受保护状态启动。');
  return password;
}

export function cookieSecureFromEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.AEOS_COOKIE_SECURE;
  if (!isLocalDevelopmentEnvironment(env)) {
    if (value !== '1') throw new Error('AEOS_COOKIE_SECURE=1 is required outside local development');
    return true;
  }
  if (value === undefined || value === '0') return false;
  if (value === '1') return true;
  throw new Error('AEOS_COOKIE_SECURE must be 0 or 1');
}

export function assertAuthModeAllowedInEnvironment(authMode: 'local-dev' | 'm01', env: NodeJS.ProcessEnv = process.env): void {
  if (!isLocalDevelopmentEnvironment(env)) {
    if (authMode !== 'm01') throw new Error('AEOS_AUTH_MODE=m01 is required outside local development');
    if (env.AEOS_COOKIE_SECURE !== '1') throw new Error('AEOS_COOKIE_SECURE=1 is required outside local development');
  }
}

export function authRoutePolicy(authMode: 'local-dev' | 'm01', pathname: string): { public: boolean; method: 'GET' | 'POST' } | null {
  if (pathname === '/api/auth/login') return { public: true, method: authMode === 'm01' ? 'GET' : 'POST' };
  if (pathname === '/api/auth/callback' && authMode === 'm01') return { public: true, method: 'GET' };
  return null;
}

export function isPublicLoginResource(pathname: string, method: string | undefined): boolean {
  if (method !== 'GET') return false;
  return pathname === '/' || pathname === '/index.html'
    || pathname === '/style.css' || pathname === '/app.js'
    || pathname === '/ui-localization.js'
    || pathname === '/daily-questions.js' || pathname === '/agent-registration.js' || pathname === '/task-center.js' || pathname === '/task-agent-eligibility.js' || pathname === '/personnel-admin.js'
    || pathname === '/vendor/lucide.min.js' || pathname.startsWith('/brand/');
}

export function sessionSummary(actor: ActorContext, authMode: 'local-dev' | 'm01'): Record<string, unknown> {
  return {
    authenticated: true,
    authMode,
    actorId: actor.actorId,
    actorType: actor.actorType,
    tenantId: actor.tenantId,
    roles: actor.roles,
    authSource: actor.authSource,
    ...(actor.organizationId ? { organizationId: actor.organizationId } : {}),
    ...(actor.clientId ? { clientId: actor.clientId } : {}),
  };
}

function localContextValue(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = (env[name] ?? fallback).trim();
  if (!LOCAL_CONTEXT_VALUE_RE.test(value)) throw new Error(`${name} must be a safe non-empty identifier`);
  return value;
}

export function buildLocalDevActor(env: NodeJS.ProcessEnv = process.env, username = usernameFromEnvironment(env)): ActorContext {
  const tenantId = localContextValue(env, 'AEOS_LOCAL_TENANT_ID', 'local-dev');
  const organizationId = localContextValue(env, 'AEOS_LOCAL_ORGANIZATION_ID', 'local-dev');
  const rawRoles = env.AEOS_LOCAL_ROLES ?? 'manager';
  const roles = [...new Set(rawRoles.split(',').map((role) => role.trim()).filter(Boolean))];
  if (!roles.length || roles.some((role) => !LOCAL_CONTEXT_VALUE_RE.test(role))) {
    throw new Error('AEOS_LOCAL_ROLES must be a comma-separated list of safe role identifiers');
  }
  const accountFingerprint = createHash('sha256').update(username, 'utf8').digest('hex').slice(0, 24);
  return {
    actorId: `local-dev:user:${accountFingerprint}`,
    actorType: 'human',
    tenantId,
    organizationId,
    roles,
    authSource: 'local-dev',
  };
}

function cookieAttributes(secure: boolean): string {
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function browserBindingFromCookie(cookieHeader: string | undefined): string | null {
  return M01_BINDING_COOKIE_RE.exec(cookieHeader ?? '')?.[1] ?? null;
}

export function newBrowserBinding(): string {
  return randomUUID();
}

export function bindingCookie(browserBinding: string, secure = false): string {
  return `${M01_BINDING_COOKIE_NAME}=${browserBinding}; ${cookieAttributes(secure)}; Max-Age=300`;
}

export function expiredBindingCookie(secure = false): string {
  return `${M01_BINDING_COOKIE_NAME}=; ${cookieAttributes(secure)}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export type M01BrowserOidc = {
  beginLogin(input: { browserBinding: string; forceReauthentication?: boolean }): Promise<{ redirectUrl: string }>;
  completeLogin(input: { code: string; state: string; browserBinding: string }): Promise<ActorContext>;
  /** Returns the RP-initiated logout URL, or null when the IdP exposes no end session endpoint. */
  endSessionUrl(input: { postLogoutRedirectUri: string }): Promise<string | null>;
};

export type BrowserAuthGateway = {
  login(method: string | undefined, cookieHeader: string | undefined, forceReauthentication?: boolean): Promise<{ status: number; location?: string; cookies?: string[]; error?: string }>;
  callback(method: string | undefined, cookieHeader: string | undefined, code: string, state: string): Promise<{ status: number; location?: string; cookies?: string[]; error?: string }>;
  /** Revokes the Hub session; in M01 mode `redirectTo` also ends the IdP session in the browser. */
  logout(cookieHeader: string | undefined): Promise<{ status: number; cookies: string[]; redirectTo?: string }>;
  session(cookieHeader: string | undefined): Record<string, unknown>;
  isAuthorized(cookieHeader: string | undefined): boolean;
  canAccess(pathname: string, method: string | undefined, cookieHeader: string | undefined): boolean;
  sessionIdFromCookie(cookieHeader: string | undefined): string | null;
  actorIdFromCookie(cookieHeader: string | undefined): string | null;
  /** Returns the server-held actor context for an authorized browser session. */
  actorFromCookie(cookieHeader: string | undefined): ActorContext | null;
};

export function createBrowserAuthGateway(input: {
  authMode: 'local-dev' | 'm01';
  webAuth: BrowserSessionAuth;
  oidc?: M01BrowserOidc;
  /** Explicit M01 roles admitted to the Hub; this is a login boundary, not per-action RBAC. */
  allowedRoles?: readonly string[];
  /** Registered post logout redirect URI, required for M01 RP-initiated logout. */
  postLogoutRedirectUri?: string;
  /** Best-effort, credential-free audit sink for terminal M01 callback outcomes. */
  onAuthenticationAudit?: (event: AuthenticationAuditEvent) => void;
  secureCookies: boolean;
  browserBindingFactory?: () => string;
}): BrowserAuthGateway {
  const allowedRoles = input.authMode === 'm01' ? new Set(input.allowedRoles ?? []) : new Set<string>();
  if (input.authMode === 'm01' && allowedRoles.size === 0) {
    throw new Error('M01 role admission is not configured');
  }
  const expiredAuthenticationCookies = (): string[] => {
    const expiry = `Path=/; HttpOnly; SameSite=Lax${input.secureCookies ? '; Secure' : ''}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    return [input.webAuth.expiredCookie(), `hub_token=; ${expiry}`, `aeos_session=; ${expiry}`, expiredBindingCookie(input.secureCookies)];
  };
  const emitAuthenticationAudit = (event: AuthenticationAuditEvent): void => {
    try { input.onAuthenticationAudit?.(event); } catch { /* Audit availability must not change an authentication response. */ }
  };
  const failure = (cookieHeader: string | undefined, event: Extract<AuthenticationAuditEvent, { type: 'authentication_failed' | 'admission_denied' }>) => {
    emitAuthenticationAudit(event);
    input.webAuth.revoke(cookieHeader);
    return { status: 302, location: '/?auth_error=1', cookies: expiredAuthenticationCookies() };
  };

  return {
    async login(method, cookieHeader, forceReauthentication = false) {
      if (input.authMode !== 'm01') return { status: 404, error: 'not found' };
      if (method !== 'GET') return { status: 405, error: 'method not allowed' };
      try {
        const browserBinding = browserBindingFromCookie(cookieHeader) ?? (input.browserBindingFactory ?? newBrowserBinding)();
        const login = await input.oidc!.beginLogin({ browserBinding, forceReauthentication });
        return { status: 302, location: login.redirectUrl, cookies: [bindingCookie(browserBinding, input.secureCookies)] };
      } catch {
        return { status: 302, location: '/?auth_error=1', cookies: [expiredBindingCookie(input.secureCookies)] };
      }
    },
    async callback(method, cookieHeader, code, state) {
      if (input.authMode !== 'm01') return { status: 404, error: 'not found' };
      if (method !== 'GET') return { status: 405, error: 'method not allowed' };
      try {
        const browserBinding = browserBindingFromCookie(cookieHeader);
        if (!browserBinding) throw new Error('browser binding required');
        const actor = await input.oidc!.completeLogin({ code, state, browserBinding });
        if (actor.roles.length === 0 || !actor.roles.some((role) => allowedRoles.has(role))) {
          return failure(cookieHeader, { type: 'admission_denied', authMode: 'm01', actor });
        }
        // A successful sign-in replaces any authenticated Hub session carried by this browser.
        input.webAuth.revoke(cookieHeader);
        const sessionId = input.webAuth.createSession(actor);
        if (!sessionId) throw new Error('session capacity reached');
        emitAuthenticationAudit({ type: 'login_succeeded', authMode: 'm01', actor });
        return {
          status: 302,
          location: '/',
          cookies: [input.webAuth.sessionCookie(sessionId), expiredBindingCookie(input.secureCookies)],
        };
      } catch {
        return failure(cookieHeader, { type: 'authentication_failed', authMode: 'm01' });
      }
    },
    async logout(cookieHeader) {
      // The Hub session is revoked first: sign-out must succeed locally even when
      // the IdP is unreachable and the browser cannot be redirected to it.
      input.webAuth.revoke(cookieHeader);
      let redirectTo: string | undefined;
      if (input.authMode === 'm01' && input.oidc && input.postLogoutRedirectUri) {
        try {
          redirectTo = (await input.oidc.endSessionUrl({ postLogoutRedirectUri: input.postLogoutRedirectUri })) ?? undefined;
        } catch {
          redirectTo = undefined;
        }
      }
      return { status: 200, cookies: expiredAuthenticationCookies(), ...(redirectTo ? { redirectTo } : {}) };
    },
    session(cookieHeader) {
      const actor = input.webAuth.actorFromCookie(cookieHeader);
      return actor ? sessionSummary(actor, input.authMode) : { authenticated: false, authMode: input.authMode };
    },
    isAuthorized(cookieHeader) {
      return input.webAuth.isAuthorized(cookieHeader);
    },
    canAccess(pathname, method, cookieHeader) {
      return isPublicLoginResource(pathname, method) || input.webAuth.isAuthorized(cookieHeader);
    },
    sessionIdFromCookie(cookieHeader) {
      return input.webAuth.authorizedSessionId(cookieHeader);
    },
    actorIdFromCookie(cookieHeader) {
      return input.webAuth.actorFromCookie(cookieHeader)?.actorId ?? null;
    },
    actorFromCookie(cookieHeader) {
      return input.webAuth.actorFromCookie(cookieHeader);
    },
  };
}

export type SessionSocket = { close(code?: number, reason?: string): void };

/** Tracks sockets by opaque Hub session ID so revocation cannot affect another session for the same actor. */
export class SessionSocketRegistry {
  private readonly sessionSockets = new Map<string, Set<SessionSocket>>();
  private readonly socketSessions = new Map<SessionSocket, string>();

  attach(sessionId: string, socket: SessionSocket): void {
    this.detach(socket);
    const sockets = this.sessionSockets.get(sessionId) ?? new Set<SessionSocket>();
    sockets.add(socket);
    this.sessionSockets.set(sessionId, sockets);
    this.socketSessions.set(socket, sessionId);
  }

  detach(socket: SessionSocket): void {
    const sessionId = this.socketSessions.get(socket);
    if (!sessionId) return;
    this.socketSessions.delete(socket);
    const sockets = this.sessionSockets.get(sessionId);
    sockets?.delete(socket);
    if (sockets?.size === 0) this.sessionSockets.delete(sessionId);
  }

  closeSession(sessionId: string): void {
    const sockets = this.sessionSockets.get(sessionId);
    if (!sockets) return;
    this.sessionSockets.delete(sessionId);
    for (const socket of sockets) {
      this.socketSessions.delete(socket);
      socket.close(1008, 'Session revoked');
    }
  }
}

type SessionRecord = {
  actor: ActorContext;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
};

export type BrowserSessionAuthOptions = {
  secureCookies?: boolean;
  now?: () => number;
  idleTtlMs?: number;
  absoluteTtlMs?: number;
  maxSessions?: number;
  onSessionRevoked?: (sessionId: string) => void;
};

export class BrowserSessionAuth {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly username: string;
  private readonly password: string;
  private readonly localActor: ActorContext;
  private readonly secureCookies: boolean;
  private readonly clock: () => number;
  private readonly idleTtlMs: number;
  private readonly absoluteTtlMs: number;
  private readonly maxSessions: number;
  private readonly onSessionRevoked?: (sessionId: string) => void;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    username: string,
    password: string,
    localActor: ActorContext = buildLocalDevActor({}, username),
    options: boolean | BrowserSessionAuthOptions = false,
  ) {
    const configuration: BrowserSessionAuthOptions = typeof options === 'boolean' ? { secureCookies: options } : options;
    this.username = username;
    this.password = password;
    this.localActor = localActor;
    this.secureCookies = configuration.secureCookies ?? false;
    this.clock = configuration.now ?? Date.now;
    this.idleTtlMs = configuration.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.absoluteTtlMs = configuration.absoluteTtlMs ?? DEFAULT_ABSOLUTE_TTL_MS;
    this.maxSessions = configuration.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.onSessionRevoked = configuration.onSessionRevoked;
    if (!Number.isFinite(this.idleTtlMs) || this.idleTtlMs <= 0 || !Number.isFinite(this.absoluteTtlMs) || this.absoluteTtlMs <= 0 || !Number.isInteger(this.maxSessions) || this.maxSessions <= 0) {
      throw new Error('Browser session limits must be positive');
    }
    this.cleanupTimer = setInterval(() => this.pruneExpired(), Math.min(this.idleTtlMs, 60_000));
    this.cleanupTimer.unref();
  }

  login(account: string, password: string): string | null {
    if (!credentialsMatch(account, password, this.username, this.password)) return null;
    return this.createSession(this.localActor);
  }

  loginReplacing(cookieHeader: string | undefined, account: string, password: string): string | null {
    if (!credentialsMatch(account, password, this.username, this.password)) return null;
    this.revoke(cookieHeader);
    return this.createSession(this.localActor);
  }

  createSession(actor: ActorContext): string | null {
    this.pruneExpired();
    if (this.sessions.size >= this.maxSessions) return null;
    const now = this.clock();
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { actor, createdAt: now, lastSeenAt: now, expiresAt: now + this.absoluteTtlMs });
    return sessionId;
  }

  isAuthorized(cookieHeader: string | undefined): boolean {
    return this.actorFromCookie(cookieHeader) !== null;
  }

  actorFromCookie(cookieHeader: string | undefined): ActorContext | null {
    const sessionId = this.authorizedSessionId(cookieHeader);
    return sessionId ? this.sessions.get(sessionId)!.actor : null;
  }

  authorizedSessionId(cookieHeader: string | undefined): string | null {
    const sessionId = this.sessionId(cookieHeader);
    if (!sessionId) return null;
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const now = this.clock();
    if (now >= session.expiresAt || now - session.lastSeenAt >= this.idleTtlMs) {
      this.removeSession(sessionId);
      return null;
    }
    session.lastSeenAt = now;
    return sessionId;
  }

  revoke(cookieHeader: string | undefined): string | null {
    const sessionId = this.sessionId(cookieHeader);
    if (!sessionId || !this.sessions.has(sessionId)) return null;
    this.removeSession(sessionId);
    return sessionId;
  }

  sessionCookie(sessionId: string): string {
    // Deliberately no Max-Age / Expires: the browser discards it when closed.
    return `${AUTH_COOKIE_NAME}=${sessionId}; ${cookieAttributes(this.secureCookies)}`;
  }

  expiredCookie(): string {
    return `${AUTH_COOKIE_NAME}=; ${cookieAttributes(this.secureCookies)}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }

  private sessionId(cookieHeader: string | undefined): string | null {
    return AUTH_COOKIE_RE.exec(cookieHeader ?? '')?.[1] ?? null;
  }

  private pruneExpired(): void {
    const now = this.clock();
    for (const [sessionId, session] of this.sessions) {
      if (now >= session.expiresAt || now - session.lastSeenAt >= this.idleTtlMs) this.removeSession(sessionId);
    }
  }

  private removeSession(sessionId: string): void {
    if (!this.sessions.delete(sessionId)) return;
    try { this.onSessionRevoked?.(sessionId); } catch { /* session revocation must not fail open */ }
  }
}
