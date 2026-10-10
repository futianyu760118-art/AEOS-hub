import type { EvidenceInput } from './evidence.ts';
import { controlledTaskTypeForM04Task, evaluateAgentTaskEligibility } from './agent-task-eligibility.ts';
import { loadHarbor, type HarborSnapshot } from './harbor-store.ts';
import { OperatingCenterStore, type OperatingCase, type OperatingResult } from './operating-center.ts';
import { TaskCenterStore, type TaskCenterSnapshot, type TaskRecord } from './task-center.ts';

export type TaskApiActor = {
  actorId: string;
  actorType: 'human' | 'service' | 'agent' | 'system';
  tenantId: string;
};
export type TaskApiResponse = { status: number; body: Record<string, unknown> };
type TaskApiRequest = {
  method: string | undefined;
  pathname: string;
  actor: TaskApiActor | null;
  body?: Record<string, unknown>;
};
type TaskApiDependencies = {
  operatingCenter: Pick<OperatingCenterStore, 'load' | 'createPendingResult' | 'verifyResult'>;
  taskCenter: TaskCenterStore;
  appendEvidence: (input: EvidenceInput) => unknown;
  loadHarbor?: () => HarborSnapshot;
  now?: () => Date;
};

class TaskApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function decoded(value: string): string {
  try { return decodeURIComponent(value).trim(); } catch { throw new TaskApiError(400, '路径标识无效'); }
}
function bodyValue(body: Record<string, unknown>, key: string): unknown { return body[key]; }
function isBlockedVerifier(actor: TaskApiActor): boolean {
  return actor.actorType === 'agent' || actor.actorType === 'system' || /^(agent|system):/i.test(actor.actorId);
}

/**
 * Narrow HTTP-neutral task boundary. The server supplies the authenticated
 * actor; callers may supply task content but can never choose who performed
 * the action. Keeping this separately testable avoids importing the web server
 * (which starts a listener) into API contract tests.
 */
export class TaskApi {
  private readonly dependencies: TaskApiDependencies;

  constructor(dependencies: TaskApiDependencies) {
    this.dependencies = dependencies;
  }

  handle(request: TaskApiRequest): TaskApiResponse | null {
    if (!this.isTaskRoute(request.pathname)) return null;
    if (!request.actor) return { status: 401, body: { error: 'authentication required' } };
    try {
      return this.handleAuthorized({ ...request, actor: request.actor, body: request.body ?? {} });
    } catch (error) {
      const status = error instanceof TaskApiError ? error.status : 400;
      return { status, body: { error: (error as Error).message } };
    }
  }

  private isTaskRoute(pathname: string): boolean {
    return pathname === '/api/tasks' || pathname.startsWith('/api/tasks/')
      || /^\/api\/operating-cases\/[^/]+\/tasks$/.test(pathname);
  }

  private handleAuthorized(request: TaskApiRequest & { actor: TaskApiActor; body: Record<string, unknown> }): TaskApiResponse {
    const { method, pathname, actor, body } = request;
    const createMatch = pathname.match(/^\/api\/operating-cases\/([^/]+)\/tasks$/);
    if (createMatch) {
      this.method(method, 'POST');
      const operatingCase = this.requireCase(decoded(createMatch[1] ?? ''));
      if (!operatingCase.evidenceRefs.length) throw new TaskApiError(422, '经营事项缺少证据上下文，不能创建任务');
      const existed = this.dependencies.taskCenter.load().tasks.find((task) => task.caseId === operatingCase.id && task.tenantId === actor.tenantId && !['COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED'].includes(task.status));
      const task = this.dependencies.taskCenter.createFromOperatingCase({
        caseId: operatingCase.id,
        source: operatingCase.source,
        entityId: operatingCase.entityId,
        title: operatingCase.title,
        evidenceRefs: operatingCase.evidenceRefs,
        ownerRole: operatingCase.ownerRole,
        priority: bodyValue(body, 'priority') ?? 'medium',
        dueAt: operatingCase.dueAt,
        actor: actor.actorId,
        tenantId: actor.tenantId,
        correlationId: operatingCase.id,
        reason: bodyValue(body, 'reason'),
      });
      this.audit(task, actor, existed ? 'task_create_replayed' : 'task_created');
      return { status: existed ? 200 : 201, body: { task } };
    }

    if (pathname === '/api/tasks') {
      this.method(method, 'GET');
      const snapshot = this.tenantSnapshot(actor);
      return { status: 200, body: { tasks: snapshot.tasks.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), total: snapshot.tasks.length } };
    }

