// HTTP-neutral boundary for Hub personnel administration. Identity and scope
// come only from the server's authenticated session; browser body identity or
// scope fields are never parsed or copied into Keycloak or the audit log.
import type { EvidenceInput } from './evidence.ts';
import type { G0DecisionRegisterStore } from './g0-decision-register.ts';
import {
  PERSONNEL_PILOT_ROLES,
  authorizePersonnelAction,
  authorizePersonnelOnboarding,
  type PilotRole,
  type PersonnelAuthorizationScope,
} from './personnel-authorization.ts';
import {
  KeycloakPersonnelError,
  KeycloakPersonnelPartialCommitError,
  KeycloakPersonnelAdmin,
  MAX_LIST,
  type CreatePersonnelUserInput,
  type PersonnelScope,
  type PersonnelUser,
  type UpdatePersonnelUserInput,
} from './keycloak-personnel-admin.ts';

export type PersonnelApiActor = {
  actorId: string;
  actorType: 'human' | 'service' | 'agent' | 'system';
  tenantId: string;
  organizationId?: string;
  roles: readonly string[];
};

export type PersonnelApiResponse = { status: number; body: Record<string, unknown> };
export type PersonnelApiRequest = {
  method: string | undefined;
  pathname: string;
  actor: PersonnelApiActor | null;
  body?: Record<string, unknown>;
  /** Set only by the server when this route's JSON body could not be parsed. */
  bodyParseFailed?: boolean;
  search?: string;
};

type PersonnelApiDependencies = {
  admin: KeycloakPersonnelAdmin | null;
  g0DecisionStore: Pick<G0DecisionRegisterStore, 'load'>;
  appendEvidence: (input: EvidenceInput) => unknown;
};

class PersonnelApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const PERSONNEL_OBJECT_REF = 'hub://system/personnel';
const MAX_PASSWORD_CHARS = 1024;
const MAX_NAME_CHARS = 160;

function decoded(value: string): string {
  try { return decodeURIComponent(value).trim(); } catch { throw new PersonnelApiError(400, '用户标识无效'); }
}

function textField(body: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new PersonnelApiError(400, `${key} 必须是字符串`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new PersonnelApiError(400, `${key} 过长`);
  return trimmed;
}

function booleanField(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new PersonnelApiError(400, `${key} 必须是布尔值`);
  return value;
}

function rolesField(body: Record<string, unknown>, key: string): PilotRole[] {
  const value = body[key];
  if (!Array.isArray(value)) throw new PersonnelApiError(400, `${key} 必须是角色数组`);
  const roles: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) roles.push(item.trim());
  }
  const unique = [...new Set(roles)];
  if (unique.some((role) => !(PERSONNEL_PILOT_ROLES as readonly string[]).includes(role))) {
    throw new PersonnelApiError(400, '只能分配 manager、operator、owner 三种角色');
  }
  return unique as PilotRole[];
}

function hubRolesField(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value)) throw new PersonnelApiError(400, `${key} 必须是角色数组`);
  const unique = [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
  if (!unique.length || unique.some((role) => !/^[a-z][a-z0-9_]{1,79}$/.test(role))) {
    throw new PersonnelApiError(400, '角色编码无效');
  }
  return unique;
}

export class PersonnelApi {
  private readonly dependencies: PersonnelApiDependencies;

  constructor(dependencies: PersonnelApiDependencies) {
    this.dependencies = dependencies;
  }

  async handle(request: PersonnelApiRequest): Promise<PersonnelApiResponse | null> {
    if (!this.isPersonnelRoute(request.pathname)) return null;
    if (!request.actor) return { status: 401, body: { error: 'authentication required' } };
    if (!this.dependencies.admin) return { status: 503, body: { error: 'personnel administration is not enabled' } };
    try {
      if (this.isOnboardingRoute(request.pathname)) {
        return await this.handleOnboarding({ ...request, actor: request.actor, body: request.body ?? {} });
      }
      return await this.handleAuthorized({ ...request, actor: request.actor, body: request.body ?? {} });
    } catch (error) {
      if (error instanceof KeycloakPersonnelPartialCommitError) {
        const auditStatus = this.auditPartialCommit(request.actor, error.actorId);
        return {
          status: 201,
          body: {
            actorId: error.actorId,
            committed: true,
            partial: true,
            auditStatus,
            ...(auditStatus === 'failed' ? { warning: 'user created but completion and audit events were not recorded' } : { warning: '用户已创建，但角色分配或回读未完成；请刷新人员列表核对' }),
          },
        };
      }
      if (error instanceof KeycloakPersonnelError) {
        return { status: this.statusForKind(error.kind), body: { error: error.message } };
      }
      const status = error instanceof PersonnelApiError ? error.status : 400;
      return { status, body: { error: (error as Error).message } };
    }
  }

