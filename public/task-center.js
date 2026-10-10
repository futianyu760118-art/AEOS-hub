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
