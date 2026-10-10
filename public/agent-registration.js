const TYPE_RULES = Object.freeze({
  hub: { level: 'L0', parentType: null },
  master: { level: 'L1', parentType: 'hub' },
  specialist: { level: 'L2', parentType: 'master' },
  tool: { level: 'L3', parentType: 'specialist' },
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function registrationRule(type) {
  const rule = TYPE_RULES[text(type)];
  if (!rule) throw new Error('Agent 类型无效');
  return rule;
}

export function normalizeAllowedRuntimeCapabilities(value) {
  const source = Array.isArray(value) ? value : text(value).split(',');
  const seen = new Set();
  const values = [];
  for (const item of source) {
    const capability = text(item);
    const key = capability.toLocaleLowerCase('en-US');
    if (!capability || seen.has(key)) continue;
    seen.add(key);
    values.push(capability);
  }
  return values;
}

export function eligibleParentAgents(agents, type) {
  const { parentType } = registrationRule(type);
  if (!parentType) return [];
  return (Array.isArray(agents) ? agents : []).filter((agent) => agent?.registration?.type === parentType);
}

export function buildAgentRegistrationPayload(input, agents) {
  const type = text(input?.type);
  const { level, parentType } = registrationRule(type);
  if (!parentType) throw new Error('Hub Agent 只能由系统初始化，不能在页面中新增');
  const parentAgentId = text(input?.parentAgentId);
  if (!eligibleParentAgents(agents, type).some((agent) => agent.id === parentAgentId)) {
    throw new Error(`上级 Agent 不符合 ${type} 的层级规则`);
  }
  return {
    ...input,
    type,
    parentAgentId,
    hierarchyLevel: level,
    allowedRuntimeCapabilities: normalizeAllowedRuntimeCapabilities(input?.allowedRuntimeCapabilities),
  };
}