  private isPersonnelRoute(pathname: string): boolean {
    return pathname.startsWith('/api/system/personnel/');
  }

  private isOnboardingRoute(pathname: string): boolean {
    return pathname === '/api/system/personnel/onboarding/users';
  }

  /** First-time onboarding: create/list G0-needed accounts in the caller's own session scope. */
  private async handleOnboarding(request: PersonnelApiRequest & { actor: PersonnelApiActor; body: Record<string, unknown> }): Promise<PersonnelApiResponse> {
    const { method, pathname, actor, body } = request;
    const denied = this.onboardingDenied(actor);
    if (denied) return denied;
    const scope = this.sessionScope(actor);

    if (pathname === '/api/system/personnel/onboarding/users') {
      if (method === 'GET') {
        const users = await this.dependencies.admin!.listUsers(scope, { search: request.search });
        return { status: 200, body: { users, total: users.length } };
      }
      if (method === 'POST') {
        if (request.bodyParseFailed) return this.invalidRequest(actor, 'onboard_create');
        const input = this.parseCreateInput(body);
        const user = await this.dependencies.admin!.createUser(scope, input);
        const auditStatus = this.auditAccepted(actor, 'personnel_user_onboarded', user, { roles: input.roles });
        return this.acceptedResponse(201, user, auditStatus);
      }
      return { status: 405, body: { error: 'method not allowed' } };
    }

    return { status: 404, body: { error: 'personnel endpoint not found' } };
  }

  private onboardingDenied(actor: PersonnelApiActor): PersonnelApiResponse | null {
    const decision = authorizePersonnelOnboarding({
      actorId: actor.actorId,
      actorType: actor.actorType,
      tenantId: actor.tenantId,
      organizationId: actor.organizationId,
      roles: actor.roles,
    });
    if (decision.allowed) return null;
    return this.denied(actor, 'onboard', decision.code);
  }

  /** The onboarding scope is the caller's authenticated session scope, never the browser body. */
  private sessionScope(actor: PersonnelApiActor): PersonnelScope {
    return { demoTenantId: actor.tenantId, organizationScope: actor.organizationId! };
  }

