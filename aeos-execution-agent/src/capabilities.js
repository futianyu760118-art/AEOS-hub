// 能力注册表：插件式能力注册。新增能力 = registerCapability，不改 agent-core。
const capabilities = new Map();

export function registerCapability({ name, description, handler }) {
  if (!name || typeof name !== 'string') throw new Error('能力注册需要 name');
  if (typeof handler !== 'function') throw new Error(`能力 ${name} 需要 handler 函数`);
  capabilities.set(name, { name, description: description || '', handler });
}

export function capabilityHandlers() {
  const handlers = {};
  for (const [name, cap] of capabilities) handlers[name] = cap.handler;
  return handlers;
}

export function capabilityDefinitions() {
  return [...capabilities.values()].map((cap) => ({ name: cap.name, description: cap.description }));
}
