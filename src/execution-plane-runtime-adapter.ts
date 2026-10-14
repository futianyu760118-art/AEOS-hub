// 执行面运行时适配器：把 ExecutionPlaneRegistry 包装成 AgentRuntime 契约，
// 让 G1 受控任务的 agent-runs 流程（createSession/startRun/waitForRun）能驱动远程查询智能体。
// 查询输入约定：startRun 的 input 是 JSON 字符串 {"path":..., "params":{...}}（由 task-api 用 deriveExecutionQuery 生成）。
import { randomUUID } from 'node:crypto';
import type {
  AgentRuntime,
  CreateRuntimeSessionRequest,
  RuntimeApprovalDecision,
  RuntimeApprovalRequest,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeHealth,
  RuntimeHealthVerifyOptions,
  RuntimeRun,
  RuntimeSession,
  StartRuntimeRunRequest,
} from './runtime/types.ts';
import { ExecutionPlaneError, ExecutionPlaneRegistry, type ExecutionRunRecord } from './execution-plane.ts';

const DEFAULT_WAIT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toRuntimeFailure(error?: { code?: string; message?: string } | null): RuntimeRun['failure'] {
  if (!error) return undefined;
  return { message: error.message ?? '运行异常', ...(error.code ? { code: error.code } : {}) };
}

export class ExecutionPlaneRuntimeAdapter implements AgentRuntime {
  readonly runtimeInstanceId: string;
  readonly runtimeKind = 'remote-execution-agent';
  private readonly registry: ExecutionPlaneRegistry;
  private readonly agentId: string;
  private readonly clock: () => Date;
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly runs = new Map<string, RuntimeRun>();

  constructor(registry: ExecutionPlaneRegistry, agentId: string, clock: () => Date = () => new Date()) {
    this.registry = registry;
    this.agentId = agentId;
    this.clock = clock;
    this.runtimeInstanceId = agentId;
  }

  private iso(): string {
    return this.clock().toISOString();
  }

  // ---------- RuntimeSessionApi ----------
  async createSession(request?: CreateRuntimeSessionRequest): Promise<RuntimeSession> {
    const session: RuntimeSession = {
      id: `exec-session-${randomUUID()}`,
      runtimeInstanceId: this.agentId,
      state: 'active',
      createdAt: this.iso(),
      updatedAt: this.iso(),
      metadata: request ? { developerInstructions: request.developerInstructions } : undefined,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async resumeSession(sessionId: string, request?: CreateRuntimeSessionRequest): Promise<RuntimeSession> {
    return this.getSession(sessionId) ?? this.createSession(request);
  }

  async closeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  getSession(sessionId: string): RuntimeSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): RuntimeSession[] {
    return [...this.sessions.values()];
  }

  // ---------- RuntimeRunApi ----------
  async startRun(sessionId: string, request: StartRuntimeRunRequest): Promise<RuntimeRun> {
    const inputText = typeof request.input === 'string' ? request.input : JSON.stringify(request.input ?? '');
    let dispatch: { capability?: unknown; input?: unknown };
    try {
      dispatch = JSON.parse(inputText);
    } catch {
      return this.failedRun(sessionId, 'INVALID_ARGUMENT', '派单输入不是合法 JSON');
    }
    const capability = typeof dispatch.capability === 'string' ? dispatch.capability : '';
    const input = dispatch.input && typeof dispatch.input === 'object' ? (dispatch.input as Record<string, unknown>) : {};
    if (!capability) return this.failedRun(sessionId, 'INVALID_ARGUMENT', '派单输入缺少 capability');

    try {
      const { runId } = this.registry.dispatch(this.agentId, capability, input);
      const run: RuntimeRun = { id: runId, runtimeInstanceId: this.agentId, sessionId, state: 'running', createdAt: this.iso() };
      this.runs.set(runId, run);
      return run;
    } catch (error) {
      const code = error instanceof ExecutionPlaneError ? error.code : 'EXECUTION_FAILED';
      return this.failedRun(sessionId, code, (error as Error).message);
    }
  }

  async interruptRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (run && !['completed', 'failed', 'interrupted'].includes(run.state)) {
      this.registry.recall(this.agentId);
      run.state = 'interrupted';
      run.endedAt = this.iso();
    }
  }