  private async handleAuthorized(request: PersonnelApiRequest & { actor: PersonnelApiActor; body: Record<string, unknown> }): Promise<PersonnelApiResponse> {
    const { method, pathname, actor, body } = request;
    const scope = this.personnelScope(actor);

    if (pathname === '/api/system/personnel/users') {
      if (method === 'GET') {
        const denied = this.baseDenied(actor, 'list', scope);
        if (denied) return denied;
        const users = await this.dependencies.admin!.listUsers(this.g0Scope(scope)!, { search: request.search });
        return { status: 200, body: { users, total: users.length } };
      }
      if (method === 'POST') {
        if (request.bodyParseFailed) return this.invalidRequest(actor, 'create');
        const input = this.parseCreateInput(body);
        const denied = this.baseDenied(actor, 'create', scope, input.roles);
        if (denied) return denied;
        const user = await this.dependencies.admin!.createUser(this.g0Scope(scope)!, input);
        const auditStatus = this.auditAccepted(actor, 'personnel_user_created', user, { roles: input.roles });
        return this.acceptedResponse(201, user, auditStatus);
      }
      return { status: 405, body: { error: 'method not allowed' } };
    }

    const detailMatch = pathname.match(/^\/api\/system\/personnel\/users\/([^/]+)$/);
    if (detailMatch && method === 'PATCH') {
      if (request.bodyParseFailed) return this.invalidRequest(actor, 'update');
      const input = this.parseUpdateInput(body);
      let denied = this.baseDenied(actor, 'update', scope);
      if (denied) return denied;
      const userId = decoded(detailMatch[1] ?? '');
      const target = await this.requireTarget(scope, userId);
      const activeManagers = input.enabled === false ? await this.activeManagerActorIds(this.g0Scope(scope)!) : [];
      denied = this.targetDenied(actor, 'update', scope, target, undefined, input.enabled, activeManagers);
      if (denied) return denied;
      const user = await this.dependencies.admin!.updateUser(this.g0Scope(scope)!, userId, input);
      const auditStatus = this.auditAccepted(actor, 'personnel_user_updated', user, { fields: Object.keys(input) });
      return this.acceptedResponse(200, user, auditStatus);
    }

    if (detailMatch && method === 'DELETE') {
      let denied = this.baseDenied(actor, 'delete', scope);
      if (denied) return denied;
      const userId = decoded(detailMatch[1] ?? '');
      const target = await this.requireTarget(scope, userId);
      const activeManagers = await this.activeManagerActorIds(this.g0Scope(scope)!);
      denied = this.targetDenied(actor, 'delete', scope, target, undefined, undefined, activeManagers);
      if (denied) return denied;
      const deleted = await this.dependencies.admin!.deleteUser(this.g0Scope(scope)!, userId);
      const auditStatus = this.auditDelete(actor, deleted.actorId);
      return { status: 200, body: { actorId: deleted.actorId, committed: true, auditStatus } };
    }

    const rolesMatch = pathname.match(/^\/api\/system\/personnel\/users\/([^/]+)\/roles$/);
    if (rolesMatch && method === 'PUT') {
      if (request.bodyParseFailed) return this.invalidRequest(actor, 'set_roles');
      const roles = hubRolesField(body, 'roles');
      let denied = this.baseDenied(actor, 'set_roles', scope, roles);
      if (denied) return denied;
      const userId = decoded(rolesMatch[1] ?? '');
      const target = await this.requireTarget(scope, userId);
      const activeManagers = await this.activeManagerActorIds(this.g0Scope(scope)!);
      denied = this.targetDenied(actor, 'set_roles', scope, target, roles, undefined, activeManagers);
      if (denied) return denied;
      const user = await this.dependencies.admin!.setHubRoles(this.g0Scope(scope)!, userId, roles);
      const auditStatus = this.auditAccepted(actor, 'personnel_roles_replaced', user, { roles });
      return this.acceptedResponse(200, user, auditStatus);
    }

    const resetMatch = pathname.match(/^\/api\/system\/personnel\/users\/([^/]+)\/reset-password$/);
    if (resetMatch && method === 'POST') {
      if (request.bodyParseFailed) return this.invalidRequest(actor, 'reset_password');
      const password = textField(body, 'temporaryPassword', MAX_PASSWORD_CHARS);
      if (!password) throw new PersonnelApiError(400, 'temporaryPassword 不能为空');
      const denied = this.baseDenied(actor, 'reset_password', scope);
      if (denied) return denied;
      const userId = decoded(resetMatch[1] ?? '');
      await this.requireTarget(scope, userId);
      const user = await this.dependencies.admin!.resetTemporaryPassword(this.g0Scope(scope)!, userId, password);
      const auditStatus = this.auditAccepted(actor, 'personnel_password_reset', user, { temporary: true });
      return this.acceptedResponse(200, user, auditStatus);
    }

    throw new PersonnelApiError(404, 'personnel endpoint not found');
  }

  private statusForKind(kind: KeycloakPersonnelError['kind']): number {
    if (kind === 'not_found') return 404;
    if (kind === 'conflict') return 409;
    return 503;
  }

