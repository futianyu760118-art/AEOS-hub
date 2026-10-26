// 执行面能力授权表：系统 × Agent × 能力 × 租户。
//
// 三张配置的分工：
//   execution-agent-allowlist.json = 准入（哪个 Agent 可以连接）
//   execution-agent-permissions.json = 授权（连上后能调用哪些能力）
//   execution-routing-policy.json = 选路（优先派给哪个 Agent）
//
// 默认 observe（只告警不拦截），确认授权表覆盖全部在线 Agent 后把 enforcement 改成 enforce。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const executionAgentPermissionsFile = process.env.AEOS_EXECUTION_AGENT_PERMISSIONS_FILE?.trim()
  || join(root, 'config', 'execution-agent-permissions.json');

const identifier = z.string().trim().min(1).max(160);

export const ExecutionCapabilityGrantSchema = z.object({
  systemId: identifier,
  agentId: identifier,
  /** null / 缺省 = 任意租户；指定后只匹配该租户。 */
  tenantId: identifier.nullable().default(null),
  capabilities: z.array(identifier).min(1).max(200),
}).strict();

export const ExecutionAgentPermissionsSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().min(1).max(64),
  enforcement: z.enum(['observe', 'enforce']).default('observe'),
  defaultPolicy: z.enum(['allow', 'deny']).default('deny'),
  grants: z.array(ExecutionCapabilityGrantSchema).max(500),
}).strict();

export type ExecutionCapabilityGrant = z.infer<typeof ExecutionCapabilityGrantSchema>;
export type ExecutionAgentPermissions = z.infer<typeof ExecutionAgentPermissionsSchema>;

export const DEFAULT_EXECUTION_AGENT_PERMISSIONS: ExecutionAgentPermissions = {
  version: 1,
  revision: 0,
  updatedAt: '1970-01-01T00:00:00.000Z',
  enforcement: 'observe',
  defaultPolicy: 'deny',
  grants: [],
};

const cache = new Map<string, { mtimeMs: number; policy: ExecutionAgentPermissions }>();

/** 读取授权表；mtime 未变时复用缓存，损坏时回落默认值（observe + deny）。 */
export function loadExecutionAgentPermissions(file = executionAgentPermissionsFile): ExecutionAgentPermissions {
  if (!existsSync(file)) return DEFAULT_EXECUTION_AGENT_PERMISSIONS;
  try {
    const stat = statSync(file);
    const cached = cache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.policy;
    const parsed = ExecutionAgentPermissionsSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    cache.set(file, { mtimeMs: stat.mtimeMs, policy: parsed });
    return parsed;
  } catch {
    cache.delete(file);
    return DEFAULT_EXECUTION_AGENT_PERMISSIONS;
  }
}

export type CapabilityAuthorization = {
  allowed: boolean;
  /** observe=只告警；enforce=拦截派单。 */
  enforcement: 'observe' | 'enforce';
  reason: 'granted' | 'capability_not_granted' | 'no_grant' | 'default_allow';
  /** 是否命中显式 grant（用于排查 defaultPolicy 导致的放行）。 */
  matchedGrant: boolean;
};

/** 判断某次派单是否被授权；调用方决定 observe/enforce 的处置方式。 */
export function authorizeCapability(
  policy: ExecutionAgentPermissions,
  query: { systemId: string; agentId: string; capability: string; tenantId?: string | null },
): CapabilityAuthorization {
  const systemId = query.systemId.trim();
  const agentId = query.agentId.trim();
  const capability = query.capability.trim();
  const tenantId = query.tenantId?.trim() || null;
  const grants = policy.grants.filter((grant) => grant.systemId === systemId
    && grant.agentId === agentId
    && (grant.tenantId === null || grant.tenantId === tenantId));
  if (grants.length) {
    const allowed = grants.some((grant) => grant.capabilities.includes(capability));
    return {
      allowed,
      enforcement: policy.enforcement,
      reason: allowed ? 'granted' : 'capability_not_granted',
      matchedGrant: true,
    };
  }
  if (policy.defaultPolicy === 'allow') {
    return { allowed: true, enforcement: policy.enforcement, reason: 'default_allow', matchedGrant: false };
  }
  return { allowed: false, enforcement: policy.enforcement, reason: 'no_grant', matchedGrant: false };
}

/** 某 Agent 在指定租户下被授权的能力清单（不做默认放行推断）。 */
export function grantedCapabilities(
  policy: ExecutionAgentPermissions,
  query: { systemId: string; agentId: string; tenantId?: string | null },
): string[] {
  const tenantId = query.tenantId?.trim() || null;
  return [...new Set(policy.grants
    .filter((grant) => grant.systemId === query.systemId.trim()
      && grant.agentId === query.agentId.trim()
      && (grant.tenantId === null || grant.tenantId === tenantId))
    .flatMap((grant) => grant.capabilities))];
}

export type RegistrationCapabilityFilter = {
  allowed: string[];
  denied: string[];
  enforcement: 'observe' | 'enforce';
};

/** 注册时按授权表过滤自报能力：enforce 下拒绝未授权能力，observe 下只标记。 */
export function filterRegistrationCapabilities(
  policy: ExecutionAgentPermissions,
  query: { systemId: string; agentId: string; tenantId?: string | null; capabilities: string[] },
): RegistrationCapabilityFilter {
  const allowed: string[] = [];
  const denied: string[] = [];
  for (const capability of [...new Set(query.capabilities.map((item) => item.trim()).filter(Boolean))]) {
    const decision = authorizeCapability(policy, {
      systemId: query.systemId,
      agentId: query.agentId,
      capability,
      tenantId: query.tenantId,
    });
    (decision.allowed ? allowed : denied).push(capability);
  }
  return { allowed, denied, enforcement: policy.enforcement };
}
