export const TASK_STATUS_LABELS = {
  DRAFT: ['待分派', 'neutral'],
  ASSIGNED: ['待接受', 'info'],
  ACCEPTED: ['已接受', 'info'],
  IN_PROGRESS: ['处理中', 'warn'],
  AWAITING_DECISION: ['待决策', 'warn'],
  AWAITING_VERIFY: ['待业务核验', 'info'],
  COMPLETED: ['已核验完成', 'ok'],
  REJECTED: ['结果退回', 'danger'],
  FAILED: ['处理失败', 'danger'],
  CANCELLED: ['已撤回', 'neutral'],
};

const TERMINAL = new Set(['COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED']);

export function taskDisplayState(task, today) {
  const [label, tone] = TASK_STATUS_LABELS[task?.status] || ['未知状态', 'neutral'];
  const overdue = Boolean(task?.dueAt && today && task.dueAt < today && !TERMINAL.has(task.status));
  const failed = task?.status === 'FAILED';
  return {
    label,
    tone: overdue && tone === 'neutral' ? 'warn' : tone,
    overdue,
    needsAttention: failed || overdue || task?.status === 'AWAITING_DECISION',
    assigneeLabel: task?.currentAssignee?.role || '尚未分派责任角色',
    nextAction: task?.nextAction || '待补充下一步动作',
    awaitingBusinessVerification: task?.status === 'AWAITING_VERIFY',
  };
}

/** Manager controls are deliberately human-decision controls, never business execution controls. */
export function taskInteractionPolicy(task) {
  const status = task?.status;
  return {
    canAssign: !TERMINAL.has(status) && status !== 'AWAITING_VERIFY',
    canTransition: ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_DECISION'].includes(status),
    canSupplementEvidence: !TERMINAL.has(status),
    canEscalate: ['IN_PROGRESS', 'AWAITING_DECISION'].includes(status),
    canSubmitPendingResult: ['IN_PROGRESS', 'AWAITING_DECISION'].includes(status) && !task?.resultId,
    canVerify: status === 'AWAITING_VERIFY' && Boolean(task?.resultId),
    allowsAutomaticBusinessExecution: false,
    allowsAgentSelfVerification: false,
  };
}

function hasRole(session, role) {
  return Array.isArray(session?.roles) && session.roles.includes(role);
}

function isHumanSession(session) {
  return session?.actorType === 'human' && typeof session?.actorId === 'string' && session.actorId.trim().length > 0;
}

/**
 * G0 establishes the only browser-visible scope for G1 mutations. The server
 * remains authoritative, but the UI must not invite requests that are known
 * to fail when its governing decision is unavailable, incomplete, or scoped
 * to a different M01 tenant or organization.
 */
export function g1TaskUiMutationGate(session, snapshot) {
  if (!isHumanSession(session)) return { allowed: false, code: 'HUMAN_ACTOR_REQUIRED' };
  if (!snapshot || typeof snapshot !== 'object') return { allowed: false, code: 'G0_DECISION_UNAVAILABLE' };
  if (snapshot.readyForG1 !== true) return { allowed: false, code: 'G0_NOT_READY' };
  const scope = snapshot.decisions?.scope?.value;
  if (!scope || scope.demoTenantId !== session.tenantId || scope.organizationScope !== session.organizationId) {
    return { allowed: false, code: 'G0_SCOPE_MISMATCH' };
  }
  return { allowed: true, code: 'ALLOWED' };
}

/**
 * Browser-only projection of the G1 policy. This improves the task-center
 * experience, but never replaces the server-side authorization boundary.
 */
export function taskUiCapabilities(task, session, registeredOwnerActorId = '', g0Snapshot = null) {
  const human = isHumanSession(session);
  const gate = g1TaskUiMutationGate(session, g0Snapshot);
  const manager = gate.allowed && human && hasRole(session, 'manager');
  const operator = gate.allowed && human && hasRole(session, 'operator')
    && task?.currentAssignee?.actorId === session.actorId;
  const owner = gate.allowed && human && hasRole(session, 'owner')
    && Boolean(registeredOwnerActorId)
    && registeredOwnerActorId === session.actorId;
  const policy = taskInteractionPolicy(task);

  return {
    canCreate: manager,
    canAssign: manager && policy.canAssign,
    canAccept: operator && task?.status === 'ASSIGNED',
    canStart: operator && ['ACCEPTED', 'AWAITING_DECISION'].includes(task?.status),
    canSupplementEvidence: operator && policy.canSupplementEvidence,
    canSubmitPendingResult: operator && policy.canSubmitPendingResult,
    canVerify: owner && policy.canVerify,
    canReject: owner && policy.canVerify,
    isReadOnly: !gate.allowed || (!manager && !operator && !owner),
    mutationGate: gate.code,
  };
}

export function canCreateTaskFromCase(session, operatingCase, g0Snapshot = null) {
  return g1TaskUiMutationGate(session, g0Snapshot).allowed
    && hasRole(session, 'manager')
    && operatingCase?.source === 'order'
    && Array.isArray(operatingCase.evidenceRefs)
    && operatingCase.evidenceRefs.length > 0;
}

/** Keeps browser identity claims out of assignment requests. */
export function buildTaskAssignmentPayload(fields) {
  const assigneeRole = String(fields?.assigneeRole ?? '').trim();
  const assigneeActorId = String(fields?.assigneeActorId ?? '').trim();
  const reason = String(fields?.reason ?? '').trim();
  if (!assigneeRole) throw new Error('请填写责任角色。');
  if (!assigneeActorId) throw new Error('请填写目标 M01 actor ID。');
  if (!reason) throw new Error('请填写分派说明。');
  return { assigneeRole, assigneeActorId, reason };
}
