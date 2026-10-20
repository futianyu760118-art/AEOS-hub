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
import { buildUnifiedCapabilityCatalog, type UnifiedCapability } from './capability-catalog.ts';
import { DEFAULT_TENANT_ID } from './tenant-registry.ts';
import { listSystems } from './system-registry.ts';
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
const ALLOWED_CREATE_FIELDS = new Set(['requestId', 'capability', 'capabilityVersion', 'inputSchemaHash', 'outputSchemaHash', 'input', 'toSystem', 'toAgent', 'fromAgentId']);
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
  kind: 'query' | 'reason' | 'tool';
  providers: Array<{
    systemId: string;
    agentId: string;
    agentName: string;
    online: boolean;
    busy: boolean;
    lastSeenAt: string;
    version: string | null;
    inputSchemaHash: string | null;
  }>;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

interface CapabilitySelectors {
  version: string | null;
  inputSchemaHash: string | null;
  outputSchemaHash: string | null;
}

function requestHash(
  capability: string,
  selectors: CapabilitySelectors,
  input: unknown,
  toSystem: string | null,
  toAgent: string | null,
): string {
  return createHash('sha256').update(stableStringify({
    capability,
    capabilityVersion: selectors.version,
    inputSchemaHash: selectors.inputSchemaHash,
    outputSchemaHash: selectors.outputSchemaHash,
    input,
    toSystem,
    toAgent,
  })).digest('hex');
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

function optionalHash(value: unknown, field: string): string | null {
  const text = optionalText(value, field, 64);
  if (text && !/^[a-f0-9]{64}$/.test(text)) {
    throw new BorrowOrderServiceError('INVALID_ARGUMENT', 400, `${field} 必须是 64 位小写十六进制`);
  }
  return text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function entrySelectorsMatch(entry: UnifiedCapability, selectors: CapabilitySelectors): boolean {
  if (selectors.version && entry.version !== selectors.version) return false;
  if (selectors.inputSchemaHash && entry.inputSchemaHash !== selectors.inputSchemaHash) return false;
  if (selectors.outputSchemaHash && entry.outputSchemaHash !== selectors.outputSchemaHash) return false;
  return true;
}

function hasSelectors(selectors: CapabilitySelectors): boolean {
  return Boolean(selectors.version || selectors.inputSchemaHash || selectors.outputSchemaHash);
}

function selectorMismatch(entries: UnifiedCapability[], selectors: CapabilitySelectors): { code: string; message: string; reason: string } | null {
  if (!hasSelectors(selectors)) return null;
  if (!entries.length) return null;
  if (selectors.version && !entries.some((entry) => entry.version === selectors.version)) {
    return { code: 'VERSION_MISMATCH', message: `没有提供方支持能力版本 ${selectors.version}`, reason: 'version_mismatch' };
  }
  if ((selectors.inputSchemaHash || selectors.outputSchemaHash)
    && !entries.some((entry) => entrySelectorsMatch(entry, selectors))) {
    return { code: 'SCHEMA_MISMATCH', message: '提供方能力的输入/输出 schema 与请求不兼容', reason: 'schema_mismatch' };
  }
  return null;
}

function isEligible(entry: UnifiedCapability, fromSystem: string, selectors: CapabilitySelectors): boolean {
  return entry.status === 'available'
    && entry.readOnly
    && entry.providerSystemId !== fromSystem
    && isBorrowCapabilityAllowed(entry.providerSystemId, entry.name)
    && entrySelectorsMatch(entry, selectors);
}

function eligibilityReasons(entry: UnifiedCapability, fromSystem: string, selectors: CapabilitySelectors): string[] {
  const reasons: string[] = [];
  if (entry.providerSystemId === fromSystem) reasons.push('same_system');
  if (entry.status === 'disabled') reasons.push('deregistered');
  if (entry.status === 'offline') reasons.push('offline');
  if (!entry.readOnly) reasons.push('not_read_only');
  if (!isBorrowCapabilityAllowed(entry.providerSystemId, entry.name)) reasons.push('capability_not_allowed_for_borrow');
  if (selectors.version && entry.version !== selectors.version) reasons.push('version_mismatch');
  if (selectors.inputSchemaHash && entry.inputSchemaHash !== selectors.inputSchemaHash) reasons.push('input_schema_mismatch');
  if (selectors.outputSchemaHash && entry.outputSchemaHash !== selectors.outputSchemaHash) reasons.push('output_schema_mismatch');
  return reasons;
}

function canonicalSystemId(systemId: string): string {
  const value = systemId.trim();
  const system = listSystems().find((candidate) => candidate.systemId === value
    || candidate.sourceSystemAliases.includes(value));
  return system?.systemId ?? value;
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

  private resolveProvider(
    fromSystem: string,
    capability: string,
    toSystem: string | null,
    toAgent: string | null,
    selectors: CapabilitySelectors,
  ): { agent: ExecutionAgentRecord; providerSystem: string } {
    const agents = this.executionPlane.list().agents;
    const agentById = new Map(agents.map((agent) => [agent.agentId, agent]));
    const catalog = buildUnifiedCapabilityCatalog({
      executionAgents: agents,
      harborAgents: [],
      systems: listSystems(),
      mcp: null,
    });
    const entries = catalog.filter((entry) => entry.source === 'execution' && entry.name === capability);
    if (!entries.length) {
      throw new BorrowOrderServiceError('CAPABILITY_NOT_FOUND', 404, `没有任何系统声明能力 ${capability}`);
    }
    if (!entries.some((entry) => entry.readOnly)) {
      throw new BorrowOrderServiceError('NO_PROVIDER', 409, '该能力存在，但没有系统声明只读版本，试点不可借调', { reason: 'no_read_only_provider' });
    }
    const externalEntries = entries.filter((entry) => entry.providerSystemId !== fromSystem);
    if (externalEntries.some((entry) => entry.readOnly)
      && !externalEntries.some((entry) => entry.readOnly && isBorrowCapabilityAllowed(entry.providerSystemId, capability))) {
      throw new BorrowOrderServiceError('CAPABILITY_NOT_ALLOWED', 403, `能力 ${capability} 不允许跨系统借调`, { reason: 'capability_not_allowed' });
    }
    if (toSystem && toSystem === fromSystem) {
      throw new BorrowOrderServiceError('SELF_BORROW_FORBIDDEN', 403, '不允许向本系统借调');
    }

    let targetPool: UnifiedCapability[];
    if (toAgent) {
      const targetAgent = agentById.get(toAgent);
      if (!targetAgent) {
        throw new BorrowOrderServiceError('TARGET_NOT_ELIGIBLE', 409, `指定目标不存在：${toAgent}`, { reasons: ['agent_not_found'] });
      }
      if (targetAgent.sourceSystem === fromSystem) {
        throw new BorrowOrderServiceError('SELF_BORROW_FORBIDDEN', 403, '不允许向本系统的 Agent 借调');
      }
      targetPool = entries.filter((entry) => entry.providerAgentId === toAgent);
      if (!targetPool.length) {
        throw new BorrowOrderServiceError('TARGET_NOT_ELIGIBLE', 409, '指定目标未声明该能力', { reasons: ['capability_missing'] });
      }
      if (toSystem && targetPool[0]?.providerSystemId !== toSystem) {
        throw new BorrowOrderServiceError('TARGET_NOT_ELIGIBLE', 409, '指定的 Agent 不属于指定系统', { reasons: ['target_system_mismatch'] });
      }
    } else if (toSystem) {
      targetPool = entries.filter((entry) => entry.providerSystemId === toSystem);
    } else {
      targetPool = entries;
    }

    const eligible = targetPool.filter((entry) => isEligible(entry, fromSystem, selectors));
    if (!eligible.length) {
      const mismatch = selectorMismatch(targetPool, selectors);
      if (mismatch) throw new BorrowOrderServiceError(mismatch.code, 409, mismatch.message, { reason: mismatch.reason });
      if (toAgent || toSystem) {
        const reasons = targetPool.flatMap((entry) => eligibilityReasons(entry, fromSystem, selectors));
        throw new BorrowOrderServiceError('TARGET_NOT_ELIGIBLE', 409, '指定目标当前不可用', {
          reasons: [...new Set(reasons)],
          candidateCount: targetPool.length,
        });
      }
      const readOnlyProviders = entries.filter((entry) => entry.readOnly && entry.status !== 'disabled');
      const onlySameSystem = readOnlyProviders.length > 0 && readOnlyProviders.every((entry) => entry.providerSystemId === fromSystem);
      throw new BorrowOrderServiceError('NO_PROVIDER', 409, onlySameSystem
        ? '该能力只有本系统提供，无法跨系统借调'
        : '没有其他系统的在线只读提供方', { reason: onlySameSystem ? 'only_same_system' : 'no_online_read_only_provider' });
    }

    const chosen = eligible.slice().sort((left, right) => {
      const leftAgent = agentById.get(left.providerAgentId);
      const rightAgent = agentById.get(right.providerAgentId);
      if (!leftAgent || !rightAgent) return left.providerAgentId.localeCompare(right.providerAgentId);
      return compareCandidates(leftAgent, rightAgent);
    })[0]!;
    const agent = agentById.get(chosen.providerAgentId);
    if (!agent) {
      throw new BorrowOrderServiceError('TARGET_NOT_ELIGIBLE', 409, '提供方 Agent 已不在执行面', { reasons: ['agent_not_found'] });
    }
    return { agent, providerSystem: chosen.providerSystemId };
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
    const selectors: CapabilitySelectors = {
      version: optionalText(body.capabilityVersion, 'capabilityVersion', 40),
      inputSchemaHash: optionalHash(body.inputSchemaHash, 'inputSchemaHash'),
      outputSchemaHash: optionalHash(body.outputSchemaHash, 'outputSchemaHash'),
    };
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
    const hash = requestHash(capability, selectors, rawInput, toSystem, toAgent);

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

    const { agent: provider, providerSystem } = this.resolveProvider(fromSystem, capability, toSystem, toAgent, selectors);
    const order = this.store.create({
      tenantId: this.tenantId,
      requestId,
      requestHash: hash,
      capabilityVersion: selectors.version,
      inputSchemaHash: selectors.inputSchemaHash,
      outputSchemaHash: selectors.outputSchemaHash,
      fromSystem,
      fromAgentId,
      capability,
      input: rawInput,
      toSystem,
      toAgent,
      providerSystem,
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
    const scope = canonicalSystemId(systemId);
    const outgoing = direction === 'incoming' ? [] : this.store.list({ fromSystem: scope, status: filter.status, limit });
    const incoming = direction === 'outgoing' ? [] : this.store.list({ providerSystem: scope, status: filter.status, limit });
    return { outgoing, incoming };
  }

  getForSystem(systemId: string, orderId: string): BorrowOrderRecord {
    const order = this.store.get(orderId);
    const scope = canonicalSystemId(systemId);
    if (!order || (order.fromSystem !== scope && order.providerSystem !== scope)) {
      throw new BorrowOrderServiceError('ORDER_NOT_FOUND', 404, '借调单不存在或无权查看');
    }
    return order;
  }

  listAll(filter: { status?: BorrowOrderStatus; tenantId?: string; limit?: number } = {}): BorrowOrderRecord[] {
    return this.store.list({ status: filter.status, tenantId: filter.tenantId, limit: filter.limit ?? 100 });
  }

  capabilityDirectory(systemId: string): CapabilityDirectoryEntry[] {
    const scope = canonicalSystemId(systemId);
    const agents = this.executionPlane.list().agents;
    const agentById = new Map(agents.map((agent) => [agent.agentId, agent]));
    const catalog = buildUnifiedCapabilityCatalog({
      executionAgents: agents,
      harborAgents: [],
      systems: listSystems(),
      mcp: null,
    });
    const byName = new Map<string, CapabilityDirectoryEntry>();
    for (const capability of catalog) {
      if (capability.source !== 'execution'
        || !capability.readOnly
        || capability.status === 'disabled'
        || capability.providerSystemId === scope
        || !isBorrowCapabilityAllowed(capability.providerSystemId, capability.name)) continue;
      const agent = agentById.get(capability.providerAgentId);
      if (!agent) continue;
      const entry = byName.get(capability.name) ?? {
        name: capability.name,
        description: capability.description,
        kind: capability.kind as CapabilityDirectoryEntry['kind'],
        providers: [],
      };
      entry.providers.push({
        systemId: capability.providerSystemId,
        agentId: agent.agentId,
        agentName: agent.name,
        online: capability.status === 'available',
        busy: agent.runtimeStatus === 'working' || agent.currentRunId !== null,
        lastSeenAt: agent.lastSeenAt,
        version: capability.version,
        inputSchemaHash: capability.inputSchemaHash,
      });
      byName.set(capability.name, entry);
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
