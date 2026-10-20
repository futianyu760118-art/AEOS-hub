// 跨系统借调能力允许列表：按「提供方系统」限定可被外部借用的能力。
// 未列出的能力默认拒绝；写能力、查询本机文件等敏感能力不在列表中。
const SYSTEM_ALIASES: Record<string, string> = {
  'control-platform': 'control-platform',
  '公司中控平台': 'control-platform',
  '公司中控平台（本机演示）': 'control-platform',
  '公司中控平台（UAT）': 'control-platform',
  中控: 'control-platform',
  'hengjian-plm': 'hengjian-plm',
  '恒剑PLM': 'hengjian-plm',
  '恒剑 PLM': 'hengjian-plm',
  PLM: 'hengjian-plm',
};

export const BORROW_CAPABILITY_ALLOWLIST: Record<string, readonly string[]> = {
  'control-platform': ['query_control_platform', 'reason_control_platform'],
  'hengjian-plm': ['query_plm', 'reason_plm'],
};

function canonicalSystemId(systemId: string): string {
  const value = systemId.trim();
  return SYSTEM_ALIASES[value] ?? value;
}

export function isBorrowCapabilityAllowed(providerSystemId: string | null | undefined, capability: string): boolean {
  if (!providerSystemId || !capability.trim()) return false;
  const systemId = canonicalSystemId(providerSystemId);
  return (BORROW_CAPABILITY_ALLOWLIST[systemId] ?? []).includes(capability.trim());
}
