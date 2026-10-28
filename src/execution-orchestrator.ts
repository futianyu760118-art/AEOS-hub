// 窄范围编排：今日/当前风险最高的订单 → 查询智能体定位订单 → 推理智能体只读分析。
// 只做同系统、只读、确定性排序；不猜测订单号，不使用模拟执行面。
import { randomUUID } from 'node:crypto';
import type { ExecutionAgentRecord, ExecutionPlaneRegistry, ExecutionRunRecord } from './execution-plane.ts';
import type { EvidenceInput } from './evidence.ts';

const KITTING_RESULTS_PATH = '/external/material-kitting/results';
const DEFAULT_QUERY_TIMEOUT_MS = 15_000;
const DEFAULT_REASONING_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 200;

type ExecutionPlaneLike = Pick<ExecutionPlaneRegistry, 'list' | 'dispatch' | 'getRun' | 'recall'>;

export interface HighestRiskOrder {
  orderNo: string;
  riskLevel: string;
  riskRank: number;
  amount: number | null;
  promisedDate: string | null;
  businessObjectRef: string;
  raw: Record<string, unknown>;
}

export interface HighestRiskOrderResult {
  requestId: string;
  order: HighestRiskOrder;
  queryRunId: string;
  reasoningRunId: string;
  result: unknown;
}

