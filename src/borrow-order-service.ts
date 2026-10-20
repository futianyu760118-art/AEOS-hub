// 跨系统借调服务：能力目录解析 → 创建借调单 → 派单 → 状态回写 → 用量归属 → 启动对账。
// Hub 只做中介：不直连提供方业务系统，所有执行都经 ExecutionPlaneRegistry。
import { createHash } from 'node:crypto';
import {
  ExecutionPlaneError,
  type AgentOfflineEvent,
  type ExecutionAgentRecord,
  type ExecutionPlaneRegistry,
  type ExecutionRunStateEvent,
} from './execution-plane.ts';
import { isBorrowCapabilityAllowed } from './borrow-policy.ts';
import { DEFAULT_TENANT_ID } from './tenant-registry.ts';
import {
  BorrowOrderStore,
  BorrowOrderStoreError,
  capBorrowResult,
  BORROW_ORDER_MAX_INPUT_BYTES,
  type BorrowOrderRecord,
  type BorrowOrderStatus,
} from './borrow-order-store.ts';
import type { EvidenceInput } from './evidence.ts';
import type { UsageEventAppendInput } from './usage-ledger-store.ts';

const DEFAULT_TENANT = DEFAULT_TENANT_ID;
const DEFAULT_OPEN_ORDER_LIMIT = 50;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const ALLOWED_CREATE_FIELDS = new Set(['requestId', 'capability', 'input', 'toSystem', 'toAgent', 'fromAgentId']);
const TERMINAL: ReadonlySet<BorrowOrderStatus> = new Set(['completed', 'failed', 'cancelled']);

export class BorrowOrderServiceError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, httpStatus: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'BorrowOrderServiceError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export interface BorrowOrderServiceOptions {
  store: BorrowOrderStore;
  executionPlane: Pick<ExecutionPlaneRegistry, 'list' | 'dispatch' | 'getRun'>;
  appendEvidence: (input: EvidenceInput) => unknown;
  tenantId?: string;
  openOrderLimit?: number;
}

export interface CreateBorrowOrderResult {
  order: BorrowOrderRecord;
  idempotent: boolean;
  dispatch?: { runId: string; state: string };
  auditStatus: 'recorded' | 'failed';
}