  async waitForRun(runId: string, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<RuntimeRun> {
    const local = this.runs.get(runId);
    if (local && local.state === 'failed') return local;

    const deadline = this.clock().getTime() + timeoutMs;
    while (this.clock().getTime() < deadline) {
      const reg = this.registry.list().runs.find((candidate) => candidate.runId === runId);
      if (reg) {
        if (reg.state === 'completed') return this.fromRegistryRun(reg, 'completed');
        if (reg.state === 'failed') return this.fromRegistryRun(reg, 'failed');
        if (reg.state === 'recalled') return this.fromRegistryRun(reg, 'interrupted');
      }
      await sleep(POLL_INTERVAL_MS);
    }
    const base = local ?? this.runs.get(runId);
    return {
      id: runId,
      runtimeInstanceId: this.agentId,
      sessionId: base?.sessionId ?? '',
      state: 'failed',
      createdAt: base?.createdAt ?? this.iso(),
      endedAt: this.iso(),
      failure: { code: 'RUN_TIMEOUT', message: '运行超时' },
    };
  }

  getRun(runId: string): RuntimeRun | undefined {
    return this.runs.get(runId);
  }

  listRuns(sessionId?: string): RuntimeRun[] {
    const runs = [...this.runs.values()];
    return sessionId ? runs.filter((run) => run.sessionId === sessionId) : runs;
  }

  // ---------- RuntimeEventApi ----------
  onEvent(_listener: RuntimeEventListener): () => void {
    return () => {};
  }

  // ---------- RuntimeApprovalApi ----------
  listPendingApprovals(): RuntimeApprovalRequest[] {
    return [];
  }

  async resolveApproval(_requestId: string, _decision: RuntimeApprovalDecision): Promise<void> {
    // 执行面查询为只读、无需审批。
  }

  // ---------- RuntimeHealthApi ----------
  async getHealth(): Promise<RuntimeHealth> {
    const agent = this.registry.list().agents.find((candidate) => candidate.agentId === this.agentId);
    const online = agent?.connectionStatus === 'online';
    return {
      runtimeInstanceId: this.agentId,
      status: online ? 'healthy' : 'unhealthy',
      checkedAt: this.iso(),
      message: online ? '执行面在线' : '执行面离线',
    };
  }

  async verifyHealth(_options?: RuntimeHealthVerifyOptions): Promise<RuntimeHealth> {
    return this.getHealth();
  }

  // ---------- 生命周期 ----------
  async start(): Promise<void> {
    // 执行面连接由 WS 通道管理，无需这里启动。
  }

  async stop(): Promise<void> {
    this.registry.recall(this.agentId);
  }

  private failedRun(sessionId: string, code: string, message: string): RuntimeRun {
    const runId = `exec-failed-${randomUUID()}`;
    const run: RuntimeRun = {
      id: runId,
      runtimeInstanceId: this.agentId,
      sessionId,
      state: 'failed',
      createdAt: this.iso(),
      endedAt: this.iso(),
      failure: { code, message },
    };
    this.runs.set(runId, run);
    return run;
  }

  private fromRegistryRun(record: ExecutionRunRecord, state: RuntimeRun['state']): RuntimeRun {
    return {
      id: record.runId,
      runtimeInstanceId: this.agentId,
      sessionId: this.runs.get(record.runId)?.sessionId ?? '',
      state,
      createdAt: record.startedAt,
      endedAt: record.endedAt ?? this.iso(),
      failure: toRuntimeFailure(record.error),
    };
  }
}
