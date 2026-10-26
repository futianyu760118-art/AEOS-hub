// 执行面接入层：管理面（Hub）与远程执行面智能体之间的「遥控 + 仪表盘」通道。
// 管理面是控制面：接收执行面智能体反向连接、心跳、任务结果，并下发派单/召回指令。
// 状态双份：内存为在线连接事实源；data/execution-plane.json 持久化最近状态（重启后可显示离线）。
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateAgainstSchema, type Schema } from './schema-validation.ts';
import type { CallerContext } from './caller-context.ts';
import { type QueryIntent } from './execution-intent-types.ts';
import type { UsageEventAppendInput } from './usage-ledger-store.ts';
import type { ExecutionRegistrationIdentity } from './execution-identity.ts';

export type ExecutionAgentRuntimeStatus = 'idle' | 'working' | 'error';
export type ExecutionAgentConnectionStatus = 'online' | 'offline';
export type ExecutionRunState = 'dispatched' | 'running' | 'completed' | 'failed' | 'recalled';

export interface ExecutionAgentCapability {
  name: string;
  description: string;
  version?: string;
  inputSchemaVersion?: string;
  outputSchemaVersion?: string;
  inputSchema?: Schema;
  outputSchema?: Schema;
  constraints?: { readOnly?: boolean; requireEvidence?: boolean };
  intent?: QueryIntent;
}

export type ExecutionAgentAuthMode = 'system-token' | 'legacy-root' | 'control-plane' | 'unknown';

export interface ExecutionAgentRecord {
  agentId: string;
  name: string;
  version: string;
  capabilities: ExecutionAgentCapability[];
  connectionStatus: ExecutionAgentConnectionStatus;
  runtimeStatus: ExecutionAgentRuntimeStatus;
  lastSeenAt: string;
  currentRunId: string | null;
  registeredAt: string;
  /** 是否从本机回环地址（127.0.0.1/::1）连接：本地执行面 vs 远程目标系统。 */
  local: boolean;
  /** 规范系统 ID（system-token 认证或 legacy 解析成功）；无法解析时为 null。 */
  systemId: string | null;
  /** 执行面记录的业务系统键：优先规范 systemId，否则保留 legacy 自报值。 */
  sourceSystem: string;
  /** 系统显示名，供页面展示；历史记录可能为 null。 */
  sourceSystemName: string | null;
  /** 身份来源：系统令牌 / legacy 根令牌 / 控制面声明 / 历史未知。 */
  authMode: ExecutionAgentAuthMode;
  /** 本机模拟器注册的连接；不计入真实目录统计。 */
  simulated: boolean;
  /** 执行体角色：普通执行面 Agent 或系统网关（单 Agent 兼容模式）。 */
  agentKind?: 'execution-agent' | 'system-gateway';
  /** 网关协议版本；非网关为 null。 */
  gatewayVersion?: string | null;
  /** 软删除时间戳：系统自助注销后保留画像/用量台账，仅强制离线、不再派单。 */
  deregisteredAt?: string | null;
}

export interface ExecutionRunRecord {
  runId: string;
  /** 链路 ID：借调单号或编排 requestId；未指定时等于 runId。历史记录可能没有该字段。 */
  traceId?: string;
  /** 调用方上下文（SPC 用户/Agent/任务）；历史记录可能没有该字段。 */
  caller?: CallerContext | null;
  agentId: string;
  capability: string;
  input: unknown;
  state: ExecutionRunState;
  startedAt: string;
  endedAt: string | null;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface ExecutionPlaneSnapshot {
  agents: ExecutionAgentRecord[];
  runs: ExecutionRunRecord[];
}

/** 运行状态变化事件：所有 run 生命周期变更都通过该回调发出（不再只依赖 WS 层）。 */
export interface ExecutionRunStateEvent {
  runId: string;
  agentId: string;
  state: ExecutionRunState;
  result?: unknown;
  error?: { code: string; message: string };
  startedAt: string;
  endedAt: string | null;
}

/** 执行面离线事件：带出离线瞬间未完成的 runId（若有）。 */
export interface AgentOfflineEvent {
  agentId: string;
  runId: string | null;
}

export class ExecutionPlaneError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ExecutionPlaneError';
  }
}

type SendFn = (message: unknown) => void;

interface ConnectedAgent {
  record: ExecutionAgentRecord;
  send: SendFn;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = DEFAULT_HEARTBEAT_INTERVAL_MS * 3;
const DEFAULT_DISPATCH_TIMEOUT_MS = 30_000;
const DEFAULT_QUERY_TIMEOUT_MS = 60_000;
const DEFAULT_REASONING_TIMEOUT_MS = 240_000;
const DEFAULT_IDLE_RECONCILE_GRACE_MS = 30_000;
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['1.0']);

