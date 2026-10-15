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
const PROJECT_STATUSES = ['PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;
const TASK_EVENT_TYPES = [
  'created', 'assigned', 'reassigned', 'accepted', 'started', 'decision_requested',
  'result_submitted', 'verified', 'rejected', 'failed', 'cancelled', 'withdrawn',
  'evidence_supplemented', 'escalated', 'project_linked', 'reminded',
] as const;
const TERMINAL_STATUSES = new Set(['COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED']);
const timestamp = z.string().datetime({ offset: true });
const text = (max: number, min = 0) => z.string().trim().min(min).max(max);
const evidenceRefs = z.array(text(500, 1)).min(1).max(40);
const dueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期必须使用 YYYY-MM-DD 格式');

export const TaskStatusSchema = z.enum(TASK_STATUSES);
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES);
export const ProjectStatusSchema = z.enum(PROJECT_STATUSES);
export const TaskAssigneeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('responsibility_role'),
    role: text(160, 1),
    actorId: text(160, 1),
    assignedAt: timestamp,
  }).strict(),
  z.object({
    kind: z.literal('agent'),
    agentId: text(160, 1),
    assignedAt: timestamp,
  }).strict(),
]);
export const DispatchHistoryEntrySchema = z.object({
  agentId: text(160, 1),
  recommendedReasons: z.array(text(500)).max(32),
  confirmedBy: text(160, 1),
  confirmedAt: timestamp,
  reason: text(1_000, 1),
}).strict();
export type DispatchHistoryEntry = z.infer<typeof DispatchHistoryEntrySchema>;
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
  dispatchHistory: z.array(DispatchHistoryEntrySchema).default([]),
  status: TaskStatusSchema,
  correlationId: text(200, 1),
  projectId: text(160, 1).nullable(),
  nextAction: text(500),
  resultId: text(160, 1).nullable(),
  agentRun: z.object({
    runtimeRunId: text(160, 1),
    runtimeSessionId: text(160, 1),
    agentId: text(160, 1),
    startedAt: timestamp,
    endedAt: timestamp,
  }).strict().optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();
