import { existsSync, readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { atomicWrite } from './atomic-file.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const taskCenterFile = join(root, 'data', 'task-center.json');
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const TASK_STATUSES = [
  'DRAFT', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_DECISION',
  'AWAITING_VERIFY', 'COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED',
] as const;
const TASK_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
const TASK_EVENT_TYPES = [
  'created', 'assigned', 'reassigned', 'accepted', 'started', 'decision_requested',
  'result_submitted', 'verified', 'rejected', 'failed', 'cancelled', 'withdrawn',
  'evidence_supplemented', 'escalated', 'reminded',
] as const;
const TERMINAL_STATUSES = new Set(['COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED']);
const timestamp = z.string().datetime({ offset: true });
const text = (max: number, min = 0) => z.string().trim().min(min).max(max);
const evidenceRefs = z.array(text(500, 1)).min(1).max(40);
const dueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期必须使用 YYYY-MM-DD 格式');

export const TaskStatusSchema = z.enum(TASK_STATUSES);
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES);
export const TaskAssigneeSchema = z.object({
  kind: z.literal('responsibility_role'),
  role: text(160, 1),
  assignedAt: timestamp,
}).strict();
export const TaskRecordSchema = z.object({
  taskId: text(160, 1),
  tenantId: text(160, 1),
  businessObjectRef: text(500, 1),
  caseId: text(160, 1),
  source: text(80, 1),
  title: text(300, 1),
  evidenceRefs,
  priority: TaskPrioritySchema,
  dueAt: dueDate,
  initiatedBy: text(160, 1),
  currentAssignee: TaskAssigneeSchema.nullable(),
  status: TaskStatusSchema,
  correlationId: text(200, 1),
  nextAction: text(500),
  resultId: text(160, 1).nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();
export const TaskHistoryEntrySchema = z.object({
  eventId: text(160, 1),
  taskId: text(160, 1),
  eventType: z.enum(TASK_EVENT_TYPES),
  fromStatus: TaskStatusSchema.nullable(),
  toStatus: TaskStatusSchema,
  actor: text(160, 1),
  reason: text(1_000, 1),
  evidenceRefs,
  occurredAt: timestamp,
}).strict();
export const TaskCenterSnapshotSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  updatedAt: timestamp,
  tasks: z.array(TaskRecordSchema).max(10_000),
  history: z.array(TaskHistoryEntrySchema).max(100_000),
}).strict().superRefine((snapshot, ctx) => {
  const taskIds = new Set<string>();
  snapshot.tasks.forEach((task, index) => {
    if (taskIds.has(task.taskId)) {
      ctx.addIssue({ code: 'custom', path: ['tasks', index, 'taskId'], message: '任务 ID 不能重复' });
    }
    taskIds.add(task.taskId);
    if (task.status !== 'DRAFT' && task.status !== 'CANCELLED' && !task.currentAssignee) {
      ctx.addIssue({ code: 'custom', path: ['tasks', index, 'currentAssignee'], message: '已分派及后续状态必须保留当前责任角色' });
    }
    if (Date.parse(task.updatedAt) < Date.parse(task.createdAt)) {
      ctx.addIssue({ code: 'custom', path: ['tasks', index, 'updatedAt'], message: 'updatedAt 不能早于 createdAt' });
    }
  });
  snapshot.history.forEach((entry, index) => {
    if (!taskIds.has(entry.taskId)) {
      ctx.addIssue({ code: 'custom', path: ['history', index, 'taskId'], message: '历史记录引用的任务不存在' });
    }
  });
});

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskRecord = z.infer<typeof TaskRecordSchema>;
export type TaskHistoryEntry = z.infer<typeof TaskHistoryEntrySchema>;
export type TaskCenterSnapshot = z.infer<typeof TaskCenterSnapshotSchema>;

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  DRAFT: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'FAILED', 'CANCELLED'],
  ACCEPTED: ['IN_PROGRESS', 'FAILED', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_DECISION', 'AWAITING_VERIFY', 'FAILED', 'CANCELLED'],
  AWAITING_DECISION: ['IN_PROGRESS', 'AWAITING_VERIFY', 'FAILED', 'CANCELLED'],
  AWAITING_VERIFY: ['COMPLETED', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
  FAILED: [],
  CANCELLED: [],
};

function timestampFor(clock: () => Date): string { return clock().toISOString(); }
function defaultSnapshot(clock: () => Date): TaskCenterSnapshot {
  return { version: 1, revision: 0, updatedAt: timestampFor(clock), tasks: [], history: [] };
}
function parseSnapshot(value: unknown, source: string): TaskCenterSnapshot {
  const parsed = TaskCenterSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${source} 数据无效：${parsed.error.issues.slice(0, 3).map((issue) => issue.message).join('；')}`);
  }
  return parsed.data;
}
function safeRead(file: string): TaskCenterSnapshot | null {
  if (!existsSync(file)) return null;
  if (statSync(file).size > MAX_FILE_BYTES) throw new Error('任务中心数据超过大小上限');
  return parseSnapshot(JSON.parse(readFileSync(file, 'utf8')), '任务中心');
}
function requiredString(input: Record<string, unknown>, key: string, label = key, max = 500): string {
  const value = typeof input[key] === 'string' ? input[key].trim() : '';
  if (!value) throw new Error(`${label}不能为空`);
  if (value.length > max) throw new Error(`${label}长度不能超过 ${max}`);
  return value;
}
function optionalString(input: Record<string, unknown>, key: string, max = 500): string {
  const value = typeof input[key] === 'string' ? input[key].trim() : '';
  if (value.length > max) throw new Error(`${key}长度不能超过 ${max}`);
  return value;
}
function uniqueRefs(values: unknown, required = true): string[] {
  if (!Array.isArray(values)) {
    if (required) throw new Error('evidenceRefs不能为空');
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('evidenceRefs必须是非空字符串数组');
    const value = raw.trim();
    if (value.length > 500) throw new Error('evidenceRefs单项长度不能超过 500');
    const key = value.toLocaleLowerCase('en-US');
    if (!seen.has(key)) { seen.add(key); result.push(value); }
  }
  if (required && !result.length) throw new Error('evidenceRefs不能为空');
  if (result.length > 40) throw new Error('evidenceRefs最多 40 项');
  return result;
}
function isBlockedVerifier(actor: string): boolean { return /^(agent|system):/i.test(actor); }
function taskEventForStatus(status: TaskStatus): z.infer<typeof TaskHistoryEntrySchema>['eventType'] {
  if (status === 'ACCEPTED') return 'accepted';
  if (status === 'IN_PROGRESS') return 'started';
  if (status === 'FAILED') return 'failed';
  if (status === 'CANCELLED') return 'cancelled';
  return 'decision_requested';
}

export class TaskCenterStore {
  private readonly file: string;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly tenantId: string;

  constructor(options: {
    file?: string;
    clock?: () => Date;
    idFactory?: () => string;
    tenantId?: string;
  } = {}) {
    this.file = options.file ?? taskCenterFile;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.tenantId = options.tenantId?.trim() || process.env.AEOS_TENANT_ID?.trim() || 'pilot-default';
  }

  load(): TaskCenterSnapshot {
    try {
      return structuredClone(safeRead(this.file) ?? defaultSnapshot(this.clock));
    } catch (primary) {
      try {
        const backup = safeRead(`${this.file}.bak`);
        if (!backup) throw primary;
        return structuredClone(backup);
      } catch { throw primary; }
    }
  }

  createFromOperatingCase(input: Record<string, unknown>): TaskRecord {
    const caseId = requiredString(input, 'caseId', 'caseId', 160);
    const source = requiredString(input, 'source', 'source', 80);
    const entityId = requiredString(input, 'entityId', 'entityId', 180);
    const title = requiredString(input, 'title', 'title', 300);
    const actor = requiredString(input, 'actor', 'actor', 160);
    const reason = requiredString(input, 'reason', 'reason', 1_000);
    const priority = TaskPrioritySchema.safeParse(input.priority);
    if (!priority.success) throw new Error('priority无效');
    const dueAt = dueDate.safeParse(input.dueAt);
    if (!dueAt.success) throw new Error('dueAt必须使用 YYYY-MM-DD 格式');
    const refs = uniqueRefs(input.evidenceRefs);
    const correlationId = optionalString(input, 'correlationId', 200) || caseId;
    const tenantId = optionalString(input, 'tenantId', 160) || this.tenantId;
    const alreadyOpen = this.load().tasks.find((task) => task.caseId === caseId && task.tenantId === tenantId && !TERMINAL_STATUSES.has(task.status));
    if (alreadyOpen) return structuredClone(alreadyOpen);
    return this.mutate((snapshot, occurredAt) => {
      const existing = snapshot.tasks.find((task) => task.caseId === caseId && task.tenantId === tenantId && !TERMINAL_STATUSES.has(task.status));
      if (existing) return existing;
      const task = TaskRecordSchema.parse({
        taskId: `task-${this.idFactory()}`,
        tenantId,
        businessObjectRef: `business://${source}/${encodeURIComponent(entityId)}`,
        caseId, source, title, evidenceRefs: refs, priority: priority.data, dueAt: dueAt.data,
        initiatedBy: actor, currentAssignee: null, status: 'DRAFT', correlationId,
        nextAction: '等待管理者分派责任角色', resultId: null, createdAt: occurredAt, updatedAt: occurredAt,
      });
      snapshot.tasks.push(task);
      this.appendHistory(snapshot, task, { eventType: 'created', fromStatus: null, toStatus: 'DRAFT', actor, reason, evidenceRefs: refs }, occurredAt);
      return task;
    });
  }

  assign(input: Record<string, unknown>): TaskRecord {
    const taskId = requiredString(input, 'taskId', 'taskId', 160);
    const assigneeRole = requiredString(input, 'assigneeRole', 'assigneeRole', 160);
    const actor = requiredString(input, 'actor', 'actor', 160);
    const reason = requiredString(input, 'reason', 'reason', 1_000);
    return this.mutate((snapshot, occurredAt) => {
      const task = this.findOpenTask(snapshot, taskId);
      const fromStatus = task.status;
      const wasAssigned = Boolean(task.currentAssignee);
      if (task.status === 'DRAFT') task.status = 'ASSIGNED';
      task.currentAssignee = TaskAssigneeSchema.parse({ kind: 'responsibility_role', role: assigneeRole, assignedAt: occurredAt });
      task.nextAction = task.status === 'ASSIGNED' ? '等待责任角色接受任务' : task.nextAction;
      task.updatedAt = occurredAt;
      this.appendHistory(snapshot, task, {
        eventType: wasAssigned ? 'reassigned' : 'assigned', fromStatus, toStatus: task.status, actor, reason, evidenceRefs: task.evidenceRefs,
      }, occurredAt);
      return task;
    });
  }

  transition(input: Record<string, unknown>): TaskRecord {
    const taskId = requiredString(input, 'taskId', 'taskId', 160);
    const actor = requiredString(input, 'actor', 'actor', 160);
    const reason = requiredString(input, 'reason', 'reason', 1_000);
    const toStatus = TaskStatusSchema.safeParse(input.toStatus);
    if (!toStatus.success) throw new Error('目标任务状态无效');
    if (['AWAITING_DECISION', 'AWAITING_VERIFY', 'COMPLETED', 'REJECTED'].includes(toStatus.data)) {
      throw new Error('不允许通过普通状态流转进入该状态；请使用受控操作');
    }
    const nextAction = optionalString(input, 'nextAction', 500);
    return this.mutate((snapshot, occurredAt) => {
      const task = this.findOpenTask(snapshot, taskId);
      if (toStatus.data === 'FAILED' && !nextAction) throw new Error('失败任务必须说明下一步动作');
      return this.transitionTask(snapshot, task, toStatus.data, actor, reason, occurredAt, taskEventForStatus(toStatus.data), nextAction || undefined);
    });
  }

  supplementEvidence(input: Record<string, unknown>): TaskRecord {
    const taskId = requiredString(input, 'taskId', 'taskId', 160);
    const actor = requiredString(input, 'actor', 'actor', 160);
    const reason = requiredString(input, 'reason', 'reason', 1_000);
    const additions = uniqueRefs(input.evidenceRefs);
    return this.mutate((snapshot, occurredAt) => {
      const task = this.findOpenTask(snapshot, taskId);
      task.evidenceRefs = uniqueRefs([...task.evidenceRefs, ...additions]);
      task.updatedAt = occurredAt;
      this.appendHistory(snapshot, task, {
        eventType: 'evidence_supplemented', fromStatus: task.status, toStatus: task.status, actor, reason, evidenceRefs: additions,
      }, occurredAt);
      return task;
    });
  }

  escalate(input: Record<string, unknown>): TaskRecord {
    const taskId = requiredString(input, 'taskId', 'taskId', 160);
    const actor = requiredString(input, 'actor', 'actor', 160);
    const reason = requiredString(input, 'reason', 'reason', 1_000);
    const nextAction = requiredString(input, 'nextAction', '下一步动作', 500);
    return this.mutate((snapshot, occurredAt) => {
      const task = this.findOpenTask(snapshot, taskId);
      return this.transitionTask(snapshot, task, 'AWAITING_DECISION', actor, reason, occurredAt, 'escalated', nextAction);
    });
  }

  remind(input: Record<string, unknown>): TaskRecord {
    const taskId = requiredString(input, 'taskId', 'taskId', 160);
    const actor = requiredString(input, 'actor', 'actor', 160);
    const reason = requiredString(input, 'reason', 'reason', 1_000);
    return this.mutate((snapshot, occurredAt) => {
      const task = this.findOpenTask(snapshot, taskId);
      task.updatedAt = occurredAt;
      this.appendHistory(snapshot, task, { eventType: 'reminded', fromStatus: task.status, toStatus: task.status, actor, reason, evidenceRefs: task.evidenceRefs }, occurredAt);
      return task;
    });
  }

  withdraw(input: Record<string, unknown>): TaskRecord {
    const taskId = requiredString(input, 'taskId', 'taskId', 160);
    const actor = requiredString(input, 'actor', 'actor', 160);
    const reason = requiredString(input, 'reason', 'reason', 1_000);
    return this.mutate((snapshot, occurredAt) => {
      const task = this.findOpenTask(snapshot, taskId);
      return this.transitionTask(snapshot, task, 'CANCELLED', actor, reason, occurredAt, 'withdrawn', '任务已撤回，不再继续处理');
    });
  }

  recordPendingResult(input: Record<string, unknown>): TaskRecord {
    const taskId = requiredString(input, 'taskId', 'taskId', 160);
    const resultId = requiredString(input, 'resultId', 'resultId', 160);
    const actor = requiredString(input, 'actor', 'actor', 160);
    const reason = requiredString(input, 'reason', 'reason', 1_000);
    const refs = uniqueRefs(input.evidenceRefs);
    return this.mutate((snapshot, occurredAt) => {
      const task = this.findOpenTask(snapshot, taskId);
      if (task.resultId) throw new Error('任务已有待核验或已核验结果，不能重复提交');
      task.resultId = resultId;
      task.evidenceRefs = uniqueRefs([...task.evidenceRefs, ...refs]);
      return this.transitionTask(snapshot, task, 'AWAITING_VERIFY', actor, reason, occurredAt, 'result_submitted', '等待业务 Owner 核验结果', refs);
    });
  }

  verifyResult(input: Record<string, unknown>): TaskRecord {
    const taskId = requiredString(input, 'taskId', 'taskId', 160);
    const resultId = requiredString(input, 'resultId', 'resultId', 160);
    const actor = requiredString(input, 'actor', 'actor', 160);
    const reason = requiredString(input, 'reason', 'reason', 1_000);
    const outcome = input.outcome === 'VERIFIED' || input.outcome === 'REJECTED' ? input.outcome : null;
    if (!outcome) throw new Error('核验结果只能是 VERIFIED 或 REJECTED');
    if (isBlockedVerifier(actor)) throw new Error('Agent 或系统身份不能核验业务 Result；请由业务 Owner 确认');
    return this.mutate((snapshot, occurredAt) => {
      const task = this.findOpenTask(snapshot, taskId);
      if (task.status !== 'AWAITING_VERIFY' || task.resultId !== resultId) throw new Error('任务未处于该 Result 的待核验状态');
      return this.transitionTask(snapshot, task, outcome === 'VERIFIED' ? 'COMPLETED' : 'REJECTED', actor, reason, occurredAt, outcome === 'VERIFIED' ? 'verified' : 'rejected', outcome === 'VERIFIED' ? '业务 Owner 已核验通过' : '结果被退回，需重新分析');
    });
  }

  private mutate<T>(operation: (snapshot: TaskCenterSnapshot, occurredAt: string) => T): T {
    const snapshot = this.load();
    const occurredAt = timestampFor(this.clock);
    const result = operation(snapshot, occurredAt);
    snapshot.revision += 1;
    snapshot.updatedAt = occurredAt;
    TaskCenterSnapshotSchema.parse(snapshot);
    atomicWrite(this.file, `${JSON.stringify(snapshot, null, 2)}\n`);
    return structuredClone(result);
  }

  private findOpenTask(snapshot: TaskCenterSnapshot, taskId: string): TaskRecord {
    const task = snapshot.tasks.find((candidate) => candidate.taskId === taskId);
    if (!task) throw new Error('任务不存在');
    if (TERMINAL_STATUSES.has(task.status)) throw new Error(`任务已处于 ${task.status} 状态，不能继续处理`);
    return task;
  }

  private transitionTask(
    snapshot: TaskCenterSnapshot, task: TaskRecord, toStatus: TaskStatus, actor: string, reason: string,
    occurredAt: string, eventType: TaskHistoryEntry['eventType'], nextAction?: string, eventEvidenceRefs?: string[],
  ): TaskRecord {
    const fromStatus = task.status;
    if (!TRANSITIONS[fromStatus].includes(toStatus)) throw new Error(`不允许从 ${fromStatus} 流转到 ${toStatus}`);
    if (toStatus !== 'CANCELLED' && toStatus !== 'DRAFT' && !task.currentAssignee) {
      throw new Error('任务尚未分派责任角色');
    }
    task.status = toStatus;
    task.nextAction = nextAction ?? (toStatus === 'ACCEPTED' ? '责任角色开始处理任务' : toStatus === 'IN_PROGRESS' ? '继续处理并补充证据' : task.nextAction);
    task.updatedAt = occurredAt;
    this.appendHistory(snapshot, task, {
      eventType, fromStatus, toStatus, actor, reason, evidenceRefs: eventEvidenceRefs ?? task.evidenceRefs,
    }, occurredAt);
    return task;
  }

  private appendHistory(
    snapshot: TaskCenterSnapshot, task: TaskRecord,
    entry: Omit<TaskHistoryEntry, 'eventId' | 'taskId' | 'occurredAt'>,
    occurredAt: string,
  ): void {
    snapshot.history.push(TaskHistoryEntrySchema.parse({
      eventId: `task-event-${this.idFactory()}`,
      taskId: task.taskId,
      ...entry,
      occurredAt,
    }));
  }
}

export const taskCenter = new TaskCenterStore();
