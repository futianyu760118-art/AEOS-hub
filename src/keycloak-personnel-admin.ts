// Keycloak Admin REST boundary for Hub personnel administration.
//
// This module is the only place the Hub talks to Keycloak's Admin API. It uses
// a dedicated confidential service client (aeos-hub-personnel-admin) with
// client-credentials grants, keeps the access token only in process memory, and
// returns only a safe, scope-filtered projection. Upstream responses, tokens,
// credentials, and arbitrary user attributes never leave this boundary.
import { PERSONNEL_PILOT_ROLES, type PilotRole } from './personnel-authorization.ts';

export type PersonnelScope = { demoTenantId: string; organizationScope: string };

export type PersonnelUser = {
  id: string;
  actorId: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  tenantId: string;
  organizationId: string;
  roles: PilotRole[];
};

export type CreatePersonnelUserInput = {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  roles: PilotRole[];
  temporaryPassword: string;
};

export type UpdatePersonnelUserInput = {
  enabled?: boolean;
  email?: string;
  firstName?: string;
  lastName?: string;
};

export type KeycloakPersonnelAdminConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
};

export type KeycloakPersonnelAdminDependencies = {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
};

export type KeycloakPersonnelFailureKind =
  | 'unavailable'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'not_found'
  | 'invalid';

const USER_SAFE_MESSAGES: Record<KeycloakPersonnelFailureKind, string> = {
  unavailable: '身份服务暂不可用，请稍后重试',
  unauthorized: '身份服务鉴权失败',
  forbidden: '身份服务权限不足',
  conflict: '用户名已存在或与现有账号冲突',
  not_found: '目标用户不存在或不在当前范围',
  invalid: '身份服务返回了无法识别的数据',
};

export class KeycloakPersonnelError extends Error {
  readonly kind: KeycloakPersonnelFailureKind;

  constructor(kind: KeycloakPersonnelFailureKind) {
    super(USER_SAFE_MESSAGES[kind]);
    this.name = 'KeycloakPersonnelError';
    this.kind = kind;
  }
}

/**
 * A create that committed the Keycloak user but could not complete role
 * assignment or the read-back. The user exists with a valid temporary password,
 * so callers must report the partial commit instead of a plain failure.
 */
export class KeycloakPersonnelPartialCommitError extends Error {
  readonly actorId: string;