export interface ExecutionPlaneTimeouts {
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  dispatchTimeoutMs: number;
  queryTimeoutMs: number;
  reasoningTimeoutMs: number;
  idleReconcileGraceMs: number;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function envInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value || !value.trim()) return fallback;
  return clampInt(Number(value), fallback, min, max);
}

/** 从环境变量读取执行面超时；默认值保持向后兼容，便于直连/网关双轨期按系统调整。 */
export function executionPlaneTimeoutsFromEnv(env: NodeJS.ProcessEnv = process.env): ExecutionPlaneTimeouts {
  const heartbeatIntervalMs = envInt(env.AEOS_HEARTBEAT_INTERVAL_MS, DEFAULT_HEARTBEAT_INTERVAL_MS, 1_000, 60_000);
  return {
    heartbeatIntervalMs,
    heartbeatTimeoutMs: envInt(env.AEOS_HEARTBEAT_TIMEOUT_MS, heartbeatIntervalMs * 3, heartbeatIntervalMs, 300_000),
    dispatchTimeoutMs: envInt(env.AEOS_DISPATCH_TIMEOUT_MS, DEFAULT_DISPATCH_TIMEOUT_MS, 5_000, 300_000),
    queryTimeoutMs: envInt(env.AEOS_QUERY_TIMEOUT_MS, DEFAULT_QUERY_TIMEOUT_MS, 5_000, 600_000),
    reasoningTimeoutMs: envInt(env.AEOS_REASONING_TIMEOUT_MS, DEFAULT_REASONING_TIMEOUT_MS, 5_000, 1_800_000),
    idleReconcileGraceMs: envInt(env.AEOS_IDLE_RECONCILE_GRACE_MS, DEFAULT_IDLE_RECONCILE_GRACE_MS, 5_000, 300_000),
  };
}

function isReasoningCapability(capability: string): boolean {
  return /(^|[_-])reason(ing)?([_-]|$)/i.test(capability);
}

export function isLoopbackExecutionPeer(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function requireString(value: unknown, field: string, maxLen = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw new ExecutionPlaneError('INVALID_ARGUMENT', `${field} 不能为空`);
  const trimmed = value.trim();
  if (trimmed.length > maxLen) throw new ExecutionPlaneError('INVALID_ARGUMENT', `${field} 过长（最多 ${maxLen} 字符）`);
  return trimmed;
}

const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'boolean']);
const MAX_SCHEMA_BYTES = 8192;

function parseSchema(value: unknown, field: string): Schema | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ExecutionPlaneError('INVALID_ARGUMENT', `${field} 必须是对象`);
  }
  if (JSON.stringify(value).length > MAX_SCHEMA_BYTES) {
    throw new ExecutionPlaneError('INVALID_ARGUMENT', `${field} 过大（最多 ${MAX_SCHEMA_BYTES} 字节）`);
  }
  const type = (value as Record<string, unknown>).type;
  if (typeof type !== 'string' || !SCHEMA_TYPES.has(type)) {
    throw new ExecutionPlaneError('INVALID_ARGUMENT', `${field}.type 必须是 object/array/string/number/boolean`);
  }
  return value as Schema;
}

function parseConstraints(value: unknown): { readOnly?: boolean; requireEvidence?: boolean } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ExecutionPlaneError('INVALID_ARGUMENT', 'constraints 必须是对象');
  }
  const record = value as Record<string, unknown>;
  const constraints: { readOnly?: boolean; requireEvidence?: boolean } = {};
  if (record.readOnly !== undefined) {
    if (typeof record.readOnly !== 'boolean') throw new ExecutionPlaneError('INVALID_ARGUMENT', 'constraints.readOnly 必须是布尔值');
    constraints.readOnly = record.readOnly;
  }
  if (record.requireEvidence !== undefined) {
    if (typeof record.requireEvidence !== 'boolean') throw new ExecutionPlaneError('INVALID_ARGUMENT', 'constraints.requireEvidence 必须是布尔值');
    constraints.requireEvidence = record.requireEvidence;
  }
  return Object.keys(constraints).length ? constraints : undefined;
}

function parseQueryIntent(value: unknown): QueryIntent | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ExecutionPlaneError('INVALID_ARGUMENT', 'intent 必须是对象');
  }
  if (JSON.stringify(value).length > MAX_SCHEMA_BYTES) {
    throw new ExecutionPlaneError('INVALID_ARGUMENT', `intent 过大（最多 ${MAX_SCHEMA_BYTES} 字节）`);
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.paths)) throw new ExecutionPlaneError('INVALID_ARGUMENT', 'intent.paths 必须是数组');
  return value as QueryIntent;
}

