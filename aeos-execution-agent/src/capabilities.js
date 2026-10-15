// 能力注册表：插件式能力注册。新增能力 = registerCapability，不改 agent-core。
// 能力可自描述：name/description 之外，可带 inputSchema/outputSchema/constraints，
// 注册时原样上报给管理面，由管理面做通用校验。
const capabilities = new Map();

export function registerCapability({ name, description, version, inputSchema, outputSchema, constraints, handler }) {
  if (!name || typeof name !== 'string') throw new Error('能力注册需要 name');
  if (typeof handler !== 'function') throw new Error(`能力 ${name} 需要 handler 函数`);
  capabilities.set(name, { name, description: description || '', version, inputSchema, outputSchema, constraints, handler });
}

export function capabilityHandlers() {
  const handlers = {};
  for (const [name, cap] of capabilities) handlers[name] = cap.handler;
  return handlers;
}

export function capabilityDefinitions() {
  return [...capabilities.values()].map((cap) => {
    const definition = { name: cap.name, description: cap.description };
    if (cap.version) definition.version = cap.version;
    if (cap.inputSchema) definition.inputSchema = cap.inputSchema;
    if (cap.outputSchema) definition.outputSchema = cap.outputSchema;
    if (cap.constraints) definition.constraints = cap.constraints;
    return definition;
  });
}
