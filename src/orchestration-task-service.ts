// 跨系统任务交接服务：请求校验、能力预检、幂等与任务创建。
// 本阶段只创建 pending 任务，不派单；派单在后续执行服务中接入。
import { z } from 'zod';
import type { ExecutionAgentRecord, ExecutionPlaneRegistry } from './execution-plane.ts';
import { isBorrowCapabilityAllowed } from './borrow-policy.ts';
import { listSystems } from './system-registry.ts';
import { DEFAULT_TENANT_ID } from './tenant-registry.ts';
import { validateAgainstSchema, type Schema } from './schema-validation.ts';
import {
  OrchestrationContextSchema,
  OrchestrationConstraintsSchema,
  OrchestrationPlanStepSchema,
  OrchestrationTaskStore,
  OrchestrationTaskStoreError,
  ORCHESTRATION_TASK_MAX_STEPS,
  orchestrationRequestHash,
  type OrchestrationTaskRecord,
  type OrchestrationPlanStep,
} from './orchestration-task-store.ts';

const DEFAULT_OPEN_TASK_LIMIT = 50;
const CONTEXT_MAX_BYTES = 8 * 1024;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const BUSINESS_OBJECT_REF = /^business:\/\/(order|product|batch)\/[^\s]+$/;

const createBodySchema = z.object({
  taskId: z.string().trim().min(1).max(160),
  conversationId: z.string().trim().min(1).max(160),
  turn: z.number().int().positive(),
  plan: z.array(OrchestrationPlanStepSchema).min(1).max(ORCHESTRATION_TASK_MAX_STEPS),
  context: OrchestrationContextSchema,
  constraints: OrchestrationConstraintsSchema,
}).strict();

export class OrchestrationTaskServiceError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, httpStatus: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'OrchestrationTaskServiceError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export interface OrchestrationTaskServiceOptions {
  store: OrchestrationTaskStore;
  executionPlane: Pick<ExecutionPlaneRegistry, 'list'>;
  tenantId?: string;
  openTaskLimit?: number;
}

export interface CreateOrchestrationTaskResult {
  task: OrchestrationTaskRecord;
  idempotent: boolean;
}

function canonicalSystemId(systemId: string): string {
  const value = systemId.trim();
  const system = listSystems().find((candidate) => candidate.systemId === value
    || candidate.sourceSystemAliases.includes(value));
  return system?.systemId ?? value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function invalid(message: string, details?: Record<string, unknown>): never {
  throw new OrchestrationTaskServiceError('INVALID_ARGUMENT', 400, message, details);
}

function normalizeBody(body: Record<string, unknown>) {
  const parsed = createBodySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    invalid(issue ? `${issue.path.join('.') || 'body'}：${issue.message}` : '请求体不合法', {
      path: issue?.path ?? [],
    });
  }
  return parsed.data;
}

function validatePlanShape(plan: OrchestrationPlanStep[], constraints: { maxSteps: number }): void {
  if (plan.length > constraints.maxSteps) {
    invalid(`plan 步骤数 ${plan.length} 超过 maxSteps ${constraints.maxSteps}`, { maxSteps: constraints.maxSteps });
  }
  const seen = new Set<number>();
  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    const expected = index + 1;
    if (step.stepId !== expected) {
      invalid(`stepId 必须从 1 连续递增：期望 ${expected}，实际 ${step.stepId}`, { stepId: step.stepId });
    }
    if (seen.has(step.stepId)) invalid(`stepId 重复：${step.stepId}`, { stepId: step.stepId });
    seen.add(step.stepId);
    if (!isPlainObject(step.input)) {
      invalid(`step ${step.stepId} 的 input 必须是对象`, { stepId: step.stepId });
    }
  }
}

function validateBusinessObjectRef(value: string): void {
  if (value && !BUSINESS_OBJECT_REF.test(value)) {
    invalid('context.businessObjectRef 必须符合 business://<order|product|batch>/<键>', { field: 'context.businessObjectRef' });
  }
}

function candidateAgents(
  agents: ExecutionAgentRecord[],
  step: OrchestrationPlanStep,
  canonicalTarget: string,
): ExecutionAgentRecord[] {
  return agents.filter((agent) => {
    if (agent.deregisteredAt) return false;
    if (canonicalSystemId(agent.systemId ?? agent.sourceSystem) !== canonicalTarget) return false;
    return agent.capabilities.some((capability) => capability.name === step.capability);
  });
}

export class OrchestrationTaskService {
  private readonly store: OrchestrationTaskStore;
  private readonly executionPlane: Pick<ExecutionPlaneRegistry, 'list'>;
  private readonly tenantId: string;
  private readonly openTaskLimit: number;

  constructor(options: OrchestrationTaskServiceOptions) {
    this.store = options.store;
    this.executionPlane = options.executionPlane;
    this.tenantId = options.tenantId?.trim() || DEFAULT_TENANT_ID;
    this.openTaskLimit = options.openTaskLimit ?? DEFAULT_OPEN_TASK_LIMIT;
  }