function parseCapabilities(value: unknown): ExecutionAgentCapability[] {
  if (!Array.isArray(value)) throw new ExecutionPlaneError('INVALID_ARGUMENT', 'capabilities 必须是数组');
  if (value.length === 0) throw new ExecutionPlaneError('INVALID_ARGUMENT', 'capabilities 不能为空');
  return value.map((cap) => {
    if (!cap || typeof cap !== 'object') throw new ExecutionPlaneError('INVALID_ARGUMENT', 'capability 必须是对象');
    const record = cap as Record<string, unknown>;
    const name = requireString(record.name, 'capability.name', 100);
    const description = typeof record.description === 'string' ? record.description.slice(0, 500) : '';
    const optional = (field: string) => (typeof record[field] === 'string' ? record[field].slice(0, 40) : undefined);
    const inputSchema = parseSchema(record.inputSchema, 'capability.inputSchema');
    const outputSchema = parseSchema(record.outputSchema, 'capability.outputSchema');
    const constraints = parseConstraints(record.constraints);
    const intent = parseQueryIntent(record.intent);
    return {
      name,
      description,
      ...(optional('version') ? { version: optional('version') } : {}),
      ...(optional('inputSchemaVersion') ? { inputSchemaVersion: optional('inputSchemaVersion') } : {}),
      ...(optional('outputSchemaVersion') ? { outputSchemaVersion: optional('outputSchemaVersion') } : {}),
      ...(inputSchema ? { inputSchema } : {}),
      ...(outputSchema ? { outputSchema } : {}),
      ...(constraints ? { constraints } : {}),
      ...(intent ? { intent } : {}),
    };
  });
}

function parseStatus(value: unknown): ExecutionAgentRuntimeStatus {
  if (value === 'idle' || value === 'working' || value === 'error') return value;
  if (value === undefined || value === null || value === '') return 'idle';
  throw new ExecutionPlaneError('INVALID_ARGUMENT', 'status 必须是 idle/working/error');
}

/** run_complete 可选携带的用量上报：字段容错归一化，未上报记 0 / null。 */
function normalizeUsage(value: unknown): { modelId: string | null; tokensIn: number; cachedTokens: number; tokensOut: number; cost: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { modelId: null, tokensIn: 0, cachedTokens: 0, tokensOut: 0, cost: 0 };
  }
  const record = value as Record<string, unknown>;
  const nonNegativeInt = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0);
  const nonNegative = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const modelId = typeof record.modelId === 'string' && record.modelId.trim() ? record.modelId.trim().slice(0, 160) : null;
  return {
    modelId,
    tokensIn: nonNegativeInt(record.tokensIn),
    cachedTokens: nonNegativeInt(record.cachedTokens),
    tokensOut: nonNegativeInt(record.tokensOut),
    cost: nonNegative(record.cost),
  };
}

function atomicWrite(file: string, content: string): void {
  const tmp = `${file}.tmp-${randomUUID()}`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
}

export class ExecutionPlaneRegistry {
  private agents = new Map<string, ConnectedAgent>();
  private runs = new Map<string, ExecutionRunRecord>();
  private readonly file: string;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly dispatchTimeoutMs: number;
  private readonly queryTimeoutMs: number;
  private readonly reasoningTimeoutMs: number;
  private readonly idleReconcileGraceMs: number;
  private readonly idFactory: () => string;
  private readonly clock: () => Date;
  private readonly onChange?: () => void;
  private readonly onUsageEvent?: (event: UsageEventAppendInput) => void;
  private readonly onRunStateChange?: (event: ExecutionRunStateEvent) => void;
  private readonly onAgentOffline?: (event: AgentOfflineEvent) => void;
  /** 派单前的能力授权检查；返回 false 时按 enforcement 决定拦截还是仅告警。 */
  private readonly isCapabilityAuthorized?: (agent: ExecutionAgentRecord, capability: string) => boolean | {
    allowed: boolean;
    enforcement?: 'observe' | 'enforce';
    reason?: string;
  };

