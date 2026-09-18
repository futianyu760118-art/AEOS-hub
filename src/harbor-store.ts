import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const AUTONOMY_LEVELS = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'] as const;
const AGENT_STATUSES = ['draft', 'idle', 'working', 'offline', 'archived'] as const;
const RUNTIME_STATUSES = ['ready', 'online', 'busy', 'offline', 'unstable'] as const;
const RUNTIME_KINDS = ['codex-app-server', 'openai-responses', 'mcp-agent', 'custom-cli'] as const;
const RUNTIME_VERIFICATION_STATUSES = ['healthy', 'degraded', 'unhealthy', 'stopped', 'starting', 'unverified'] as const;
const PROJECT_STATUSES = ['planned', 'in_progress', 'paused', 'completed', 'cancelled'] as const;
const PROJECT_PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;
const RUN_TRIGGERS = ['chat', 'project', 'schedule', 'event'] as const;
const RUN_STATUSES = ['queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled'] as const;
const MAX_HARBOR_FILE_BYTES = 25 * 1024 * 1024;

export const AutonomyLevelSchema = z.enum(AUTONOMY_LEVELS);
export const HarborAgentStatusSchema = z.enum(AGENT_STATUSES);
export const HarborRuntimeStatusSchema = z.enum(RUNTIME_STATUSES);
export const HarborRuntimeKindSchema = z.enum(RUNTIME_KINDS);
export const HarborRuntimeVerificationStatusSchema = z.enum(RUNTIME_VERIFICATION_STATUSES);
export const HarborProjectStatusSchema = z.enum(PROJECT_STATUSES);
export const HarborProjectPrioritySchema = z.enum(PROJECT_PRIORITIES);
export const HarborRunTriggerSchema = z.enum(RUN_TRIGGERS);
export const HarborRunStatusSchema = z.enum(RUN_STATUSES);

export type AutonomyLevel = z.infer<typeof AutonomyLevelSchema>;
export type HarborAgentStatus = z.infer<typeof HarborAgentStatusSchema>;
export type HarborRuntimeStatus = z.infer<typeof HarborRuntimeStatusSchema>;
export type HarborRuntimeKind = z.infer<typeof HarborRuntimeKindSchema>;
export type HarborRuntimeVerificationStatus = z.infer<typeof HarborRuntimeVerificationStatusSchema>;
export type HarborProjectStatus = z.infer<typeof HarborProjectStatusSchema>;
export type HarborProjectPriority = z.infer<typeof HarborProjectPrioritySchema>;
export type HarborRunTrigger = z.infer<typeof HarborRunTriggerSchema>;
export type HarborRunStatus = z.infer<typeof HarborRunStatusSchema>;

const trimmedString = (max: number, min = 0) => z.string()
  .min(min)
  .max(max)
  .refine((value) => value === value.trim(), '字符串前后不能包含空白');
const identifierSchema = trimmedString(160, 1);
const timestampSchema = z.string().datetime({ offset: true });
const stringListSchema = (itemMax: number, max = 40) => z.array(trimmedString(itemMax, 1)).max(max);
const calendarDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期必须使用 YYYY-MM-DD 格式')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, '日期无效');

