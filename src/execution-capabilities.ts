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

// ---------- businessObjectRef 解析 ----------
export interface BusinessObjectRef {
  source: string;
  entityId: string;
}

export function parseBusinessObjectRef(businessObjectRef: string): BusinessObjectRef {
  const match = /^business:\/\/([^/]+)\/(.+)$/.exec(businessObjectRef);
  if (!match) throw new Error(`无法解析 businessObjectRef: ${businessObjectRef}`);
  return { source: match[1], entityId: decodeURIComponent(match[2]) };
}

// ---------- 查询能力 query_control_platform ----------
// 只读接口白名单（与 mcp-company-control/mcp_server/upstream_client.py 的 _ENDPOINT_CODES 一致）。
export const CONTROL_PLATFORM_READONLY_PATHS = [
  '/common/ping',
  '/external/orders/list',
  '/external/order-details/list',
  '/external/boms/tree',
  '/external/materials/list',
  '/external/suppliers/list',
  '/external/material-kitting/results',
  '/external/material-kitting/shortages',
  '/external/material-kitting/demands',
  '/external/inventory/availability',
  '/external/material-supplies/list',
  '/external/quality-issues/list',
  '/external/quality-trace/list',
  '/external/production/work-orders/list',
  '/external/production/operations/list',
  '/external/production/order-links/list',
  '/external/production/reports/list',
  '/external/production/capacity/list',
] as const;

export function deriveExecutionQuery(businessObjectRef: string): { path: string; params: Record<string, string> } {
  const { source, entityId } = parseBusinessObjectRef(businessObjectRef);
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

// ---------- 推理能力 reason_control_platform ----------
const REASON_TASK_TYPE_BY_SOURCE: Record<string, string> = {
  order: 'order_delivery_analysis',
  kitting: 'material_kitting_analysis',
  quality: 'quality_analysis',
  production: 'production_analysis',
};

export type ReasoningRequest = {
  prompt: string;
  task_type: string;
  context: Record<string, unknown>;
  constraints: { read_only: boolean; require_evidence: boolean };
};

export function deriveExecutionReasoning(task: { businessObjectRef: string; title: string }): ReasoningRequest {
  const { source } = parseBusinessObjectRef(task.businessObjectRef);
  return {
    prompt: task.title,
    task_type: REASON_TASK_TYPE_BY_SOURCE[source] ?? 'operating_case_analysis',
    context: { businessObjectRef: task.businessObjectRef },
    constraints: { read_only: true, require_evidence: true },
  };
}

// ---------- 输入/结果校验（返回 null 表示通过，否则返回错误信息） ----------
export function validateQueryInput(input: Record<string, unknown>): string | null {
  const path = typeof input.path === 'string' ? input.path : '';
  if (!path) return '查询输入缺少 path';
  if (!(CONTROL_PLATFORM_READONLY_PATHS as readonly string[]).includes(path)) {
    return `不在只读白名单内的查询 path: ${path}`;
  }
  if (input.params !== undefined && (input.params === null || typeof input.params !== 'object' || Array.isArray(input.params))) {
    return '查询输入 params 必须是对象';
  }
  return null;
}

export function validateReasoningInput(input: Record<string, unknown>): string | null {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) return '推理输入缺少 prompt';
  if (prompt.length > 2000) return '推理 prompt 过长（最多 2000 字符）';
  const taskType = typeof input.task_type === 'string' ? input.task_type.trim() : '';
  if (!taskType) return '推理输入缺少 task_type';
  const constraints = input.constraints;
  if (constraints && typeof constraints === 'object' && (constraints as Record<string, unknown>).read_only === false) {
    return '推理能力不允许写操作（constraints.read_only 必须为 true）';
  }
  return null;
}

/** 校验推理结果：每条结论必须携带非空 evidence_refs。 */
export function validateReasoningResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') return '推理结果必须是对象';
  const conclusions = (result as Record<string, unknown>).conclusions;
  if (!Array.isArray(conclusions) || conclusions.length === 0) return '推理结果缺少 conclusions 数组';
  for (const conclusion of conclusions) {
    if (!conclusion || typeof conclusion !== 'object') return '推理结论必须是对象';
    const refs = (conclusion as Record<string, unknown>).evidence_refs;
    if (!Array.isArray(refs) || refs.length === 0 || !refs.every((ref) => typeof ref === 'string' && ref.trim())) {
      return '推理结论必须包含非空 evidence_refs';
    }
  }
  return null;
}

export function validateExecutionInput(capability: string, input: Record<string, unknown>): string | null {
  if (capability === 'query_control_platform') return validateQueryInput(input);
  if (capability === 'reason_control_platform') return validateReasoningInput(input);
  return null; // 未知能力交由 dispatch 的白名单校验拒绝。
}

registerExecutionCapability('query_control_platform', (task) => deriveExecutionQuery(task.businessObjectRef));
registerExecutionCapability('reason_control_platform', (task) => deriveExecutionReasoning(task));
