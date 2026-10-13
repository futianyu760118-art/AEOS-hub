import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { atomicWrite } from './atomic-file.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FILE_BYTES = 1024 * 1024;
const CODE = /^[a-z][a-z0-9_]{1,79}$/;
const RESOURCE_OPERATIONS = ['create', 'read', 'update', 'delete'] as const;
export type AccessOperation = (typeof RESOURCE_OPERATIONS)[number];
export type AccessScope = { tenantId: string; organizationId: string };

const code = z.string().regex(CODE);
const operation = z.enum(RESOURCE_OPERATIONS);
const resourceSchema: z.ZodType<AccessResource> = z.lazy(() => z.object({
  code,
  name: z.string().trim().min(1).max(80),
  route: z.string().trim().max(240).optional(),
  operations: z.array(operation).min(1).max(4),
  sort: z.number().int().min(0).max(10_000),
  enabled: z.boolean(),
  children: z.array(resourceSchema).max(100),
}).strict());

export type AccessResource = {
  code: string;
  name: string;
  route?: string;
  operations: AccessOperation[];
  sort: number;
  enabled: boolean;
  children: AccessResource[];
};

export type AccessResourceInput = Omit<AccessResource, 'children'> & { parentCode?: string };
export type RolePermissionGrant = { resourceCode: string; operations: AccessOperation[] };
export type AccessControlSnapshot = { version: 1; resources: AccessResource[]; rolePermissions: Record<string, RolePermissionGrant[]> };

const snapshotSchema: z.ZodType<AccessControlSnapshot> = z.object({
  version: z.literal(1),
  resources: z.array(resourceSchema).max(200),
  rolePermissions: z.record(code, z.array(z.object({ resourceCode: code, operations: z.array(operation).min(1).max(4) }).strict()).max(200)),
}).strict();

const all = [...RESOURCE_OPERATIONS];
const defaultResources: AccessResource[] = [
  ['dashboard', '经营驾驶舱', '/dashboard'], ['topbar', '顶栏功能'], ['analysis', '经营分析'], ['cases', '经营事项', '/cases'],
  ['tasks', '任务中心', '/tasks'], ['evidence', 'Evidence 证据中心', '/evidence'], ['agents', '智能体协作'], ['system', '系统治理', '/config'],
].map(([resourceCode, name, route], index) => ({ code: resourceCode, name, ...(route ? { route } : {}), operations: all, sort: index + 1, enabled: true, children: [] }));
const defaultManagerPermissions: RolePermissionGrant[] = defaultResources.map((resource) => ({ resourceCode: resource.code, operations: [...resource.operations] }));