export const HarborAgentSchema = z.object({
  id: identifierSchema,
  name: trimmedString(80, 1),
  role: trimmedString(120, 1),
  description: trimmedString(500),
  instructions: trimmedString(5000),
  provider: trimmedString(80, 1),
  model: trimmedString(120, 1),
  runtimeId: identifierSchema.nullable(),
  autonomyLevel: AutonomyLevelSchema,
  access: z.enum(['private', 'workspace', 'selected']),
  skills: stringListSchema(200),
  status: HarborAgentStatusSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();

export const HarborRuntimeSchema = z.object({
  id: identifierSchema,
  name: trimmedString(100, 1),
  kind: HarborRuntimeKindSchema,
  description: trimmedString(500),
  endpoint: trimmedString(500),
  workdir: trimmedString(500),
  owner: trimmedString(120, 1),
  capabilities: stringListSchema(200),
  status: HarborRuntimeStatusSchema,
  lastSeenAt: timestampSchema.nullable(),
  lastVerification: z.object({
    status: HarborRuntimeVerificationStatusSchema,
    checkedAt: timestampSchema,
    message: trimmedString(500),
    code: trimmedString(120).nullable(),
  }).strict().nullable().default(null),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();

export const HarborProjectSchema = z.object({
  id: identifierSchema,
  key: trimmedString(30, 1),
  name: trimmedString(120, 1),
  objective: trimmedString(1200, 1),
  status: HarborProjectStatusSchema,
  priority: HarborProjectPrioritySchema,
  leadType: z.enum(['member', 'agent']),
  leadId: identifierSchema,
  agentIds: stringListSchema(160),
  progress: z.number().int().min(0).max(100),
  resourceRefs: stringListSchema(500),
  startDate: calendarDateSchema.nullable(),
  targetDate: calendarDateSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();

export const HarborRunSchema = z.object({
  id: identifierSchema,
  agentId: identifierSchema,
  projectId: identifierSchema.nullable(),
  workItem: trimmedString(1200, 1),
  trigger: HarborRunTriggerSchema,
  status: HarborRunStatusSchema,
  evidenceRefs: stringListSchema(500, 200),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();

function addDuplicateIssues(
  values: string[],
  ctx: z.RefinementCtx,
  path: Array<string | number>,
  label: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.toLocaleLowerCase('en-US');
    if (seen.has(normalized)) {
      ctx.addIssue({ code: 'custom', path, message: `${label} 不能重复: ${value}` });
    }
    seen.add(normalized);
  }
}

function addTimelineIssue(
  createdAt: string,
  updatedAt: string,
  ctx: z.RefinementCtx,
  path: Array<string | number>,
): void {
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    ctx.addIssue({ code: 'custom', path: [...path, 'updatedAt'], message: 'updatedAt 不能早于 createdAt' });
  }
}

export const HarborSnapshotSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative().default(0),
  agents: z.array(HarborAgentSchema).max(5_000),
  runtimes: z.array(HarborRuntimeSchema).max(1_000),
  projects: z.array(HarborProjectSchema).max(5_000),
  runs: z.array(HarborRunSchema).max(50_000),
}).strict().superRefine((snapshot, ctx) => {
  addDuplicateIssues(snapshot.agents.map((agent) => agent.id), ctx, ['agents'], 'Agent id');
  addDuplicateIssues(snapshot.runtimes.map((runtime) => runtime.id), ctx, ['runtimes'], 'Runtime id');
  addDuplicateIssues(snapshot.projects.map((project) => project.id), ctx, ['projects'], 'Project id');
  addDuplicateIssues(snapshot.projects.map((project) => project.key), ctx, ['projects'], 'Project key');
  addDuplicateIssues(snapshot.runs.map((run) => run.id), ctx, ['runs'], 'Run id');

  const runtimeIds = new Set(snapshot.runtimes.map((runtime) => runtime.id));
  const agentIds = new Set(snapshot.agents.map((agent) => agent.id));
  const projects = new Map(snapshot.projects.map((project) => [project.id, project]));

  snapshot.agents.forEach((agent, index) => {
    addTimelineIssue(agent.createdAt, agent.updatedAt, ctx, ['agents', index]);
    if (agent.runtimeId && !runtimeIds.has(agent.runtimeId)) {
      ctx.addIssue({ code: 'custom', path: ['agents', index, 'runtimeId'], message: '引用的 Runtime 不存在' });
    }
    if (!agent.runtimeId && !['draft', 'archived'].includes(agent.status)) {
      ctx.addIssue({ code: 'custom', path: ['agents', index, 'status'], message: '未绑定 Runtime 的 Agent 只能是 draft 或 archived' });
    }
    addDuplicateIssues(agent.skills, ctx, ['agents', index, 'skills'], 'Skill');
  });

  snapshot.runtimes.forEach((runtime, index) => {
    addTimelineIssue(runtime.createdAt, runtime.updatedAt, ctx, ['runtimes', index]);
    addDuplicateIssues(runtime.capabilities, ctx, ['runtimes', index, 'capabilities'], 'Capability');
  });

  snapshot.projects.forEach((project, index) => {
    addTimelineIssue(project.createdAt, project.updatedAt, ctx, ['projects', index]);
    addDuplicateIssues(project.agentIds, ctx, ['projects', index, 'agentIds'], 'Project agent');
    addDuplicateIssues(project.resourceRefs, ctx, ['projects', index, 'resourceRefs'], 'Resource ref');
    project.agentIds.forEach((agentId, agentIndex) => {
      if (!agentIds.has(agentId)) {
        ctx.addIssue({ code: 'custom', path: ['projects', index, 'agentIds', agentIndex], message: '引用的 Agent 不存在' });
      }
    });
    if (project.leadType === 'agent') {
      if (!agentIds.has(project.leadId)) {
        ctx.addIssue({ code: 'custom', path: ['projects', index, 'leadId'], message: 'Agent 负责人不存在' });
      } else if (!project.agentIds.includes(project.leadId)) {
        ctx.addIssue({ code: 'custom', path: ['projects', index, 'agentIds'], message: 'Agent 负责人必须属于项目' });
      }
    }
    if (project.startDate && project.targetDate && project.targetDate < project.startDate) {
      ctx.addIssue({ code: 'custom', path: ['projects', index, 'targetDate'], message: '目标日期不能早于开始日期' });
    }
  });

  snapshot.runs.forEach((run, index) => {
    addTimelineIssue(run.createdAt, run.updatedAt, ctx, ['runs', index]);
    if (!agentIds.has(run.agentId)) {
      ctx.addIssue({ code: 'custom', path: ['runs', index, 'agentId'], message: '引用的 Agent 不存在' });
    }
    if (run.projectId) {
      const project = projects.get(run.projectId);
      if (!project) {
        ctx.addIssue({ code: 'custom', path: ['runs', index, 'projectId'], message: '引用的 Project 不存在' });
      } else if (!project.agentIds.includes(run.agentId)) {
        ctx.addIssue({ code: 'custom', path: ['runs', index, 'agentId'], message: '执行 Agent 尚未加入该项目' });
      }
    }
    addDuplicateIssues(run.evidenceRefs, ctx, ['runs', index, 'evidenceRefs'], 'Evidence ref');
  });
});

export type HarborAgent = z.infer<typeof HarborAgentSchema>;
export type HarborRuntime = z.infer<typeof HarborRuntimeSchema>;
export type HarborProject = z.infer<typeof HarborProjectSchema>;
export type HarborRun = z.infer<typeof HarborRunSchema>;
export type HarborSnapshot = z.infer<typeof HarborSnapshotSchema>;

export type HarborAgentCreateInput = Readonly<Record<string, unknown>> & {
  name?: unknown;
  role?: unknown;
  runtimeId?: unknown;
};
export type HarborRuntimeCreateInput = Readonly<Record<string, unknown>> & { name?: unknown };
export interface HarborRuntimeVerificationInput {
  status: HarborRuntimeVerificationStatus;
  checkedAt: string;
  message?: string;
  code?: string | null;
}
export type HarborProjectCreateInput = Readonly<Record<string, unknown>> & {
  name?: unknown;
  objective?: unknown;
};
export type HarborRunCreateInput = Readonly<Record<string, unknown>> & {
  agentId?: unknown;
  workItem?: unknown;
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const harborFile = join(root, 'data', 'ai-harbor.json');

export class HarborStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
  }
}

export class HarborStoreCorruptError extends HarborStoreError {
  constructor(message: string, cause?: unknown) {
    super('HARBOR_STORE_CORRUPT', message, cause);
  }
}

export class HarborStoreBusyError extends HarborStoreError {
  constructor(message: string, cause?: unknown) {
    super('HARBOR_STORE_BUSY', message, cause);
  }
}

export class HarborStoreConflictError extends HarborStoreError {
  constructor(message: string) {
    super('HARBOR_STORE_CONFLICT', message);
  }
}

export class HarborStoreNotFoundError extends HarborStoreError {
  constructor(message: string) {
    super('HARBOR_STORE_NOT_FOUND', message);
  }
}

export interface HarborStoreOptions {
  file?: string;
  workspaceRoot?: string;
  clock?: () => Date;
  idFactory?: () => string;
  lockTimeoutMs?: number;
  staleLockMs?: number;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '<root>'}: ${issue.message}`)
    .join('; ');
}

function parseSnapshot(value: unknown, source: string): HarborSnapshot {
  const result = HarborSnapshotSchema.safeParse(value);
  if (!result.success) {
    throw new HarborStoreCorruptError(`${source} 数据结构无效: ${formatIssues(result.error)}`, result.error);
  }
  return result.data;
}

function requiredText(input: Readonly<Record<string, unknown>>, key: string, max = 240): string {
  const raw = input[key];
  if (typeof raw !== 'string') throw new Error(`${key} 必须是字符串`);
  const value = raw.trim();
  if (!value) throw new Error(`${key} 不能为空`);
  return value.slice(0, max);
}

function optionalText(input: Readonly<Record<string, unknown>>, key: string, max: number, fallback = ''): string {
  const raw = input[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string') throw new Error(`${key} 必须是字符串`);
  const value = raw.trim();
  return value ? value.slice(0, max) : fallback;
}

function stringList(input: unknown, itemMax: number, max = 40): string[] {
  const source = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
  const values: string[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    if (typeof item !== 'string') continue;
    const value = item.trim().slice(0, itemMax);
    const key = value.toLocaleLowerCase('en-US');
    if (!value || seen.has(key)) continue;
    values.push(value);
    seen.add(key);
    if (values.length === max) break;
  }
  return values;
}

function enumValue<T extends readonly [string, ...string[]]>(
  input: Readonly<Record<string, unknown>>,
  key: string,
  values: T,
  fallback: T[number],
): T[number] {
  const raw = input[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string' || !values.includes(raw)) throw new Error(`${key} 无效`);
  return raw;
}

function optionalDate(input: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = optionalText(input, key, 10);
  if (!value) return null;
  const result = calendarDateSchema.safeParse(value);
  if (!result.success) throw new Error(`${key} 无效: ${result.error.issues[0]?.message ?? '日期格式错误'}`);
  return result.data;
}

function nextProjectKey(snapshot: HarborSnapshot): string {
  const used = new Set(snapshot.projects.map((project) => project.key.toLocaleLowerCase('en-US')));
  let index = snapshot.projects.length + 1;
  while (used.has(`prj-${String(index).padStart(2, '0')}`)) index += 1;
  return `PRJ-${String(index).padStart(2, '0')}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class HarborStore {
  readonly file: string;
  readonly backupFile: string;
  readonly lockFile: string;
  readonly workspaceRoot: string;

  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;

  constructor(options: HarborStoreOptions = {}) {
    this.file = options.file ?? harborFile;
    this.backupFile = `${this.file}.bak`;
    this.lockFile = `${this.file}.lock`;
    this.workspaceRoot = options.workspaceRoot ?? root;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 2_000;
    this.staleLockMs = options.staleLockMs ?? 30_000;
  }

  load(): HarborSnapshot {
    return this.withLock(() => clone(this.loadUnlocked()));
  }

  save(snapshot: HarborSnapshot): HarborSnapshot {
    const requested = parseSnapshot(snapshot, '待保存的 AI 港湾快照');
    return this.withLock(() => {
      const current = this.loadUnlocked();
      if (requested.revision !== current.revision) {
        throw new HarborStoreConflictError(
          `AI 港湾数据已更新（当前 revision=${current.revision}，提交 revision=${requested.revision}），请重新加载后再保存`,
        );
      }
      const next = parseSnapshot({ ...requested, revision: current.revision + 1 }, '待保存的 AI 港湾快照');
      this.writeSnapshotUnlocked(next);
      return clone(next);
    });
  }

  createAgent(input: HarborAgentCreateInput): HarborAgent {
    return this.mutate((snapshot) => {
      const timestamp = this.now();
      const runtimeId = optionalText(input, 'runtimeId', 160) || null;
      if (runtimeId && !snapshot.runtimes.some((runtime) => runtime.id === runtimeId)) {
        throw new Error('所选 Runtime 不存在');
      }
      const agent = HarborAgentSchema.parse({
        id: `agent-${this.idFactory()}`,
        name: requiredText(input, 'name', 80),
        role: requiredText(input, 'role', 120),
        description: optionalText(input, 'description', 500),
        instructions: optionalText(input, 'instructions', 5000),
        provider: requiredText(input, 'provider', 80),
        model: optionalText(input, 'model', 120, 'provider-default'),
        runtimeId,
        autonomyLevel: enumValue(input, 'autonomyLevel', AUTONOMY_LEVELS, 'A1'),
        access: enumValue(input, 'access', ['private', 'workspace', 'selected'] as const, 'private'),
        skills: stringList(input.skills, 200),
        status: runtimeId ? 'idle' : 'draft',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      snapshot.agents.push(agent);
      return agent;
    });
  }

  createRuntime(input: HarborRuntimeCreateInput): HarborRuntime {
    return this.mutate((snapshot) => {
      const timestamp = this.now();
      const runtime = HarborRuntimeSchema.parse({
        id: `runtime-${this.idFactory()}`,
        name: requiredText(input, 'name', 100),
        kind: enumValue(input, 'kind', RUNTIME_KINDS, 'custom-cli'),
        description: optionalText(input, 'description', 500),
        endpoint: optionalText(input, 'endpoint', 500),
        workdir: optionalText(input, 'workdir', 500),
        owner: optionalText(input, 'owner', 120, 'workspace-owner'),
        capabilities: stringList(input.capabilities, 200),
        status: 'offline',
        lastSeenAt: null,
        lastVerification: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      snapshot.runtimes.push(runtime);
      return runtime;
    });
  }

  createProject(input: HarborProjectCreateInput): HarborProject {
    return this.mutate((snapshot) => {
      const timestamp = this.now();
      const requestedAgentIds = stringList(input.agentIds, 160);
      const knownAgentIds = new Set(snapshot.agents.map((agent) => agent.id));
      const unknownAgentIds = requestedAgentIds.filter((id) => !knownAgentIds.has(id));
      if (unknownAgentIds.length) throw new Error(`项目引用了不存在的 Agent: ${unknownAgentIds.join(', ')}`);

      const leadId = optionalText(input, 'leadId', 160, requestedAgentIds[0] ?? 'workspace-owner');
      const leadType = knownAgentIds.has(leadId) ? 'agent' : 'member';
      const agentIds = [...requestedAgentIds];
      if (leadType === 'agent' && !agentIds.includes(leadId)) agentIds.push(leadId);

      const key = optionalText(input, 'key', 30, nextProjectKey(snapshot));
      if (snapshot.projects.some((project) => project.key.toLocaleLowerCase('en-US') === key.toLocaleLowerCase('en-US'))) {
        throw new Error(`Project key 已存在: ${key}`);
      }
      const startDate = optionalDate(input, 'startDate');
      const targetDate = optionalDate(input, 'targetDate');
      if (startDate && targetDate && targetDate < startDate) throw new Error('targetDate 不能早于 startDate');

      const project = HarborProjectSchema.parse({
        id: `project-${this.idFactory()}`,
        key,
        name: requiredText(input, 'name', 120),
        objective: requiredText(input, 'objective', 1200),
        status: 'planned',
        priority: enumValue(input, 'priority', PROJECT_PRIORITIES, 'medium'),
        leadType,
        leadId,
        agentIds,
        progress: 0,
        resourceRefs: stringList(input.resourceRefs, 500),
        startDate,
        targetDate,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      snapshot.projects.push(project);
      return project;
    });
  }

  recordRuntimeVerification(runtimeId: string, input: HarborRuntimeVerificationInput): HarborRuntime {
    return this.mutate((snapshot) => {
      const runtime = snapshot.runtimes.find((item) => item.id === runtimeId);
      if (!runtime) throw new HarborStoreNotFoundError(`Runtime 不存在: ${runtimeId}`);

      const verification = HarborRuntimeSchema.shape.lastVerification.unwrap().parse({
        status: input.status,
        checkedAt: input.checkedAt,
        message: String(input.message ?? '').trim().slice(0, 500),
        code: input.code ? String(input.code).trim().slice(0, 120) : null,
      });
      if (runtime.lastVerification && verification.checkedAt < runtime.lastVerification.checkedAt) {
        throw new HarborStoreConflictError('较旧的 Runtime 验证结果不能覆盖较新的状态');
      }

      runtime.lastVerification = verification;
      runtime.updatedAt = new Date(Math.max(Date.parse(runtime.updatedAt), Date.parse(verification.checkedAt))).toISOString();
      if (verification.status === 'healthy') {
        runtime.status = runtime.status === 'busy' ? 'busy' : 'online';
        runtime.lastSeenAt = verification.checkedAt;
      } else if (verification.status === 'degraded' || verification.status === 'starting') {
        runtime.status = 'unstable';
        if (verification.status === 'degraded') runtime.lastSeenAt = verification.checkedAt;
      } else {
        runtime.status = 'offline';
      }
      return runtime;
    });
  }

  createRun(input: HarborRunCreateInput): HarborRun {
    return this.mutate((snapshot) => {
      const timestamp = this.now();
      const agentId = requiredText(input, 'agentId', 160);
      if (!snapshot.agents.some((agent) => agent.id === agentId)) throw new Error('执行 Agent 不存在');

      const projectId = optionalText(input, 'projectId', 160) || null;
      if (projectId) {
        const project = snapshot.projects.find((item) => item.id === projectId);
        if (!project) throw new Error('所属 Project 不存在');
        if (!project.agentIds.includes(agentId)) throw new Error('执行 Agent 尚未加入所属 Project');
      }

      const run = HarborRunSchema.parse({
        id: `run-${this.idFactory()}`,
        agentId,
        projectId,
        workItem: requiredText(input, 'workItem', 1200),
        trigger: enumValue(input, 'trigger', RUN_TRIGGERS, projectId ? 'project' : 'chat'),
        status: 'queued',
        evidenceRefs: stringList(input.evidenceRefs, 500, 200),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      snapshot.runs.push(run);
      return run;
    });
  }

  private mutate<T>(mutation: (snapshot: HarborSnapshot) => T): T {
    return this.withLock(() => {
      const snapshot = this.loadUnlocked();
      const result = mutation(snapshot);
      snapshot.revision += 1;
      const validated = parseSnapshot(snapshot, '待保存的 AI 港湾快照');
      this.writeSnapshotUnlocked(validated);
      return clone(result);
    });
  }

  private now(): string {
    return this.clock().toISOString();
  }

  private defaultSnapshot(): HarborSnapshot {
    const createdAt = this.now();
    return parseSnapshot({
      version: 1,
      revision: 0,
      runtimes: [
        {
          id: 'runtime-codex-local',
          name: '本机 Codex Runtime',
          kind: 'codex-app-server',
          description: 'AEOS Hub 当前已跑通的隔离 Codex app-server 运行时。',
          endpoint: 'stdio://codex-app-server',
          workdir: this.workspaceRoot,
          owner: 'AEOS Platform',
          capabilities: ['conversation', 'tool-calling', 'mcp', 'guard-events', 'streaming'],
          status: 'ready',
          lastSeenAt: createdAt,
          lastVerification: null,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      agents: [
        {
          id: 'agent-aeos-hub',
          name: 'AEOS 中枢 Agent',
          role: '跨域经营分析与编排',
          description: '面向管理者执行只读风险扫描、物料缺口核查与综合判断。',
          instructions: '结论必须引用 evidence_refs；只输出建议动作，不越过 Guard 执行高风险操作。',
          provider: 'openai-codex',
          model: 'account-default',
          runtimeId: 'runtime-codex-local',
          autonomyLevel: 'A2',
          access: 'workspace',
          skills: ['订单风险扫描', '物料缺口核查', '经营综合判断'],
          status: 'idle',
          createdAt,
          updatedAt: createdAt,
        },
      ],
      projects: [
        {
          id: 'project-pilot-01',
          key: 'PILOT-01',
          name: '经营风险只读试点',
          objective: '跑通中枢 Agent → Capability → Evidence → Guard 的 A1/A2 经营分析闭环。',
          status: 'in_progress',
          priority: 'high',
          leadType: 'agent',
          leadId: 'agent-aeos-hub',
          agentIds: ['agent-aeos-hub'],
          progress: 38,
          resourceRefs: ['mcp://demo-erp', 'file://AGENTS.md', 'evidence://data/evidence.jsonl'],
          startDate: '2026-09-03',
          targetDate: null,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      runs: [],
    }, 'AI 港湾默认快照');
  }

  private loadUnlocked(): HarborSnapshot {
    if (existsSync(this.file)) {
      try {
        return this.readSnapshotFile(this.file);
      } catch (primaryError) {
        if (!existsSync(this.backupFile)) throw primaryError;
        try {
          const backup = this.readSnapshotFile(this.backupFile);
          this.quarantineCorruptPrimary();
          this.writeSnapshotUnlocked(backup, false);
          return backup;
        } catch (backupError) {
          throw new HarborStoreCorruptError(
            `AI 港湾主数据和备份均不可读取: ${this.file}`,
            { primaryError, backupError },
          );
        }
      }
    }

    if (existsSync(this.backupFile)) {
      const backup = this.readSnapshotFile(this.backupFile);
      this.writeSnapshotUnlocked(backup, false);
      return backup;
    }

    const initial = this.defaultSnapshot();
    this.writeSnapshotUnlocked(initial, false);
    return initial;
  }

  private readSnapshotFile(file: string): HarborSnapshot {
    let raw: string;
    try {
      const size = statSync(file).size;
      if (size > MAX_HARBOR_FILE_BYTES) {
        throw new HarborStoreCorruptError(`AI 港湾数据超过 ${MAX_HARBOR_FILE_BYTES} 字节上限: ${file}`);
      }
      raw = readFileSync(file, 'utf8');
    } catch (error) {
      if (error instanceof HarborStoreCorruptError) throw error;
      throw new HarborStoreError('HARBOR_STORE_READ_FAILED', `读取 AI 港湾数据失败: ${file}`, error);
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new HarborStoreCorruptError(`AI 港湾数据不是有效 JSON: ${file}`, error);
    }
    return parseSnapshot(value, file);
  }

  private writeSnapshotUnlocked(snapshot: HarborSnapshot, preservePrevious = true): void {
    const validated = parseSnapshot(snapshot, '待保存的 AI 港湾快照');
    const payload = `${JSON.stringify(validated, null, 2)}\n`;
    if (Buffer.byteLength(payload, 'utf8') > MAX_HARBOR_FILE_BYTES) {
      throw new HarborStoreError('HARBOR_STORE_TOO_LARGE', `AI 港湾数据超过 ${MAX_HARBOR_FILE_BYTES} 字节上限`);
    }
    mkdirSync(dirname(this.file), { recursive: true });

    if (preservePrevious && existsSync(this.file)) {
      try {
        const previousPayload = readFileSync(this.file, 'utf8');
        parseSnapshot(JSON.parse(previousPayload), this.file);
        this.writeTextAtomic(this.backupFile, previousPayload);
      } catch (error) {
        if (!(error instanceof HarborStoreCorruptError) && !(error instanceof SyntaxError)) throw error;
      }
    }
    this.writeTextAtomic(this.file, payload);
  }

  private writeTextAtomic(target: string, payload: string): void {
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true });
      renameSync(temporary, target);
    } catch (error) {
      try {
        if (existsSync(temporary)) unlinkSync(temporary);
      } catch {
        // 保留原始写入错误。
      }
      throw new HarborStoreError('HARBOR_STORE_WRITE_FAILED', `写入 AI 港湾数据失败: ${target}`, error);
    }
  }

  private quarantineCorruptPrimary(): void {
    if (!existsSync(this.file)) return;
    const stamp = this.now().replace(/[:.]/g, '-');
    const quarantineFile = `${this.file}.corrupt-${stamp}-${randomUUID()}`;
    try {
      renameSync(this.file, quarantineFile);
    } catch (error) {
      throw new HarborStoreError('HARBOR_STORE_RECOVERY_FAILED', `隔离损坏数据失败: ${this.file}`, error);
    }
  }

  private withLock<T>(operation: () => T): T {
    mkdirSync(dirname(this.file), { recursive: true });
    const fd = this.acquireLock();
    try {
      return operation();
    } finally {
      try {
        closeSync(fd);
      } finally {
        try {
          unlinkSync(this.lockFile);
        } catch {
          // 锁可能已经被外部清理。
        }
      }
    }
  }

  private acquireLock(): number {
    const startedAt = Date.now();
    const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
    while (true) {
      let fd: number;
      try {
        fd = openSync(this.lockFile, 'wx', 0o600);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          throw new HarborStoreBusyError(`创建 AI 港湾数据锁失败: ${this.lockFile}`, error);
        }
        try {
          if (Date.now() - statSync(this.lockFile).mtimeMs > this.staleLockMs) {
            unlinkSync(this.lockFile);
            continue;
          }
        } catch (staleError) {
          if ((staleError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        }
        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          throw new HarborStoreBusyError(`AI 港湾数据正被其他进程写入: ${this.file}`, error);
        }
        Atomics.wait(sleepBuffer, 0, 0, 10);
        continue;
      }
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
        return fd;
      } catch (error) {
        try {
          closeSync(fd);
          unlinkSync(this.lockFile);
        } catch {
          // 保留写锁元数据时的原始错误。
        }
        throw new HarborStoreBusyError(`写入 AI 港湾数据锁失败: ${this.lockFile}`, error);
      }
    }
  }
}

const defaultStore = new HarborStore();

export function loadHarbor(): HarborSnapshot {
  return defaultStore.load();
}

export function saveHarbor(snapshot: HarborSnapshot): HarborSnapshot {
  return defaultStore.save(snapshot);
}

export function createHarborAgent(input: HarborAgentCreateInput): HarborAgent {
  return defaultStore.createAgent(input);
}

export function createHarborRuntime(input: HarborRuntimeCreateInput): HarborRuntime {
  return defaultStore.createRuntime(input);
}

export function createHarborProject(input: HarborProjectCreateInput): HarborProject {
  return defaultStore.createProject(input);
}

export function createHarborRun(input: HarborRunCreateInput): HarborRun {
  return defaultStore.createRun(input);
}

export function recordHarborRuntimeVerification(
  runtimeId: string,
  input: HarborRuntimeVerificationInput,
): HarborRuntime {
  return defaultStore.recordRuntimeVerification(runtimeId, input);
}
