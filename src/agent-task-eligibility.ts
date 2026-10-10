import { z } from 'zod';
import {
  HarborAgentSchema,
  HarborRuntimeSchema,
  isAgentTaskServiceProfileConfigured,
} from './harbor-store.ts';

const TASK_TYPES = ['operating-case-analysis'] as const;
const USABLE_AGENT_STATUSES = new Set(['idle', 'working']);
const USABLE_RUNTIME_STATUSES = new Set(['ready', 'online', 'busy']);

export const ControlledTaskTypeSchema = z.enum(TASK_TYPES);
export const AgentTaskEligibilityInputSchema = z.object({
  taskId: z.string().trim().min(1).max(160),
  tenantId: z.string().trim().min(1).max(160),
  taskType: ControlledTaskTypeSchema,
  agent: HarborAgentSchema,
  runtime: HarborRuntimeSchema.nullable(),
  evaluatedAt: z.string().datetime({ offset: true }),
}).strict();

export const AgentTaskEligibilityReasonCodeSchema = z.enum([
  'AGENT_PROFILE_UNCONFIGURED',
  'AGENT_LIFECYCLE_NOT_ACTIVE',
  'AGENT_STATUS_UNUSABLE',
  'TENANT_NOT_APPROVED',
  'TASK_TYPE_NOT_APPROVED',
  'RUNTIME_NOT_BOUND',
  'RUNTIME_STATUS_UNUSABLE',
  'RUNTIME_HEALTH_UNVERIFIED',
  'RUNTIME_HEALTH_UNHEALTHY',
  'RUNTIME_HEALTH_STALE',
  'RUNTIME_HEALTH_CLOCK_INVALID',
]);

export type ControlledTaskType = z.infer<typeof ControlledTaskTypeSchema>;
export type AgentTaskEligibilityReasonCode = z.infer<typeof AgentTaskEligibilityReasonCodeSchema>;
export type AgentTaskEligibilityInput = z.infer<typeof AgentTaskEligibilityInputSchema>;

/** M04 tasks are all evidence-bound operating-case analysis tasks until a later dispatch schema adds explicit task types. */
export function controlledTaskTypeForM04Task(_task: { source: string }): ControlledTaskType {
  return 'operating-case-analysis';
}

const REASON_MESSAGES: Record<AgentTaskEligibilityReasonCode, string> = {
  AGENT_PROFILE_UNCONFIGURED: 'Agent 尚未完成任务服务档案配置。',
  AGENT_LIFECYCLE_NOT_ACTIVE: 'Agent 当前不处于已启用生命周期。',
  AGENT_STATUS_UNUSABLE: 'Agent 当前不可用于候选任务。',
  TENANT_NOT_APPROVED: '该 Agent 未获批准处理当前租户的任务。',
  TASK_TYPE_NOT_APPROVED: '该 Agent 未获批准处理当前任务类型。',
  RUNTIME_NOT_BOUND: 'Agent 尚未绑定可验证的 Runtime。',
  RUNTIME_STATUS_UNUSABLE: '绑定的 Runtime 当前不可用。',
  RUNTIME_HEALTH_UNVERIFIED: 'Runtime 尚未完成健康验证。',
  RUNTIME_HEALTH_UNHEALTHY: 'Runtime 最新健康验证未通过。',
  RUNTIME_HEALTH_STALE: 'Runtime 健康验证已超过该 Agent 的数据新鲜度要求。',
  RUNTIME_HEALTH_CLOCK_INVALID: 'Runtime 健康验证时间异常，不能作为接手依据。',
};

export interface AgentTaskEligibilityDecision {
  taskId: string;
  tenantId: string;
  taskType: ControlledTaskType;
  eligible: boolean;
  reasonCodes: AgentTaskEligibilityReasonCode[];
  reasons: string[];
  candidate: {
    agentId: string;
    name: string;
    role: string;
    hierarchyLevel: string;
    lifecycle: string;
    status: string;
    profile: {
      profileVersion: string;
      supportedTaskTypes: string[];
      tenantIds: string[];
      accessMode: 'read_only';
      dataFreshnessMinutes: number;
    };
    runtime: null | {
      id: string;
      name: string;
      status: string;
      lastVerification: null | { status: string; checkedAt: string };
    };
  };
}

