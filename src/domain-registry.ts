// 业务域注册表：归属轴的第二层（系统 → 业务域 → 智能体）。
// 四个一等业务域与现有 Agent 小队 ID 的迁移映射；不读写任何数据。
export const DOMAIN_IDS = ['order', 'kitting', 'quality', 'production', 'cross-domain'] as const;
export type DomainId = (typeof DOMAIN_IDS)[number];

export interface BusinessDomain {
  domainId: DomainId;
  name: string;
  squadId: string | null;
}

export const BUSINESS_DOMAINS: readonly BusinessDomain[] = [
  { domainId: 'order', name: '订单交付', squadId: 'business-squad-orders' },
  { domainId: 'kitting', name: '物料齐套', squadId: 'business-squad-material-kitting' },
  { domainId: 'quality', name: '质量异常', squadId: 'business-squad-quality' },
  { domainId: 'production', name: '生产进度', squadId: 'business-squad-production' },
  { domainId: 'cross-domain', name: '跨系统协同', squadId: null },
];

const DOMAIN_BY_ID = new Map<string, BusinessDomain>(BUSINESS_DOMAINS.map((domain) => [domain.domainId, domain]));
const DOMAIN_BY_SQUAD = new Map<string, BusinessDomain>(
  BUSINESS_DOMAINS
    .filter((domain): domain is BusinessDomain & { squadId: string } => Boolean(domain.squadId))
    .map((domain) => [domain.squadId, domain]),
);

export function isDomainId(value: unknown): value is DomainId {
  return typeof value === 'string' && DOMAIN_BY_ID.has(value);
}

export function getDomain(domainId: string): BusinessDomain | null {
  return DOMAIN_BY_ID.get(domainId.trim()) ?? null;
}

/** 迁移期：把旧的 Agent 小队 ID 映射到业务域。 */
export function squadIdToDomainId(squadId: string): DomainId | null {
  return DOMAIN_BY_SQUAD.get(squadId.trim())?.domainId ?? null;
}

/** 迁移期：业务域对应的旧小队 ID；跨域没有小队。 */
export function domainIdToSquadId(domainId: string): string | null {
  return DOMAIN_BY_ID.get(domainId.trim())?.squadId ?? null;
}

/**
 * 归一 Agent 的服务域列表：
 * - 去重、过滤未知域；
 * - 若提供了主属域，则强制包含主属域；
 * - 保持输入顺序，主属域排在最前。
 */
export function normalizeDomainIds(primaryDomainId: string | null | undefined, domainIds: unknown): DomainId[] {
  const primary = isDomainId(primaryDomainId) ? primaryDomainId : null;
  const values = Array.isArray(domainIds)
    ? domainIds.filter(isDomainId)
    : [];
  const ordered = [
    ...(primary ? [primary] : []),
    ...values.filter((value) => value !== primary),
  ];
  return [...new Set(ordered)];
}
