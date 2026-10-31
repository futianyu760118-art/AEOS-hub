import type {
  AgentRuntime,
  CreateRuntimeSessionRequest,
  ResumeRuntimeSessionRequest,
  RuntimeApprovalDecision,
  RuntimeApprovalRequest,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeHealth,
  RuntimeHealthVerifyOptions,
  RuntimeRun,
  RuntimeSession,
  StartRuntimeRunRequest,
} from './types.ts';

interface SupervisorListener {
  listener: RuntimeEventListener;
  runtimeInstanceId?: string;
}

/** Owns runtime instances and serializes lifecycle transitions per instance. */
export class RuntimeSupervisor {
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly startLocks = new Map<string, Promise<AgentRuntime>>();
  private readonly stopLocks = new Map<string, Promise<void>>();
  private readonly unsubscribers = new Map<string, () => void>();
  private readonly listeners = new Set<SupervisorListener>();

  register(runtime: AgentRuntime): this {
    const id = runtime.runtimeInstanceId.trim();
    if (!id) throw new Error('runtimeInstanceId is required');
    const existing = this.runtimes.get(id);
    if (existing && existing !== runtime) throw new Error(`runtime already registered: ${id}`);
    if (existing) return this;

    this.runtimes.set(id, runtime);
    this.unsubscribers.set(id, runtime.onEvent((event) => this.forwardEvent(event)));
    return this;
  }

  async unregister(runtimeInstanceId: string, stop = true): Promise<AgentRuntime | undefined> {
    const runtime = this.runtimes.get(runtimeInstanceId);
    if (!runtime) return undefined;
    if (stop) await this.stop(runtimeInstanceId);
    this.unsubscribers.get(runtimeInstanceId)?.();
    this.unsubscribers.delete(runtimeInstanceId);
    this.runtimes.delete(runtimeInstanceId);
    return runtime;
  }

  has(runtimeInstanceId: string): boolean {
    return this.runtimes.has(runtimeInstanceId);
  }

  get(runtimeInstanceId: string): AgentRuntime | undefined {
    return this.runtimes.get(runtimeInstanceId);
  }

  list(): AgentRuntime[] {
    return [...this.runtimes.values()];
  }

  async ensureStarted(runtimeInstanceId: string): Promise<AgentRuntime> {
    const stopping = this.stopLocks.get(runtimeInstanceId);
    if (stopping) await stopping;

    const existing = this.startLocks.get(runtimeInstanceId);
    if (existing) return existing;

    const runtime = this.getRegistered(runtimeInstanceId);
    const operation = (async () => {
      await runtime.start();
      return runtime;
    })();
    this.startLocks.set(runtimeInstanceId, operation);

    try {
      return await operation;
    } finally {
      if (this.startLocks.get(runtimeInstanceId) === operation) {
        this.startLocks.delete(runtimeInstanceId);
      }
    }
  }

  async stop(runtimeInstanceId: string): Promise<void> {
    const existing = this.stopLocks.get(runtimeInstanceId);
    if (existing) return existing;

    const runtime = this.getRegistered(runtimeInstanceId);
    const operation = (async () => {
      const starting = this.startLocks.get(runtimeInstanceId);
      if (starting) {
        try {
          await starting;
        } catch {
          // A failed start is already stopped from the supervisor's perspective.
        }
      }
      await runtime.stop();
    })();
    this.stopLocks.set(runtimeInstanceId, operation);

    try {
      await operation;
    } finally {
      if (this.stopLocks.get(runtimeInstanceId) === operation) {
        this.stopLocks.delete(runtimeInstanceId);
      }
    }
  }

  async startAll(): Promise<RuntimeHealth[]> {
    await Promise.all(this.list().map((runtime) => this.ensureStarted(runtime.runtimeInstanceId)));
    return this.getAllHealth();
  }

  async stopAll(): Promise<void> {
    await Promise.all(this.list().map((runtime) => this.stop(runtime.runtimeInstanceId)));
  }

  async getHealth(runtimeInstanceId: string): Promise<RuntimeHealth> {
    return this.getRegistered(runtimeInstanceId).getHealth();
  }

