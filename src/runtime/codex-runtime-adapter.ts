import { randomUUID } from 'node:crypto';
import {
  CodexAppServerClient,
  type RpcIncoming,
  type StartOptions,
} from '../codex-client.ts';
import {
  isTerminalRunState,
  type AgentRuntime,
  type CreateRuntimeSessionRequest,
  type ResumeRuntimeSessionRequest,
  type RuntimeApprovalDecision,
  type RuntimeApprovalRequest,
  type RuntimeEvent,
  type RuntimeEventListener,
  type RuntimeFailure,
  type RuntimeHealth,
  type RuntimeHealthStatus,
  type RuntimeHealthVerifyOptions,
  type RuntimeInputItem,
  type RuntimeMetadata,
  type RuntimeRun,
  type RuntimeRunState,
  type RuntimeSession,
  type StartRuntimeRunRequest,
} from './types.ts';

export interface CodexRuntimeTransport {
  request(method: string, params?: unknown): Promise<unknown>;
  respond(reqId: number, result: unknown): void;
  respondError(reqId: number, code: number, message: string): void;
  close(): void;
  on(eventName: string | symbol, listener: (...args: any[]) => void): this;
  off(eventName: string | symbol, listener: (...args: any[]) => void): this;
}

export interface CodexRuntimeAdapterOptions {
  runtimeInstanceId: string;
  startOptions: StartOptions;
  defaultRunTimeoutMs?: number;
  clientFactory?: (options: StartOptions) => Promise<CodexRuntimeTransport>;
}

interface RunWaiter {
  resolve: (run: RuntimeRun) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_RUN_TIMEOUT_MS = 600_000;
const DEFAULT_HEALTH_PROBE_METHOD = 'getAuthStatus';
const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 10_000;
const READ_ONLY_HEALTH_PROBE_METHODS = new Set([
  'getAuthStatus',
  'account/read',
  'thread/list',
  'mcpServerStatus/list',
  'model/list',
]);
const COMPATIBILITY_HEALTH_PROBES: Array<{ method: string; params: unknown }> = [
  { method: 'getAuthStatus', params: { includeToken: false, refreshToken: false } },
  { method: 'account/read', params: { refreshToken: false } },
  { method: 'thread/list', params: { limit: 1, archived: false, useStateDbOnly: true } },
];

export class CodexRuntimeAdapter implements AgentRuntime {
  readonly runtimeInstanceId: string;
  readonly runtimeKind = 'codex-app-server';

  private readonly startOptions: StartOptions;
  private readonly defaultRunTimeoutMs: number;
  private readonly clientFactory: (options: StartOptions) => Promise<CodexRuntimeTransport>;
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly runs = new Map<string, RuntimeRun>();
  private readonly approvals = new Map<string, RuntimeApprovalRequest>();
  private readonly listeners = new Set<RuntimeEventListener>();
  private readonly runWaiters = new Map<string, Set<RunWaiter>>();

  private client: CodexRuntimeTransport | null = null;
  private startPromise: Promise<void> | null = null;
  private sequence = 0;
  private healthStatus: RuntimeHealthStatus = 'stopped';
  private healthMessage = 'runtime has not been started';
  private healthDetails: RuntimeMetadata | undefined;
  private healthLatencyMs: number | undefined;
  private healthCheckedAt = new Date().toISOString();
  private healthVerifyPromise: Promise<RuntimeHealth> | null = null;

  constructor(options: CodexRuntimeAdapterOptions) {
    const runtimeInstanceId = options.runtimeInstanceId.trim();
    if (!runtimeInstanceId) throw new Error('runtimeInstanceId is required');
    if (
      !Number.isFinite(options.defaultRunTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS)
      || (options.defaultRunTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS) < 0
    ) {
      throw new Error('defaultRunTimeoutMs must be a non-negative finite number');
    }

    this.runtimeInstanceId = runtimeInstanceId;
    this.startOptions = { ...options.startOptions };
    this.defaultRunTimeoutMs = options.defaultRunTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    this.clientFactory = options.clientFactory ?? ((startOptions) => CodexAppServerClient.start(startOptions));
  }

