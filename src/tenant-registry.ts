// 租户解析：系统登记的 tenantId 是权威来源；找不到时回落到试点默认租户。
import type { SystemRecord } from './system-registry.ts';

export const DEFAULT_TENANT_ID = 'pilot-default';

export function resolveTenantId(
  systemId: string,
  systems: readonly SystemRecord[],
  fallback = DEFAULT_TENANT_ID,
): string {
  const value = String(systemId || '').trim();
  if (!value) return fallback;
  const system = systems.find((candidate) => candidate.systemId === value
    || candidate.sourceSystemAliases.includes(value));
  return system?.tenantId?.trim() || fallback;
}
