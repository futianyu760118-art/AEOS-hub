// 跨系统任务执行器：按 plan.stepId 顺序借调执行，回写任务/步骤状态。
// 本模块只依赖一个可注入的 BorrowExecutionPort，便于先用 fake 测试，再接真实借调服务。
import {
  OrchestrationTaskStore,
  OrchestrationTaskStoreError,
  capOrchestrationResult,
  type OrchestrationTaskErrorInfo,
  type OrchestrationTaskRecord,
  type OrchestrationTaskRun,
} from './orchestration-task-store.ts';

const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const DEFAULT_TOTAL_BUDGET_MS = 300_000;
const DEFAULT_QUERY_TIMEOUT_MS = 20_000;
const DEFAULT_REASONING_TIMEOUT_MS = 200_000;

export interface BorrowCreateInput {
  fromSystem: string;
  requestId: string;
  capability: string;
  systemId: string;
  input: unknown;
}

export interface BorrowCreated {
  orderId: string;
  runId: string | null;
}

export interface BorrowTerminalError {
  code: string;
  message: string;
  stage?: 'dispatch' | 'execution' | 'timeout';
}

export interface BorrowTerminal {
  status: 'completed' | 'failed';
  result?: unknown;
  error?: BorrowTerminalError | null;
}

export interface BorrowExecutionPort {
  create(input: BorrowCreateInput): Promise<BorrowCreated>;
  waitForTerminal(orderId: string, timeoutMs: number, fromSystem: string): Promise<BorrowTerminal>;
}

export class OrchestrationTaskExecutionError extends Error {
  readonly code: string;
  readonly stage: 'dispatch' | 'execution' | 'timeout';

  constructor(code: string, message: string, stage: 'dispatch' | 'execution' | 'timeout') {
    super(message);
    this.name = 'OrchestrationTaskExecutionError';
    this.code = code;
    this.stage = stage;
  }
}

export interface OrchestrationTaskExecutorOptions {
  store: OrchestrationTaskStore;
  borrowPort: BorrowExecutionPort;
  totalBudgetMs?: number;
  queryTimeoutMs?: number;
  reasoningTimeoutMs?: number;
  now?: () => number;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function stepTimeoutMs(capability: string, options: { query: number; reasoning: number }): number {
  return capability.startsWith('reason') ? options.reasoning : options.query;
}

function extractEvidenceRefs(result: unknown): string[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
  const record = result as Record<string, unknown>;
  const value = record.evidence_refs ?? record.evidenceRefs;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 500))
    .slice(0, 100);
}

function extractDataAsOf(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const record = result as Record<string, unknown>;
  const value = record.data_as_of ?? record.dataAsOf;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 64) : null;
}

function errorInfo(code: string, message: string, stepId: number, stage: OrchestrationTaskErrorInfo['stage']): OrchestrationTaskErrorInfo {
  return { code: code.slice(0, 100), message: message.slice(0, 1_000), stepId, stage };
}

function partialReason(completedStepIds: number[], failedStepId: number): string {
  if (!completedStepIds.length) return `step ${failedStepId} 失败`;
  return `step ${failedStepId} 失败，已完成步骤：${completedStepIds.join(', ')}`;
}

export class OrchestrationTaskExecutor {
  private readonly store: OrchestrationTaskStore;
  private readonly borrowPort: BorrowExecutionPort;
  private readonly totalBudgetMs: number;
  private readonly queryTimeoutMs: number;
  private readonly reasoningTimeoutMs: number;
  private readonly now: () => number;