  async start(): Promise<void> {
    if (this.client) return;
    if (this.startPromise) return this.startPromise;

    const operation = (async () => {
      this.setHealth('starting', 'starting codex app-server');
      this.emitEvent('lifecycle', 'runtime/starting');
      try {
        const client = await this.clientFactory({ ...this.startOptions });
        this.client = client;
        this.attachClient(client);
        this.setHealth('healthy', 'codex app-server is ready', {
          codexHome: this.startOptions.codexHome,
          cwd: this.startOptions.cwd,
        });
        this.emitEvent('lifecycle', 'runtime/started');
      } catch (error) {
        const failure = toFailure(error);
        this.setHealth('unhealthy', failure.message, { error: failure.details });
        this.emitEvent('lifecycle', 'runtime/start-failed', { failure });
        throw error;
      }
    })();

    this.startPromise = operation;
    try {
      await operation;
    } finally {
      if (this.startPromise === operation) this.startPromise = null;
    }
  }

  async stop(): Promise<void> {
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        // Continue so a failed start transitions cleanly to stopped.
      }
    }

    const client = this.client;
    if (!client) {
      this.setHealth('stopped', 'runtime is stopped');
      return;
    }

    this.client = null;
    this.detachClient(client);
    client.close();
    this.failActiveRuns('runtime stopped before the run completed');
    this.approvals.clear();
    this.setHealth('stopped', 'runtime is stopped');
    this.emitEvent('lifecycle', 'runtime/stopped');
  }

  async createSession(request: CreateRuntimeSessionRequest = {}): Promise<RuntimeSession> {
    const client = await this.readyClient();
    const params: RuntimeMetadata = { ...(request.runtimeOptions ?? {}) };
    params.cwd = request.workingDirectory ?? this.startOptions.cwd;
    if (request.model !== undefined) params.model = request.model;
    if (request.modelProvider !== undefined) params.modelProvider = request.modelProvider;

    const response = await client.request('thread/start', params);
    const session = this.sessionFromResponse(response, request.metadata, request.workingDirectory);
    this.sessions.set(session.id, session);
    this.emitEvent('session', 'session/created', { session }, session.id);
    return cloneSession(session);
  }

  async resumeSession(
    sessionId: string,
    request: ResumeRuntimeSessionRequest = {},
  ): Promise<RuntimeSession> {
    requireId(sessionId, 'sessionId');
    const client = await this.readyClient();
    const params: RuntimeMetadata = { ...(request.runtimeOptions ?? {}), threadId: sessionId };
    if (request.workingDirectory !== undefined) params.cwd = request.workingDirectory;
    if (request.model !== undefined) params.model = request.model;
    if (request.modelProvider !== undefined) params.modelProvider = request.modelProvider;

    const response = await client.request('thread/resume', params);
    const existing = this.sessions.get(sessionId);
    const fromResponse = this.sessionFromResponse(
      response,
      existing?.metadata,
      request.workingDirectory ?? existing?.workingDirectory,
      sessionId,
    );
    this.sessions.set(sessionId, fromResponse);
    this.emitEvent('session', 'session/resumed', { session: fromResponse }, sessionId);
    return cloneSession(fromResponse);
  }

  async closeSession(sessionId: string): Promise<void> {
    requireId(sessionId, 'sessionId');
    const client = await this.readyClient();
    const params = { threadId: sessionId };
    await client.request('thread/archive', params);
    const now = new Date().toISOString();
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.state = 'closed';
      existing.updatedAt = now;
    } else {
      this.sessions.set(sessionId, {
        id: sessionId,
        runtimeInstanceId: this.runtimeInstanceId,
        state: 'closed',
        createdAt: now,
        updatedAt: now,
      });
    }
    this.emitEvent('session', 'session/closed', undefined, sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    requireId(sessionId, 'sessionId');
    const client = await this.readyClient();
    const params = { threadId: sessionId };
    await client.request('thread/delete', params);
    this.sessions.delete(sessionId);
    this.emitEvent('session', 'session/deleted', undefined, sessionId);
  }

  getSession(sessionId: string): RuntimeSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? cloneSession(session) : undefined;
  }

  listSessions(): RuntimeSession[] {
    return [...this.sessions.values()].map(cloneSession);
  }

  async startRun(sessionId: string, request: StartRuntimeRunRequest): Promise<RuntimeRun> {
    requireId(sessionId, 'sessionId');
    const input = normalizeInput(request.input);
    const client = await this.readyClient();
    const params: RuntimeMetadata = {
      ...(request.runtimeOptions ?? {}),
      threadId: sessionId,
      clientUserMessageId: request.clientRequestId ?? `${this.runtimeInstanceId}_${randomUUID()}`,
      input,
    };

    const response = await client.request('turn/start', params);
    const run = this.runFromResponse(response, sessionId, request.metadata);
    const current = this.runs.get(run.id);
    const stored = current && isTerminalRunState(current.state)
      ? current
      : { ...current, ...run, metadata: { ...current?.metadata, ...run.metadata } };
    this.runs.set(stored.id, stored);
    this.ensureSession(sessionId);
    this.emitEvent('run', 'run/accepted', { run: stored }, sessionId, stored.id);
    return cloneRun(stored);
  }

  async interruptRun(runId: string): Promise<void> {
    requireId(runId, 'runId');
    const run = this.runs.get(runId);
    if (!run) throw new Error(`unknown run: ${runId}`);
    if (isTerminalRunState(run.state)) return;

    const client = await this.readyClient();
    run.state = 'interrupting';
    const params = { threadId: run.sessionId, turnId: runId };
    await client.request('turn/interrupt', params);
    this.emitEvent('run', 'run/interrupt-requested', undefined, run.sessionId, runId);
  }

  waitForRun(runId: string, timeoutMs = this.defaultRunTimeoutMs): Promise<RuntimeRun> {
    requireId(runId, 'runId');
    const run = this.runs.get(runId);
    if (!run) return Promise.reject(new Error(`unknown run: ${runId}`));
    if (isTerminalRunState(run.state)) return Promise.resolve(cloneRun(run));
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      return Promise.reject(new Error('timeoutMs must be a non-negative finite number'));
    }

    return new Promise((resolve, reject) => {
      const waiter: RunWaiter = { resolve, reject };
      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          this.removeRunWaiter(runId, waiter);
          reject(new Error(`timed out waiting for run ${runId} after ${timeoutMs}ms`));
        }, timeoutMs);
      }
      const waiters = this.runWaiters.get(runId) ?? new Set<RunWaiter>();
      waiters.add(waiter);
      this.runWaiters.set(runId, waiters);
    });
  }

  getRun(runId: string): RuntimeRun | undefined {
    const run = this.runs.get(runId);
    return run ? cloneRun(run) : undefined;
  }

  listRuns(sessionId?: string): RuntimeRun[] {
    const runs = sessionId
      ? [...this.runs.values()].filter((run) => run.sessionId === sessionId)
      : [...this.runs.values()];
    return runs.map(cloneRun);
  }

  onEvent(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listPendingApprovals(): RuntimeApprovalRequest[] {
    return [...this.approvals.values()].map(cloneApproval);
  }

  async resolveApproval(requestId: string, decision: RuntimeApprovalDecision): Promise<void> {
    requireId(requestId, 'requestId');
    const approval = this.approvals.get(requestId);
    if (!approval) throw new Error(`unknown or already resolved approval request: ${requestId}`);
    const client = this.client;
    if (!client) throw new Error('runtime is not running');

    const numericId = Number(requestId);
    if (!Number.isSafeInteger(numericId)) {
      throw new Error(`Codex approval request id is not numeric: ${requestId}`);
    }

    const response = decision.response !== undefined
      ? decision.response
      : defaultApprovalResponse(approval.method, decision);
    client.respond(numericId, response);
    this.approvals.delete(requestId);
    this.emitEvent(
      'approval',
      'approval/resolved',
      { request: approval, decision },
      approval.sessionId,
      approval.runId,
    );
  }

  async getHealth(): Promise<RuntimeHealth> {
    return {
      runtimeInstanceId: this.runtimeInstanceId,
      status: this.healthStatus,
      checkedAt: this.healthCheckedAt,
      latencyMs: this.healthLatencyMs,
      message: this.healthMessage,
      details: this.healthDetails ? { ...this.healthDetails } : undefined,
    };
  }

  /**
   * Perform a provider-level, read-only health probe. This deliberately does
   * not start a stopped runtime unless the caller opts in with startIfStopped.
   */
  async verifyHealth(options: RuntimeHealthVerifyOptions = {}): Promise<RuntimeHealth> {
    if (this.healthVerifyPromise) return this.healthVerifyPromise;

    const operation = this.verifyHealthOnce(options);
    this.healthVerifyPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.healthVerifyPromise === operation) this.healthVerifyPromise = null;
    }
  }

  private async readyClient(): Promise<CodexRuntimeTransport> {
    await this.start();
    if (!this.client) throw new Error('runtime failed to start');
    return this.client;
  }

  private async verifyHealthOnce(options: RuntimeHealthVerifyOptions): Promise<RuntimeHealth> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_HEALTH_PROBE_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new Error('health timeoutMs must be a non-negative finite number');
    }

    if (!this.client && options.startIfStopped) {
      try {
        await this.start();
      } catch {
        return this.getHealth();
      }
    }

    const client = this.client;
    if (!client) {
      const status = this.healthStatus === 'unhealthy' ? 'unhealthy' : 'stopped';
      const message = status === 'unhealthy'
        ? this.healthMessage
        : 'runtime is stopped; probe not attempted';
      const details = {
        ...(this.healthDetails ?? {}),
        probe: {
          attempted: false,
          method: options.probeMethod ?? DEFAULT_HEALTH_PROBE_METHOD,
          reason: status === 'unhealthy' ? 'runtime process is unavailable' : 'runtime is stopped',
        },
      };
      this.healthLatencyMs = undefined;
      this.setHealth(status, message, details);
      return this.getHealth();
    }

    const requestedMethod = options.probeMethod?.trim() || DEFAULT_HEALTH_PROBE_METHOD;
    if (!READ_ONLY_HEALTH_PROBE_METHODS.has(requestedMethod)) {
      throw new Error(`health probe method is not allowlisted as read-only: ${requestedMethod}`);
    }
    const candidates = options.probeMethod?.trim()
      ? [{ method: requestedMethod, params: normalizeHealthProbeParams(requestedMethod, options.probeParams) }]
      : COMPATIBILITY_HEALTH_PROBES;
    const startedAt = Date.now();
    const errors: Array<{ method: string; message: string; code?: string }> = [];

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const elapsedMs = Date.now() - startedAt;
      const remainingMs = timeoutMs === 0 ? 0 : Math.max(1, timeoutMs - elapsedMs);
      try {
        const response = await withTimeout(
          client.request(candidate.method, candidate.params),
          remainingMs,
          `health probe ${candidate.method} timed out after ${remainingMs}ms`,
        );
        const latencyMs = Date.now() - startedAt;
        const assessment = assessHealthProbe(candidate.method, response);
        this.healthLatencyMs = latencyMs;
        this.setHealth(assessment.status, assessment.message, {
          ...(this.healthDetails ?? {}),
          probe: {
            attempted: true,
            ok: true,
            requestedMethod,
            method: candidate.method,
            usedFallback: candidate.method !== requestedMethod,
            attempts: index + 1,
            latencyMs,
            responseShape: describeResponse(response),
            ...(errors.length ? { priorErrors: errors } : {}),
            ...assessment.details,
          },
        });
        return this.getHealth();
      } catch (error) {
        const failure = toFailure(error);
        errors.push({ method: candidate.method, message: failure.message, code: failure.code });
        const hasFallback = index < candidates.length - 1;
        if (!hasFallback || !isMethodUnavailable(error)) break;
      }
    }

    const latencyMs = Date.now() - startedAt;
    const lastError = errors[errors.length - 1] ?? {
      method: requestedMethod,
      message: 'unknown health probe failure',
    };
    this.healthLatencyMs = latencyMs;
    this.setHealth('degraded', `health probe ${requestedMethod} failed: ${lastError.message}`, {
      ...(this.healthDetails ?? {}),
      probe: {
        attempted: true,
        ok: false,
        requestedMethod,
        method: lastError.method,
        usedFallback: lastError.method !== requestedMethod,
        attempts: errors.length,
        latencyMs,
        errors,
      },
    });
    return this.getHealth();
  }

  private attachClient(client: CodexRuntimeTransport): void {
    client.on('notification', this.handleNotification);
    client.on('serverRequest', this.handleServerRequest);
    client.on('exit', this.handleExit);
  }

  private detachClient(client: CodexRuntimeTransport): void {
    client.off('notification', this.handleNotification);
    client.off('serverRequest', this.handleServerRequest);
    client.off('exit', this.handleExit);
  }

  private readonly handleNotification = (method: string, params: unknown): void => {
    const runId = extractRunId(params);
    // A few app-server versions omit threadId on turn/item notifications.
    // Once a run has been accepted, its session is the authoritative fallback.
    const sessionId = extractSessionId(params) ?? (runId ? this.runs.get(runId)?.sessionId : undefined);

    if (method === 'thread/started' && sessionId) this.ensureSession(sessionId, params);
    if (method === 'turn/started' && runId && sessionId) {
      this.upsertRunFromNotification(runId, sessionId, 'running', params);
    } else if (method === 'turn/completed' && runId && sessionId) {
      const turn = asRecord(asRecord(params)?.turn);
      // The method itself is terminal even when older providers omit status.
      const state = mapCodexRunState(asString(turn?.status), true);
      const failure = state === 'failed' ? toFailure(turn?.error ?? 'Codex run failed') : undefined;
      this.upsertRunFromNotification(runId, sessionId, state, params, failure);
      this.resolveRunWaiters(runId);
    }

    this.emitEvent('notification', method, params, sessionId, runId);
  };

  private readonly handleServerRequest = (incoming: RpcIncoming): void => {
    if (incoming.id === undefined) {
      this.emitEvent('notification', incoming.method ?? 'server/request-without-id', incoming.params);
      return;
    }

    const requestId = String(incoming.id);
    const runId = extractRunId(incoming.params);
    const sessionId = extractSessionId(incoming.params) ?? (runId ? this.runs.get(runId)?.sessionId : undefined);
    const approval: RuntimeApprovalRequest = {
      requestId,
      runtimeInstanceId: this.runtimeInstanceId,
      method: incoming.method ?? 'unknown',
      requestedAt: new Date().toISOString(),
      sessionId,
      runId,
      payload: incoming.params,
    };
    this.approvals.set(requestId, approval);
    this.emitEvent(
      'approval',
      'approval/requested',
      { request: cloneApproval(approval) },
      approval.sessionId,
      approval.runId,
    );
  };

  private readonly handleExit = (code: number | null): void => {
    const client = this.client;
    if (client) this.detachClient(client);
    this.client = null;
    this.approvals.clear();
    const message = `codex app-server exited with code ${code ?? 'unknown'}`;
    this.failActiveRuns(message);
    this.setHealth('unhealthy', message, { exitCode: code });
    this.emitEvent('lifecycle', 'runtime/exited', { exitCode: code });
  };

  private sessionFromResponse(
    response: unknown,
    metadata?: RuntimeMetadata,
    workingDirectory?: string,
    fallbackId?: string,
  ): RuntimeSession {
    const responseRecord = asRecord(response);
    const thread = asRecord(responseRecord?.thread) ?? responseRecord;
    const id = asString(thread?.id) ?? fallbackId;
    if (!id) throw new Error(`Codex thread response did not contain an id: ${preview(response)}`);
    const now = new Date().toISOString();
    const createdAt = unixSecondsToIso(thread?.createdAt) ?? this.sessions.get(id)?.createdAt ?? now;
    return {
      id,
      runtimeInstanceId: this.runtimeInstanceId,
      state: 'active',
      createdAt,
      updatedAt: unixSecondsToIso(thread?.updatedAt) ?? now,
      workingDirectory: workingDirectory ?? asString(thread?.cwd) ?? this.startOptions.cwd,
      metadata: metadata ? { ...metadata } : undefined,
      providerData: response,
    };
  }

  private runFromResponse(
    response: unknown,
    sessionId: string,
    metadata?: RuntimeMetadata,
  ): RuntimeRun {
    const responseRecord = asRecord(response);
    const turn = asRecord(responseRecord?.turn) ?? responseRecord;
    const id = asString(turn?.id);
    if (!id) throw new Error(`Codex turn response did not contain an id: ${preview(response)}`);
    const now = new Date().toISOString();
    const state = mapCodexRunState(asString(turn?.status));
    return {
      id,
      runtimeInstanceId: this.runtimeInstanceId,
      sessionId,
      state,
      createdAt: unixSecondsToIso(turn?.startedAt) ?? now,
      startedAt: unixSecondsToIso(turn?.startedAt) ?? now,
      endedAt: unixSecondsToIso(turn?.completedAt),
      failure: state === 'failed' ? toFailure(turn?.error ?? 'Codex run failed') : undefined,
      metadata: metadata ? { ...metadata } : undefined,
      providerData: response,
    };
  }

  private ensureSession(sessionId: string, providerData?: unknown): RuntimeSession {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.state = 'active';
      existing.updatedAt = new Date().toISOString();
      if (providerData !== undefined) existing.providerData = providerData;
      return existing;
    }
    const now = new Date().toISOString();
    const session: RuntimeSession = {
      id: sessionId,
      runtimeInstanceId: this.runtimeInstanceId,
      state: 'active',
      createdAt: now,
      updatedAt: now,
      workingDirectory: this.startOptions.cwd,
      providerData,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  private upsertRunFromNotification(
    runId: string,
    sessionId: string,
    state: RuntimeRunState,
    providerData: unknown,
    failure?: RuntimeFailure,
  ): void {
    const now = new Date().toISOString();
    const turn = asRecord(asRecord(providerData)?.turn);
    const existing = this.runs.get(runId);
    const run: RuntimeRun = {
      id: runId,
      runtimeInstanceId: this.runtimeInstanceId,
      sessionId,
      state,
      createdAt: existing?.createdAt ?? unixSecondsToIso(turn?.startedAt) ?? now,
      startedAt: existing?.startedAt ?? unixSecondsToIso(turn?.startedAt) ?? now,
      endedAt: isTerminalRunState(state) ? unixSecondsToIso(turn?.completedAt) ?? now : undefined,
      failure,
      metadata: existing?.metadata,
      providerData,
    };
    this.runs.set(runId, run);
    this.ensureSession(sessionId);
  }

  private failActiveRuns(message: string): void {
    for (const run of this.runs.values()) {
      if (isTerminalRunState(run.state)) continue;
      run.state = 'failed';
      run.endedAt = new Date().toISOString();
      run.failure = { message };
      this.resolveRunWaiters(run.id);
      this.emitEvent('run', 'run/failed', { run: cloneRun(run) }, run.sessionId, run.id);
    }
  }

  private resolveRunWaiters(runId: string): void {
    const run = this.runs.get(runId);
    const waiters = this.runWaiters.get(runId);
    if (!run || !waiters || !isTerminalRunState(run.state)) return;
    this.runWaiters.delete(runId);
    for (const waiter of waiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(cloneRun(run));
    }
  }

  private removeRunWaiter(runId: string, waiter: RunWaiter): void {
    const waiters = this.runWaiters.get(runId);
    if (!waiters) return;
    waiters.delete(waiter);
    if (!waiters.size) this.runWaiters.delete(runId);
  }

  private setHealth(status: RuntimeHealthStatus, message: string, details?: RuntimeMetadata): void {
    this.healthStatus = status;
    this.healthMessage = message;
    this.healthDetails = details;
    this.healthCheckedAt = new Date().toISOString();
    this.emitEvent('lifecycle', 'runtime/health-changed', { status, message, details });
  }

  private emitEvent(
    kind: RuntimeEvent['kind'],
    name: string,
    data?: unknown,
    sessionId?: string,
    runId?: string,
  ): void {
    const event: RuntimeEvent = {
      sequence: ++this.sequence,
      runtimeInstanceId: this.runtimeInstanceId,
      kind,
      name,
      occurredAt: new Date().toISOString(),
      sessionId,
      runId,
      data,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A control-plane listener must not take down the runtime transport.
      }
    }
  }
}