  constructor(options: {
    file: string;
    heartbeatIntervalMs?: number;
    heartbeatTimeoutMs?: number;
    dispatchTimeoutMs?: number;
    queryTimeoutMs?: number;
    reasoningTimeoutMs?: number;
    idleReconcileGraceMs?: number;
    idFactory?: () => string;
    clock?: () => Date;
    onChange?: () => void;
    onUsageEvent?: (event: UsageEventAppendInput) => void;
    onRunStateChange?: (event: ExecutionRunStateEvent) => void;
    onAgentOffline?: (event: AgentOfflineEvent) => void;
    isCapabilityAuthorized?: (agent: ExecutionAgentRecord, capability: string) => boolean | {
      allowed: boolean;
      enforcement?: 'observe' | 'enforce';
      reason?: string;
    };
  }) {
    this.file = options.file;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? this.heartbeatIntervalMs * 3;
    this.dispatchTimeoutMs = options.dispatchTimeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS;
    this.queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    this.reasoningTimeoutMs = options.reasoningTimeoutMs ?? DEFAULT_REASONING_TIMEOUT_MS;
    this.idleReconcileGraceMs = options.idleReconcileGraceMs ?? DEFAULT_IDLE_RECONCILE_GRACE_MS;
    this.idFactory = options.idFactory ?? randomUUID;
    this.clock = options.clock ?? (() => new Date());
    this.onChange = options.onChange;
    this.onUsageEvent = options.onUsageEvent;
    this.onRunStateChange = options.onRunStateChange;
    this.onAgentOffline = options.onAgentOffline;
    this.isCapabilityAuthorized = options.isCapabilityAuthorized;
    this.load();
  }