export class ExecutionOrchestrationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly queryRunId: string | null;
  readonly reasoningRunId: string | null;

  constructor(
    code: string,
    message: string,
    options: { status?: number; requestId?: string | null; queryRunId?: string | null; reasoningRunId?: string | null } = {},
  ) {
    super(message);
    this.name = 'ExecutionOrchestrationError';
    this.code = code;
    this.status = options.status ?? 400;
    this.requestId = options.requestId ?? null;
    this.queryRunId = options.queryRunId ?? null;
    this.reasoningRunId = options.reasoningRunId ?? null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rowsFromResult(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result.filter((row) => record(row) !== null) as Array<Record<string, unknown>>;
  const root = record(result);
  if (!root) return [];
  const direct = ['items', 'rows', 'list', 'orders'];
  for (const key of direct) {
    if (Array.isArray(root[key])) return (root[key] as unknown[]).filter((row) => record(row) !== null) as Array<Record<string, unknown>>;
  }
  for (const key of ['data', 'body', 'result']) {
    if (Array.isArray(root[key])) return (root[key] as unknown[]).filter((row) => record(row) !== null) as Array<Record<string, unknown>>;
    const nested = record(root[key]);
    if (!nested) continue;
    for (const child of direct) {
      if (Array.isArray(nested[child])) return (nested[child] as unknown[]).filter((row) => record(row) !== null) as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function textOf(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function numberOf(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function riskRank(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (['red', 'high', '高', '高风险'].includes(normalized)) return 3;
  if (['yellow', 'medium', '中', '中风险'].includes(normalized)) return 2;
  if (['green', 'low', '低', '低风险'].includes(normalized)) return 1;
  return 0;
}

/** 从查询结果里提取订单并按“风险等级 → 金额降序 → 交期升序”排序。 */
export function rankOrdersFromResult(result: unknown): HighestRiskOrder[] {
  const orders = rowsFromResult(result).flatMap((row): HighestRiskOrder[] => {
    const orderNo = textOf(row, ['demand_no', 'order_no', 'orderNo', 'order_id', 'orderId', 'sales_order_no']);
    if (!orderNo) return [];
    const riskLevel = textOf(row, ['risk_level', 'riskLevel', 'risk']);
    const amount = numberOf(row, ['affected_order_amount', 'order_amount', 'orderAmount', 'shortage_amount', 'amount']);
    const promisedDate = textOf(row, ['required_date', 'promised_date', 'promisedDate', 'delivery_date', 'due_date']) || null;
    return [{
      orderNo,
      riskLevel,
      riskRank: riskRank(riskLevel),
      amount,
      promisedDate,
      businessObjectRef: `business://order/${orderNo}`,
      raw: row,
    }];
  });
  return orders.sort((left, right) => {
    if (left.riskRank !== right.riskRank) return right.riskRank - left.riskRank;
    const amountDiff = (right.amount ?? -1) - (left.amount ?? -1);
    if (amountDiff !== 0) return amountDiff;
    const leftDate = left.promisedDate ? Date.parse(left.promisedDate) : Number.POSITIVE_INFINITY;
    const rightDate = right.promisedDate ? Date.parse(right.promisedDate) : Number.POSITIVE_INFINITY;
    if (leftDate !== rightDate) return leftDate - rightDate;
    return left.orderNo.localeCompare(right.orderNo, 'zh-CN');
  });
}

export function buildHighestRiskReasoningRequest(text: string, order: HighestRiskOrder, requestId: string): Record<string, unknown> {
  const details = [
    `订单号：${order.orderNo}`,
    `风险等级：${order.riskLevel || '未知'}`,
    order.amount !== null ? `影响金额：${order.amount}` : '',
    order.promisedDate ? `需求日期：${order.promisedDate}` : '',
  ].filter(Boolean).join('；');
  const prompt = `${text}\n\n已从物料齐套红色风险中定位影响最大的订单：${details}。请仅基于该订单做只读交付风险分析，结论必须引用 evidence_refs；数据缺失或过期时明确说明数据置信度不足。`;
  return {
    prompt: prompt.slice(0, 2000),
    task_type: 'order_delivery_analysis',
    context: { businessObjectRef: order.businessObjectRef },
    constraints: { read_only: true, require_evidence: true },
    request_id: requestId,
  };
}

function capabilityName(agent: ExecutionAgentRecord, prefix: 'query' | 'reason'): string | null {
  return agent.capabilities.find((capability) => typeof capability.name === 'string' && capability.name.startsWith(prefix))?.name ?? null;
}

function supportsQueryPath(agent: ExecutionAgentRecord, capability: string, path: string): boolean {
  const cap = agent.capabilities.find((item) => item.name === capability);
  const allowed = cap?.inputSchema?.properties?.path?.enum;
  return !Array.isArray(allowed) || allowed.includes(path);
}

export interface ExecutionOrchestratorOptions {
  queryTimeoutMs?: number;
  reasoningTimeoutMs?: number;
  pollIntervalMs?: number;
  /** 目标执行面忙碌时的最长等待时间（后台分发会占用同一网关）。 */
  agentIdleTimeoutMs?: number;
  idFactory?: () => string;
  clock?: () => Date;
}

export class ExecutionOrchestrator {
  private readonly plane: ExecutionPlaneLike;
  private readonly appendEvidence: (input: EvidenceInput) => unknown;
  private readonly queryTimeoutMs: number;
  private readonly reasoningTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly agentIdleTimeoutMs: number;
  private readonly idFactory: () => string;
  private readonly clock: () => Date;

  constructor(
    plane: ExecutionPlaneLike,
    appendEvidence: (input: EvidenceInput) => unknown,
    options: ExecutionOrchestratorOptions = {},
  ) {
    this.plane = plane;
    this.appendEvidence = appendEvidence;
    this.queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    this.reasoningTimeoutMs = options.reasoningTimeoutMs ?? DEFAULT_REASONING_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.agentIdleTimeoutMs = options.agentIdleTimeoutMs ?? 60_000;
    this.idFactory = options.idFactory ?? randomUUID;
    this.clock = options.clock ?? (() => new Date());
  }

  async highestRiskOrder(input: { reasoningAgentId: string; text: string }): Promise<HighestRiskOrderResult> {
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    const reasoningAgentId = typeof input.reasoningAgentId === 'string' ? input.reasoningAgentId.trim() : '';
    if (!text || text.length > 2000) throw new ExecutionOrchestrationError('INVALID_ARGUMENT', 'text 必填且不超过 2000 字符', { status: 400 });
    if (!reasoningAgentId) throw new ExecutionOrchestrationError('INVALID_ARGUMENT', 'reasoningAgentId 必填', { status: 400 });

    const agents = this.plane.list().agents;
    const reasoner = agents.find((agent) => agent.agentId === reasoningAgentId);
    if (!reasoner || reasoner.connectionStatus !== 'online' || reasoner.deregisteredAt || reasoner.simulated) {
      throw new ExecutionOrchestrationError('REASONING_AGENT_UNAVAILABLE', '推理智能体不在线或不可用', { status: 409 });
    }
    const reasonCapability = capabilityName(reasoner, 'reason');
    if (!reasonCapability) throw new ExecutionOrchestrationError('CAPABILITY_UNSUPPORTED', '推理智能体未声明推理能力', { status: 409 });

    const reasonerSystem = reasoner.systemId ?? reasoner.sourceSystem;
    const sameSystem = (agent: ExecutionAgentRecord) => (agent.systemId ?? agent.sourceSystem) === reasonerSystem;
    const available = (agent: ExecutionAgentRecord) => agent.connectionStatus === 'online' && !agent.deregisteredAt && !agent.simulated;
    const canQuery = (agent: ExecutionAgentRecord) => available(agent) && sameSystem(agent) && Boolean(capabilityName(agent, 'query'));
    // 优先用独立的查询智能体；统一网关模式下同一个 Agent 同时声明查询与推理，允许复用自身。
    const queryer = agents.find((agent) => agent.agentId !== reasoner.agentId && canQuery(agent))
      ?? (canQuery(reasoner) ? reasoner : undefined);
    if (!queryer) {
      throw new ExecutionOrchestrationError('QUERY_AGENT_UNAVAILABLE', '同系统内没有可用的查询智能体', { status: 409 });
    }
    const queryCapability = capabilityName(queryer, 'query')!;
    if (!supportsQueryPath(queryer, queryCapability, KITTING_RESULTS_PATH)) {
      throw new ExecutionOrchestrationError('QUERY_PATH_UNSUPPORTED', '查询智能体未开放物料齐套查询路径', { status: 409 });
    }

    const requestId = `orch-${this.idFactory()}`;
    let queryRunId: string | null = null;
    let reasoningRunId: string | null = null;
    try {
      await this.requireAgentIdle(queryer.agentId, requestId);
      const queryDispatch = this.plane.dispatch(queryer.agentId, queryCapability, {
        path: KITTING_RESULTS_PATH,
        params: { page: 1, page_size: 200, risk_level: 'red' },
      }, { traceId: requestId });
      queryRunId = queryDispatch.runId;
      const queryRun = await this.waitForRun(queryRunId, this.queryTimeoutMs, 'QUERY_TIMEOUT');
      if (queryRun.state !== 'completed') {
        throw new ExecutionOrchestrationError('QUERY_FAILED', queryRun.error?.message || '订单查询未完成', {
          status: 502, requestId, queryRunId,
        });
      }

      const [order] = rankOrdersFromResult(queryRun.result);
      if (!order) {
        throw new ExecutionOrchestrationError('NO_ELIGIBLE_ORDER', '当前查询窗口没有可用于分析的订单', {
          status: 422, requestId, queryRunId,
        });
      }

      await this.requireAgentIdle(reasoner.agentId, requestId, queryRunId);
      const reasonDispatch = this.plane.dispatch(reasoner.agentId, reasonCapability, buildHighestRiskReasoningRequest(text, order, requestId), { traceId: requestId });
      reasoningRunId = reasonDispatch.runId;
      const reasonRun = await this.waitForRun(reasoningRunId, this.reasoningTimeoutMs, 'REASONING_TIMEOUT');
      if (reasonRun.state !== 'completed') {
        throw new ExecutionOrchestrationError('REASONING_FAILED', reasonRun.error?.message || '推理未完成', {
          status: 502, requestId, queryRunId, reasoningRunId,
        });
      }

      this.audit('completed', { requestId, traceId: requestId, queryRunId, reasoningRunId, orderNo: order.orderNo, queryAgentId: queryer.agentId, reasoningAgentId: reasoner.agentId });
      return { requestId, order, queryRunId, reasoningRunId, result: reasonRun.result };
    } catch (error) {
      const mapped = error instanceof ExecutionOrchestrationError
        ? error
        : new ExecutionOrchestrationError('ORCHESTRATION_FAILED', (error as Error).message || '编排失败', {
          status: 502, requestId, queryRunId, reasoningRunId,
        });
      if (reasoningRunId) {
        try { this.plane.recall(reasoner.agentId); } catch { /* 已结束或已召回 */ }
      }
      this.audit('failed', { requestId, traceId: requestId, queryRunId, reasoningRunId, code: mapped.code });
      throw mapped;
    }
  }

  /** 通用单能力派单：供中枢意图路由调用；失败时尝试召回。 */
  async runCapability(input: {
    agentId: string;
    capability: string;
    input: unknown;
    timeoutMs?: number;
  }): Promise<unknown> {
    await this.requireAgentIdle(input.agentId, null);
    const dispatch = this.plane.dispatch(input.agentId, input.capability, input.input);
    try {
      const run = await this.waitForRun(dispatch.runId, input.timeoutMs ?? this.reasoningTimeoutMs, 'EXECUTION_TIMEOUT');
      if (run.state !== 'completed') {
        throw new ExecutionOrchestrationError('EXECUTION_FAILED', run.error?.message || '执行面未完成', { status: 502 });
      }
      return run.result;
    } catch (error) {
      try { this.plane.recall(input.agentId); } catch { /* 已结束或已召回 */ }
      throw error instanceof ExecutionOrchestrationError
        ? error
        : new ExecutionOrchestrationError('EXECUTION_FAILED', (error as Error).message || '执行失败', { status: 502 });
    }
  }

  /** 目标执行面同一时刻只跑一个任务：等空闲再派；超时返回 AGENT_BUSY，不直接撞上游。 */
  private async requireAgentIdle(agentId: string, requestId: string | null, queryRunId: string | null = null): Promise<void> {
    const deadline = Date.now() + this.agentIdleTimeoutMs;
    for (;;) {
      const agent = this.plane.list().agents.find((item) => item.agentId === agentId);
      // 离线/不存在交给 dispatch 按原逻辑报错。
      if (!agent || agent.connectionStatus !== 'online') return;
      if (!agent.currentRunId && agent.runtimeStatus !== 'working') return;
      if (Date.now() >= deadline) {
        throw new ExecutionOrchestrationError('AGENT_BUSY', '目标执行面持续忙碌，请稍后重试', {
          status: 409, requestId, queryRunId,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  private async waitForRun(runId: string, timeoutMs: number, timeoutCode: string): Promise<ExecutionRunRecord> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = this.plane.getRun(runId);
      if (run && ['completed', 'failed', 'recalled'].includes(run.state)) return run;
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new ExecutionOrchestrationError(timeoutCode, '执行超时', { status: 504 });
  }

  private audit(status: 'completed' | 'failed', payload: Record<string, unknown>): void {
    try {
      this.appendEvidence({
        kind: 'app_event',
        actor_id: 'hub-execution-orchestrator',
        actor_type: 'system',
        object_ref: 'hub://execution-orchestration/highest-risk-order',
        source_system: 'aeos-hub',
        correlation_id: 'execution-orchestration-highest-risk',
        summary: `highest risk order orchestration ${status}`,
        payload: { status, ...payload },
      });
    } catch {
      // 审计失败不改变编排结果。
    }
  }
}
