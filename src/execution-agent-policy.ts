// 执行面 Agent 允许列表：只允许已在 Hub 登记的 Agent 连接/注册。
// 配置来源：config/execution-agent-allowlist.json（可用 AEOS_EXECUTION_AGENT_ALLOWLIST_FILE 覆盖）。
// 文件缺失或损坏时回落到内置默认值；mtime 变化时自动重载，新增网关/Agent 无需重启 Hub。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const executionAgentAllowlistFile = process.env.AEOS_EXECUTION_AGENT_ALLOWLIST_FILE?.trim()
  || join(root, 'config', 'execution-agent-allowlist.json');

const identifier = z.string().min(1).max(160);

export const ExecutionAgentAllowlistSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().min(1).max(64),
  allowlist: z.record(identifier, z.array(identifier).max(1_000)),
}).strict();

export type ExecutionAgentAllowlist = z.infer<typeof ExecutionAgentAllowlistSchema>;

export const DEFAULT_EXECUTION_AGENT_ALLOWLIST: ExecutionAgentAllowlist = {
  version: 1,
  revision: 1,
  updatedAt: '2026-10-23T00:00:00.000Z',
  allowlist: {
    'control-platform': ['gateway-control-platform'],
    'hengjian-plm': ['runtime-execution-query'],
  },
};

/** 兼容旧代码的默认白名单导出；新代码请使用 loadExecutionAgentAllowlist()。 */
export const EXECUTION_AGENT_ALLOWLIST: Record<string, readonly string[]> = DEFAULT_EXECUTION_AGENT_ALLOWLIST.allowlist;

const cache = new Map<string, { mtimeMs: number; policy: ExecutionAgentAllowlist }>();

/** 读取配置；同文件 mtime 未变时复用缓存，支持热更新。 */
export function loadExecutionAgentAllowlist(file = executionAgentAllowlistFile): ExecutionAgentAllowlist {
  if (!existsSync(file)) return DEFAULT_EXECUTION_AGENT_ALLOWLIST;
  try {
    const stat = statSync(file);
    const cached = cache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.policy;
    const parsed = ExecutionAgentAllowlistSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    cache.set(file, { mtimeMs: stat.mtimeMs, policy: parsed });
    return parsed;
  } catch {
    // 配置损坏不应阻断执行面注册；回落到默认值，保留文件供人工修复。
    cache.delete(file);
    return DEFAULT_EXECUTION_AGENT_ALLOWLIST;
  }
}

export function allowedExecutionAgentIds(
  systemId: string | null | undefined,
  policy: ExecutionAgentAllowlist = loadExecutionAgentAllowlist(),
): readonly string[] {
  if (!systemId) return [];
  return policy.allowlist[systemId] ?? [];
}

export function isExecutionAgentAllowed(
  systemId: string | null | undefined,
  agentId: string,
  policy: ExecutionAgentAllowlist = loadExecutionAgentAllowlist(),
): boolean {
  if (!systemId || !agentId.trim()) return false;
  return allowedExecutionAgentIds(systemId, policy).includes(agentId.trim());
}
