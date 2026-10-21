// 跨系统任务交接系统 API：系统令牌鉴权 + POST/GET + 202/200/错误映射。
import { verifySystemToken } from './system-token.ts';
import type { EvidenceInput } from './evidence.ts';
import {
  OrchestrationTaskService,
  OrchestrationTaskServiceError,
  type CreateOrchestrationTaskResult,
} from './orchestration-task-service.ts';
import {
  OrchestrationTaskStore,
  OrchestrationTaskStoreError,
  type OrchestrationTaskRecord,
} from './orchestration-task-store.ts';

export interface OrchestrationTaskApiRequest {
  method?: string;
  pathname: string;
  systemId: string;
  token: string;
  body?: Record<string, unknown>;
  bodyParseFailed?: boolean;
  query?: URLSearchParams;
}

export type OrchestrationTaskApiResponse = { status: number; body: Record<string, unknown> };

const PATH_PREFIX = '/api/system/orchestration-tasks';

function taskView(task: OrchestrationTaskRecord): Record<string, unknown> {
  return {
    hubTaskId: task.hubTaskId,
    taskId: task.taskId,
    conversationId: task.conversationId,
    turn: task.turn,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    finishedAt: task.finishedAt,
    runs: task.runs.map((run) => ({
      stepId: run.stepId,
      systemId: run.systemId,
      capability: run.capability,
      status: run.status,
      runId: run.runId,
      borrowOrderId: run.borrowOrderId,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      result: run.result,
      resultBytes: run.resultBytes,
      truncated: run.truncated,
      evidenceRefs: run.evidenceRefs,
      dataAsOf: run.dataAsOf,
      error: run.error,
    })),
    completedStepIds: task.completedStepIds,
    partialReason: task.partialReason,
    error: task.error,
  };
}

function createView(task: OrchestrationTaskRecord): Record<string, unknown> {
  return {
    hubTaskId: task.hubTaskId,
    taskId: task.taskId,
    status: task.status,
    createdAt: task.createdAt,
    runs: task.runs.map((run) => ({
      stepId: run.stepId,
      systemId: run.systemId,
      capability: run.capability,
      status: run.status,
      runId: run.runId,
      borrowOrderId: run.borrowOrderId,
    })),
  };
}

export class OrchestrationTaskApi {
  private readonly rootSecret: string;
  private readonly enabled: boolean;
  private readonly service: Pick<OrchestrationTaskService, 'create'>;
  private readonly store: Pick<OrchestrationTaskStore, 'get'>;
  private readonly executor: { startTask(hubTaskId: string): void };
  private readonly appendEvidence: ((input: EvidenceInput) => unknown) | undefined;

  constructor(dependencies: {
    rootSecret: string;
    enabled: boolean;
    service: Pick<OrchestrationTaskService, 'create'>;
    store: Pick<OrchestrationTaskStore, 'get'>;
    executor: { startTask(hubTaskId: string): void };
    appendEvidence?: (input: EvidenceInput) => unknown;
  }) {
    this.rootSecret = dependencies.rootSecret;
    this.enabled = dependencies.enabled;
    this.service = dependencies.service;
    this.store = dependencies.store;
    this.executor = dependencies.executor;
    this.appendEvidence = dependencies.appendEvidence;
  }

  handle(request: OrchestrationTaskApiRequest): OrchestrationTaskApiResponse | null {
    if (!request.pathname.startsWith(PATH_PREFIX)) return null;
    if (!this.enabled || !this.rootSecret) {
      return { status: 503, body: { error: 'orchestration task plane is not configured', code: 'NOT_CONFIGURED' } };
    }
    const systemId = request.systemId.trim();
    if (!systemId || !request.token || !verifySystemToken(this.rootSecret, systemId, request.token)) {
      this.auditDenied(systemId, request);
      return { status: 401, body: { error: 'authentication required', code: 'AUTH_REQUIRED' } };
    }
    if (request.bodyParseFailed) {
      return { status: 400, body: { error: 'invalid orchestration-task request', code: 'INVALID_ARGUMENT' } };
    }

    try {
      if (request.pathname === PATH_PREFIX) {
        if (request.method === 'POST') return this.create(request, systemId);
        return { status: 405, body: { error: 'method not allowed' } };
      }
      const detail = request.pathname.match(/^\/api\/system\/orchestration-tasks\/([^/]+)$/);
      if (detail) {
        if (request.method !== 'GET') return { status: 405, body: { error: 'method not allowed' } };
        return this.get(systemId, decodeURIComponent(detail[1] ?? '').trim());
      }
      return { status: 404, body: { error: 'orchestration-task endpoint not found' } };
    } catch (error) {
      if (error instanceof OrchestrationTaskServiceError) {
        return { status: error.httpStatus, body: { error: error.message, code: error.code, ...(error.details ?? {}) } };
      }
      if (error instanceof OrchestrationTaskStoreError) {
        const status = error.code === 'ORCHESTRATION_TASK_NOT_FOUND' ? 404 : error.code === 'ORCHESTRATION_TASK_CAPACITY_EXCEEDED' ? 503 : 400;
        return { status, body: { error: error.message, code: error.code } };
      }
      return { status: 500, body: { error: (error as Error).message || 'orchestration task error', code: 'INTERNAL_ERROR' } };
    }
  }

  private create(request: OrchestrationTaskApiRequest, systemId: string): OrchestrationTaskApiResponse {
    const result: CreateOrchestrationTaskResult = this.service.create(systemId, request.body ?? {});
    if (result.task.status === 'pending') this.executor.startTask(result.task.hubTaskId);
    return {
      status: result.idempotent ? 200 : 202,
      body: {
        ...createView(result.task),
        idempotent: result.idempotent,
      },
    };
  }

  private get(systemId: string, hubTaskId: string): OrchestrationTaskApiResponse {
    if (!hubTaskId) return { status: 400, body: { error: 'hubTaskId 无效', code: 'INVALID_ARGUMENT' } };
    const task = this.store.get(hubTaskId);
    if (!task || task.fromSystem !== systemId) {
      return { status: 404, body: { error: '任务不存在或无权查看', code: 'TASK_NOT_FOUND' } };
    }
    return { status: 200, body: taskView(task) };
  }

  private auditDenied(systemId: string, request: OrchestrationTaskApiRequest): void {
    if (!this.appendEvidence) return;
    try {
      this.appendEvidence({
        kind: 'app_event',
        actor_id: `execution-token:system:${systemId || 'unknown'}`,
        actor_type: 'system',
        object_ref: 'hub://system/orchestration-task',
        source_system: systemId || 'unknown',
        correlation_id: 'orchestration-task-denied',
        summary: 'orchestration task denied',
        payload: { method: request.method ?? null, pathname: request.pathname, reason: 'auth_required' },
      });
    } catch {
      // 审计失败不阻断鉴权拒绝。
    }
  }
}
