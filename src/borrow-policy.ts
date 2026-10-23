// 跨系统借调能力允许列表：按「提供方系统」限定可被外部借用的能力。
// 配置来源：config/borrow-policy.json（可用 AEOS_BORROW_POLICY_FILE 覆盖）；文件缺失或损坏时回落到内置默认值。
// 未列出的能力默认拒绝；写能力、查询本机文件等敏感能力不在列表中。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const borrowPolicyFile = process.env.AEOS_BORROW_POLICY_FILE?.trim()
  || join(root, 'config', 'borrow-policy.json');

const text = (max: number) => z.string().min(1).max(max);
const identifier = text(160);
const capabilityName = text(100);

export const BorrowPolicySchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  updatedAt: text(64),
  systemAliases: z.record(identifier, identifier),
  allowlist: z.record(identifier, z.array(capabilityName).max(100)),
}).strict();

export type BorrowPolicy = z.infer<typeof BorrowPolicySchema>;

export const DEFAULT_BORROW_POLICY: BorrowPolicy = {
  version: 1,
  revision: 1,
  updatedAt: '2026-10-23T00:00:00.000Z',
  systemAliases: {
    'control-platform': 'control-platform',
    '公司中控平台': 'control-platform',
    '公司中控平台（本机演示）': 'control-platform',
    '公司中控平台（UAT）': 'control-platform',
    '中控': 'control-platform',
    'hengjian-plm': 'hengjian-plm',
    '恒剑PLM': 'hengjian-plm',
    '恒剑 PLM': 'hengjian-plm',
    'PLM': 'hengjian-plm',
  },
  allowlist: {
    'control-platform': ['query_control_platform', 'reason_control_platform'],
    'hengjian-plm': ['query_plm', 'reason_plm'],
  },
};

/** 兼容旧代码的默认白名单导出；新代码请使用 loadBorrowPolicy()。 */
export const BORROW_CAPABILITY_ALLOWLIST: Record<string, readonly string[]> = DEFAULT_BORROW_POLICY.allowlist;

const cache = new Map<string, { mtimeMs: number; policy: BorrowPolicy }>();

/** 读取配置；同文件 mtime 未变时复用缓存，支持配置热更新。 */
export function loadBorrowPolicy(file = borrowPolicyFile): BorrowPolicy {
  if (!existsSync(file)) return DEFAULT_BORROW_POLICY;
  try {
    const stat = statSync(file);
    const cached = cache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.policy;
    const parsed = BorrowPolicySchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    cache.set(file, { mtimeMs: stat.mtimeMs, policy: parsed });
    return parsed;
  } catch {
    // 配置损坏不应导致借调入口不可用；回落到默认值，保留文件供人工修复。
    cache.delete(file);
    return DEFAULT_BORROW_POLICY;
  }
}

export function canonicalSystemId(systemId: string, policy: BorrowPolicy = loadBorrowPolicy()): string {
  const value = systemId.trim();
  return policy.systemAliases[value] ?? value;
}

export function isBorrowCapabilityAllowed(
  providerSystemId: string | null | undefined,
  capability: string,
  policy: BorrowPolicy = loadBorrowPolicy(),
): boolean {
  if (!providerSystemId || !capability.trim()) return false;
  const systemId = canonicalSystemId(providerSystemId, policy);
  return (policy.allowlist[systemId] ?? []).includes(capability.trim());
}