  verifyHealth(
    runtimeInstanceId: string,
    options?: RuntimeHealthVerifyOptions,
  ): Promise<RuntimeHealth> {
    return this.getRegistered(runtimeInstanceId).verifyHealth(options);
  }

  async getAllHealth(): Promise<RuntimeHealth[]> {
    return Promise.all(this.list().map((runtime) => runtime.getHealth()));
  }

  async verifyAllHealth(options?: RuntimeHealthVerifyOptions): Promise<RuntimeHealth[]> {
    return Promise.all(this.list().map((runtime) => runtime.verifyHealth(options)));
  }

  onEvent(listener: RuntimeEventListener, runtimeInstanceId?: string): () => void {
    const entry: SupervisorListener = { listener, runtimeInstanceId };
    this.listeners.add(entry);
    return () => this.listeners.delete(entry);
  }

  async createSession(
    runtimeInstanceId: string,
    request?: CreateRuntimeSessionRequest,
  ): Promise<RuntimeSession> {
    const runtime = await this.ensureStarted(runtimeInstanceId);
    return runtime.createSession(request);
  }

  async resumeSession(
    runtimeInstanceId: string,
    sessionId: string,
    request?: ResumeRuntimeSessionRequest,
  ): Promise<RuntimeSession> {
    const runtime = await this.ensureStarted(runtimeInstanceId);
    return runtime.resumeSession(sessionId, request);
  }

  async closeSession(runtimeInstanceId: string, sessionId: string): Promise<void> {
    const runtime = await this.ensureStarted(runtimeInstanceId);
    await runtime.closeSession(sessionId);
  }

  async deleteSession(runtimeInstanceId: string, sessionId: string): Promise<void> {
    const runtime = await this.ensureStarted(runtimeInstanceId);
    await runtime.deleteSession(sessionId);
  }

  getSession(runtimeInstanceId: string, sessionId: string): RuntimeSession | undefined {
    return this.getRegistered(runtimeInstanceId).getSession(sessionId);
  }

  listSessions(runtimeInstanceId: string): RuntimeSession[] {
    return this.getRegistered(runtimeInstanceId).listSessions();
  }

  async startRun(
    runtimeInstanceId: string,
    sessionId: string,
    request: StartRuntimeRunRequest,
  ): Promise<RuntimeRun> {
    const runtime = await this.ensureStarted(runtimeInstanceId);
    return runtime.startRun(sessionId, request);
  }

  async interruptRun(runtimeInstanceId: string, runId: string): Promise<void> {
    await this.getRegistered(runtimeInstanceId).interruptRun(runId);
  }

  async waitForRun(
    runtimeInstanceId: string,
    runId: string,
    timeoutMs?: number,
  ): Promise<RuntimeRun> {
    return this.getRegistered(runtimeInstanceId).waitForRun(runId, timeoutMs);
  }

  getRun(runtimeInstanceId: string, runId: string): RuntimeRun | undefined {
    return this.getRegistered(runtimeInstanceId).getRun(runId);
  }

  listRuns(runtimeInstanceId: string, sessionId?: string): RuntimeRun[] {
    return this.getRegistered(runtimeInstanceId).listRuns(sessionId);
  }

  listPendingApprovals(runtimeInstanceId: string): RuntimeApprovalRequest[] {
    return this.getRegistered(runtimeInstanceId).listPendingApprovals();
  }

  async resolveApproval(
    runtimeInstanceId: string,
    requestId: string,
    decision: RuntimeApprovalDecision,
  ): Promise<void> {
    await this.getRegistered(runtimeInstanceId).resolveApproval(requestId, decision);
  }

  private getRegistered(runtimeInstanceId: string): AgentRuntime {
    const runtime = this.runtimes.get(runtimeInstanceId);
    if (!runtime) throw new Error(`runtime is not registered: ${runtimeInstanceId}`);
    return runtime;
  }

  private forwardEvent(event: RuntimeEvent): void {
    for (const entry of this.listeners) {
      if (entry.runtimeInstanceId && entry.runtimeInstanceId !== event.runtimeInstanceId) continue;
      try {
        entry.listener(event);
      } catch {
        // One observer must not block events for the rest of the control plane.
      }
    }
  }
}