  constructor(options: OrchestrationTaskExecutorOptions) {
    this.store = options.store;
    this.borrowPort = options.borrowPort;
    this.totalBudgetMs = options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
    this.queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    this.reasoningTimeoutMs = options.reasoningTimeoutMs ?? DEFAULT_REASONING_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  /** 后台启动；异常只记录，不向调用方抛出。 */
  startTask(hubTaskId: string): void {
    void this.executeTask(hubTaskId).catch((error) => {
      console.error('[orchestration-task] 执行失败:', (error as Error).message);
    });
  }

  async executeTask(hubTaskId: string): Promise<OrchestrationTaskRecord> {
    const task = this.store.get(hubTaskId);
    if (!task) throw new OrchestrationTaskStoreError('ORCHESTRATION_TASK_NOT_FOUND', `任务不存在：${hubTaskId}`);
    if (TERMINAL_TASK_STATUSES.has(task.status)) return task;
    if (task.status !== 'pending') {
      throw new OrchestrationTaskExecutionError('TASK_ALREADY_RUNNING', `任务已在执行：${hubTaskId}`, 'execution');
    }

    const deadline = this.now() + this.totalBudgetMs;
    const completedStepIds: number[] = [];
    let current = this.store.update(hubTaskId, (value) => ({ ...value, status: 'dispatched' }));

    for (const step of [...current.plan].sort((left, right) => left.stepId - right.stepId)) {
      const remaining = deadline - this.now();
      if (remaining <= 0) {
        return this.failTask(current, step.stepId, errorInfo('TASK_TIMEOUT', `任务超过 ${this.totalBudgetMs}ms 总预算`, step.stepId, 'timeout'), completedStepIds);
      }

      const startedAt = iso(this.now());
      current = this.store.update(hubTaskId, (value) => ({
        ...value,
        status: 'running',
        runs: value.runs.map((run) => run.stepId === step.stepId
          ? { ...run, status: 'dispatched', startedAt }
          : run),
      }));

      let created: BorrowCreated;
      try {
        created = await this.borrowPort.create({
          fromSystem: current.fromSystem,
          requestId: `${current.taskId}:${step.stepId}`,
          capability: step.capability,
          systemId: step.systemId,
          input: step.input,
        });
      } catch (error) {
        const mapped = error instanceof OrchestrationTaskExecutionError
          ? error
          : new OrchestrationTaskExecutionError('DISPATCH_FAILED', (error as Error).message || '派单失败', 'dispatch');
        return this.failTask(current, step.stepId, errorInfo(mapped.code, mapped.message, step.stepId, 'dispatch'), completedStepIds);
      }

      current = this.store.update(hubTaskId, (value) => ({
        ...value,
        runs: value.runs.map((run) => run.stepId === step.stepId
          ? { ...run, status: 'running', runId: created.runId, borrowOrderId: created.orderId }
          : run),
      }));

      let terminal: BorrowTerminal;
      try {
        terminal = await this.borrowPort.waitForTerminal(
          created.orderId,
          Math.max(1, Math.min(stepTimeoutMs(step.capability, {
            query: this.queryTimeoutMs,
            reasoning: this.reasoningTimeoutMs,
          }), remaining)),
          current.fromSystem,
        );
      } catch (error) {
        const mapped = error instanceof OrchestrationTaskExecutionError
          ? error
          : new OrchestrationTaskExecutionError('TASK_TIMEOUT', (error as Error).message || '任务执行超时', 'timeout');
        return this.failTask(current, step.stepId, errorInfo(mapped.code, mapped.message, step.stepId, mapped.stage), completedStepIds);
      }

      if (terminal.status === 'failed') {
        const error = terminal.error;
        return this.failTask(
          current,
          step.stepId,
          errorInfo(error?.code ?? 'EXECUTION_FAILED', error?.message ?? '执行失败', step.stepId, error?.stage ?? 'execution'),
          completedStepIds,
        );
      }

      const capped = capOrchestrationResult(terminal.result ?? null);
      completedStepIds.push(step.stepId);
      current = this.store.update(hubTaskId, (value) => ({
        ...value,
        completedStepIds,
        runs: value.runs.map((run) => run.stepId === step.stepId
          ? {
              ...run,
              status: 'completed',
              endedAt: iso(this.now()),
              result: capped.result,
              resultBytes: capped.resultBytes,
              truncated: capped.truncated,
              evidenceRefs: extractEvidenceRefs(terminal.result),
              dataAsOf: extractDataAsOf(terminal.result),
              error: null,
            }
          : run),
      }));
    }

    return this.store.update(hubTaskId, (value) => ({
      ...value,
      status: 'completed',
      completedStepIds,
      partialReason: null,
      error: null,
      finishedAt: iso(this.now()),
    }));
  }

  private failTask(
    task: OrchestrationTaskRecord,
    stepId: number,
    error: OrchestrationTaskErrorInfo,
    completedStepIds: number[],
  ): OrchestrationTaskRecord {
    return this.store.update(task.hubTaskId, (value) => ({
      ...value,
      status: 'failed',
      completedStepIds,
      partialReason: partialReason(completedStepIds, stepId),
      error,
      finishedAt: iso(this.now()),
      runs: value.runs.map((run) => run.stepId === stepId
        ? {
            ...run,
            status: 'failed',
            endedAt: iso(this.now()),
            error,
          }
        : run),
    }));
  }
}