    const detailMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (detailMatch) {
      this.method(method, 'GET');
      const task = this.requireTask(decoded(detailMatch[1] ?? ''), actor);
      const history = this.dependencies.taskCenter.load().history.filter((entry) => entry.taskId === task.taskId);
      return { status: 200, body: { task, history } };
    }

    const candidatesMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/agent-candidates$/);
    if (candidatesMatch) {
      this.method(method, 'GET');
      const task = this.requireTask(decoded(candidatesMatch[1] ?? ''), actor);
      const harbor = (this.dependencies.loadHarbor ?? loadHarbor)();
      const taskType = controlledTaskTypeForM04Task(task);
      const evaluatedAt = (this.dependencies.now ?? (() => new Date()))().toISOString();
      const candidates = harbor.agents
        .map((agent) => evaluateAgentTaskEligibility({
          taskId: task.taskId,
          tenantId: task.tenantId,
          taskType,
          agent,
          runtime: agent.runtimeId ? harbor.runtimes.find((runtime) => runtime.id === agent.runtimeId) ?? null : null,
          evaluatedAt,
        }))
        .sort((left, right) => Number(right.eligible) - Number(left.eligible) || left.candidate.name.localeCompare(right.candidate.name, 'zh-CN'));
      return {
        status: 200,
        body: {
          taskId: task.taskId,
          taskType,
          dispatchEnabled: false,
          candidates,
        },
      };
    }

    const assignmentMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/assignments$/);
    if (assignmentMatch) {
      this.method(method, 'POST');
      const task = this.requireTask(decoded(assignmentMatch[1] ?? ''), actor);
      const updated = this.dependencies.taskCenter.assign({ taskId: task.taskId, assigneeRole: bodyValue(body, 'assigneeRole'), reason: bodyValue(body, 'reason'), actor: actor.actorId });
      this.audit(updated, actor, task.currentAssignee ? 'task_reassigned' : 'task_assigned');
      return { status: 200, body: { task: updated } };
    }

    const transitionMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/transitions$/);
    if (transitionMatch) {
      this.method(method, 'POST');
      const task = this.requireTask(decoded(transitionMatch[1] ?? ''), actor);
      const updated = this.dependencies.taskCenter.transition({ taskId: task.taskId, toStatus: bodyValue(body, 'toStatus'), reason: bodyValue(body, 'reason'), nextAction: bodyValue(body, 'nextAction'), actor: actor.actorId });
      this.audit(updated, actor, 'task_transitioned');
      return { status: 200, body: { task: updated } };
    }

    const evidenceMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/evidence$/);
    if (evidenceMatch) {
      this.method(method, 'POST');
      const task = this.requireTask(decoded(evidenceMatch[1] ?? ''), actor);
      const updated = this.dependencies.taskCenter.supplementEvidence({ taskId: task.taskId, evidenceRefs: bodyValue(body, 'evidenceRefs'), reason: bodyValue(body, 'reason'), actor: actor.actorId });
      this.audit(updated, actor, 'task_evidence_supplemented');
      return { status: 200, body: { task: updated } };
    }

    const escalationMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/escalations$/);
    if (escalationMatch) {
      this.method(method, 'POST');
      const task = this.requireTask(decoded(escalationMatch[1] ?? ''), actor);
      const updated = this.dependencies.taskCenter.escalate({ taskId: task.taskId, reason: bodyValue(body, 'reason'), nextAction: bodyValue(body, 'nextAction'), actor: actor.actorId });
      this.audit(updated, actor, 'task_escalated');
      return { status: 200, body: { task: updated } };
    }

    const resultMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/results$/);
    if (resultMatch) {
      this.method(method, 'POST');
      const task = this.requireTask(decoded(resultMatch[1] ?? ''), actor);
      if (!['IN_PROGRESS', 'AWAITING_DECISION'].includes(task.status) || task.resultId) {
        throw new TaskApiError(409, '任务未处于可提交 Result 的处理状态');
      }
      const operatingCase = this.requireCase(task.caseId);
      const result = this.dependencies.operatingCenter.createPendingResult({
        caseId: operatingCase.id,
        resultType: bodyValue(body, 'resultType'),
        summary: bodyValue(body, 'summary'),
        actor: actor.actorId,
        tenantId: actor.tenantId,
      });
      const updated = this.dependencies.taskCenter.recordPendingResult({
        taskId: task.taskId,
        resultId: result.result_id,
        actor: actor.actorId,
        reason: bodyValue(body, 'reason') ?? '已提交结果，等待业务 Owner 核验',
        evidenceRefs: result.evidence_refs,
      });
      this.audit(updated, actor, 'task_result_submitted', result.result_id);
      return { status: 201, body: { task: updated, result } };
    }

    const verifyMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/results\/([^/]+)\/verify$/);
    if (verifyMatch) {
      this.method(method, 'POST');
      if (isBlockedVerifier(actor)) throw new TaskApiError(403, 'Agent 或系统身份不能核验业务 Result');
      const task = this.requireTask(decoded(verifyMatch[1] ?? ''), actor);
      const resultId = decoded(verifyMatch[2] ?? '');
      if (task.status !== 'AWAITING_VERIFY' || task.resultId !== resultId) {
        throw new TaskApiError(409, '任务未处于该 Result 的待核验状态');
      }
      const existing = this.dependencies.operatingCenter.load().results.find((result) => result.result_id === resultId && result.case_id === task.caseId);
      if (!existing) throw new TaskApiError(404, '待核验 Result 不存在或不属于该任务');
      if (existing.status !== 'PENDING') throw new TaskApiError(409, `Result 已处于 ${existing.status} 状态`);
      const outcome = bodyValue(body, 'outcome');
      const reason = bodyValue(body, 'reason');
      const verified = this.dependencies.operatingCenter.verifyResult({ resultId, outcome, actor: actor.actorId, note: reason });
      const updated = this.dependencies.taskCenter.verifyResult({ taskId: task.taskId, resultId, outcome, actor: actor.actorId, reason });
      this.audit(updated, actor, outcome === 'VERIFIED' ? 'task_result_verified' : 'task_result_rejected', resultId);
      return { status: 200, body: { task: updated, result: verified } };
    }

    throw new TaskApiError(404, 'task endpoint not found');
  }

  private method(actual: string | undefined, expected: string): void {
    if (actual !== expected) throw new TaskApiError(405, 'method not allowed');
  }

  private requireCase(caseId: string): OperatingCase {
    const item = this.dependencies.operatingCenter.load().cases.find((candidate) => candidate.id === caseId);
    if (!item) throw new TaskApiError(404, '经营事项不存在');
    return item;
  }

  private tenantSnapshot(actor: TaskApiActor): TaskCenterSnapshot {
    const snapshot = this.dependencies.taskCenter.load();
    return { ...snapshot, tasks: snapshot.tasks.filter((task) => task.tenantId === actor.tenantId) };
  }

  private requireTask(taskId: string, actor: TaskApiActor): TaskRecord {
    const task = this.dependencies.taskCenter.load().tasks.find((candidate) => candidate.taskId === taskId && candidate.tenantId === actor.tenantId);
    if (!task) throw new TaskApiError(404, '任务不存在');
    return task;
  }

  private audit(task: TaskRecord, actor: TaskApiActor, action: string, resultId?: string): void {
    this.dependencies.appendEvidence({
      kind: 'app_event',
      actor_id: actor.actorId,
      actor_type: actor.actorType,
      tenant_id: task.tenantId,
      object_ref: task.businessObjectRef,
      correlation_id: task.correlationId,
      evidence_refs: task.evidenceRefs,
      summary: `task ${action}`,
      payload: {
        action,
        taskId: task.taskId,
        caseId: task.caseId,
        status: task.status,
        ...(resultId ? { resultId } : {}),
      },
    });
  }
}