function normalizeInput(input: StartRuntimeRunRequest['input']): RuntimeInputItem[] {
  if (typeof input === 'string') {
    if (!input.trim()) throw new Error('run input cannot be empty');
    return [{ type: 'text', text: input }];
  }
  if (!input.length) throw new Error('run input cannot be empty');
  return input.map((item) => ({ ...item }));
}

function defaultApprovalResponse(
  method: string,
  decision: RuntimeApprovalDecision,
): RuntimeMetadata {
  const accepted = decision.outcome === 'approved';
  if (method === 'mcpServer/elicitation/request') {
    return { action: accepted ? 'accept' : 'decline', content: null, _meta: null };
  }
  return { decision: accepted ? 'accept' : 'decline' };
}

function mapCodexRunState(status?: string, terminalHint = false): RuntimeRunState {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'interrupted') return 'interrupted';
  // `turn/completed` is a terminal protocol event.  A few provider builds
  // accidentally repeat `inProgress` (or omit status) in its payload; the
  // method-level hint must win so waiters cannot hang until timeout.
  if (terminalHint) return 'completed';
  if (status === 'inProgress' || status === 'in_progress' || status === 'in-progress' || status === 'running') return 'running';
  return 'running';
}

function extractSessionId(value: unknown): string | undefined {
  const record = asRecord(value);
  return asString(record?.threadId)
    ?? asString(asRecord(record?.thread)?.id)
    ?? asString(asRecord(record?.turn)?.threadId)
    ?? asString(asRecord(record?.item)?.threadId);
}