  constructor(userId: string) {
    super('用户已创建，但角色分配或回读未完成');
    this.name = 'KeycloakPersonnelPartialCommitError';
    this.actorId = `m01:user:${userId}`;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_LIST_MAX = 100;
export const MAX_LIST = 500;
const TOKEN_SKEW_MS = 30_000;
const TENANT_ATTRIBUTE = 'tenant_id';
const ORGANIZATION_ATTRIBUTE = 'organization_id';

type RawUser = {
  id?: unknown;
  username?: unknown;
  email?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  enabled?: unknown;
  attributes?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function attributeValue(attributes: unknown, name: string): string | undefined {
  if (!isRecord(attributes)) return undefined;
  const value = attributes[name];
  if (!Array.isArray(value)) return typeof value === 'string' ? value : undefined;
  const first = value.find((item): item is string => typeof item === 'string');
  return first ? first.trim() : undefined;
}

function pilotRoles(names: unknown): PilotRole[] {
  if (!Array.isArray(names)) return [];
  return PERSONNEL_PILOT_ROLES.filter((role) => names.some((name) => name === role));
}

/**
 * Reads the optional personnel service-client configuration. It fails closed:
 * administration stays disabled unless the feature flag is enabled and a
 * non-sentinel client secret is present.
 */
export type PersonnelAdminConfig =
  | { enabled: false }
  | { enabled: true; issuer: string; clientId: string; clientSecret: string };

const SENTINEL = '__REPLACE_BEFORE_START__';

export function readPersonnelAdminConfig(
  environment: NodeJS.ProcessEnv,
  issuer: string,
): PersonnelAdminConfig {
  const enabledValue = environment.M01_PERSONNEL_ADMIN_ENABLED;
  const enabled = enabledValue === '1' || enabledValue === 'true';
  if (!enabled) return { enabled: false };
  const clientSecret = (environment.M01_PERSONNEL_ADMIN_CLIENT_SECRET ?? '').trim();
  if (!clientSecret || clientSecret === SENTINEL) return { enabled: false };
  const clientId = (environment.M01_PERSONNEL_ADMIN_CLIENT_ID ?? '').trim() || 'aeos-hub-personnel-admin';
  return { enabled: true, issuer, clientId, clientSecret };
}

type ParsedIssuer = { origin: string; realm: string };

function parseIssuer(issuer: string): ParsedIssuer {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    throw new KeycloakPersonnelError('invalid');
  }
  if (url.protocol !== 'https:' || !url.host || url.username || url.password || url.search || url.hash) {
    throw new KeycloakPersonnelError('invalid');
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const realm = segments[segments.length - 1];
  if (!realm || realm !== 'aeos' || segments[segments.length - 2] !== 'realms') {
    throw new KeycloakPersonnelError('invalid');
  }
  return { origin: url.origin, realm };
}

export class KeycloakPersonnelAdmin {
  private readonly config: KeycloakPersonnelAdminConfig;
  private readonly fetcher: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly clock: () => number;
  private readonly origin: string;
  private readonly realm: string;
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private roleCache = new Map<string, { id: string; name: string }>();

  constructor(config: KeycloakPersonnelAdminConfig, dependencies: KeycloakPersonnelAdminDependencies = {}) {
    if (!config.clientSecret || config.clientSecret === SENTINEL) throw new KeycloakPersonnelError('invalid');
    const parsed = parseIssuer(config.issuer);
    this.config = config;
    this.fetcher = dependencies.fetch ?? ((input, init) => fetch(input, init));
    this.clock = dependencies.now ?? Date.now;
    this.origin = parsed.origin;
    this.realm = parsed.realm;
  }

  private get adminBase(): string {
    return `${this.origin}/admin/realms/${this.realm}`;
  }

  async listUsers(scope: PersonnelScope, options: { search?: string; max?: number; first?: number } = {}): Promise<PersonnelUser[]> {
    const max = Math.min(Math.max(Number(options.max) || DEFAULT_LIST_MAX, 1), MAX_LIST);
    const first = Math.max(Number(options.first) || 0, 0);
    const search = typeof options.search === 'string' ? options.search.trim() : '';
    const response = await this.adminRequest('GET', '/users', {
      query: { max: String(max), first: String(first), ...(search ? { search } : {}) },
    });
    const users: PersonnelUser[] = [];
    for (const raw of this.asArray(response.json)) {
      const projected = this.projectUser(raw, scope);
      if (projected) users.push(await this.withRoles(projected));
    }
    return users;
  }

  async getUser(scope: PersonnelScope, userId: string): Promise<PersonnelUser> {
    const raw = await this.rawUser(scope, userId);
    return this.withRoles(raw.user);
  }

  async createUser(scope: PersonnelScope, input: CreatePersonnelUserInput): Promise<PersonnelUser> {
    const body = {
      username: input.username,
      enabled: input.enabled ?? true,
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      attributes: {
        [TENANT_ATTRIBUTE]: [scope.demoTenantId],
        [ORGANIZATION_ATTRIBUTE]: [scope.organizationScope],
      },
      credentials: [{ type: 'password', value: input.temporaryPassword, temporary: true }],
    };
    const response = await this.adminRequest('POST', '/users', { body });
    const location = response.location;
    const match = location ? /\/([^/]+)\/?$/.exec(location) : null;
    const userId = match?.[1];
    if (!userId) throw new KeycloakPersonnelError('invalid');
    try {
      await this.setPilotRoles(scope, userId, input.roles);
      return await this.getUser(scope, userId);
    } catch (error) {
      // The user (with a valid temporary password and scope attributes) is now
      // committed. Never report a plain failure for a committed create.
      if (error instanceof KeycloakPersonnelError) throw new KeycloakPersonnelPartialCommitError(userId);
      throw error;
    }
  }

  async updateUser(scope: PersonnelScope, userId: string, input: UpdatePersonnelUserInput): Promise<PersonnelUser> {
    const { raw } = await this.rawUser(scope, userId);
    const body = {
      username: typeof raw.username === 'string' ? raw.username : '',
      enabled: input.enabled ?? (raw.enabled === true),
      email: input.email !== undefined ? input.email : (typeof raw.email === 'string' ? raw.email : undefined),
      firstName: input.firstName !== undefined ? input.firstName : (typeof raw.firstName === 'string' ? raw.firstName : undefined),
      lastName: input.lastName !== undefined ? input.lastName : (typeof raw.lastName === 'string' ? raw.lastName : undefined),
      attributes: isRecord(raw.attributes) ? raw.attributes : {},
    };
    await this.adminRequest('PUT', `/users/${encodeURIComponent(userId)}`, { body });
    return this.getUser(scope, userId);
  }

  async resetTemporaryPassword(scope: PersonnelScope, userId: string, temporaryPassword: string): Promise<PersonnelUser> {
    await this.rawUser(scope, userId);
    await this.adminRequest('PUT', `/users/${encodeURIComponent(userId)}/reset-password`, {
      body: { type: 'password', value: temporaryPassword, temporary: true },
    });
    return this.getUser(scope, userId);
  }

  async deleteUser(scope: PersonnelScope, userId: string): Promise<{ actorId: string }> {
    const user = await this.rawUser(scope, userId);
    await this.adminRequest('DELETE', `/users/${encodeURIComponent(userId)}`);
    return { actorId: user.user.actorId };
  }

  async setPilotRoles(scope: PersonnelScope, userId: string, roles: readonly PilotRole[]): Promise<PersonnelUser> {
    await this.rawUser(scope, userId);
    const requested = new Set(roles);
    const current = await this.currentPilotRoles(userId);
    const currentNames = new Set(current.map((role) => role.name));
    const toAdd = [...requested].filter((name) => !currentNames.has(name));
    const toRemove = current.filter((role) => !requested.has(role.name));

    for (const name of toAdd) {
      const role = await this.realmRole(name);
      await this.adminRequest('POST', `/users/${encodeURIComponent(userId)}/role-mappings/realm`, { body: [role] });
    }
    if (toRemove.length) {
      await this.adminRequest('DELETE', `/users/${encodeURIComponent(userId)}/role-mappings/realm`, { body: toRemove });
    }

    return this.getUser(scope, userId);
  }

  private async rawUser(scope: PersonnelScope, userId: string): Promise<{ raw: RawUser; user: PersonnelUser }> {
    const response = await this.adminRequest('GET', `/users/${encodeURIComponent(userId)}`);
    if (!isRecord(response.json)) throw new KeycloakPersonnelError('invalid');
    const raw = response.json as unknown as RawUser;
    const user = this.projectUser(raw, scope);
    if (!user) throw new KeycloakPersonnelError('not_found');
    return { raw, user };
  }

  private async withRoles(user: PersonnelUser): Promise<PersonnelUser> {
    const names = await this.realmRoleNames(user.id);
    return { ...user, roles: pilotRoles(names) };
  }

  private async currentPilotRoles(userId: string): Promise<Array<{ id: string; name: PilotRole }>> {
    const response = await this.adminRequest('GET', `/users/${encodeURIComponent(userId)}/role-mappings/realm`);
    const mappings = this.asArray(response.json);
    return mappings
      .filter(isRecord)
      .map((mapping) => ({ id: typeof mapping.id === 'string' ? mapping.id : '', name: mapping.name }))
      .filter((entry): entry is { id: string; name: PilotRole } => (PERSONNEL_PILOT_ROLES as readonly string[]).includes(String(entry.name)));
  }

  private async realmRoleNames(userId: string): Promise<string[]> {
    const response = await this.adminRequest('GET', `/users/${encodeURIComponent(userId)}/role-mappings/realm`);
    return this.asArray(response.json)
      .filter(isRecord)
      .map((mapping) => mapping.name)
      .filter((name): name is string => typeof name === 'string');
  }

  private async realmRole(name: PilotRole): Promise<{ id: string; name: string }> {
    const cached = this.roleCache.get(name);
    if (cached) return cached;
    const response = await this.adminRequest('GET', `/roles/${encodeURIComponent(name)}`);
    if (!isRecord(response.json) || typeof response.json.id !== 'string') throw new KeycloakPersonnelError('invalid');
    const role = { id: response.json.id, name };
    this.roleCache.set(name, role);
    return role;
  }

  private projectUser(raw: RawUser, scope: PersonnelScope): PersonnelUser | null {
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const username = typeof raw.username === 'string' ? raw.username.trim() : '';
    if (!id || !username) return null;
    const attributes = raw.attributes;
    const tenantId = attributeValue(attributes, TENANT_ATTRIBUTE);
    const organizationId = attributeValue(attributes, ORGANIZATION_ATTRIBUTE);
    if (tenantId !== scope.demoTenantId || organizationId !== scope.organizationScope) return null;
    const enabled = raw.enabled === true;
    return {
      id,
      actorId: `m01:user:${id}`,
      username,
      ...(typeof raw.email === 'string' && raw.email.trim() ? { email: raw.email.trim() } : {}),
      ...(typeof raw.firstName === 'string' && raw.firstName.trim() ? { firstName: raw.firstName.trim() } : {}),
      ...(typeof raw.lastName === 'string' && raw.lastName.trim() ? { lastName: raw.lastName.trim() } : {}),
      enabled,
      tenantId,
      organizationId,
      roles: [],
    };
  }

  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.accessTokenExpiresAt > this.clock() + TOKEN_SKEW_MS) return this.accessToken;
    const url = `${this.origin}/realms/${this.realm}/protocol/openid-connect/token`;
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: `Basic ${basic}` },
        body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new KeycloakPersonnelError('unavailable');
    }
    if (!response.ok) throw this.errorForStatus(response.status);
    const data: unknown = await response.json().catch(() => null);
    if (!isRecord(data) || typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
      throw new KeycloakPersonnelError('invalid');
    }
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = this.clock() + data.expires_in * 1000;
    return this.accessToken;
  }

  private async adminRequest(
    method: string,
    path: string,
    options: { body?: unknown; query?: Record<string, string> } = {},
  ): Promise<{ status: number; ok: boolean; json: unknown; location?: string }> {
    const token = await this.token();
    const url = new URL(`${this.adminBase}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.fetcher(url.toString(), {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new KeycloakPersonnelError('unavailable');
    }
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // A 401/403 usually means the service-client secret was rotated; drop the
      // cached token so the next request re-authenticates instead of replaying it.
      if (response.status === 401 || response.status === 403) {
        this.accessToken = null;
        this.accessTokenExpiresAt = 0;
      }
      throw this.errorForStatus(response.status);
    }
    return { status: response.status, ok: response.ok, json, location: response.headers.get('location') ?? undefined };
  }

  private errorForStatus(status: number): KeycloakPersonnelError {
    if (status === 401) return new KeycloakPersonnelError('unauthorized');
    if (status === 403) return new KeycloakPersonnelError('forbidden');
    if (status === 404) return new KeycloakPersonnelError('not_found');
    if (status === 409) return new KeycloakPersonnelError('conflict');
    return new KeycloakPersonnelError('unavailable');
  }
}
