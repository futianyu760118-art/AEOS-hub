export const TASK_ACTIONS = [
  'create', 'assign', 'reassign', 'accept', 'start', 'supplement_evidence', 'submit_result', 'verify', 'reject',
] as const;

export type TaskAction = typeof TASK_ACTIONS[number];
export type TaskAuthorizationActor = {
  actorId: string;
  actorType: 'human' | 'service' | 'agent' | 'system';
  tenantId: string;
  roles: readonly string[];
};
export type TaskAuthorizationTask = {
  tenantId: string;
  currentAssignee: { actorId: string } | null;
};
export type AuthorizationDecision =
  | { allowed: true; code: 'ALLOWED' }
  | { allowed: false; code: 'HUMAN_ACTOR_REQUIRED' | 'TENANT_MISMATCH' | 'TASK_REQUIRED' | 'MANAGER_ROLE_REQUIRED' | 'OPERATOR_ROLE_REQUIRED' | 'OWNER_ROLE_REQUIRED' | 'ASSIGNMENT_REQUIRED' | 'ASSIGNEE_MISMATCH' | 'REGISTERED_OWNER_MISMATCH' };
export type TaskAuthorizationInput = {
  action: TaskAction;
  actor: TaskAuthorizationActor;
  task?: TaskAuthorizationTask | null;
  registeredOwnerActorId?: string | null;
};

const MANAGER_ACTIONS = new Set<TaskAction>(['create', 'assign', 'reassign']);
const OPERATOR_ACTIONS = new Set<TaskAction>(['accept', 'start', 'supplement_evidence', 'submit_result']);
const OWNER_ACTIONS = new Set<TaskAction>(['verify', 'reject']);

/**
 * Pure G1 policy for trusted M01 actor context and a tenant-scoped task.
 * It deliberately performs no storage, audit, or HTTP work so TaskApi can
 * uniformly audit either outcome at its boundary.
 */
export function authorizeTaskAction(input: TaskAuthorizationInput): AuthorizationDecision {
  const { action, actor, task } = input;
  if (actor.actorType !== 'human') return { allowed: false, code: 'HUMAN_ACTOR_REQUIRED' };
  if (task && actor.tenantId !== task.tenantId) return { allowed: false, code: 'TENANT_MISMATCH' };

  if (MANAGER_ACTIONS.has(action)) {
    return actor.roles.includes('manager')
      ? { allowed: true, code: 'ALLOWED' }
      : { allowed: false, code: 'MANAGER_ROLE_REQUIRED' };
  }
  if (!task) return { allowed: false, code: 'TASK_REQUIRED' };

  if (OPERATOR_ACTIONS.has(action)) {
    if (!actor.roles.includes('operator')) return { allowed: false, code: 'OPERATOR_ROLE_REQUIRED' };
    if (!task.currentAssignee) return { allowed: false, code: 'ASSIGNMENT_REQUIRED' };
    return task.currentAssignee.actorId === actor.actorId
      ? { allowed: true, code: 'ALLOWED' }
      : { allowed: false, code: 'ASSIGNEE_MISMATCH' };
  }

  if (OWNER_ACTIONS.has(action)) {
    if (!actor.roles.includes('owner')) return { allowed: false, code: 'OWNER_ROLE_REQUIRED' };
    return input.registeredOwnerActorId?.trim() === actor.actorId
      ? { allowed: true, code: 'ALLOWED' }
      : { allowed: false, code: 'REGISTERED_OWNER_MISMATCH' };
  }

  return { allowed: false, code: 'TASK_REQUIRED' };
}
