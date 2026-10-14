// 执行面能力注册表：把「G1 任务 → 执行面派单(capability + input)」的映射做成可插拔能力。
// 接入新智能体 = 在这里 register 一个新能力解析器，无需改动适配器 / task-api / server。
export type ExecutionCapabilityInput = Record<string, unknown>;
export type ExecutionCapabilityResolver = (task: { businessObjectRef: string; title: string }) => ExecutionCapabilityInput;
export interface ExecutionDispatch {
  capability: string;
  input: ExecutionCapabilityInput;
}

const resolvers = new Map<string, ExecutionCapabilityResolver>();

export function registerExecutionCapability(capability: string, resolver: ExecutionCapabilityResolver): void {
  if (!capability.trim()) throw new Error('capability 不能为空');
  resolvers.set(capability, resolver);
}

export function hasExecutionCapability(capability: string): boolean {
  return resolvers.has(capability);
}

export function resolveExecutionDispatch(task: { businessObjectRef: string; title: string }, capability: string): ExecutionDispatch {
  const resolver = resolvers.get(capability);
  if (!resolver) throw new Error(`未注册执行面能力: ${capability}`);
  return { capability, input: resolver(task) };
}

// ---------- 内置能力：中台只读查询 query_control_platform ----------
// 输入推导：从 G1 任务的 businessObjectRef（business://<source>/<encodeURIComponent(entityId)>）推导 path + params。
export function deriveExecutionQuery(businessObjectRef: string): { path: string; params: Record<string, string> } {
  const match = /^business:\/\/([^/]+)\/(.+)$/.exec(businessObjectRef);
  if (!match) throw new Error(`无法解析 businessObjectRef: ${businessObjectRef}`);
  const source = match[1];
  const entityId = decodeURIComponent(match[2]);

  if (source === 'kitting') {
    const colon = entityId.indexOf(':');
    const params: Record<string, string> = { demand_no: colon >= 0 ? entityId.slice(0, colon) : entityId };
    if (colon >= 0) params.demand_line_no = entityId.slice(colon + 1);
    return { path: '/external/material-kitting/results', params };
  }
  if (source === 'order') {
    return { path: '/external/orders/list', params: { keyword: entityId } };
  }
  throw new Error(`暂不支持派生查询的 source: ${source}`);
}

registerExecutionCapability('query_control_platform', (task) => deriveExecutionQuery(task.businessObjectRef));