  private parseCreateInput(body: Record<string, unknown>): CreatePersonnelUserInput {
    const username = textField(body, 'username', MAX_NAME_CHARS);
    if (!username) throw new PersonnelApiError(400, 'username 不能为空');
    const password = textField(body, 'temporaryPassword', MAX_PASSWORD_CHARS);
    if (!password) throw new PersonnelApiError(400, 'temporaryPassword 不能为空');
    return {
      username,
      ...(textField(body, 'email', 320) ? { email: textField(body, 'email', 320)! } : {}),
      ...(textField(body, 'firstName', 320) ? { firstName: textField(body, 'firstName', 320)! } : {}),
      ...(textField(body, 'lastName', 320) ? { lastName: textField(body, 'lastName', 320)! } : {}),
      ...(booleanField(body, 'enabled') !== undefined ? { enabled: booleanField(body, 'enabled')! } : {}),
      roles: rolesField(body, 'roles'),
      temporaryPassword: password,
    };
  }

  private parseUpdateInput(body: Record<string, unknown>): UpdatePersonnelUserInput {
    const input: UpdatePersonnelUserInput = {};
    const enabled = booleanField(body, 'enabled');
    if (enabled !== undefined) input.enabled = enabled;
    const email = textField(body, 'email', 320);
    if (email !== undefined) input.email = email;
    const firstName = textField(body, 'firstName', 320);
    if (firstName !== undefined) input.firstName = firstName;
    const lastName = textField(body, 'lastName', 320);
    if (lastName !== undefined) input.lastName = lastName;
    if (Object.keys(input).length === 0) throw new PersonnelApiError(400, '至少提供一个可更新字段');
    return input;
  }

  private personnelScope(actor: PersonnelApiActor): PersonnelAuthorizationScope | null {
    try {
      const snapshot = this.dependencies.g0DecisionStore.load();
      const scope = snapshot.decisions.scope?.value;
      if (!scope || !scope.demoTenantId || !scope.organizationScope) return null;
      return {
        readyForG1: snapshot.readyForG1 === true,
        firstScenario: snapshot.decisions.firstScenario?.value ?? null,
        demoTenantId: scope.demoTenantId,
        organizationScope: scope.organizationScope,
      };
    } catch {
      return null;
    }
  }

  private g0Scope(scope: PersonnelAuthorizationScope | null): PersonnelScope | null {
    if (!scope || !scope.demoTenantId || !scope.organizationScope) return null;
    return { demoTenantId: scope.demoTenantId, organizationScope: scope.organizationScope };
  }

  private async requireTarget(scope: PersonnelAuthorizationScope | null, userId: string): Promise<PersonnelUser> {
    const g0Scope = this.g0Scope(scope);
    if (!g0Scope) throw new KeycloakPersonnelError('not_found');
    return this.dependencies.admin!.getUser(g0Scope, userId);
  }

  private async activeManagerActorIds(scope: PersonnelScope): Promise<string[]> {
    // Enumerate every in-scope user (not just the first list page) so the
    // last-active-manager guard is correct even when the pilot grows beyond the
    // default page size. The upstream list is bounded per page and terminates
    // on a short page.
    const managers: string[] = [];
    const maxPages = 40;
    for (let page = 0; page < maxPages; page++) {
      const users = await this.dependencies.admin!.listUsers(scope, { first: page * MAX_LIST, max: MAX_LIST });
      for (const user of users) {
        if (user.enabled && user.roles.includes('manager')) managers.push(user.actorId);
      }
      if (users.length < MAX_LIST) break;
    }
    return managers;
  }

  /** Rejects non-human, non-manager, out-of-scope, or invalid-role requests before any Keycloak call. */
  private baseDenied(
    actor: PersonnelApiActor,
    action: Parameters<typeof authorizePersonnelAction>[0]['action'],
    scope: PersonnelAuthorizationScope | null,
    requestedRoles?: readonly string[],
  ): PersonnelApiResponse | null {
    const decision = authorizePersonnelAction({
      action,
      actor,
      scope,
      target: null,
      ...(requestedRoles ? { requestedRoles } : {}),
    });
    if (decision.allowed) return null;
    return this.denied(actor, action, decision.code);
  }