  // ---------- 持久化 ----------
  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      if (raw && Array.isArray(raw.agents)) {
        for (const record of raw.agents as ExecutionAgentRecord[]) {
          const sourceSystem = typeof record.sourceSystem === 'string' && record.sourceSystem.trim()
            ? record.sourceSystem.trim()
            : '历史记录（来源待补充）';
          // 重启后没有活跃连接：一律视为离线，仅保留最近一次画像供仪表盘展示。
          this.agents.set(record.agentId, {
            record: {
              ...record,
              local: record.local === true,
              systemId: typeof record.systemId === 'string' && record.systemId.trim() ? record.systemId.trim() : null,
              sourceSystem,
              sourceSystemName: typeof record.sourceSystemName === 'string' && record.sourceSystemName.trim()
                ? record.sourceSystemName.trim()
                : null,
              authMode: record.authMode === 'system-token' || record.authMode === 'legacy-root' || record.authMode === 'control-plane'
                ? record.authMode
                : 'unknown',
              simulated: record.simulated === true,
              agentKind: record.agentKind === 'system-gateway' ? 'system-gateway' : 'execution-agent',
              gatewayVersion: typeof record.gatewayVersion === 'string' && record.gatewayVersion.trim()
                ? record.gatewayVersion.trim()
                : null,
              connectionStatus: 'offline',
              runtimeStatus: 'idle',
              currentRunId: null,
            },
            send: () => {},
          });
        }
      }
      if (raw && Array.isArray(raw.runs)) {
        for (const run of raw.runs as ExecutionRunRecord[]) this.runs.set(run.runId, run);
      }
    } catch {
      // 损坏的持久化文件不阻塞服务启动，回退为空状态。
    }
  }

  private persist(): void {
    try {
      if (!existsSync(dirname(this.file))) return;
      const snapshot: ExecutionPlaneSnapshot = {
        agents: [...this.agents.values()].map((entry) => entry.record),
        runs: [...this.runs.values()],
      };
      atomicWrite(this.file, JSON.stringify(snapshot, null, 2));
    } catch {
      // 持久化失败不影响在线通道。
    }
    this.onChange?.();
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  // ---------- 运行状态/离线回调（供借调单等上层订阅；回调异常不影响执行面） ----------
  private emitRunState(run: ExecutionRunRecord): void {
    try {
      this.onRunStateChange?.({
        runId: run.runId,
        agentId: run.agentId,
        state: run.state,
        result: run.result,
        error: run.error,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
      });
    } catch {
      // 订阅方异常不得中断执行面状态机。
    }
  }

  private emitAgentOffline(agentId: string, runId: string | null): void {
    try {
      this.onAgentOffline?.({ agentId, runId });
    } catch {
      // 同上。
    }
  }

  getRun(runId: string): ExecutionRunRecord | undefined {
    return this.runs.get(runId);
  }

  private timeoutForRun(run: ExecutionRunRecord): number {
    // 推理任务在首次 run_update 之前就可能持续几十秒，不能套通用 30s 派单超时。
    if (run.state === 'dispatched') {
      return isReasoningCapability(run.capability) ? this.reasoningTimeoutMs : this.dispatchTimeoutMs;
    }
    return isReasoningCapability(run.capability) ? this.reasoningTimeoutMs : this.queryTimeoutMs;
  }

  private failRun(run: ExecutionRunRecord, code: string, message: string): boolean {
    if (run.state !== 'dispatched' && run.state !== 'running') return false;
    run.state = 'failed';
    run.error = { code, message };
    run.endedAt = this.nowIso();
    const entry = this.agents.get(run.agentId);
    if (entry) {
      if (entry.record.currentRunId === run.runId) entry.record.currentRunId = null;
      entry.record.runtimeStatus = 'error';
      try {
        entry.send({ type: 'recall', runId: run.runId });
      } catch {
        // 召回失败不影响 Hub 侧终止状态。
      }
    }
    this.persist();
    this.emitRunState(run);
    return true;
  }

  /** 扫出派单后无响应、或执行超时的 run；由服务端周期调用。 */
  markRunTimeouts(): number {
    const now = this.clock().getTime();
    let count = 0;
    for (const run of this.runs.values()) {
      if (run.state !== 'dispatched' && run.state !== 'running') continue;
      const startedAt = new Date(run.startedAt).getTime();
      if (Number.isNaN(startedAt)) continue;
      const timeoutMs = this.timeoutForRun(run);
      if (now - startedAt < timeoutMs) continue;
      const code = run.state === 'dispatched' ? 'DISPATCH_TIMEOUT' : 'RUN_TIMEOUT';
      const message = run.state === 'dispatched'
        ? `派单后 ${timeoutMs}ms 未收到执行面响应`
        : `执行超过 ${timeoutMs}ms 未完成`;
      if (this.failRun(run, code, message)) count += 1;
    }
    return count;
  }

  /** Agent 已空闲/离线但 run 仍非终态：超过宽限期后回收，避免死单。 */
  reconcileIdleRuns(): number {
    const now = this.clock().getTime();
    let count = 0;
    for (const run of this.runs.values()) {
      if (run.state !== 'dispatched' && run.state !== 'running') continue;
      const startedAt = new Date(run.startedAt).getTime();
      if (Number.isNaN(startedAt) || now - startedAt < this.idleReconcileGraceMs) continue;
      const entry = this.agents.get(run.agentId);
      if (!entry) {
        if (this.failRun(run, 'ORPHANED_AGENT_MISSING', '执行面已不存在，任务无法回写')) count += 1;
        continue;
      }
      if (entry.record.connectionStatus !== 'online') {
        if (this.failRun(run, 'ORPHANED_AGENT_OFFLINE', '执行面已离线，任务无法回写')) count += 1;
        continue;
      }
      if (entry.record.runtimeStatus !== 'working') {
        if (this.failRun(run, 'ORPHANED_AGENT_IDLE', '执行面已空闲但任务未回写')) count += 1;
      }
    }
    return count;
  }

  // ---------- 执行面 → 管理面 ----------
  onRegister(
    input: { agentId?: unknown; name?: unknown; version?: unknown; capabilities?: unknown; local?: unknown; sourceSystem?: unknown; protocolVersion?: unknown; simulated?: unknown; kind?: unknown; gatewayVersion?: unknown },
    send: SendFn,
    identity?: ExecutionRegistrationIdentity,
  ): { agentId: string; heartbeatIntervalMs: number } {
    const agentId = requireString(input.agentId, 'agentId', 160);
    const name = requireString(input.name, 'name', 160);
    const version = typeof input.version === 'string' ? input.version.slice(0, 40) : 'unknown';
    const protocolVersion = typeof input.protocolVersion === 'string' && input.protocolVersion.trim()
      ? input.protocolVersion.trim()
      : '1.0';
    if (!SUPPORTED_PROTOCOL_VERSIONS.has(protocolVersion)) {
      throw new ExecutionPlaneError('PROTOCOL_VERSION_UNSUPPORTED', `不支持的执行面协议版本: ${protocolVersion}（支持 ${[...SUPPORTED_PROTOCOL_VERSIONS].join(', ')}）`);
    }
    const capabilities = parseCapabilities(input.capabilities);
    const local = input.local === true;
    const sourceSystem = identity?.sourceSystem ?? requireString(input.sourceSystem, 'sourceSystem', 160);
    const agentKind = input.kind === 'system-gateway' ? 'system-gateway' : 'execution-agent';
    const gatewayVersion = agentKind === 'system-gateway'
      && typeof input.gatewayVersion === 'string'
      && input.gatewayVersion.trim()
      ? input.gatewayVersion.trim().slice(0, 40)
      : null;

    const now = this.nowIso();
    const existing = this.agents.get(agentId);
    const record: ExecutionAgentRecord = {
      agentId,
      name,
      version,
      capabilities,
      connectionStatus: 'online',
      runtimeStatus: 'idle',
      lastSeenAt: now,
      currentRunId: existing?.record.currentRunId ?? null,
      registeredAt: existing?.record.registeredAt ?? now,
      local,
      systemId: identity?.systemId ?? null,
      sourceSystem,
      sourceSystemName: identity?.sourceSystemName ?? sourceSystem,
      authMode: identity?.authMode ?? 'legacy-root',
      simulated: input.simulated === true,
      agentKind,
      gatewayVersion,
      deregisteredAt: null,
    };
    this.agents.set(agentId, { record, send });
    this.persist();
    return { agentId, heartbeatIntervalMs: this.heartbeatIntervalMs };
  }

  onHeartbeat(agentId: string, input: { status?: unknown; currentRunId?: unknown }): void {
    const entry = this.requireAgent(agentId);
    entry.record.runtimeStatus = parseStatus(input.status);
    if (Object.prototype.hasOwnProperty.call(input, 'currentRunId')) {
      entry.record.currentRunId = typeof input.currentRunId === 'string' && input.currentRunId.trim()
        ? input.currentRunId.trim()
        : null;
    }
    entry.record.lastSeenAt = this.nowIso();
    entry.record.connectionStatus = 'online';
    this.persist();
  }

  onRunUpdate(agentId: string, input: { runId?: unknown; state?: unknown }): void {
    const runId = requireString(input.runId, 'runId', 160);
    const run = this.requireRun(runId, agentId);
    if (run.state === 'completed' || run.state === 'failed' || run.state === 'recalled') return;
    run.state = 'running';
    run.endedAt = null;
    this.requireAgent(agentId).record.currentRunId = runId;
    this.persist();
    this.emitRunState(run);
  }

  onRunComplete(agentId: string, input: { runId?: unknown; result?: unknown; usage?: unknown }): void {
    const runId = requireString(input.runId, 'runId', 160);
    const run = this.requireRun(runId, agentId);
    if (run.state === 'completed' || run.state === 'failed' || run.state === 'recalled') return;
    const entry = this.requireAgent(agentId);
    run.state = 'completed';
    const cap = entry.record.capabilities.find((item) => item.name === run.capability);
    const result = input.result ?? null;
    if (cap?.outputSchema || cap?.constraints?.requireEvidence) {
      const issue = cap.outputSchema ? validateAgainstSchema(result, cap.outputSchema) : null;
      // 未通过结果 schema（如缺 evidence_refs）的结论：不静默丢弃，标记低置信度并附带校验说明。
      run.result = issue
        ? { ...(result && typeof result === 'object' ? (result as Record<string, unknown>) : {}), data_confidence: 'low', validation_note: issue }
        : result;
    } else {
      run.result = result;
    }
    run.endedAt = this.nowIso();
    entry.record.currentRunId = null;
    entry.record.runtimeStatus = 'idle';
    this.persist();
    // 先通知运行状态订阅方（借调单落终态），再记用量，保证记账时订单已终结。
    this.emitRunState(run);
    // 每次 run_complete 落一条用量事件（设计稿 §3.2）；未上报用量时明确标记 metering='missing'。
    const usage = normalizeUsage(input.usage);
    const hasUsage = usage.modelId !== null || usage.tokensIn > 0 || usage.tokensOut > 0 || usage.cost > 0;
    this.onUsageEvent?.({
      agentId,
      systemId: entry.record.systemId ?? (entry.record.sourceSystem.trim() ? entry.record.sourceSystem.trim() : 'unknown'),
      modelId: usage.modelId,
      runId: run.runId,
      traceId: run.traceId ?? run.runId,
      callerAgentId: run.caller?.agentId ?? null,
      callerUserId: run.caller?.userId ?? null,
      tokensIn: usage.tokensIn,
      cachedTokens: usage.cachedTokens,
      tokensOut: usage.tokensOut,
      cost: usage.cost,
      metering: hasUsage ? 'reported' : 'missing',
      usageKind: run.capability.startsWith('query') ? 'query' : 'model',
      startedAt: run.startedAt,
      endedAt: run.endedAt ?? this.nowIso(),
    });
  }

  onRunFailed(agentId: string, input: { runId?: unknown; error?: unknown }): void {
    const runId = requireString(input.runId, 'runId', 160);
    const run = this.requireRun(runId, agentId);
    if (run.state === 'completed' || run.state === 'failed' || run.state === 'recalled') return;
    run.state = 'failed';
    const err = input.error && typeof input.error === 'object' ? (input.error as Record<string, unknown>) : {};
    run.error = {
      code: typeof err.code === 'string' ? err.code : 'EXECUTION_FAILED',
      message: typeof err.message === 'string' ? err.message : '执行面查询失败',
    };
    run.endedAt = this.nowIso();
    const entry = this.requireAgent(agentId);
    entry.record.currentRunId = null;
    entry.record.runtimeStatus = 'error';
    this.persist();
    this.emitRunState(run);
  }

  // ---------- 管理面 → 执行面 ----------
  dispatch(agentId: string, capability: string, input: unknown, options: { traceId?: string; caller?: CallerContext | null } = {}): { runId: string; state: ExecutionRunState } {
    const entry = this.requireAgent(agentId);
    if (entry.record.connectionStatus !== 'online') {
      throw new ExecutionPlaneError('AGENT_OFFLINE', `执行面 ${agentId} 不在线，无法派单`);
    }
    const cap = entry.record.capabilities.find((item) => item.name === capability);
    if (!cap) {
      throw new ExecutionPlaneError('CAPABILITY_UNSUPPORTED', `执行面 ${agentId} 不支持能力 ${capability}`);
    }
    // 能力授权表：enforce 模式拦截未授权派单；observe 模式只告警，便于灰度切换。
    const authorization = this.isCapabilityAuthorized?.(entry.record, capability);
    if (authorization !== undefined) {
      const allowed = typeof authorization === 'boolean' ? authorization : authorization.allowed;
      if (!allowed) {
        const enforcement = typeof authorization === 'boolean' ? 'enforce' : authorization.enforcement ?? 'enforce';
        const reason = typeof authorization === 'boolean' ? '' : authorization.reason ?? '';
        const message = `执行面 ${agentId} 未被授权能力 ${capability}${reason ? `（${reason}）` : ''}`;
        if (enforcement === 'enforce') throw new ExecutionPlaneError('CAPABILITY_FORBIDDEN', message);
        console.warn(`[execution-plane] ${message}；当前为 observe 模式，仍允许派单`);
      }
    }
    if (cap.constraints?.readOnly !== true) {
      throw new ExecutionPlaneError('WRITE_FORBIDDEN', `能力 ${capability} 未声明只读，试点仅允许只读能力`);
    }
    const inputRecord = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    if (cap.inputSchema) {
      const validationError = validateAgainstSchema(inputRecord, cap.inputSchema);
      if (validationError) throw new ExecutionPlaneError('INVALID_ARGUMENT', validationError);
    }
    const runId = `exec-run-${this.idFactory()}`;
    const traceId = typeof options.traceId === 'string' && options.traceId.trim()
      ? options.traceId.trim().slice(0, 160)
      : runId;
    const run: ExecutionRunRecord = {
      runId,
      traceId,
      caller: options.caller ?? null,
      agentId,
      capability,
      input: input ?? null,
      state: 'dispatched',
      startedAt: this.nowIso(),
      endedAt: null,
    };
    this.runs.set(runId, run);
    entry.record.currentRunId = runId;
    entry.record.runtimeStatus = 'working';
    entry.send({ type: 'dispatch', runId, capability, input: input ?? null, traceId, caller: run.caller ?? null });
    this.persist();
    return { runId, state: run.state };
  }

  recall(agentId: string): { recalled: boolean; runId: string | null } {
    const entry = this.requireAgent(agentId);
    const runId = entry.record.currentRunId;
    entry.send({ type: 'recall', runId });
    let recalledRun: ExecutionRunRecord | undefined;
    if (runId) {
      const run = this.runs.get(runId);
      if (run && (run.state === 'dispatched' || run.state === 'running')) {
        run.state = 'recalled';
        run.endedAt = this.nowIso();
        recalledRun = run;
      }
    }
    entry.record.currentRunId = null;
    entry.record.runtimeStatus = 'idle';
    this.persist();
    if (recalledRun) this.emitRunState(recalledRun);
    return { recalled: true, runId };
  }

  disconnect(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (!entry) return;
    const unfinishedRunId = entry.record.currentRunId;
    entry.record.connectionStatus = 'offline';
    entry.record.runtimeStatus = 'idle';
    entry.record.currentRunId = null;
    entry.send = () => {};
    this.persist();
    this.emitAgentOffline(agentId, unfinishedRunId);
  }

  /** 心跳超时判离线；返回本次标记离线的 agent 数。 */
  markStaleOffline(): number {
    const now = this.clock().getTime();
    let count = 0;
    const offlineEvents: AgentOfflineEvent[] = [];
    for (const entry of this.agents.values()) {
      if (entry.record.connectionStatus !== 'online') continue;
      const lastSeen = new Date(entry.record.lastSeenAt).getTime();
      if (Number.isNaN(lastSeen) || now - lastSeen > this.heartbeatTimeoutMs) {
        offlineEvents.push({ agentId: entry.record.agentId, runId: entry.record.currentRunId });
        entry.record.connectionStatus = 'offline';
        entry.record.runtimeStatus = 'idle';
        entry.record.currentRunId = null;
        count += 1;
      }
    }
    if (count > 0) this.persist();
    for (const event of offlineEvents) this.emitAgentOffline(event.agentId, event.runId);
    return count;
  }

  // ---------- 控制面：系统自助声明/注销本系统 Agent（token 鉴权后调用） ----------
  /** 声明本系统 Agent 画像（upsert）。不改动运行时连接状态：已有在线连接则保留，仅更新 name/version/capabilities。 */
  declareAgent(
    input: { agentId?: unknown; name?: unknown; version?: unknown; capabilities?: unknown },
    sourceSystem: string,
  ): ExecutionAgentRecord {
    const agentId = requireString(input.agentId, 'agentId', 160);
    const name = requireString(input.name, 'name', 160);
    const version = typeof input.version === 'string' ? input.version.slice(0, 40) : 'unknown';
    const capabilities = parseCapabilities(input.capabilities);
    const ownedSourceSystem = requireString(sourceSystem, 'sourceSystem', 160);

    const existing = this.agents.get(agentId);
    if (existing && existing.record.sourceSystem !== ownedSourceSystem) {
      throw new ExecutionPlaneError('AGENT_OWNED_BY_OTHER', `执行面 ${agentId} 属于其他系统，无权操作`);
    }
    const now = this.nowIso();
    const record: ExecutionAgentRecord = {
      agentId,
      name,
      version,
      capabilities,
      connectionStatus: existing?.record.connectionStatus ?? 'offline',
      runtimeStatus: existing?.record.runtimeStatus ?? 'idle',
      lastSeenAt: existing?.record.lastSeenAt ?? now,
      currentRunId: existing?.record.currentRunId ?? null,
      registeredAt: existing?.record.registeredAt ?? now,
      local: existing?.record.local ?? false,
      systemId: ownedSourceSystem,
      sourceSystem: ownedSourceSystem,
      sourceSystemName: existing?.record.sourceSystemName ?? null,
      authMode: 'control-plane',
      simulated: existing?.record.simulated ?? false,
      agentKind: existing?.record.agentKind ?? 'execution-agent',
      gatewayVersion: existing?.record.gatewayVersion ?? null,
      deregisteredAt: null,
    };
    this.agents.set(agentId, { record, send: existing?.send ?? (() => {}) });
    this.persist();
    return record;
  }

  /** 软注销本系统 Agent：保留画像与用量台账，仅强制离线、清空运行、停止派单。 */
  deregister(agentId: string, sourceSystem: string): ExecutionAgentRecord {
    const entry = this.requireAgent(agentId);
    const ownedSourceSystem = requireString(sourceSystem, 'sourceSystem', 160);
    if (entry.record.sourceSystem !== ownedSourceSystem) {
      throw new ExecutionPlaneError('AGENT_OWNED_BY_OTHER', `执行面 ${agentId} 属于其他系统，无权操作`);
    }
    entry.record.deregisteredAt = this.nowIso();
    entry.record.connectionStatus = 'offline';
    entry.record.runtimeStatus = 'idle';
    const unfinishedRunId = entry.record.currentRunId;
    entry.record.currentRunId = null;
    entry.send = () => {};
    this.persist();
    this.emitAgentOffline(agentId, unfinishedRunId);
    return entry.record;
  }

  /** 列出本系统的全部 Agent（含已软注销的，供系统自检/追溯）。 */
  listForSystem(sourceSystem: string): ExecutionAgentRecord[] {
    return [...this.agents.values()].map((entry) => entry.record).filter((record) => record.sourceSystem === sourceSystem);
  }

  list(): ExecutionPlaneSnapshot {
    return {
      agents: [...this.agents.values()].map((entry) => entry.record),
      runs: [...this.runs.values()].reverse(),
    };
  }

  private requireAgent(agentId: string): ConnectedAgent {
    const entry = this.agents.get(agentId);
    if (!entry) throw new ExecutionPlaneError('AGENT_NOT_FOUND', `执行面 ${agentId} 未注册`);
    return entry;
  }

  private requireRun(runId: string, agentId: string): ExecutionRunRecord {
    const run = this.runs.get(runId);
    if (!run || run.agentId !== agentId) {
      throw new ExecutionPlaneError('RUN_NOT_FOUND', `运行 ${runId} 不存在或不属于执行面 ${agentId}`);
    }
    return run;
  }
}
