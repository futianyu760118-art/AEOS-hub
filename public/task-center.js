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
export const PROJECT_STATUS_LABELS = {
  PLANNING: ['计划中', 'neutral'], IN_PROGRESS: ['进行中', 'warn'], ON_HOLD: ['已搁置', 'danger'], COMPLETED: ['已完成', 'ok'], CANCELLED: ['已取消', 'neutral'],
};
export const PRIORITY_LABELS = {
  urgent: ['紧急', 'danger'], high: ['高', 'warn'], medium: ['中', 'info'], low: ['低', 'neutral'], none: ['无', 'neutral'],
};

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
  const manager = gate.allowed && human && (hasRole(session, 'manager') || hasRole(session, 'supervisor'));
  const operator = gate.allowed && human && hasRole(session, 'operator')
    && task?.currentAssignee?.actorId === session.actorId;
  const verifier = gate.allowed && human && (hasRole(session, 'manager') || hasRole(session, 'supervisor'));
  const policy = taskInteractionPolicy(task);

  return {
    canCreate: manager,
    canAssign: manager && policy.canAssign,
    canAccept: operator && task?.status === 'ASSIGNED',
    canStart: operator && ['ACCEPTED', 'AWAITING_DECISION'].includes(task?.status),
    canSupplementEvidence: operator && policy.canSupplementEvidence,
    canSubmitPendingResult: operator && policy.canSubmitPendingResult,
    canVerify: verifier && policy.canVerify,
    canReject: verifier && policy.canVerify,
    canEscalate: (manager || operator) && policy.canEscalate,
    canRemind: manager && !TERMINAL.has(task?.status) && task?.status !== 'AWAITING_VERIFY',
    canWithdraw: manager && !TERMINAL.has(task?.status) && task?.status !== 'AWAITING_VERIFY',
    canDelete: manager,
    isReadOnly: !gate.allowed || (!manager && !operator && !verifier),
    mutationGate: gate.code,
  };
}

export function canCreateTaskFromCase(session, operatingCase, g0Snapshot = null) {
  return g1TaskUiMutationGate(session, g0Snapshot).allowed
    && (hasRole(session, 'manager') || hasRole(session, 'supervisor'))
    && ['order', 'kitting'].includes(operatingCase?.source)
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

export function projectDisplayState(project, tasks = []) {
  const [label, tone] = PROJECT_STATUS_LABELS[project?.status] || ['未知状态', 'neutral'];
  const projectTasks = tasks.filter((task) => task?.projectId === project?.projectId);
  const completed = projectTasks.filter((task) => task.status === 'COMPLETED').length;
  const progress = project?.progress && Number.isFinite(project.progress.percent)
    ? project.progress : { total: projectTasks.length, completed, percent: projectTasks.length ? Math.round((completed / projectTasks.length) * 100) : 0 };
  const [priorityLabel] = PRIORITY_LABELS[project?.priority] || ['—', 'neutral'];
  return { label, tone, progress, ownerLabel: project?.ownerActorId || '未指定负责人', priorityLabel };
}

export function taskBoardColumns(tasks = []) {
  const columns = [
    ['DRAFT', '待规划'], ['ASSIGNED', '待办'], ['ACCEPTED', '处理中'], ['IN_PROGRESS', '处理中'], ['AWAITING_DECISION', '待决策'], ['AWAITING_VERIFY', '待核验'], ['COMPLETED', '已完成'], ['REJECTED', '已退回'], ['FAILED', '已阻塞'], ['CANCELLED', '已取消'],
  ];
  return columns.map(([status, label]) => ({ status, label, tasks: tasks.filter((task) => task.status === status) }));
}

export function filterCollaborationTasks(tasks = [], filters = {}) {
  const query = String(filters.query || '').trim().toLocaleLowerCase('zh-CN');
  return tasks.filter((task) => {
    if (filters.projectId && task.projectId !== filters.projectId) return false;
    if (filters.status && filters.status !== 'all' && task.status !== filters.status) return false;
    if (filters.assignee && filters.assignee !== 'all' && task.currentAssignee?.actorId !== filters.assignee) return false;
    if (!query) return true;
    return [task.title, task.taskId, task.currentAssignee?.actorId, task.currentAssignee?.role, task.projectId].some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(query));
  });
}

export function buildCollaborationTaskPayload(fields) {
  const title = String(fields?.title ?? '').trim();
  const dueAt = String(fields?.dueAt ?? '').trim();
  if (!title) throw new Error('请填写任务标题。');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) throw new Error('请填写 YYYY-MM-DD 格式的截止日期。');
  const payload = { title, dueAt, priority: String(fields?.priority || 'medium'), projectId: String(fields?.projectId || '').trim() || null, nextAction: String(fields?.nextAction || '').trim() || undefined };
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}
