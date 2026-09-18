export type RuntimeMetadata = Record<string, unknown>;

export type RuntimeHealthStatus =
  | 'stopped'
  | 'starting'
  | 'healthy'
  | 'degraded'
  | 'unhealthy';

export interface RuntimeHealth {
  runtimeInstanceId: string;
  status: RuntimeHealthStatus;
  checkedAt: string;
  /** Duration of the last active health probe, when one was attempted. */
  latencyMs?: number;
  message?: string;
  details?: RuntimeMetadata;
}

export interface RuntimeHealthVerifyOptions {
  /** Start a stopped runtime before probing it. Defaults to false. */
  startIfStopped?: boolean;
  /** Maximum time to wait for the provider's read-only probe. */
  timeoutMs?: number;
  /** Provider-specific read-only RPC. Implementations may ignore it. */
  probeMethod?: string;
  /** Parameters for probeMethod. */
  probeParams?: unknown;
}

export type RuntimeSessionState = 'active' | 'closed' | 'error';

export interface RuntimeSession {
  id: string;
  runtimeInstanceId: string;
  state: RuntimeSessionState;
  createdAt: string;
  updatedAt: string;
  workingDirectory?: string;
  metadata?: RuntimeMetadata;
  providerData?: unknown;
}

export interface CreateRuntimeSessionRequest {
  workingDirectory?: string;
  model?: string;
  modelProvider?: string;
  metadata?: RuntimeMetadata;
  runtimeOptions?: RuntimeMetadata;
}

export interface ResumeRuntimeSessionRequest {
  workingDirectory?: string;
  model?: string;
  modelProvider?: string;
  runtimeOptions?: RuntimeMetadata;
}

export interface RuntimeInputItem {
  type: string;
  [key: string]: unknown;
}

export type RuntimeRunState =
  | 'queued'
  | 'running'
  | 'interrupting'
  | 'completed'
  | 'failed'
  | 'interrupted';

export interface RuntimeFailure {
  message: string;
  code?: string;
  details?: unknown;
}

export interface RuntimeRun {
  id: string;
  runtimeInstanceId: string;
  sessionId: string;
  state: RuntimeRunState;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  failure?: RuntimeFailure;
  metadata?: RuntimeMetadata;
  providerData?: unknown;
}

export interface StartRuntimeRunRequest {
  input: string | readonly RuntimeInputItem[];
  clientRequestId?: string;
  metadata?: RuntimeMetadata;
  runtimeOptions?: RuntimeMetadata;
}

export type RuntimeEventKind =
  | 'lifecycle'
  | 'notification'
  | 'session'
  | 'run'
  | 'approval';

export interface RuntimeEvent<T = unknown> {
  sequence: number;
  runtimeInstanceId: string;
  kind: RuntimeEventKind;
  name: string;
  occurredAt: string;
  sessionId?: string;
  runId?: string;
  data?: T;
}

export type RuntimeEventListener = (event: RuntimeEvent) => void;

export interface RuntimeApprovalRequest {
  requestId: string;
  runtimeInstanceId: string;
  method: string;
  requestedAt: string;
  sessionId?: string;
  runId?: string;
  payload?: unknown;
}

export type RuntimeApprovalOutcome = 'approved' | 'denied';

export interface RuntimeApprovalDecision {
  outcome: RuntimeApprovalOutcome;
  reason?: string;
  /** Runtime-specific response. When omitted, the adapter builds its normal response. */
  response?: unknown;
}

export interface RuntimeSessionApi {
  createSession(request?: CreateRuntimeSessionRequest): Promise<RuntimeSession>;
  resumeSession(sessionId: string, request?: ResumeRuntimeSessionRequest): Promise<RuntimeSession>;
  closeSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  getSession(sessionId: string): RuntimeSession | undefined;
  listSessions(): RuntimeSession[];
}

export interface RuntimeRunApi {
  startRun(sessionId: string, request: StartRuntimeRunRequest): Promise<RuntimeRun>;
  interruptRun(runId: string): Promise<void>;
  waitForRun(runId: string, timeoutMs?: number): Promise<RuntimeRun>;
  getRun(runId: string): RuntimeRun | undefined;
  listRuns(sessionId?: string): RuntimeRun[];
}

export interface RuntimeEventApi {
  onEvent(listener: RuntimeEventListener): () => void;
}

export interface RuntimeApprovalApi {
  listPendingApprovals(): RuntimeApprovalRequest[];
  resolveApproval(requestId: string, decision: RuntimeApprovalDecision): Promise<void>;
}

export interface RuntimeHealthApi {
  getHealth(): Promise<RuntimeHealth>;
  verifyHealth(options?: RuntimeHealthVerifyOptions): Promise<RuntimeHealth>;
}

/**
 * Runtime-neutral contract used by the AI Harbor control plane.
 * Implementations must make start/stop idempotent.
 */
export interface AgentRuntime
  extends RuntimeSessionApi,
    RuntimeRunApi,
    RuntimeEventApi,
    RuntimeApprovalApi,
    RuntimeHealthApi {
  readonly runtimeInstanceId: string;
  readonly runtimeKind: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function isTerminalRunState(state: RuntimeRunState): boolean {
  return state === 'completed' || state === 'failed' || state === 'interrupted';
}