function scopeFilePart(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function assertScope(scope: AccessScope): void {
  if (!scope || !scope.tenantId?.trim() || !scope.organizationId?.trim()) throw new Error('权限范围无效');
}

function flatten(resources: AccessResource[], output = new Map<string, AccessResource>()): Map<string, AccessResource> {
  for (const resource of resources) {
    if (output.has(resource.code)) throw new Error('权限编码重复');
    output.set(resource.code, resource);
    flatten(resource.children, output);
  }
  return output;
}

function normalizeOperations(values: readonly string[]): AccessOperation[] {
  const result = [...new Set(values.map((value) => value.trim()))];
  if (!result.length || result.some((value) => !(RESOURCE_OPERATIONS as readonly string[]).includes(value))) throw new Error('权限操作集无效');
  return result as AccessOperation[];
}

function locate(resources: AccessResource[], resourceCode: string): { collection: AccessResource[]; index: number } | null {
  for (let index = 0; index < resources.length; index++) {
    if (resources[index]!.code === resourceCode) return { collection: resources, index };
    const nested = locate(resources[index]!.children, resourceCode);
    if (nested) return nested;
  }
  return null;
}

export class AccessControlStore {
  private readonly directory: string;
  constructor(directory = join(root, 'data')) { this.directory = directory; }

  private file(scope: AccessScope): string {
    assertScope(scope);
    return join(this.directory, `access-control-${scopeFilePart(scope.tenantId)}-${scopeFilePart(scope.organizationId)}.json`);
  }

  load(scope: AccessScope): AccessControlSnapshot {
    const file = this.file(scope);
    if (!existsSync(file)) return { version: 1, resources: structuredClone(defaultResources), rolePermissions: { manager: structuredClone(defaultManagerPermissions) } };
    if (statSync(file).size > MAX_FILE_BYTES) throw new Error('权限配置超过大小上限');
    const parsed = snapshotSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) throw new Error('权限配置无效');
    flatten(parsed.data.resources);
    return structuredClone(parsed.data);
  }

  private save(scope: AccessScope, snapshot: AccessControlSnapshot): AccessControlSnapshot {
    snapshotSchema.parse(snapshot);
    const resources = flatten(snapshot.resources);
    for (const grants of Object.values(snapshot.rolePermissions)) {
      for (const grant of grants) {
        if (!resources.has(grant.resourceCode)) throw new Error('角色权限引用了不存在的资源');
      }
    }
    const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) throw new Error('权限配置超过大小上限');
    atomicWrite(this.file(scope), serialized);
    return structuredClone(snapshot);
  }

  listResources(scope: AccessScope): AccessResource[] { return this.load(scope).resources; }
  listRolePermissions(scope: AccessScope, roleKey: string): RolePermissionGrant[] { return this.load(scope).rolePermissions[roleKey] ?? []; }

  /** Union of grants across the given roles, merged per resource. */
  listGrantsForRoles(scope: AccessScope, roles: readonly string[]): RolePermissionGrant[] {
    const snapshot = this.load(scope);
    const merged = new Map<string, RolePermissionGrant>();
    for (const role of roles) {
      for (const grant of snapshot.rolePermissions[role] ?? []) {
        const existing = merged.get(grant.resourceCode);
        if (existing) existing.operations = [...new Set([...existing.operations, ...grant.operations])];
        else merged.set(grant.resourceCode, { resourceCode: grant.resourceCode, operations: [...grant.operations] });
      }
    }
    return [...merged.values()];
  }

  createResource(scope: AccessScope, input: AccessResourceInput): AccessControlSnapshot {
    const snapshot = this.load(scope);
    if (flatten(snapshot.resources).has(input.code)) throw new Error('权限编码已存在');
    const resource: AccessResource = { code: input.code, name: input.name.trim(), ...(input.route?.trim() ? { route: input.route.trim() } : {}), operations: normalizeOperations(input.operations), sort: input.sort, enabled: input.enabled, children: [] };
    const parsed = resourceSchema.parse(resource);
    if (input.parentCode) {
      const parent = flatten(snapshot.resources).get(input.parentCode);
      if (!parent) throw new Error('父级权限不存在');
      parent.children.push(parsed);
    } else snapshot.resources.push(parsed);
    return this.save(scope, snapshot);
  }

  updateResource(scope: AccessScope, resourceCode: string, input: Omit<AccessResourceInput, 'parentCode' | 'code'>): AccessControlSnapshot {
    const snapshot = this.load(scope);
    const found = locate(snapshot.resources, resourceCode);
    if (!found) throw new Error('权限不存在');
    const prior = found.collection[found.index]!;
    const { route: _priorRoute, ...withoutPriorRoute } = prior;
    found.collection[found.index] = resourceSchema.parse({ ...withoutPriorRoute, name: input.name.trim(), ...(input.route?.trim() ? { route: input.route.trim() } : {}), operations: normalizeOperations(input.operations), sort: input.sort, enabled: input.enabled });
    return this.save(scope, snapshot);
  }

  deleteResource(scope: AccessScope, resourceCode: string): AccessControlSnapshot {
    const snapshot = this.load(scope);
    const found = locate(snapshot.resources, resourceCode);
    if (!found) throw new Error('权限不存在');
    if (found.collection[found.index]!.children.length) throw new Error('请先删除子级权限');
    found.collection.splice(found.index, 1);
    for (const [roleKey, grants] of Object.entries(snapshot.rolePermissions)) {
      snapshot.rolePermissions[roleKey] = grants.filter((grant) => grant.resourceCode !== resourceCode);
    }
    return this.save(scope, snapshot);
  }

  replaceRolePermissions(scope: AccessScope, roleKey: string, grants: RolePermissionGrant[]): AccessControlSnapshot {
    if (!CODE.test(roleKey)) throw new Error('角色标识无效');
    const snapshot = this.load(scope);
    const resources = flatten(snapshot.resources);
    const unique = new Set<string>();
    snapshot.rolePermissions[roleKey] = grants.map((grant) => {
      if (unique.has(grant.resourceCode)) throw new Error('角色权限重复');
      unique.add(grant.resourceCode);
      const resource = resources.get(grant.resourceCode);
      if (!resource) throw new Error('权限不存在');
      const operations = normalizeOperations(grant.operations);
      if (operations.some((item) => !resource.operations.includes(item))) throw new Error('角色操作超出资源操作集');
      return { resourceCode: grant.resourceCode, operations };
    });
    return this.save(scope, snapshot);
  }

  deleteRolePermissions(scope: AccessScope, roleKey: string): AccessControlSnapshot {
    if (!CODE.test(roleKey)) throw new Error('角色标识无效');
    const snapshot = this.load(scope);
    delete snapshot.rolePermissions[roleKey];
    return this.save(scope, snapshot);
  }
}

export function hasGrantedOperation(input: {
  actor: { tenantId: string; organizationId?: string; roles: readonly string[] };
  scope: AccessScope;
  resourceCode: string;
  operation: AccessOperation;
  store: Pick<AccessControlStore, 'listResources' | 'listRolePermissions'>;
}): boolean {
  if (input.actor.tenantId !== input.scope.tenantId || input.actor.organizationId !== input.scope.organizationId) return false;
  const resources = flatten(input.store.listResources(input.scope));
  const resource = resources.get(input.resourceCode);
  if (!resource?.enabled || !resource.operations.includes(input.operation)) return false;
  return input.actor.roles.some((role) => input.store.listRolePermissions(input.scope, role).some((grant) => grant.resourceCode === input.resourceCode && grant.operations.includes(input.operation)));
}