  create(fromSystemInput: string, body: Record<string, unknown>): CreateOrchestrationTaskResult {
    const fromSystem = canonicalSystemId(fromSystemInput);
    if (!fromSystem) invalid('fromSystem 不能为空');
    const parsed = normalizeBody(body);

    const requestHash = orchestrationRequestHash(parsed);
    const existing = this.store.findByTaskId(fromSystem, parsed.taskId);
    if (existing) {
      if (existing.requestHash === requestHash) return { task: existing, idempotent: true };
      throw new OrchestrationTaskServiceError('TASK_CONFLICT', 409, '同一 taskId 的请求体不一致', {
        existingHubTaskId: existing.hubTaskId,
      });
    }

    validatePlanShape(parsed.plan, parsed.constraints);
    if (byteLength(parsed.context) > CONTEXT_MAX_BYTES) {
      invalid(`context 超过 ${CONTEXT_MAX_BYTES} 字节`, { field: 'context' });
    }
    validateBusinessObjectRef(parsed.context.businessObjectRef);

    const normalizedPlan: OrchestrationPlanStep[] = [];
    for (const step of parsed.plan) {
      const targetSystem = canonicalSystemId(step.systemId);
      if (targetSystem === fromSystem) {
        throw new OrchestrationTaskServiceError(
          'SAME_SYSTEM_STEP_FORBIDDEN',
          403,
          `plan 第 ${step.stepId} 步目标系统不能是请求方系统 ${fromSystem}`,
          { stepId: step.stepId, systemId: targetSystem },
        );
      }

      const agents = this.executionPlane.list().agents;
      const allProviders = agents.filter((agent) => !agent.deregisteredAt
        && agent.capabilities.some((capability) => capability.name === step.capability));
      if (!allProviders.length) {
        throw new OrchestrationTaskServiceError(
          'CAPABILITY_NOT_FOUND',
          404,
          `能力 ${step.capability} 未在 Hub 登记`,
          { stepId: step.stepId, capability: step.capability },
        );
      }

      const candidates = candidateAgents(agents, step, targetSystem);
      if (!candidates.length) {
        throw new OrchestrationTaskServiceError(
          'NO_PROVIDER',
          409,
          `能力 ${step.capability} 在系统 ${targetSystem} 没有可用提供方`,
          { stepId: step.stepId, reasons: ['capability_missing_or_offline'] },
        );
      }

      const capabilityRecords = candidates.map((agent) => ({
        agent,
        capability: agent.capabilities.find((capability) => capability.name === step.capability)!,
      }));
      const readOnly = capabilityRecords.filter(({ capability }) => capability.constraints?.readOnly === true);
      if (!readOnly.length) {
        throw new OrchestrationTaskServiceError(
          'WRITE_FORBIDDEN',
          403,
          `能力 ${step.capability} 不是只读能力`,
          { stepId: step.stepId, capability: step.capability },
        );
      }

      const online = readOnly.filter(({ agent }) => agent.connectionStatus === 'online' && !agent.deregisteredAt);
      const allowed = online.filter(({ agent }) => isBorrowCapabilityAllowed(
        canonicalSystemId(agent.systemId ?? agent.sourceSystem),
        step.capability,
      ));
      if (!allowed.length) {
        throw new OrchestrationTaskServiceError(
          'NO_PROVIDER',
          409,
          `能力 ${step.capability} 当前没有可借调的在线只读提供方`,
          {
            stepId: step.stepId,
            reasons: online.length ? ['capability_not_allowed_for_borrow'] : ['offline'],
          },
        );
      }

      const schemaSource = allowed.find(({ capability }) => capability.inputSchema !== undefined);
      if (schemaSource?.capability.inputSchema) {
        const issue = validateAgainstSchema(step.input, schemaSource.capability.inputSchema as Schema);
        if (issue) {
          invalid(`step ${step.stepId} 的 input 不符合 ${step.capability} schema：${issue}`, {
            stepId: step.stepId,
            field: 'plan.input',
          });
        }
      }

      normalizedPlan.push({ ...step, systemId: targetSystem });
    }

    const open = this.store.list({ fromSystem, limit: 1_000 })
      .filter((task) => !TERMINAL_STATUSES.has(task.status));
    if (open.length >= this.openTaskLimit) {
      throw new OrchestrationTaskServiceError(
        'TOO_MANY_OPEN_TASKS',
        429,
        `系统 ${fromSystem} 未完成任务已达到上限 ${this.openTaskLimit}`,
        { openTaskLimit: this.openTaskLimit },
      );
    }

    try {
      const task = this.store.create({
        tenantId: this.tenantId,
        fromSystem,
        taskId: parsed.taskId,
        requestHash,
        conversationId: parsed.conversationId,
        turn: parsed.turn,
        plan: normalizedPlan,
        context: parsed.context,
        constraints: parsed.constraints,
      });
      return { task, idempotent: false };
    } catch (error) {
      if (error instanceof OrchestrationTaskStoreError) {
        const status = error.code === 'ORCHESTRATION_TASK_CAPACITY_EXCEEDED' ? 503 : 400;
        throw new OrchestrationTaskServiceError(error.code, status, error.message);
      }
      throw error;
    }
  }
}