  /** Applies the target-specific guards once the target is resolved in scope. */
  private targetDenied(
    actor: PersonnelApiActor,
    action: Parameters<typeof authorizePersonnelAction>[0]['action'],
    scope: PersonnelAuthorizationScope | null,
    target: PersonnelUser,
    requestedRoles?: readonly string[],
    nextEnabled?: boolean,
    activeManagerActorIds: readonly string[] = [],
  ): PersonnelApiResponse | null {
    const decision = authorizePersonnelAction({
      action,
      actor,
      scope,
      target: { actorId: target.actorId, enabled: target.enabled, roles: target.roles },
      ...(requestedRoles ? { requestedRoles } : {}),
      ...(nextEnabled !== undefined ? { nextEnabled } : {}),
      activeManagerActorIds,
    });
    if (decision.allowed) return null;
    return this.denied(actor, action, decision.code);
  }

  private denied(actor: PersonnelApiActor, action: string, code: string): PersonnelApiResponse {
    const auditStatus = this.auditDenied(actor, action, code);
    return { status: 403, body: { error: 'personnel action forbidden', auditStatus } };
  }

  private invalidRequest(actor: PersonnelApiActor, action: string): PersonnelApiResponse {
    const auditStatus = this.auditDenied(actor, action, 'invalid_request');
    return { status: 400, body: { error: 'invalid personnel request', ...(auditStatus === 'failed' ? { auditStatus: 'failed' } : {}) } };
  }

  private acceptedResponse(status: number, user: PersonnelUser, auditStatus: 'recorded' | 'failed'): PersonnelApiResponse {
    return {
      status,
      body: {
        user,
        committed: true,
        auditStatus,
        ...(auditStatus === 'failed' ? { warning: 'mutation committed but audit event was not appended' } : {}),
      },
    };
  }

  private auditAccepted(actor: PersonnelApiActor, action: string, user: PersonnelUser, detail: Record<string, unknown>): 'recorded' | 'failed' {
    try {
      this.dependencies.appendEvidence({
        kind: 'app_event',
        actor_id: actor.actorId,
        actor_type: actor.actorType,
        tenant_id: actor.tenantId,
        object_ref: PERSONNEL_OBJECT_REF,
        correlation_id: `personnel-${user.actorId}`,
        summary: `personnel ${action}`,
        payload: {
          action,
          targetActorId: user.actorId,
          username: user.username,
          tenantId: user.tenantId,
          organizationId: user.organizationId,
          enabled: user.enabled,
          ...detail,
        },
      });
      return 'recorded';
    } catch {
      return 'failed';
    }
  }

  private auditDenied(actor: PersonnelApiActor, action: string, code: string): 'recorded' | 'failed' {
    try {
      this.dependencies.appendEvidence({
        kind: 'app_event',
        actor_id: actor.actorId,
        actor_type: actor.actorType,
        tenant_id: actor.tenantId,
        object_ref: PERSONNEL_OBJECT_REF,
        correlation_id: 'personnel-action-denied',
        summary: 'personnel action denied',
        payload: { action: 'personnel_action_denied', requestedAction: action, policyCode: code },
      });
      return 'recorded';
    } catch {
      return 'failed';
    }
  }

  private auditPartialCommit(actor: PersonnelApiActor, actorId: string): 'recorded' | 'failed' {
    try {
      this.dependencies.appendEvidence({
        kind: 'app_event',
        actor_id: actor.actorId,
        actor_type: actor.actorType,
        tenant_id: actor.tenantId,
        object_ref: PERSONNEL_OBJECT_REF,
        correlation_id: `personnel-${actorId}`,
        summary: 'personnel user created with incomplete completion',
        payload: { action: 'personnel_user_created_partial', targetActorId: actorId },
      });
      return 'recorded';
    } catch {
      return 'failed';
    }
  }

  private auditDelete(actor: PersonnelApiActor, actorId: string): 'recorded' | 'failed' {
    try {
      this.dependencies.appendEvidence({
        kind: 'app_event',
        actor_id: actor.actorId,
        actor_type: actor.actorType,
        tenant_id: actor.tenantId,
        object_ref: PERSONNEL_OBJECT_REF,
        correlation_id: `personnel-${actorId}`,
        summary: 'personnel user deleted',
        payload: { action: 'personnel_user_deleted', targetActorId: actorId },
      });
      return 'recorded';
    } catch {
      return 'failed';
    }
  }
}
