// 执行面 Agent 能力选择：只返回 Agent 实际声明的能力，不再硬编码回退。
// 查询能力优先取带 intent 的查询能力；推理能力取 reason*。
export function selectExecutionCapabilities(capabilities) {
  const list = Array.isArray(capabilities) ? capabilities : [];
  const named = (prefix) => list.find((cap) => typeof cap?.name === 'string' && cap.name.startsWith(prefix))?.name ?? null;
  const query = list.find((cap) => cap?.intent)?.name ?? named('query');
  const reasoning = named('reason');
  return { query, reasoning };
}

export function isReasoningOnly(selection) {
  return Boolean(selection && !selection.query && selection.reasoning);
}

export function isQueryOnly(selection) {
  return Boolean(selection && selection.query && !selection.reasoning);
}

/** 从自然语言中提取业务锚点：显式 business:// 优先，其次常见订单/产品/批次编号。 */
export function inferBusinessObjectRef(text) {
  const value = String(text || '');
  const explicit = value.match(/business:\/\/(?:order|product|batch)\/[^\s，。；,;]+/i);
  if (explicit) return explicit[0];
  const order = value.match(/\b(?:HJY\d{8}-\d+|SO-\d{4,}-\d+)\b/i);
  if (order) return `business://order/${order[0]}`;
  const product = value.match(/\b(?:PN|SKU)[-_:]?[A-Za-z0-9][A-Za-z0-9._:-]*\b/i);
  if (product) return `business://product/${product[0]}`;
  const batch = value.match(/\b(?:BATCH|LOT)[-_:]?[A-Za-z0-9][A-Za-z0-9._:-]*\b/i);
  if (batch) return `business://batch/${batch[0]}`;
  return null;
}

/** 推理能力是否强制要求 context.businessObjectRef。 */
export function requiresBusinessObjectRef(capability) {
  const required = capability?.inputSchema?.properties?.context?.required;
  return Array.isArray(required) && required.includes('businessObjectRef');
}

/** 用问题中的业务锚点补齐推理请求的 context；没有锚点时保持原样。 */
export function attachBusinessObjectRef(request, text) {
  const ref = inferBusinessObjectRef(text);
  if (!ref) return request;
  return {
    ...request,
    context: { ...(request?.context && typeof request.context === 'object' ? request.context : {}), businessObjectRef: ref },
  };
}

/** 是否是“今日/当前风险最高的订单”这类需要先查询定位的全局问题。 */
export function isHighestRiskOrderQuery(text) {
  return /(风险最高|最高风险|风险最高的订单|今日.*风险|当前.*风险最高)/i.test(String(text || ''));
}

/** 执行面 Agent 按所属系统分组：systemId 优先，展示名取 sourceSystemName。 */
export function groupExecutionAgentsBySystem(agents) {
  const groups = new Map();
  for (const agent of Array.isArray(agents) ? agents : []) {
    const key = agent?.systemId || agent?.sourceSystem || agent?.sourceSystemName || 'unregistered';
    const label = agent?.sourceSystemName || agent?.systemId || agent?.sourceSystem || '未登记系统';
    const group = groups.get(key) ?? { key, label, agents: [], onlineCount: 0, total: 0 };
    group.agents.push(agent);
    group.total += 1;
    if (agent?.connectionStatus === 'online') group.onlineCount += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'));
}