export interface CapabilityDirectoryEntry {
  name: string;
  description: string;
  providers: Array<{
    systemId: string;
    agentId: string;
    agentName: string;
    online: boolean;
    busy: boolean;
    lastSeenAt: string;
  }>;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function requestHash(capability: string, input: unknown, toSystem: string | null, toAgent: string | null): string {
  return createHash('sha256').update(stableStringify({ capability, input, toSystem, toAgent })).digest('hex');
}

function requireText(value: unknown, field: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BorrowOrderServiceError('INVALID_ARGUMENT', 400, `${field} 必填且必须是非空字符串`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BorrowOrderServiceError('INVALID_ARGUMENT', 400, `${field} 不能超过 ${max} 个字符`);
  return trimmed;
}

function optionalText(value: unknown, field: string, max = 160): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BorrowOrderServiceError('INVALID_ARGUMENT', 400, `${field} 必须是字符串`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new BorrowOrderServiceError('INVALID_ARGUMENT', 400, `${field} 不能超过 ${max} 个字符`);
  return trimmed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function agentHasCapability(agent: ExecutionAgentRecord, capability: string): boolean {
  return agent.capabilities.some((cap) => cap.name === capability);
}

function agentHasReadOnlyCapability(agent: ExecutionAgentRecord, capability: string): boolean {
  return agent.capabilities.some((cap) => cap.name === capability && cap.constraints?.readOnly === true);
}

function isEligible(agent: ExecutionAgentRecord, capability: string, fromSystem: string): boolean {
  return agent.connectionStatus === 'online'
    && !agent.deregisteredAt
    && agent.sourceSystem !== fromSystem
    && isBorrowCapabilityAllowed(agent.sourceSystem, capability)
    && agentHasReadOnlyCapability(agent, capability);
}

function eligibilityReasons(agent: ExecutionAgentRecord, capability: string, fromSystem: string): string[] {
  const reasons: string[] = [];
  if (agent.sourceSystem === fromSystem) reasons.push('same_system');
  if (agent.deregisteredAt) reasons.push('deregistered');
  if (agent.connectionStatus !== 'online') reasons.push('offline');
  if (!agentHasCapability(agent, capability)) reasons.push('capability_missing');
  else if (!agentHasReadOnlyCapability(agent, capability)) reasons.push('not_read_only');
  if (!isBorrowCapabilityAllowed(agent.sourceSystem, capability)) reasons.push('capability_not_allowed_for_borrow');
  return reasons;
}

function compareCandidates(a: ExecutionAgentRecord, b: ExecutionAgentRecord): number {
  const idle = (agent: ExecutionAgentRecord) => agent.runtimeStatus === 'idle' && agent.currentRunId === null;
  if (idle(a) !== idle(b)) return idle(a) ? -1 : 1;
  const seen = (b.lastSeenAt || '').localeCompare(a.lastSeenAt || '');
  if (seen !== 0) return seen;
  const registered = (a.registeredAt || '').localeCompare(b.registeredAt || '');
  if (registered !== 0) return registered;
  return a.agentId.localeCompare(b.agentId);
}

export class BorrowOrderService {
  private readonly store: BorrowOrderStore;
  private readonly executionPlane: Pick<ExecutionPlaneRegistry, 'list' | 'dispatch' | 'getRun'>;
  private readonly appendEvidence: (input: EvidenceInput) => unknown;
  private readonly tenantId: string;
  private readonly openOrderLimit: number;
  private readonly runToOrder = new Map<string, string>();

  constructor(options: BorrowOrderServiceOptions) {
    this.store = options.store;
    this.executionPlane = options.executionPlane;
    this.appendEvidence = options.appendEvidence;
    this.tenantId = options.tenantId?.trim() || DEFAULT_TENANT;
    this.openOrderLimit = options.openOrderLimit ?? DEFAULT_OPEN_ORDER_LIMIT;
    this.rebuildRunIndex();
  }

  private rebuildRunIndex(): void {
    this.runToOrder.clear();
    for (const order of this.store.load().orders) {
      if (order.runId && !TERMINAL.has(order.status)) this.runToOrder.set(order.runId, order.orderId);
    }
  }

  private audit(action: string, order: BorrowOrderRecord | null, extra: Record<string, unknown> = {}): 'recorded' | 'failed' {
    const requesterAction = action === 'created' || action === 'dispatched' || action === 'denied' || action === 'conflict';
    const fromSystem = order?.fromSystem ?? String(extra.fromSystem ?? 'unknown');
    try {
      this.appendEvidence({
        kind: 'app_event',
        actor_id: requesterAction ? `execution-token:system:${fromSystem}` : 'borrow-broker:hub',
        actor_type: 'system',
        object_ref: order ? `hub://borrow-order/${order.orderId}` : 'hub://system/borrow-order',
        source_system: requesterAction ? fromSystem : (order?.providerSystem || 'aeos-hub'),
        correlation_id: `borrow-order-${action}`,
        summary: `borrow order ${action}`,
        payload: {
          action,
          orderId: order?.orderId ?? null,
          requestId: order?.requestId ?? null,
          capability: order?.capability ?? extra.capability ?? null,
          fromSystem,
          providerSystem: order?.providerSystem ?? null,
          providerAgentId: order?.providerAgentId ?? null,
          runId: order?.runId ?? null,
          status: order?.status ?? null,
          ...extra,
        },
      });
      return 'recorded';
    } catch {
      return 'failed';
    }
  }

  private resolveProvider(fromSystem: string, capability: string, toSystem: string | null, toAgent: string | null): ExecutionAgentRecord {
    const agents = this.executionPlane.list().agents;
    if (!agents.some((agent) => agentHasCapability(agent, capability))) {
      throw new BorrowOrderServiceError('CAPABILITY_NOT_FOUND', 404, `没有任何系统声明能力 ${capability}`);
    }
    if (!agents.some((agent) => agentHasReadOnlyCapability(agent, capability))) {
      throw new BorrowOrderServiceError('NO_PROVIDER', 409, '该能力存在，但没有系统声明只读版本，试点不可借调', { reason: 'no_read_only_provider' });
    }
    const externalAgents = agents.filter((agent) => agent.sourceSystem !== fromSystem);
    if (externalAgents.some((agent) => agentHasReadOnlyCapability(agent, capability))
      && !externalAgents.some((agent) => isBorrowCapabilityAllowed(agent.sourceSystem, capability) && agentHasReadOnlyCapability(agent, capability))) {
      throw new BorrowOrderServiceError('CAPABILITY_NOT_ALLOWED', 403, `能力 ${capability} 不允许跨系统借调`, { reason: 'capability_not_allowed' });
    }
    if (toSystem && toSystem === fromSystem) {
      throw new BorrowOrderServiceError('SELF_BORROW_FORBIDDEN', 403, '不允许向本系统借调');
    }

    let targetPool: ExecutionAgentRecord[];
    if (toAgent) {
      const target = agents.find((agent) => agent.agentId === toAgent);
      if (!target) {
        throw new BorrowOrderServiceError('TARGET_NOT_ELIGIBLE', 409, `指定目标不存在：${toAgent}`, { reasons: ['agent_not_found'] });
      }
      if (target.sourceSystem === fromSystem) {
        throw new BorrowOrderServiceError('SELF_BORROW_FORBIDDEN', 403, '不允许向本系统的 Agent 借调');
      }
      if (toSystem && target.sourceSystem !== toSystem) {
        throw new BorrowOrderServiceError('TARGET_NOT_ELIGIBLE', 409, '指定的 Agent 不属于指定系统', { reasons: ['target_system_mismatch'] });
      }
      targetPool = [target];
    } else if (toSystem) {
      targetPool = agents.filter((agent) => agent.sourceSystem === toSystem);
    } else {
      targetPool = agents;
    }

    const eligible = targetPool.filter((agent) => isEligible(agent, capability, fromSystem));
    if (!eligible.length) {
      if (toAgent || toSystem) {
        const reasons = targetPool.flatMap((agent) => eligibilityReasons(agent, capability, fromSystem));
        throw new BorrowOrderServiceError('TARGET_NOT_ELIGIBLE', 409, '指定目标当前不可用', {
          reasons: [...new Set(reasons)],
          candidateCount: targetPool.length,
        });
      }
      const readOnlyProviders = agents.filter((agent) => !agent.deregisteredAt && agentHasReadOnlyCapability(agent, capability));
      const onlySameSystem = readOnlyProviders.length > 0 && readOnlyProviders.every((agent) => agent.sourceSystem === fromSystem);
      throw new BorrowOrderServiceError('NO_PROVIDER', 409, onlySameSystem
        ? '该能力只有本系统提供，无法跨系统借调'
        : '没有其他系统的在线只读提供方', { reason: onlySameSystem ? 'only_same_system' : 'no_online_read_only_provider' });
    }
    return eligible.slice().sort(compareCandidates)[0];
  }

  create(input: {
    fromSystem: string;
    body: Record<string, unknown>;
  }): CreateBorrowOrderResult {
    const fromSystem = requireText(input.fromSystem, 'fromSystem');
    const body = input.body ?? {};
    const unknownFields = Object.keys(body).filter((key) => !ALLOWED_CREATE_FIELDS.has(key));
    if (unknownFields.length) {
      throw new BorrowOrderServiceError('INVALID_ARGUMENT', 400, `不支持的字段：${unknownFields.join(', ')}`);
    }
    const requestId = requireText(body.requestId, 'requestId');
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      throw new BorrowOrderServiceError('INVALID_ARGUMENT', 400, 'requestId 只能包含字母、数字、点、下划线、冒号和连字符');
    }
    const capability = requireText(body.capability, 'capability', 100);
    const toSystem = optionalText(body.toSystem, 'toSystem');
    const toAgent = optionalText(body.toAgent, 'toAgent');
    const fromAgentId = optionalText(body.fromAgentId, 'fromAgentId');
    const rawInput = body.input === undefined ? {} : body.input;
    if (!isPlainObject(rawInput)) {
      throw new BorrowOrderServiceError('INVALID_ARGUMENT', 400, 'input 必须是 JSON 对象');
    }
    const inputBytes = Buffer.byteLength(JSON.stringify(rawInput), 'utf8');
    if (inputBytes > BORROW_ORDER_MAX_INPUT_BYTES) {
      throw new BorrowOrderServiceError('PAYLOAD_TOO_LARGE', 413, `input 超过 ${BORROW_ORDER_MAX_INPUT_BYTES} 字节`);
    }
    const hash = requestHash(capability, rawInput, toSystem, toAgent);

    const existing = this.store.findByRequest(fromSystem, requestId);
    if (existing) {
      if (existing.requestHash !== hash) {
        this.audit('conflict', existing);
        throw new BorrowOrderServiceError('REQUEST_CONFLICT', 409, 'requestId 已用于不同的借调请求', { orderId: existing.orderId });
      }
      return { order: existing, idempotent: true, auditStatus: 'recorded' };
    }
    if (this.store.countOpenForSystem(fromSystem) >= this.openOrderLimit) {
      this.audit('denied', null, { fromSystem, reason: 'too_many_open_orders', capability });
      throw new BorrowOrderServiceError('TOO_MANY_OPEN_ORDERS', 429, `未完成借调单过多（上限 ${this.openOrderLimit}）`);
    }

    const provider = this.resolveProvider(fromSystem, capability, toSystem, toAgent);
    const order = this.store.create({
      tenantId: this.tenantId,
      requestId,
      requestHash: hash,
      fromSystem,
      fromAgentId,
      capability,
      input: rawInput,
      toSystem,
      toAgent,
      providerSystem: provider.sourceSystem,
      providerAgentId: provider.agentId,
    });
    const createdAudit = this.audit('created', order);
    try {
      const dispatched = this.executionPlane.dispatch(provider.agentId, capability, rawInput);
      this.runToOrder.set(dispatched.runId, order.orderId);
      const updated = this.store.update(order.orderId, {
        status: 'dispatched',
        runId: dispatched.runId,
        dispatchedAt: new Date().toISOString(),
      }, { expectedStatuses: ['pending'] });
      const dispatchedAudit = this.audit('dispatched', updated);
      return {
        order: updated,
        idempotent: false,
        dispatch: dispatched,
        auditStatus: createdAudit === 'recorded' && dispatchedAudit === 'recorded' ? 'recorded' : 'failed',
      };
    } catch (error) {
      const mapped = error instanceof ExecutionPlaneError ? mapDispatchError(error) : null;
      const failed = this.store.update(order.orderId, {
        status: 'failed',
        error: {
          code: mapped?.code ?? 'DISPATCH_FAILED',
          message: (error as Error).message || '派单失败',
          stage: 'dispatch',
        },
        endedAt: new Date().toISOString(),
      }, { expectedStatuses: ['pending'] });
      const failedAudit = this.audit('failed', failed);
      throw new BorrowOrderServiceError(
        mapped?.code ?? 'DISPATCH_FAILED',
        mapped?.httpStatus ?? 502,
        `派单失败：${(error as Error).message}`,
        { order: failed, auditStatus: failedAudit },
      );
    }
  }

  listForSystem(systemId: string, filter: { direction?: 'outgoing' | 'incoming' | 'all'; status?: BorrowOrderStatus; limit?: number } = {}): {
    outgoing: BorrowOrderRecord[];
    incoming: BorrowOrderRecord[];
  } {
    const direction = filter.direction ?? 'outgoing';
    const limit = filter.limit ?? 100;
    const outgoing = direction === 'incoming' ? [] : this.store.list({ fromSystem: systemId, status: filter.status, limit });
    const incoming = direction === 'outgoing' ? [] : this.store.list({ providerSystem: systemId, status: filter.status, limit });
    return { outgoing, incoming };
  }

  getForSystem(systemId: string, orderId: string): BorrowOrderRecord {
    const order = this.store.get(orderId);
    if (!order || (order.fromSystem !== systemId && order.providerSystem !== systemId)) {
      throw new BorrowOrderServiceError('ORDER_NOT_FOUND', 404, '借调单不存在或无权查看');
    }
    return order;
  }

  listAll(filter: { status?: BorrowOrderStatus; limit?: number } = {}): BorrowOrderRecord[] {
    return this.store.list({ status: filter.status, limit: filter.limit ?? 100 });
  }

  capabilityDirectory(systemId: string): CapabilityDirectoryEntry[] {
    const byName = new Map<string, CapabilityDirectoryEntry>();
    for (const agent of this.executionPlane.list().agents) {
      if (agent.deregisteredAt || agent.sourceSystem === systemId) continue;
      for (const cap of agent.capabilities) {
        if (cap.constraints?.readOnly !== true) continue;
        if (!isBorrowCapabilityAllowed(agent.sourceSystem, cap.name)) continue;
        const entry = byName.get(cap.name) ?? { name: cap.name, description: cap.description, providers: [] };
        entry.providers.push({
          systemId: agent.sourceSystem,
          agentId: agent.agentId,
          agentName: agent.name,
          online: agent.connectionStatus === 'online',
          busy: agent.runtimeStatus === 'working' || agent.currentRunId !== null,
          lastSeenAt: agent.lastSeenAt,
        });
        byName.set(cap.name, entry);
      }
    }
    return [...byName.values()]
      .map((entry) => ({ ...entry, providers: entry.providers.slice().sort((a, b) => a.agentId.localeCompare(b.agentId)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 运行状态回调：把执行面事件折叠回借调单；任何异常都不得影响执行面。 */
  handleRunStateChange(event: ExecutionRunStateEvent): void {
    try {
      const order = this.orderForRun(event.runId);
      if (!order || TERMINAL.has(order.status)) return;
      if (event.state === 'running' && (order.status === 'pending' || order.status === 'dispatched')) {
        const updated = this.store.update(order.orderId, { status: 'running', startedAt: order.startedAt ?? new Date().toISOString() });
        this.audit('running', updated);
        return;
      }
      if (event.state === 'completed' && (order.status === 'dispatched' || order.status === 'running')) {
        const capped = capBorrowResult(event.result ?? null);
        const updated = this.store.update(order.orderId, {
          status: 'completed',
          result: capped.result,
          resultBytes: capped.resultBytes,
          resultTruncated: capped.resultTruncated,
          endedAt: event.endedAt ?? new Date().toISOString(),
        });
        this.runToOrder.delete(event.runId);
        this.audit('completed', updated);
        return;
      }
      if (event.state === 'failed' && (order.status === 'dispatched' || order.status === 'running')) {
        const updated = this.store.update(order.orderId, {
          status: 'failed',
          error: { code: event.error?.code ?? 'EXECUTION_FAILED', message: event.error?.message ?? '执行面查询失败', stage: 'execution' },
          endedAt: event.endedAt ?? new Date().toISOString(),
        });
        this.runToOrder.delete(event.runId);
        this.audit('failed', updated);
        return;
      }
      if (event.state === 'recalled' && (order.status === 'dispatched' || order.status === 'running')) {
        const updated = this.store.update(order.orderId, {
          status: 'cancelled',
          error: { code: 'PROVIDER_RECALLED', message: '提供方已召回执行', stage: 'execution' },
          endedAt: event.endedAt ?? new Date().toISOString(),
        });
        this.runToOrder.delete(event.runId);
        this.audit('cancelled', updated);
      }
    } catch (error) {
      console.warn('[borrow-order] 运行状态回写失败:', (error as Error).message);
    }
  }

  /** 提供方掉线：未完成的借调单立即失败（协议不支持续跑）。 */
  handleAgentOffline(event: AgentOfflineEvent): void {
    if (!event.runId) return;
    try {
      const order = this.orderForRun(event.runId);
      if (!order || TERMINAL.has(order.status)) return;
      const updated = this.store.update(order.orderId, {
        status: 'failed',
        error: { code: 'PROVIDER_DISCONNECTED', message: '提供方执行面连接中断', stage: 'execution' },
        endedAt: new Date().toISOString(),
      });
      this.runToOrder.delete(event.runId);
      this.audit('failed', updated);
    } catch (error) {
      console.warn('[borrow-order] 提供方掉线回写失败:', (error as Error).message);
    }
  }

  /** 用量归属：执行方仍记 systemId/agentId，另补请求方与借调单号。 */
  attributeUsage(event: UsageEventAppendInput): UsageEventAppendInput {
    if (!event.runId) return event;
    const order = this.orderForRun(event.runId);
    if (!order) return event;
    return {
      ...event,
      consumerSystemId: order.fromSystem,
      consumerAgentId: order.fromAgentId ?? null,
      borrowOrderId: order.orderId,
    };
  }

  /** 启动对账：Hub 重启后无法恢复在途 run，按能查到的最终状态同步，其余标记失败。 */
  reconcileOnStartup(): { reconciled: number; failed: number } {
    let reconciled = 0;
    let failed = 0;
    for (const order of this.store.load().orders) {
      if (TERMINAL.has(order.status)) continue;
      try {
        if (!order.runId) {
          this.failReconciled(order, 'INTERRUPTED_BEFORE_DISPATCH', '任务在派单前被中断');
          failed += 1;
          continue;
        }
        const run = this.executionPlane.getRun(order.runId);
        if (!run) {
          this.failReconciled(order, 'ORPHANED_RUN_NOT_FOUND', '执行记录已丢失');
          failed += 1;
          continue;
        }
        if (run.state === 'completed') {
          const capped = capBorrowResult(run.result ?? null);
          const updated = this.store.update(order.orderId, {
            status: 'completed',
            result: capped.result,
            resultBytes: capped.resultBytes,
            resultTruncated: capped.resultTruncated,
            endedAt: run.endedAt ?? new Date().toISOString(),
          });
          this.audit('reconciled', updated);
          reconciled += 1;
          continue;
        }
        if (run.state === 'failed') {
          const updated = this.store.update(order.orderId, {
            status: 'failed',
            error: { code: run.error?.code ?? 'EXECUTION_FAILED', message: run.error?.message ?? '执行面查询失败', stage: 'reconcile' },
            endedAt: run.endedAt ?? new Date().toISOString(),
          });
          this.audit('reconciled', updated);
          reconciled += 1;
          continue;
        }
        if (run.state === 'recalled') {
          const updated = this.store.update(order.orderId, {
            status: 'cancelled',
            error: { code: 'PROVIDER_RECALLED', message: '提供方已召回执行', stage: 'reconcile' },
            endedAt: run.endedAt ?? new Date().toISOString(),
          });
          this.audit('reconciled', updated);
          reconciled += 1;
          continue;
        }
        this.failReconciled(order, 'ORPHANED_AFTER_RESTART', 'Hub 重启导致在途任务中断，请重新发起');
        failed += 1;
      } catch (error) {
        console.warn('[borrow-order] 对账失败:', order.orderId, (error as Error).message);
      }
    }
    this.rebuildRunIndex();
    return { reconciled, failed };
  }

  private failReconciled(order: BorrowOrderRecord, code: string, message: string): void {
    const updated = this.store.update(order.orderId, {
      status: 'failed',
      error: { code, message, stage: 'reconcile' },
      endedAt: new Date().toISOString(),
    });
    this.audit('reconciled', updated);
  }

  private orderForRun(runId: string): BorrowOrderRecord | null {
    const orderId = this.runToOrder.get(runId);
    if (orderId) return this.store.get(orderId);
    const found = this.store.findByRunId(runId);
    if (found && !TERMINAL.has(found.status)) this.runToOrder.set(runId, found.orderId);
    return found;
  }
}

function mapDispatchError(error: ExecutionPlaneError): { code: string; httpStatus: number } {
  switch (error.code) {
    case 'AGENT_OFFLINE': return { code: 'DISPATCH_AGENT_OFFLINE', httpStatus: 409 };
    case 'CAPABILITY_UNSUPPORTED': return { code: 'DISPATCH_CAPABILITY_UNSUPPORTED', httpStatus: 409 };
    case 'WRITE_FORBIDDEN': return { code: 'WRITE_FORBIDDEN', httpStatus: 403 };
    case 'INVALID_ARGUMENT': return { code: 'INVALID_ARGUMENT', httpStatus: 400 };
    case 'AGENT_NOT_FOUND': return { code: 'TARGET_NOT_ELIGIBLE', httpStatus: 409 };
    default: return { code: 'DISPATCH_FAILED', httpStatus: 502 };
  }
}

/** 列表投影：去掉 input/result，保留大小与截断标记。 */
export function borrowOrderSummary(order: BorrowOrderRecord): Omit<BorrowOrderRecord, 'input' | 'result'> {
  const { input: _input, result: _result, ...rest } = order;
  return rest;
}

export { BorrowOrderStoreError };
