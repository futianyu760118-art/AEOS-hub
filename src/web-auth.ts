import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export const DEFAULT_LOGIN_USERNAME = 'demo';
export const AUTH_COOKIE_NAME = 'aeos_auth';
const AUTH_COOKIE_RE = /(?:^|;\s*)aeos_auth=([0-9a-f-]{36})(?:;|$)/;

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

export class BrowserSessionAuth {
  private readonly sessions = new Set<string>();
  private readonly username: string;
  private readonly password: string;

  constructor(username: string, password: string) {
    this.username = username;
    this.password = password;
  }

  login(account: string, password: string): string | null {
    if (!credentialsMatch(account, password, this.username, this.password)) return null;
    const sessionId = randomUUID();
    this.sessions.add(sessionId);
    return sessionId;
  }

  isAuthorized(cookieHeader: string | undefined): boolean {
    const sessionId = this.sessionId(cookieHeader);
    return sessionId !== null && this.sessions.has(sessionId);
  }

  revoke(cookieHeader: string | undefined): void {
    const sessionId = this.sessionId(cookieHeader);
    if (sessionId) this.sessions.delete(sessionId);
  }

  sessionCookie(sessionId: string): string {
    // Deliberately no Max-Age / Expires: the browser discards it when closed.
    return `${AUTH_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;
  }

  expiredCookie(): string {
    return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }

  private sessionId(cookieHeader: string | undefined): string | null {
    return AUTH_COOKIE_RE.exec(cookieHeader ?? '')?.[1] ?? null;
  }
}
