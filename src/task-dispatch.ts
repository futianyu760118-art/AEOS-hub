import { controlledTaskTypeForM04Task, evaluateAgentTaskEligibility } from './agent-task-eligibility.ts';
import type { HarborAgent, HarborRuntime } from './harbor-store.ts';

export type DispatchTask = { taskId: string; tenantId: string; source: string };
export type DispatchRecommendation = {
  agentId: string;
  name: string;
  role: string;
  eligible: boolean;
  reasons: string[];
};
export type AgentAssignmentDecision =
  | { allowed: true; code: 'ALLOWED' }
  | { allowed: false; code: 'AGENT_INELIGIBLE' | 'AGENT_NOT_FOUND'; reasons: string[] };

/**
 * Deterministic, read-only candidate ranking. It never calls a model, persists
 * data, or changes a task: it only ranks Harbor agents by their governed
 * eligibility for the task type, tenant, and runtime freshness.
 */
export function recommendTaskAssignees(
  task: DispatchTask,
  agents: readonly HarborAgent[],
  runtimes: readonly HarborRuntime[],
  evaluatedAt: string,
): DispatchRecommendation[] {
  const taskType = controlledTaskTypeForM04Task(task);
  return agents
    .map((agent) => {
      const decision = evaluateAgentTaskEligibility({
        taskId: task.taskId,
        tenantId: task.tenantId,
        taskType,
        agent,
        runtime: agent.runtimeId ? runtimes.find((runtime) => runtime.id === agent.runtimeId) ?? null : null,
        evaluatedAt,
      });
      return { agentId: agent.id, name: agent.name, role: agent.role, eligible: decision.eligible, reasons: decision.reasons };
    })
    .sort((left, right) => Number(right.eligible) - Number(left.eligible)
      || left.name.localeCompare(right.name, 'zh-CN')
      || left.agentId.localeCompare(right.agentId));
}

/**
 * Governed assignment gate: a candidate Agent must pass the same eligibility
 * checks as the recommendation path before it may become a task's assignee.
 */
export function validateAgentAssignment(
  task: DispatchTask,
  agent: HarborAgent | null | undefined,
  runtime: HarborRuntime | null,
  evaluatedAt: string,
): AgentAssignmentDecision {
  if (!agent) return { allowed: false, code: 'AGENT_NOT_FOUND', reasons: ['未找到指定的 Agent。'] };
  const taskType = controlledTaskTypeForM04Task(task);
  const decision = evaluateAgentTaskEligibility({
    taskId: task.taskId,
    tenantId: task.tenantId,
    taskType,
    agent,
    runtime,
    evaluatedAt,
  });
  return decision.eligible
    ? { allowed: true, code: 'ALLOWED' }
    : { allowed: false, code: 'AGENT_INELIGIBLE', reasons: decision.reasons };
}