function appendReason(reasons: AgentTaskEligibilityReasonCode[], code: AgentTaskEligibilityReasonCode): void {
  if (!reasons.includes(code)) reasons.push(code);
}

/**
 * Performs only a deterministic governance check. It does not persist data,
 * probe a Runtime, dispatch an Agent, or change a task state.
 */
export function evaluateAgentTaskEligibility(rawInput: AgentTaskEligibilityInput): AgentTaskEligibilityDecision {
  const input = AgentTaskEligibilityInputSchema.parse(rawInput);
  const { agent, runtime } = input;
  const profile = agent.registration.taskServiceProfile;
  const reasonCodes: AgentTaskEligibilityReasonCode[] = [];

  if (!isAgentTaskServiceProfileConfigured(profile)) appendReason(reasonCodes, 'AGENT_PROFILE_UNCONFIGURED');
  if (agent.registration.lifecycle !== 'active') appendReason(reasonCodes, 'AGENT_LIFECYCLE_NOT_ACTIVE');
  if (!USABLE_AGENT_STATUSES.has(agent.status)) appendReason(reasonCodes, 'AGENT_STATUS_UNUSABLE');
  if (!profile.tenantIds.includes(input.tenantId)) appendReason(reasonCodes, 'TENANT_NOT_APPROVED');
  if (!profile.supportedTaskTypes.includes(input.taskType)) appendReason(reasonCodes, 'TASK_TYPE_NOT_APPROVED');

  if (!agent.runtimeId || !runtime || runtime.id !== agent.runtimeId) {
    appendReason(reasonCodes, 'RUNTIME_NOT_BOUND');
  } else {
    if (!USABLE_RUNTIME_STATUSES.has(runtime.status)) appendReason(reasonCodes, 'RUNTIME_STATUS_UNUSABLE');
    const verification = runtime.lastVerification;
    if (!verification) {
      appendReason(reasonCodes, 'RUNTIME_HEALTH_UNVERIFIED');
    } else if (verification.status !== 'healthy') {
      appendReason(reasonCodes, 'RUNTIME_HEALTH_UNHEALTHY');
    } else {
      const checkedAt = Date.parse(verification.checkedAt);
      const evaluatedAt = Date.parse(input.evaluatedAt);
      if (checkedAt > evaluatedAt) {
        appendReason(reasonCodes, 'RUNTIME_HEALTH_CLOCK_INVALID');
      } else if (evaluatedAt - checkedAt > profile.dataFreshnessMinutes * 60_000) {
        appendReason(reasonCodes, 'RUNTIME_HEALTH_STALE');
      }
    }
  }

  return {
    taskId: input.taskId,
    tenantId: input.tenantId,
    taskType: input.taskType,
    eligible: reasonCodes.length === 0,
    reasonCodes,
    reasons: reasonCodes.map((code) => REASON_MESSAGES[code]),
    candidate: {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      hierarchyLevel: agent.hierarchyLevel,
      lifecycle: agent.registration.lifecycle,
      status: agent.status,
      profile: {
        profileVersion: profile.profileVersion,
        supportedTaskTypes: [...profile.supportedTaskTypes],
        tenantIds: [...profile.tenantIds],
        accessMode: profile.accessMode,
        dataFreshnessMinutes: profile.dataFreshnessMinutes,
      },
      runtime: runtime ? {
        id: runtime.id,
        name: runtime.name,
        status: runtime.status,
        lastVerification: runtime.lastVerification ? {
          status: runtime.lastVerification.status,
          checkedAt: runtime.lastVerification.checkedAt,
        } : null,
      } : null,
    },
  };
}
