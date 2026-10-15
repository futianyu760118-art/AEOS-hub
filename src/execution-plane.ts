// 执行面接入层：管理面（Hub）与远程执行面智能体之间的「遥控 + 仪表盘」通道。
// 管理面是控制面：接收执行面智能体反向连接、心跳、任务结果，并下发派单/召回指令。
// 状态双份：内存为在线连接事实源；data/execution-plane.json 持久化最近状态（重启后可显示离线）。
import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateAgainstSchema, type Schema } from './schema-validation.ts';
import { type QueryIntent } from './execution-intent-types.ts';

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
  /** 执行智能体所属的业务系统，由注册方声明。 */
  sourceSystem: string;
}

export interface ExecutionRunRecord {
  runId: string;
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

const HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS * 3;
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['1.0']);

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

function atomicWrite(file: string, content: string): void {
  const tmp = `${file}.tmp-${randomUUID()}`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
}

export class ExecutionPlaneRegistry {
  private agents = new Map<string, ConnectedAgent>();
  private runs = new Map<string, ExecutionRunRecord>();
  private readonly file: string;
  private readonly heartbeatTimeoutMs: number;
  private readonly idFactory: () => string;
  private readonly clock: () => Date;
  private readonly onChange?: () => void;

  constructor(options: {
    file: string;
    heartbeatTimeoutMs?: number;
    idFactory?: () => string;
    clock?: () => Date;
    onChange?: () => void;
  }) {
    this.file = options.file;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.idFactory = options.idFactory ?? randomUUID;
    this.clock = options.clock ?? (() => new Date());
    this.onChange = options.onChange;
    this.load();
  }

  // ---------- 持久化 ----------
  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      if (raw && Array.isArray(raw.agents)) {
        for (const record of raw.agents as ExecutionAgentRecord[]) {
          // 重启后没有活跃连接：一律视为离线，仅保留最近一次画像供仪表盘展示。
          this.agents.set(record.agentId, {
            record: {
              ...record,
              local: record.local === true,
              sourceSystem: typeof record.sourceSystem === 'string' && record.sourceSystem.trim()
                ? record.sourceSystem.trim()
                : '历史记录（来源待补充）',
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

  // ---------- 执行面 → 管理面 ----------
  onRegister(
    input: { agentId?: unknown; name?: unknown; version?: unknown; capabilities?: unknown; local?: unknown; sourceSystem?: unknown; protocolVersion?: unknown },
    send: SendFn,
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
    const sourceSystem = requireString(input.sourceSystem, 'sourceSystem', 160);

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
      sourceSystem,
    };
    this.agents.set(agentId, { record, send });
    this.persist();
    return { agentId, heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS };
  }

  onHeartbeat(agentId: string, input: { status?: unknown; currentRunId?: unknown }): void {
    const entry = this.requireAgent(agentId);
    entry.record.runtimeStatus = parseStatus(input.status);
    entry.record.currentRunId = typeof input.currentRunId === 'string' && input.currentRunId.trim()
      ? input.currentRunId.trim()
      : null;
    entry.record.lastSeenAt = this.nowIso();
    entry.record.connectionStatus = 'online';
    this.persist();
  }

  onRunUpdate(agentId: string, input: { runId?: unknown; state?: unknown }): void {
    const runId = requireString(input.runId, 'runId', 160);
    const run = this.requireRun(runId, agentId);
    run.state = 'running';
    run.endedAt = null;
    this.requireAgent(agentId).record.currentRunId = runId;
    this.persist();
  }

  onRunComplete(agentId: string, input: { runId?: unknown; result?: unknown }): void {
    const runId = requireString(input.runId, 'runId', 160);
    const run = this.requireRun(runId, agentId);
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
  }

  onRunFailed(agentId: string, input: { runId?: unknown; error?: unknown }): void {
    const runId = requireString(input.runId, 'runId', 160);
    const run = this.requireRun(runId, agentId);
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
  }

  // ---------- 管理面 → 执行面 ----------
  dispatch(agentId: string, capability: string, input: unknown): { runId: string; state: ExecutionRunState } {
    const entry = this.requireAgent(agentId);
    if (entry.record.connectionStatus !== 'online') {
      throw new ExecutionPlaneError('AGENT_OFFLINE', `执行面 ${agentId} 不在线，无法派单`);
    }
    const cap = entry.record.capabilities.find((item) => item.name === capability);
    if (!cap) {
      throw new ExecutionPlaneError('CAPABILITY_UNSUPPORTED', `执行面 ${agentId} 不支持能力 ${capability}`);
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
    const run: ExecutionRunRecord = {
      runId,
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
    entry.send({ type: 'dispatch', runId, capability, input: input ?? null });
    this.persist();
    return { runId, state: run.state };
  }

  recall(agentId: string): { recalled: boolean; runId: string | null } {
    const entry = this.requireAgent(agentId);
    const runId = entry.record.currentRunId;
    entry.send({ type: 'recall', runId });
    if (runId) {
      const run = this.runs.get(runId);
      if (run && (run.state === 'dispatched' || run.state === 'running')) {
        run.state = 'recalled';
        run.endedAt = this.nowIso();
      }
    }
    entry.record.currentRunId = null;
    entry.record.runtimeStatus = 'idle';
    this.persist();
    return { recalled: true, runId };
  }

  disconnect(agentId: string): void {
    const entry = this.agents.get(agentId);
    if (!entry) return;
    entry.record.connectionStatus = 'offline';
    entry.record.runtimeStatus = 'idle';
    entry.record.currentRunId = null;
    entry.send = () => {};
    this.persist();
  }

  /** 心跳超时判离线；返回本次标记离线的 agent 数。 */
  markStaleOffline(): number {
    const now = this.clock().getTime();
    let count = 0;
    for (const entry of this.agents.values()) {
      if (entry.record.connectionStatus !== 'online') continue;
      const lastSeen = new Date(entry.record.lastSeenAt).getTime();
      if (Number.isNaN(lastSeen) || now - lastSeen > this.heartbeatTimeoutMs) {
        entry.record.connectionStatus = 'offline';
        entry.record.runtimeStatus = 'idle';
        entry.record.currentRunId = null;
        count += 1;
      }
    }
    if (count > 0) this.persist();
    return count;
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