export const ProjectRecordSchema = z.object({
  projectId: text(160, 1),
  tenantId: text(160, 1),
  name: text(200, 1),
  description: text(2_000),
  status: ProjectStatusSchema,
  priority: TaskPrioritySchema,
  ownerActorId: text(160, 1),
  memberActorIds: z.array(text(160, 1)).max(100),
  startDate: dueDate.nullable(),
  dueDate: dueDate.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();
export const ProjectHistoryEntrySchema = z.object({
  eventId: text(160, 1),
  projectId: text(160, 1),
  actor: text(160, 1),
  action: z.enum(['created', 'updated']),
  reason: text(1_000, 1),
  occurredAt: timestamp,
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
  version: z.literal(2),
  revision: z.number().int().nonnegative(),
  updatedAt: timestamp,
  tasks: z.array(TaskRecordSchema).max(10_000),
  history: z.array(TaskHistoryEntrySchema).max(100_000),
  projects: z.array(ProjectRecordSchema).max(10_000),
  projectHistory: z.array(ProjectHistoryEntrySchema).max(100_000),
}).strict().superRefine((snapshot, ctx) => {
  const taskIds = new Set<string>();
  const projects = new Map<string, ProjectRecord>();
  snapshot.projects.forEach((project, index) => {
    if (projects.has(project.projectId)) ctx.addIssue({ code: 'custom', path: ['projects', index, 'projectId'], message: '项目 ID 不能重复' });
    projects.set(project.projectId, project);
  });
  snapshot.tasks.forEach((task, index) => {
    if (taskIds.has(task.taskId)) {
      ctx.addIssue({ code: 'custom', path: ['tasks', index, 'taskId'], message: '任务 ID 不能重复' });
    }
    if (task.projectId) {
      const project = projects.get(task.projectId);
      if (!project || project.tenantId !== task.tenantId) {
        ctx.addIssue({ code: 'custom', path: ['tasks', index, 'projectId'], message: '任务项目引用不存在或不属于同一租户' });
      }
    }
    taskIds.add(task.taskId);
    if (Date.parse(task.updatedAt) < Date.parse(task.createdAt)) {
      ctx.addIssue({ code: 'custom', path: ['tasks', index, 'updatedAt'], message: 'updatedAt 不能早于 createdAt' });
    }
  });
  snapshot.history.forEach((entry, index) => {
    if (!taskIds.has(entry.taskId)) {
      ctx.addIssue({ code: 'custom', path: ['history', index, 'taskId'], message: '历史记录引用的任务不存在' });
    }
  });
  snapshot.projectHistory.forEach((entry, index) => {
    if (!projects.has(entry.projectId)) ctx.addIssue({ code: 'custom', path: ['projectHistory', index, 'projectId'], message: '项目历史记录引用的项目不存在' });
  });
});

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type TaskRecord = z.infer<typeof TaskRecordSchema>;
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;
export type TaskHistoryEntry = z.infer<typeof TaskHistoryEntrySchema>;
export type ProjectHistoryEntry = z.infer<typeof ProjectHistoryEntrySchema>;
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
  return { version: 2, revision: 0, updatedAt: timestampFor(clock), tasks: [], history: [], projects: [], projectHistory: [] };
}
function parseSnapshot(value: unknown, source: string): TaskCenterSnapshot {
  const parsed = TaskCenterSnapshotSchema.safeParse(migrateSnapshot(value));
  if (!parsed.success) {
    throw new Error(`${source} 数据无效：${parsed.error.issues.slice(0, 3).map((issue) => issue.message).join('；')}`);
  }
  return parsed.data;
}
function migrateSnapshot(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const snapshot = value as { version?: unknown; tasks?: unknown; projects?: unknown; projectHistory?: unknown };
  if (!Array.isArray(snapshot.tasks)) return value;
  let changed = snapshot.version !== 2 || !Array.isArray(snapshot.projects) || !Array.isArray(snapshot.projectHistory);
  const tasks = snapshot.tasks.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
    const task = candidate as { currentAssignee?: unknown; nextAction?: unknown; projectId?: unknown };
    const projectId = typeof task.projectId === 'string' && task.projectId.trim() ? task.projectId.trim() : null;
    const assignee = task.currentAssignee;
    if (!assignee || typeof assignee !== 'object' || Array.isArray(assignee)) {
      if (task.projectId === projectId) return candidate;
      changed = true;
      return { ...task, projectId };
    }
    const legacy = assignee as { kind?: unknown; role?: unknown };
    if (legacy.kind !== 'responsibility_role' || typeof legacy.role !== 'string' || legacy.role.trim() === '' || Object.hasOwn(assignee, 'actorId')) {
      if (task.projectId === projectId) return candidate;
      changed = true;
      return { ...task, projectId };
    }
    changed = true;
    const historicalRole = legacy.role.trim();
    return {
      ...task,
      projectId,
      currentAssignee: null,
      nextAction: `历史责任角色“${historicalRole}”未绑定具体经办人；请由管理者重新分派`,
    };
  });
  return changed ? { ...snapshot, version: 2, tasks, projects: Array.isArray(snapshot.projects) ? snapshot.projects : [], projectHistory: Array.isArray(snapshot.projectHistory) ? snapshot.projectHistory : [] } : value;
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
function nullableId(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}必须是非空字符串或 null`);
  if (value.trim().length > 160) throw new Error(`${label}长度不能超过 160`);
  return value.trim();
}
function nullableDueDate(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = dueDate.safeParse(value);
  if (!parsed.success) throw new Error(`${label}必须使用 YYYY-MM-DD 格式`);
  return parsed.data;
}
function uniqueActorIds(value: unknown, ownerActorId: string): string[] {
  if (value === undefined || value === null) return [ownerActorId];
  if (!Array.isArray(value)) throw new Error('memberActorIds必须是字符串数组');
  const values = [ownerActorId, ...value];
  const result: string[] = [];
  for (const item of values) {
    if (typeof item !== 'string' || !item.trim()) throw new Error('memberActorIds必须是非空字符串数组');
    const id = item.trim();
    if (id.length > 160) throw new Error('memberActorIds单项长度不能超过 160');
    if (!result.includes(id)) result.push(id);
  }
  if (result.length > 100) throw new Error('memberActorIds最多 100 项');
  return result;
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
function isBlockedNonHumanActor(actor: string): boolean { return /^(?:m01:)?(?:agent|system|service):/i.test(actor); }
function isBlockedVerifier(actor: string): boolean { return isBlockedNonHumanActor(actor); }
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
        projectId: null,
        nextAction: '等待管理者分派责任角色', resultId: null, createdAt: occurredAt, updatedAt: occurredAt,
      });
      snapshot.tasks.push(task);
      this.appendHistory(snapshot, task, { eventType: 'created', fromStatus: null, toStatus: 'DRAFT', actor, reason, evidenceRefs: refs }, occurredAt);
      return task;
    });
  }

  listProjectsForTenant(tenantId: string): ProjectRecord[] {
    return this.load().projects.filter((project) => project.tenantId === tenantId).map((project) => structuredClone(project));
  }

  createProject(input: Record<string, unknown>): ProjectRecord {
    const actor = requiredString(input, 'actor', 'actor', 160);
    const tenantId = requiredString(input, 'tenantId', 'tenantId', 160);
    const name = requiredString(input, 'name', '项目名称', 200);
    const description = optionalString(input, 'description', 2_000);
    const priority = TaskPrioritySchema.safeParse(input.priority ?? 'medium');
    if (!priority.success) throw new Error('priority无效');
    const status = ProjectStatusSchema.safeParse(input.status ?? 'PLANNING');
    if (!status.success) throw new Error('项目状态无效');
    const startDate = nullableDueDate(input.startDate, 'startDate');
    const projectDueDate = nullableDueDate(input.dueDate, 'dueDate');
    if (startDate && projectDueDate && startDate > projectDueDate) throw new Error('开始日期不能晚于截止日期');
    const memberActorIds = uniqueActorIds(input.memberActorIds, actor);
    return this.mutate((snapshot, occurredAt) => {
      const project = ProjectRecordSchema.parse({
        projectId: `project-${this.idFactory()}`, tenantId, name, description, priority: priority.data, status: status.data,
        ownerActorId: actor, memberActorIds, startDate, dueDate: projectDueDate, createdAt: occurredAt, updatedAt: occurredAt,
      });
      snapshot.projects.push(project);
      this.appendProjectHistory(snapshot, project, actor, 'created', '创建项目', occurredAt);
      return project;
    });
  }

  updateProject(input: Record<string, unknown>): ProjectRecord {
    const projectId = requiredString(input, 'projectId', 'projectId', 160);
    const actor = requiredString(input, 'actor', 'actor', 160);
    const reason = requiredString(input, 'reason', 'reason', 1_000);
    return this.mutate((snapshot, occurredAt) => {
      const project = this.findProject(snapshot, projectId);
      if (Object.hasOwn(input, 'name')) project.name = requiredString(input, 'name', '项目名称', 200);
      if (Object.hasOwn(input, 'description')) project.description = optionalString(input, 'description', 2_000);
      if (Object.hasOwn(input, 'priority')) {
        const priority = TaskPrioritySchema.safeParse(input.priority);
        if (!priority.success) throw new Error('priority无效');
        project.priority = priority.data;
      }
      if (Object.hasOwn(input, 'status')) {
        const status = ProjectStatusSchema.safeParse(input.status);
        if (!status.success) throw new Error('项目状态无效');
        project.status = status.data;
      }
      if (Object.hasOwn(input, 'startDate')) project.startDate = nullableDueDate(input.startDate, 'startDate');
      if (Object.hasOwn(input, 'dueDate')) project.dueDate = nullableDueDate(input.dueDate, 'dueDate');
      if (project.startDate && project.dueDate && project.startDate > project.dueDate) throw new Error('开始日期不能晚于截止日期');
      if (Object.hasOwn(input, 'memberActorIds')) project.memberActorIds = uniqueActorIds(input.memberActorIds, project.ownerActorId);
      project.updatedAt = occurredAt;
      this.appendProjectHistory(snapshot, project, actor, 'updated', reason, occurredAt);
      return project;
    });
  }

  createManualTask(input: Record<string, unknown>): TaskRecord {
    const actor = requiredString(input, 'actor', 'actor', 160);
    const tenantId = requiredString(input, 'tenantId', 'tenantId', 160);
    const title = requiredString(input, 'title', '任务标题', 300);
    const dueAt = dueDate.safeParse(input.dueAt);
    if (!dueAt.success) throw new Error('dueAt必须使用 YYYY-MM-DD 格式');
    const priority = TaskPrioritySchema.safeParse(input.priority ?? 'medium');
    if (!priority.success) throw new Error('priority无效');
    const projectId = nullableId(input.projectId, 'projectId');
    const assigneeActorId = nullableId(input.assigneeActorId, 'assigneeActorId') ?? actor;
    const assigneeRole = optionalString(input, 'assigneeRole', 160) || '项目协同负责人';
    const nextAction = optionalString(input, 'nextAction', 500) || '等待指定责任人开始处理';
    return this.mutate((snapshot, occurredAt) => {
      if (projectId) {
        const project = this.findProject(snapshot, projectId);
        if (project.tenantId !== tenantId) throw new Error('项目不属于当前租户');
      }
      const taskId = `task-${this.idFactory()}`;
      const refs = [`hub://collaboration/tasks/${taskId}`];
      const task = TaskRecordSchema.parse({
        taskId, tenantId, businessObjectRef: `hub://collaboration/tasks/${taskId}`, caseId: `manual-${taskId}`, source: 'collaboration',
        title, evidenceRefs: refs, priority: priority.data, dueAt: dueAt.data, initiatedBy: actor,
        currentAssignee: { kind: 'responsibility_role', role: assigneeRole, actorId: assigneeActorId, assignedAt: occurredAt },
        status: 'ASSIGNED', correlationId: taskId, projectId, nextAction, resultId: null, createdAt: occurredAt, updatedAt: occurredAt,
      });
      snapshot.tasks.push(task);
      this.appendHistory(snapshot, task, { eventType: 'created', fromStatus: null, toStatus: task.status, actor, reason: '创建协同任务', evidenceRefs: refs }, occurredAt);
      return task;
    });
  }

  updateCollaborationTask(input: Record<string, unknown>): TaskRecord {
    const taskId = requiredString(input, 'taskId', 'taskId', 160);
    const actor = requiredString(input, 'actor', 'actor', 160);
    const reason = requiredString(input, 'reason', 'reason', 1_000);
    return this.mutate((snapshot, occurredAt) => {
      const task = snapshot.tasks.find((candidate) => candidate.taskId === taskId);
      if (!task) throw new Error('任务不存在');
      if (task.source !== 'collaboration') throw new Error('受控经营任务不能通过协同任务接口修改');
      const fromStatus = task.status;
      if (Object.hasOwn(input, 'title')) task.title = requiredString(input, 'title', '任务标题', 300);
      if (Object.hasOwn(input, 'priority')) {
        const priority = TaskPrioritySchema.safeParse(input.priority);
        if (!priority.success) throw new Error('priority无效');
        task.priority = priority.data;
      }
      if (Object.hasOwn(input, 'dueAt')) {
        const due = dueDate.safeParse(input.dueAt);
        if (!due.success) throw new Error('dueAt必须使用 YYYY-MM-DD 格式');
        task.dueAt = due.data;
      }
      if (Object.hasOwn(input, 'nextAction')) task.nextAction = requiredString(input, 'nextAction', '下一步动作', 500);
      if (Object.hasOwn(input, 'projectId')) {
        const projectId = nullableId(input.projectId, 'projectId');
        if (projectId) {
          const project = this.findProject(snapshot, projectId);
          if (project.tenantId !== task.tenantId) throw new Error('项目不属于任务所在租户');
        }
        task.projectId = projectId;
      }
      if (Object.hasOwn(input, 'status')) {
        const status = TaskStatusSchema.safeParse(input.status);
        if (!status.success || !['DRAFT', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(status.data)) throw new Error('协同任务状态无效');
        task.status = status.data;
      }
      task.updatedAt = occurredAt;
      this.appendHistory(snapshot, task, { eventType: 'reminded', fromStatus, toStatus: task.status, actor, reason, evidenceRefs: task.evidenceRefs }, occurredAt);
      return task;
    });
  }

  linkTaskToProject(input: Record<string, unknown>): TaskRecord {
    const taskId = requiredString(input, 'taskId', 'taskId', 160);
    const actor = requiredString(input, 'actor', 'actor', 160);
    const reason = requiredString(input, 'reason', 'reason', 1_000);
    const projectId = nullableId(input.projectId, 'projectId');
    return this.mutate((snapshot, occurredAt) => {
      const task = snapshot.tasks.find((candidate) => candidate.taskId === taskId);
      if (!task) throw new Error('任务不存在');
      if (projectId) {
        const project = this.findProject(snapshot, projectId);
        if (project.tenantId !== task.tenantId) throw new Error('项目不属于任务所在租户');
      }
      const fromStatus = task.status;
      task.projectId = projectId;
      task.updatedAt = occurredAt;
      this.appendHistory(snapshot, task, { eventType: 'project_linked', fromStatus, toStatus: task.status, actor, reason, evidenceRefs: task.evidenceRefs }, occurredAt);
      return task;
    });
  }

  projectProgress(projectId: string, tenantId: string): { total: number; completed: number; percent: number } {
    const tasks = this.load().tasks.filter((task) => task.tenantId === tenantId && task.projectId === projectId);
    const completed = tasks.filter((task) => task.status === 'COMPLETED').length;
    return { total: tasks.length, completed, percent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 };
  }

  assign(input: Record<string, unknown>): TaskRecord {
    const taskId = requiredString(input, 'taskId', 'taskId', 160);
    const actor = requiredString(input, 'actor', 'actor', 160);
    const reason = requiredString(input, 'reason', 'reason', 1_000);
    const assigneeKind = typeof input.assigneeKind === 'string' && input.assigneeKind.trim() === 'agent' ? 'agent' : 'responsibility_role';
    return this.mutate((snapshot, occurredAt) => {
      const task = this.findOpenTask(snapshot, taskId);
      const fromStatus = task.status;
      const wasAssigned = Boolean(task.currentAssignee);
      if (task.status === 'DRAFT') task.status = 'ASSIGNED';
      if (assigneeKind === 'agent') {
        const agentId = requiredString(input, 'agentId', 'agentId', 160);
        const recommendedReasons = Array.isArray(input.recommendedReasons)
          ? input.recommendedReasons.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 32)
          : [];
        task.currentAssignee = TaskAssigneeSchema.parse({ kind: 'agent', agentId, assignedAt: occurredAt });
        task.dispatchHistory = [...task.dispatchHistory, DispatchHistoryEntrySchema.parse({
          agentId, recommendedReasons, confirmedBy: actor, confirmedAt: occurredAt, reason,
        })];
        task.nextAction = '等待 Agent 回传分析结果';
      } else {
        const assigneeRole = requiredString(input, 'assigneeRole', 'assigneeRole', 160);
        const assigneeActorId = requiredString(input, 'assigneeActorId', 'assigneeActorId', 160);
        task.currentAssignee = TaskAssigneeSchema.parse({ kind: 'responsibility_role', role: assigneeRole, actorId: assigneeActorId, assignedAt: occurredAt });
        task.nextAction = task.status === 'ASSIGNED' ? '等待指定责任人接受任务' : task.nextAction;
      }
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
      if (toStatus.data === 'ACCEPTED' || toStatus.data === 'IN_PROGRESS' || toStatus.data === 'FAILED') {
        this.requireAssignedHumanOperator(task, actor);
      }
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
      this.requireAssignedHumanOperator(task, actor);
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

  deleteTask(input: Record<string, unknown>): { deleted: boolean } {
    const taskId = requiredString(input, 'taskId', 'taskId', 160);
    return this.mutate((snapshot) => {
      const index = snapshot.tasks.findIndex((candidate) => candidate.taskId === taskId);
      if (index < 0) return { deleted: false };
      snapshot.tasks.splice(index, 1);
      snapshot.history = snapshot.history.filter((entry) => entry.taskId !== taskId);
      return { deleted: true };
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
      this.requireAssignedHumanOperator(task, actor);
      if (task.resultId) throw new Error('任务已有待核验或已核验结果，不能重复提交');
      task.resultId = resultId;
      task.evidenceRefs = uniqueRefs([...task.evidenceRefs, ...refs]);
      return this.transitionTask(snapshot, task, 'AWAITING_VERIFY', actor, reason, occurredAt, 'result_submitted', '等待业务 Owner 核验结果', refs);
    });
  }

  /** Records a governed Agent run outcome without using the human-operator transition path. */
  recordAgentRunOutcome(input: Record<string, unknown>): TaskRecord {
    const taskId = requiredString(input, 'taskId', 'taskId', 160);
    const agentId = requiredString(input, 'agentId', 'agentId', 160);
    const actor = requiredString(input, 'actor', 'actor', 160);
    const reason = requiredString(input, 'reason', 'reason', 1_000);
    const outcome = input.outcome === 'completed' || input.outcome === 'failed' || input.outcome === 'awaiting_decision' ? input.outcome : null;
    if (!outcome) throw new Error('outcome 只能是 completed、failed 或 awaiting_decision');
    const agentRun = z.object({
      runtimeRunId: text(160, 1),
      runtimeSessionId: text(160, 1),
      agentId: text(160, 1),
      startedAt: timestamp,
      endedAt: timestamp,
    }).strict().parse(input.agentRun);
    const refs = uniqueRefs(input.evidenceRefs);
    return this.mutate((snapshot, occurredAt) => {
      const task = this.findOpenTask(snapshot, taskId);
      if (task.currentAssignee?.kind !== 'agent' || task.currentAssignee.agentId !== agentId) throw new Error('任务未分派给该 Agent');
      if (task.resultId) throw new Error('任务已有待核验或已核验结果，不能重复提交');
      const fromStatus = task.status;
      const toStatus = outcome === 'completed' ? 'AWAITING_VERIFY' : outcome === 'failed' ? 'FAILED' : 'AWAITING_DECISION';
      const nextAction = outcome === 'completed'
        ? '等待业务 Owner 核验结果'
        : requiredString(input, 'nextAction', '下一步动作', 500);
      if (outcome === 'completed') {
        task.resultId = requiredString(input, 'resultId', 'resultId', 160);
        task.evidenceRefs = uniqueRefs([...task.evidenceRefs, ...refs]);
      }
      task.status = toStatus;
      task.nextAction = nextAction;
      task.agentRun = agentRun;
      task.updatedAt = occurredAt;
      this.appendHistory(snapshot, task, {
        eventType: outcome === 'completed' ? 'result_submitted' : outcome === 'failed' ? 'failed' : 'escalated',
        fromStatus, toStatus, actor, reason, evidenceRefs: refs,
      }, occurredAt);
      return task;
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

  private findProject(snapshot: TaskCenterSnapshot, projectId: string): ProjectRecord {
    const project = snapshot.projects.find((candidate) => candidate.projectId === projectId);
    if (!project) throw new Error('项目不存在');
    return project;
  }

  private requireAssignedHumanOperator(task: TaskRecord, actor: string): void {
    if (isBlockedNonHumanActor(actor)) {
      throw new Error('Agent 或系统身份不能执行人工任务操作');
    }
    if (!task.currentAssignee || task.currentAssignee.kind !== 'responsibility_role') throw new Error('任务尚未分派具体责任人');
    if (task.currentAssignee.actorId !== actor) throw new Error('任务只能由被分派的具体责任人操作');
  }

  private transitionTask(
    snapshot: TaskCenterSnapshot, task: TaskRecord, toStatus: TaskStatus, actor: string, reason: string,
    occurredAt: string, eventType: TaskHistoryEntry['eventType'], nextAction?: string, eventEvidenceRefs?: string[],
  ): TaskRecord {
    const fromStatus = task.status;
    if (!TRANSITIONS[fromStatus].includes(toStatus)) throw new Error(`不允许从 ${fromStatus} 流转到 ${toStatus}`);
    if (toStatus !== 'CANCELLED' && toStatus !== 'DRAFT' && !task.currentAssignee) {
      throw new Error('任务尚未分派具体责任人');
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

  private appendProjectHistory(
    snapshot: TaskCenterSnapshot, project: ProjectRecord, actor: string,
    action: ProjectHistoryEntry['action'], reason: string, occurredAt: string,
  ): void {
    snapshot.projectHistory.push(ProjectHistoryEntrySchema.parse({
      eventId: `project-event-${this.idFactory()}`,
      projectId: project.projectId,
      actor,
      action,
      reason,
      occurredAt,
    }));
  }
}

export const taskCenter = new TaskCenterStore();
