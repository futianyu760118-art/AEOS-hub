import type { EvidenceInput } from './evidence.ts';
import type { G0DecisionRegisterStore } from './g0-decision-register.ts';
import { authorizePersonnelAction, type PersonnelAuthorizationScope } from './personnel-authorization.ts';
import { AccessControlStore, type AccessOperation, type AccessScope, type AccessResourceInput, type RolePermissionGrant } from './access-control-store.ts';
import { KeycloakPersonnelAdmin, KeycloakPersonnelError } from './keycloak-personnel-admin.ts';

type Actor = { actorId: string; actorType: 'human' | 'service' | 'agent' | 'system'; tenantId: string; organizationId?: string; roles: readonly string[] };
export type AccessControlRequest = { method?: string; pathname: string; actor: Actor | null; body?: Record<string, unknown>; bodyParseFailed?: boolean };
export type AccessControlResponse = { status: number; body: Record<string, unknown> };
const OBJECT_REF = 'hub://system/access-control';
const OPS = new Set(['create', 'read', 'update', 'delete']);

function text(body: Record<string, unknown>, name: string, max = 240): string | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${name} 无效`);
  return value.trim();
}
function bool(body: Record<string, unknown>, name: string): boolean | undefined {
  const value = body[name]; if (value === undefined) return undefined; if (typeof value !== 'boolean') throw new Error(`${name} 无效`); return value;
}
function number(body: Record<string, unknown>, name: string): number | undefined {
  const value = body[name]; if (value === undefined) return undefined; if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10_000) throw new Error(`${name} 无效`); return value;
}
function operations(value: unknown): AccessOperation[] {
  if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== 'string' || !OPS.has(item))) throw new Error('operations 无效');
  return [...new Set(value)] as AccessOperation[];
}

export class AccessControlApi {
  private readonly dependencies: { admin: KeycloakPersonnelAdmin | null; store: AccessControlStore; g0DecisionStore: Pick<G0DecisionRegisterStore, 'load'>; appendEvidence: (input: EvidenceInput) => unknown };

  constructor(dependencies: { admin: KeycloakPersonnelAdmin | null; store: AccessControlStore; g0DecisionStore: Pick<G0DecisionRegisterStore, 'load'>; appendEvidence: (input: EvidenceInput) => unknown }) {
    this.dependencies = dependencies;
  }

  async handle(request: AccessControlRequest): Promise<AccessControlResponse | null> {
    if (!request.pathname.startsWith('/api/system/access-control/')) return null;
    if (!request.actor) return { status: 401, body: { error: 'authentication required' } };
    if (!this.dependencies.admin) return { status: 503, body: { error: 'personnel administration is not enabled' } };
    if (request.pathname === '/api/system/access-control/my-grants') {
      if (request.method !== 'GET') return { status: 405, body: { error: 'method not allowed' } };
      const scope = this.scope(request.actor);
      const accessScope = scope ? this.g0Scope(scope) : null;
      return { status: 200, body: { grants: accessScope ? this.dependencies.store.listGrantsForRoles(accessScope, request.actor.roles) : [] } };
    }
    const scope = this.scope(request.actor);
    const decision = authorizePersonnelAction({ action: 'list', actor: request.actor, scope });
    if (!decision.allowed) return this.denied(request.actor, decision.code);
    if (request.bodyParseFailed) return { status: 400, body: { error: 'invalid access-control request' } };
    try {
      return await this.authorized({ ...request, actor: request.actor, body: request.body ?? {} }, this.g0Scope(scope)!);
    } catch (error) {
      if (error instanceof KeycloakPersonnelError) return { status: error.kind === 'not_found' ? 404 : error.kind === 'conflict' ? 409 : error.kind === 'forbidden' ? 403 : 503, body: { error: error.message } };
      return { status: 400, body: { error: (error as Error).message || 'invalid access-control request' } };
    }
  }

  private async authorized(request: AccessControlRequest & { actor: Actor; body: Record<string, unknown> }, scope: AccessScope): Promise<AccessControlResponse> {
    const path = request.pathname; const method = request.method;
    if (path === '/api/system/access-control/resources') {
      if (method === 'GET') return { status: 200, body: { resources: this.dependencies.store.listResources(scope) } };
      if (method === 'POST') {
        const input = this.resourceInput(request.body, true);
        const snapshot = this.dependencies.store.createResource(scope, input);
        return this.accepted(request.actor, 'permission_resource_created', { resources: snapshot.resources });
      }
    }
    const resource = path.match(/^\/api\/system\/access-control\/resources\/([^/]+)$/);
    if (resource) {
      const resourceCode = decodeURIComponent(resource[1] ?? '');
      if (method === 'PATCH') {
        const input = this.resourceUpdateInput(request.body);
        const snapshot = this.dependencies.store.updateResource(scope, resourceCode, input);
        return this.accepted(request.actor, 'permission_resource_updated', { resources: snapshot.resources });
      }
      if (method === 'DELETE') {
        const snapshot = this.dependencies.store.deleteResource(scope, resourceCode);
        return this.accepted(request.actor, 'permission_resource_deleted', { resources: snapshot.resources });
      }
    }
    if (path === '/api/system/access-control/roles') {
      if (method === 'GET') {
        const roles = await this.dependencies.admin!.listHubRoles(this.personnelScope(scope));
        return { status: 200, body: { roles: roles.map((role) => ({ ...role, permissionCount: this.dependencies.store.listRolePermissions(scope, role.code).length })) } };
      }
      if (method === 'POST') {
        const code = text(request.body, 'code', 80); const name = text(request.body, 'name', 120);
        if (!code || !name) throw new Error('角色编码和名称不能为空');
        const role = await this.dependencies.admin!.createHubRole(this.personnelScope(scope), { code, name, ...(text(request.body, 'description', 320) ? { description: text(request.body, 'description', 320) } : {}) });
        return this.accepted(request.actor, 'role_created', { role });
      }
    }
    const roleDelete = path.match(/^\/api\/system\/access-control\/roles\/([^/]+)$/);
    if (roleDelete && method === 'DELETE') {
      const roleCode = decodeURIComponent(roleDelete[1] ?? '');
      await this.dependencies.admin!.deleteHubRole(this.personnelScope(scope), roleCode);
      this.dependencies.store.deleteRolePermissions(scope, roleCode);
      return this.accepted(request.actor, 'role_deleted', { roleCode });
    }
    const rolePermissions = path.match(/^\/api\/system\/access-control\/roles\/([^/]+)\/permissions$/);
    if (rolePermissions) {
      const roleCode = decodeURIComponent(rolePermissions[1] ?? '');
      const roles = await this.dependencies.admin!.listHubRoles(this.personnelScope(scope));
      if (!roles.some((role) => role.code === roleCode)) throw new KeycloakPersonnelError('not_found');
      if (method === 'GET') return { status: 200, body: { grants: this.dependencies.store.listRolePermissions(scope, roleCode) } };
      if (method === 'PUT') {
        const raw = request.body.grants;
        if (!Array.isArray(raw)) throw new Error('grants 无效');
        const grants: RolePermissionGrant[] = raw.map((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('grants 无效');
          const record = item as Record<string, unknown>;
          const resourceCode = text(record, 'resourceCode', 80);
          if (!resourceCode) throw new Error('grants 无效');
          return { resourceCode, operations: operations(record.operations) };
        });
        this.dependencies.store.replaceRolePermissions(scope, roleCode, grants);
        return this.accepted(request.actor, 'role_permissions_replaced', { roleCode, grants });
      }
    }
    return { status: 404, body: { error: 'access-control endpoint not found' } };
  }

  private resourceInput(body: Record<string, unknown>, allowParent: boolean): AccessResourceInput {
    const code = text(body, 'code', 80); const name = text(body, 'name', 80); const sort = number(body, 'sort'); const enabled = bool(body, 'enabled');
    if (!code || !name || sort === undefined || enabled === undefined) throw new Error('权限字段不完整');
    const input: AccessResourceInput = { code, name, ...(text(body, 'route', 240) ? { route: text(body, 'route', 240) } : {}), operations: operations(body.operations), sort, enabled };
    if (allowParent && text(body, 'parentCode', 80)) input.parentCode = text(body, 'parentCode', 80);
    return input;
  }

  private resourceUpdateInput(body: Record<string, unknown>): Omit<AccessResourceInput, 'parentCode' | 'code'> {
    const name = text(body, 'name', 80); const sort = number(body, 'sort'); const enabled = bool(body, 'enabled');
    if (!name || sort === undefined || enabled === undefined) throw new Error('权限字段不完整');
    return { name, ...(text(body, 'route', 240) ? { route: text(body, 'route', 240) } : {}), operations: operations(body.operations), sort, enabled };
  }

  private scope(actor: Actor): PersonnelAuthorizationScope | null {
    try { const snapshot = this.dependencies.g0DecisionStore.load(); const current = snapshot.decisions.scope?.value; return current ? { readyForG1: snapshot.readyForG1, firstScenario: snapshot.decisions.firstScenario?.value, demoTenantId: current.demoTenantId, organizationScope: current.organizationScope } : null; } catch { return null; }
  }
  private g0Scope(scope: PersonnelAuthorizationScope): AccessScope | null { return scope.demoTenantId && scope.organizationScope ? { tenantId: scope.demoTenantId, organizationId: scope.organizationScope } : null; }
  private personnelScope(scope: AccessScope) { return { demoTenantId: scope.tenantId, organizationScope: scope.organizationId }; }
  private accepted(actor: Actor, action: string, body: Record<string, unknown>): AccessControlResponse { const auditStatus = this.audit(actor, action); return { status: 200, body: { ...body, committed: true, auditStatus } }; }
  private denied(actor: Actor, code: string): AccessControlResponse { const auditStatus = this.audit(actor, 'access_control_denied', code); return { status: 403, body: { error: 'access-control action forbidden', auditStatus } }; }
  private audit(actor: Actor, action: string, code?: string): 'recorded' | 'failed' { try { this.dependencies.appendEvidence({ kind: 'app_event', actor_id: actor.actorId, actor_type: actor.actorType, tenant_id: actor.tenantId, object_ref: OBJECT_REF, correlation_id: `access-control-${action}`, summary: `access control ${action}`, payload: { action, ...(code ? { code } : {}) } }); return 'recorded'; } catch { return 'failed'; } }
}
