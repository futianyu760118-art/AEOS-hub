// 执行面 Agent 允许列表：只允许已在 Hub 登记的 Agent 连接/注册。
// 目的：防止系统用共享 legacy 令牌自行注册额外 Agent（尤其是写能力 Agent）。
export const EXECUTION_AGENT_ALLOWLIST: Record<string, readonly string[]> = {
  'control-platform': ['runtime-control-platform-query', 'runtime-control-platform-reasoning', 'gateway-control-platform'],
  'hengjian-plm': ['runtime-execution-query'],
};

export function allowedExecutionAgentIds(systemId: string | null | undefined): readonly string[] {
  if (!systemId) return [];
  return EXECUTION_AGENT_ALLOWLIST[systemId] ?? [];
}

export function isExecutionAgentAllowed(systemId: string | null | undefined, agentId: string): boolean {
  if (!systemId || !agentId.trim()) return false;
  return allowedExecutionAgentIds(systemId).includes(agentId.trim());
}