function extractRunId(value: unknown): string | undefined {
  const record = asRecord(value);
  return asString(record?.turnId)
    ?? asString(asRecord(record?.turn)?.id)
    ?? asString(asRecord(record?.item)?.turnId);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function unixSecondsToIso(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : undefined;
}

function toFailure(error: unknown): RuntimeFailure {
  if (error instanceof Error) return { message: error.message, details: error };
  const record = asRecord(error);
  const message = asString(record?.message) ?? String(error ?? 'unknown runtime error');
  const codeValue = record?.code;
  return {
    message,
    code: typeof codeValue === 'string' || typeof codeValue === 'number' ? String(codeValue) : undefined,
    details: error,
  };
}

function requireId(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function preview(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 300);
  } catch {
    return String(value).slice(0, 300);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (timeoutMs === 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function defaultHealthProbeParams(method: string): unknown {
  if (method === DEFAULT_HEALTH_PROBE_METHOD) {
    return { includeToken: false, refreshToken: false };
  }
  return {};
}

function normalizeHealthProbeParams(method: string, value: unknown): unknown {
  const params = asRecord(value) ?? {};
  if (method === 'getAuthStatus') {
    return { ...params, includeToken: false, refreshToken: false };
  }
  if (method === 'account/read') {
    return { ...params, refreshToken: false };
  }
  if (method === 'thread/list') {
    const requestedLimit = typeof params.limit === 'number' && Number.isFinite(params.limit)
      ? Math.trunc(params.limit)
      : 1;
    return {
      ...params,
      limit: Math.max(1, Math.min(10, requestedLimit)),
      useStateDbOnly: true,
    };
  }
  if (method === 'model/list' || method === 'mcpServerStatus/list') {
    const requestedLimit = typeof params.limit === 'number' && Number.isFinite(params.limit)
      ? Math.trunc(params.limit)
      : 10;
    return { ...params, limit: Math.max(1, Math.min(20, requestedLimit)) };
  }
  return params;
}

function isMethodUnavailable(error: unknown): boolean {
  const message = toFailure(error).message;
  return /(?:code\s*[=:]?\s*-32601|method\s+(?:not found|unavailable)|unknown method|not implemented|unsupported)/i.test(message);
}

function assessHealthProbe(
  method: string,
  response: unknown,
): { status: RuntimeHealthStatus; message: string; details?: RuntimeMetadata } {
  if (method !== DEFAULT_HEALTH_PROBE_METHOD) {
    if (method === 'account/read') {
      const accountResponse = asRecord(response);
      const account = accountResponse?.account;
      const requiresOpenaiAuth = typeof accountResponse?.requiresOpenaiAuth === 'boolean'
        ? accountResponse.requiresOpenaiAuth
        : null;
      const accountAvailable = account !== null && account !== undefined;
      const details = { account: { available: accountAvailable, requiresOpenaiAuth } };
      if (requiresOpenaiAuth === true && !accountAvailable) {
        return {
          status: 'degraded',
          message: 'codex app-server is reachable but authentication is required',
          details,
        };
      }
      return { status: 'healthy', message: 'codex app-server is reachable', details };
    }
    return { status: 'healthy', message: `health probe ${method} succeeded` };
  }

  const result = asRecord(response);
  const authMethod = typeof result?.authMethod === 'string' ? result.authMethod : null;
  const requiresOpenaiAuth = typeof result?.requiresOpenaiAuth === 'boolean'
    ? result.requiresOpenaiAuth
    : null;
  const authenticated = authMethod !== null || requiresOpenaiAuth === false;
  const details = { auth: { authenticated, authMethod, requiresOpenaiAuth } };
  if (requiresOpenaiAuth === true && authMethod === null) {
    return {
      status: 'degraded',
      message: 'codex app-server is reachable but authentication is required',
      details,
    };
  }
  return {
    status: 'healthy',
    message: 'codex app-server is reachable',
    details,
  };
}

function describeResponse(value: unknown): RuntimeMetadata {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (typeof value === 'object') {
    return { type: 'object', keys: Object.keys(value as Record<string, unknown>).slice(0, 32) };
  }
  return { type: typeof value };
}

function cloneSession(session: RuntimeSession): RuntimeSession {
  return { ...session, metadata: session.metadata ? { ...session.metadata } : undefined };
}

function cloneRun(run: RuntimeRun): RuntimeRun {
  return {
    ...run,
    failure: run.failure ? { ...run.failure } : undefined,
    metadata: run.metadata ? { ...run.metadata } : undefined,
  };
}

function cloneApproval(approval: RuntimeApprovalRequest): RuntimeApprovalRequest {
  return { ...approval };
}
