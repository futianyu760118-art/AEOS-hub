import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ActorContext } from './auth/actor-context.ts';

export const DEFAULT_LOGIN_USERNAME = 'demo';
export const AUTH_COOKIE_NAME = 'aeos_auth';
export const M01_BINDING_COOKIE_NAME = 'aeos_m01_binding';
const AUTH_COOKIE_RE = /(?:^|;\s*)aeos_auth=([0-9a-f-]{36})(?:;|$)/;
const M01_BINDING_COOKIE_RE = /(?:^|;\s*)aeos_m01_binding=([A-Za-z0-9_-]{16,512})(?:;|$)/;
const LOCAL_CONTEXT_VALUE_RE = /^[A-Za-z0-9._:@/-]{1,128}$/;

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
  if (value === undefined || value === '0') return false;
  if (value === '1') return true;
  throw new Error('AEOS_COOKIE_SECURE must be 0 or 1');
}

export function assertAuthModeAllowedInEnvironment(authMode: 'local-dev' | 'm01', env: NodeJS.ProcessEnv = process.env): void {
  if (authMode === 'local-dev' && (env.NODE_ENV === 'production' || env.AEOS_ENV === 'production')) {
    throw new Error('AEOS_AUTH_MODE=local-dev is not permitted in production');
  }
}

export function authRoutePolicy(authMode: 'local-dev' | 'm01', pathname: string): { public: boolean; method: 'GET' | 'POST' } | null {
  if (pathname === '/api/auth/login') return { public: true, method: authMode === 'm01' ? 'GET' : 'POST' };
  if (pathname === '/api/auth/callback' && authMode === 'm01') return { public: true, method: 'GET' };
  return null;
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

export class BrowserSessionAuth {
  private readonly sessions = new Map<string, ActorContext>();
  private readonly username: string;
  private readonly password: string;
  private readonly localActor: ActorContext;
  private readonly secureCookies: boolean;

  constructor(username: string, password: string, localActor: ActorContext = buildLocalDevActor({}, username), secureCookies = false) {
    this.username = username;
    this.password = password;
    this.localActor = localActor;
    this.secureCookies = secureCookies;
  }

  login(account: string, password: string): string | null {
    if (!credentialsMatch(account, password, this.username, this.password)) return null;
    const sessionId = randomUUID();
    this.sessions.set(sessionId, this.localActor);
    return sessionId;
  }

  createSession(actor: ActorContext): string {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, actor);
    return sessionId;
  }

  isAuthorized(cookieHeader: string | undefined): boolean {
    return this.actorFromCookie(cookieHeader) !== null;
  }

  actorFromCookie(cookieHeader: string | undefined): ActorContext | null {
    const sessionId = this.sessionId(cookieHeader);
    return sessionId ? this.sessions.get(sessionId) ?? null : null;
  }

  revoke(cookieHeader: string | undefined): void {
    const sessionId = this.sessionId(cookieHeader);
    if (sessionId) this.sessions.delete(sessionId);
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
}
