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
export const COLLABORATION_ACTIONS = ['project_create', 'project_update', 'project_read', 'task_create_manual', 'task_update_manual', 'task_move'] as const;
export type CollaborationAction = typeof COLLABORATION_ACTIONS[number];
export type CollaborationProject = { tenantId: string; ownerActorId: string; memberActorIds: readonly string[] };
export type CollaborationAuthorizationInput = {
  action: CollaborationAction;
  actor: TaskAuthorizationActor;
  task?: TaskAuthorizationTask | null;
  project?: CollaborationProject | null;
};

const MANAGER_ACTIONS = new Set<TaskAction>(['create', 'assign', 'reassign']);
const OPERATOR_ACTIONS = new Set<TaskAction>(['accept', 'start', 'supplement_evidence', 'submit_result']);
const OWNER_ACTIONS = new Set<TaskAction>(['verify', 'reject']);

function canManageBusiness(roles: readonly string[]): boolean {
  return roles.includes('manager') || roles.includes('supervisor');
}

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
    return canManageBusiness(actor.roles)
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
    if (!canManageBusiness(actor.roles)) return { allowed: false, code: 'MANAGER_ROLE_REQUIRED' };
    return input.registeredOwnerActorId?.trim() === actor.actorId
      ? { allowed: true, code: 'ALLOWED' }
      : { allowed: false, code: 'REGISTERED_OWNER_MISMATCH' };
  }

  return { allowed: false, code: 'TASK_REQUIRED' };
}

/**
 * The project workspace has a wider collaboration surface than controlled G1
 * work, but it retains the same server-trusted identity and tenant boundary.
 */
export function authorizeCollaborationAction(input: CollaborationAuthorizationInput): AuthorizationDecision {
  const { action, actor, task, project } = input;
  if (actor.actorType !== 'human') return { allowed: false, code: 'HUMAN_ACTOR_REQUIRED' };
  if (project && project.tenantId !== actor.tenantId) return { allowed: false, code: 'TENANT_MISMATCH' };
  if (task && task.tenantId !== actor.tenantId) return { allowed: false, code: 'TENANT_MISMATCH' };
  if (action === 'project_read') return { allowed: true, code: 'ALLOWED' };
  if (action === 'project_create' || action === 'task_create_manual' || action === 'task_move') {
    return canManageBusiness(actor.roles) ? { allowed: true, code: 'ALLOWED' } : { allowed: false, code: 'MANAGER_ROLE_REQUIRED' };
  }
  if (action === 'project_update') {
    if (!project) return { allowed: false, code: 'TASK_REQUIRED' };
    return canManageBusiness(actor.roles) || project.ownerActorId === actor.actorId
      ? { allowed: true, code: 'ALLOWED' }
      : { allowed: false, code: 'MANAGER_ROLE_REQUIRED' };
  }
  if (action === 'task_update_manual') {
    if (!task) return { allowed: false, code: 'TASK_REQUIRED' };
    if (canManageBusiness(actor.roles)) return { allowed: true, code: 'ALLOWED' };
    if (!actor.roles.includes('operator')) return { allowed: false, code: 'OPERATOR_ROLE_REQUIRED' };
    if (!task.currentAssignee) return { allowed: false, code: 'ASSIGNMENT_REQUIRED' };
    return task.currentAssignee.actorId === actor.actorId
      ? { allowed: true, code: 'ALLOWED' }
      : { allowed: false, code: 'ASSIGNEE_MISMATCH' };
  }
  return { allowed: false, code: 'TASK_REQUIRED' };
}
