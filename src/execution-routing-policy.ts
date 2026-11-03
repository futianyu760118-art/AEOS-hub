// 执行面选路策略：在已通过 allowlist 准入的 Agent 中，按「系统 × 能力」优先级选路。
// 配置来源：config/execution-routing-policy.json（可用 AEOS_EXECUTION_ROUTING_POLICY_FILE 覆盖）。
// 文件缺失或损坏时回落到内置默认值（无规则 + first-online），保持旧行为；mtime 变化自动重载。
//
// 与 allowlist 的分工：
//   execution-agent-allowlist.json = 准入（谁能连）
//   execution-routing-policy.json  = 选路（连上之后优先派给谁）
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const executionRoutingPolicyFile = process.env.AEOS_EXECUTION_ROUTING_POLICY_FILE?.trim()
  || join(root, 'config', 'execution-routing-policy.json');

const identifier = z.string().trim().min(1).max(160);

export const ExecutionRoutingRuleSchema = z.object({
  systemId: identifier.default('*'),
  capability: identifier.default('*'),
  /** 按优先级排列；不在列表中的 Agent 交给 fallback。 */
  agents: z.array(identifier).min(1).max(100),
}).strict();

export const ExecutionRoutingPolicySchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().min(1).max(64),
  fallback: z.enum(['first-online', 'deny']).default('first-online'),
  rules: z.array(ExecutionRoutingRuleSchema).max(200),
}).strict();

export type ExecutionRoutingRule = z.infer<typeof ExecutionRoutingRuleSchema>;
export type ExecutionRoutingPolicy = z.infer<typeof ExecutionRoutingPolicySchema>;

export const DEFAULT_EXECUTION_ROUTING_POLICY: ExecutionRoutingPolicy = {
  version: 1,
  revision: 0,
  updatedAt: '1970-01-01T00:00:00.000Z',
  fallback: 'first-online',
  rules: [],
};

const cache = new Map<string, { mtimeMs: number; policy: ExecutionRoutingPolicy }>();

/** 读取配置；mtime 未变时复用缓存。损坏时回落默认值，不阻断派单。 */
export function loadExecutionRoutingPolicy(file = executionRoutingPolicyFile): ExecutionRoutingPolicy {
  if (!existsSync(file)) return DEFAULT_EXECUTION_ROUTING_POLICY;
  try {
    const stat = statSync(file);
    const cached = cache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.policy;
    const parsed = ExecutionRoutingPolicySchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    cache.set(file, { mtimeMs: stat.mtimeMs, policy: parsed });
    return parsed;
  } catch {
    cache.delete(file);
    return DEFAULT_EXECUTION_ROUTING_POLICY;
  }
}

function specificity(rule: ExecutionRoutingRule): number {
  return (rule.systemId === '*' ? 0 : 1) + (rule.capability === '*' ? 0 : 1);
}

/** 命中规则：精确 > 系统通配 > 能力通配 > 全通配；同优先级取先声明的一条。 */
export function findRoutingRule(
  policy: ExecutionRoutingPolicy,
  systemId: string,
  capability: string,
): ExecutionRoutingRule | null {
  let best: ExecutionRoutingRule | null = null;
  let bestScore = -1;
  for (const rule of policy.rules) {
    if (rule.systemId !== '*' && rule.systemId !== systemId) continue;
    if (rule.capability !== '*' && rule.capability !== capability) continue;
    const score = specificity(rule);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 按策略重排候选 Agent：规则内按声明顺序排前，其余保持原顺序；
 * fallback=deny 时只返回规则内 Agent（用于严格单入口）。调用方仍要自己做在线/注销/能力过滤。
 */
export function orderAgentsByPolicy<T extends { agentId: string }>(
  agents: readonly T[],
  context: { systemId: string; capability: string; policy?: ExecutionRoutingPolicy },
): T[] {
  const policy = context.policy ?? loadExecutionRoutingPolicy();
  const rule = findRoutingRule(policy, context.systemId, context.capability);
  if (!rule) return policy.fallback === 'deny' ? [] : [...agents];

  const byId = new Map(agents.map((agent) => [agent.agentId, agent]));
  const listed = rule.agents
    .map((agentId) => byId.get(agentId))
    .filter((agent): agent is T => Boolean(agent));
  if (policy.fallback === 'deny') return listed;
  const listedIds = new Set(listed.map((agent) => agent.agentId));
  return [...listed, ...agents.filter((agent) => !listedIds.has(agent.agentId))];
}
