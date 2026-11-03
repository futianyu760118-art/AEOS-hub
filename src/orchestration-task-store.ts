// 跨系统任务交接存储：中台交计划，Hub 记录任务、步骤、状态与结果。
// 沿用 borrow-order / usage-ledger 的快照 + revision + 原子写模式。
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { atomicWrite } from './atomic-file.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const orchestrationTaskFile = join(root, 'data', 'orchestration-tasks.json');

export const ORCHESTRATION_TASK_MAX_TASKS = 10_000;
export const ORCHESTRATION_TASK_MAX_INPUT_BYTES = 64 * 1024;
export const ORCHESTRATION_TASK_MAX_RESULT_BYTES = 256 * 1024;
export const ORCHESTRATION_TASK_MAX_STEPS = 8;
const RESULT_PREVIEW_CHARS = 8_192;

const trimmedString = (max: number, min = 0) => z.string().min(min).max(max)
  .refine((value) => value === value.trim(), '字符串前后不能包含空白');
const identifierSchema = trimmedString(160, 1);
const optionalIdentifierSchema = trimmedString(160).nullable();
const timestampSchema = trimmedString(64, 1);

export const ORCHESTRATION_TASK_STATUSES = [
  'pending',
  'dispatched',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export type OrchestrationTaskStatus = (typeof ORCHESTRATION_TASK_STATUSES)[number];

export const ORCHESTRATION_RUN_STATUSES = [
  'pending',
  'dispatched',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export type OrchestrationRunStatus = (typeof ORCHESTRATION_RUN_STATUSES)[number];

export const OrchestrationTaskErrorInfoSchema = z.object({
  code: trimmedString(100, 1),
  message: trimmedString(1_000, 1),
  stepId: z.number().int().positive().nullable().default(null),
  stage: z.enum(['validation', 'dispatch', 'execution', 'timeout']).nullable().default(null),
}).strict();

export const OrchestrationPlanStepSchema = z.object({
  stepId: z.number().int().positive(),
  capability: trimmedString(100, 1),
  systemId: identifierSchema,
  input: z.unknown(),
}).strict();

export const OrchestrationContextSchema = z.object({
  userId: optionalIdentifierSchema.default(null),
  userDisplayName: optionalIdentifierSchema.default(null),
  businessObjectRef: trimmedString(500),
  summary: trimmedString(2_000),
  evidenceRefs: z.array(trimmedString(500)).max(100).default([]),
}).strict();

export const OrchestrationConstraintsSchema = z.object({
  readOnly: z.boolean(),
  maxSteps: z.number().int().min(1).max(ORCHESTRATION_TASK_MAX_STEPS),
}).strict();

export const OrchestrationTaskRunSchema = z.object({
  stepId: z.number().int().positive(),
  systemId: identifierSchema,
  capability: trimmedString(100, 1),
  status: z.enum(ORCHESTRATION_RUN_STATUSES),
  runId: optionalIdentifierSchema.default(null),
  borrowOrderId: optionalIdentifierSchema.default(null),
  startedAt: timestampSchema.nullable().default(null),
  endedAt: timestampSchema.nullable().default(null),
  result: z.unknown().nullable().default(null),
  resultBytes: z.number().int().nonnegative().default(0),
  truncated: z.boolean().default(false),
  evidenceRefs: z.array(trimmedString(500)).max(100).default([]),
  dataAsOf: timestampSchema.nullable().default(null),
  error: OrchestrationTaskErrorInfoSchema.nullable().default(null),
}).strict();

export const OrchestrationTaskRecordSchema = z.object({
  hubTaskId: identifierSchema,
  tenantId: identifierSchema,
  fromSystem: identifierSchema,
  taskId: identifierSchema,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/, 'requestHash 必须是 64 位十六进制'),
  conversationId: identifierSchema,
  turn: z.number().int().positive(),
  plan: z.array(OrchestrationPlanStepSchema).min(1).max(ORCHESTRATION_TASK_MAX_STEPS),
  context: OrchestrationContextSchema,
  constraints: OrchestrationConstraintsSchema,
  status: z.enum(ORCHESTRATION_TASK_STATUSES),
  runs: z.array(OrchestrationTaskRunSchema).min(1).max(ORCHESTRATION_TASK_MAX_STEPS),
  completedStepIds: z.array(z.number().int().positive()).max(ORCHESTRATION_TASK_MAX_STEPS).default([]),
  partialReason: trimmedString(1_000).nullable().default(null),
  error: OrchestrationTaskErrorInfoSchema.nullable().default(null),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  finishedAt: timestampSchema.nullable().default(null),
}).strict();

export const OrchestrationTaskSnapshotSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  updatedAt: timestampSchema,
  tasks: z.array(OrchestrationTaskRecordSchema).max(ORCHESTRATION_TASK_MAX_TASKS),
}).strict();

export type OrchestrationTaskErrorInfo = z.infer<typeof OrchestrationTaskErrorInfoSchema>;
export type OrchestrationPlanStep = z.infer<typeof OrchestrationPlanStepSchema>;
export type OrchestrationContext = z.infer<typeof OrchestrationContextSchema>;
export type OrchestrationConstraints = z.infer<typeof OrchestrationConstraintsSchema>;
export type OrchestrationTaskRun = z.infer<typeof OrchestrationTaskRunSchema>;
export type OrchestrationTaskRecord = z.infer<typeof OrchestrationTaskRecordSchema>;
export type OrchestrationTaskSnapshot = z.infer<typeof OrchestrationTaskSnapshotSchema>;

export interface CreateOrchestrationTaskInput {
  tenantId: string;
  fromSystem: string;
  taskId: string;
  requestHash: string;
  conversationId: string;
  turn: number;
  plan: OrchestrationPlanStep[];
  context: OrchestrationContext;
  constraints: OrchestrationConstraints;
}

export class OrchestrationTaskStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OrchestrationTaskStoreError';
    this.code = code;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function orchestrationRequestHash(input: {
  taskId: string;
  conversationId: string;
  turn: number;
  plan: OrchestrationPlanStep[];
  context: OrchestrationContext;
  constraints: OrchestrationConstraints;
}): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

export function capOrchestrationResult(value: unknown): { result: unknown; resultBytes: number; truncated: boolean } {
  const bytes = byteLength(value);
  if (bytes <= ORCHESTRATION_TASK_MAX_RESULT_BYTES) {
    return { result: value ?? null, resultBytes: bytes, truncated: false };
  }
  const text = JSON.stringify(value ?? null);
  return {
    result: { truncated: true, bytes, preview: text.slice(0, RESULT_PREVIEW_CHARS) },
    resultBytes: bytes,
    truncated: true,
  };
}

export interface OrchestrationTaskStoreOptions {
  file?: string;
  clock?: () => Date;
  idFactory?: () => string;
}

export class OrchestrationTaskStore {
  readonly file: string;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(options: OrchestrationTaskStoreOptions = {}) {
    this.file = options.file ?? orchestrationTaskFile;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private empty(): OrchestrationTaskSnapshot {
    return { version: 1, revision: 0, updatedAt: this.nowIso(), tasks: [] };
  }

  load(): OrchestrationTaskSnapshot {
    if (!existsSync(this.file)) return this.empty();
    const parse = (text: string): OrchestrationTaskSnapshot | null => {
      try {
        return OrchestrationTaskSnapshotSchema.parse(JSON.parse(text));
      } catch {
        return null;
      }
    };
    const primary = parse(readFileSync(this.file, 'utf8'));
    if (primary) return primary;
    const backupFile = `${this.file}.bak`;
    if (existsSync(backupFile)) {
      const backup = parse(readFileSync(backupFile, 'utf8'));
      if (backup) {
        console.warn('[orchestration-task] 主文件损坏，已从 .bak 恢复');
        return backup;
      }
    }
    try {
      renameSync(this.file, `${this.file}.corrupt-${this.clock().getTime()}.json`);
    } catch {
      // 隔离失败则保留原文件，交由下次重试。
    }
    console.warn('[orchestration-task] 任务文件损坏，已隔离并从空账本开始');
    return this.empty();
  }

  save(snapshot: OrchestrationTaskSnapshot): OrchestrationTaskSnapshot {
    const validated = OrchestrationTaskSnapshotSchema.parse({ ...snapshot, updatedAt: this.nowIso() });
    atomicWrite(this.file, `${JSON.stringify(validated, null, 2)}\n`);
    return validated;
  }

  ensure(): OrchestrationTaskSnapshot {
    if (existsSync(this.file)) return this.load();
    return this.save(this.empty());
  }

  create(input: CreateOrchestrationTaskInput): OrchestrationTaskRecord {
    const snapshot = this.load();
    if (snapshot.tasks.length >= ORCHESTRATION_TASK_MAX_TASKS) {
      throw new OrchestrationTaskStoreError('ORCHESTRATION_TASK_CAPACITY_EXCEEDED', '任务存储已达上限');
    }
    if (snapshot.tasks.some((task) => task.fromSystem === input.fromSystem && task.taskId === input.taskId)) {
      throw new OrchestrationTaskStoreError('ORCHESTRATION_TASK_DUPLICATE', '同一系统下 taskId 已存在');
    }
    if (input.plan.length > ORCHESTRATION_TASK_MAX_STEPS) {
      throw new OrchestrationTaskStoreError('ORCHESTRATION_TASK_INVALID', `步骤数不能超过 ${ORCHESTRATION_TASK_MAX_STEPS}`);
    }
    if (byteLength({ plan: input.plan, context: input.context }) > ORCHESTRATION_TASK_MAX_INPUT_BYTES) {
      throw new OrchestrationTaskStoreError('ORCHESTRATION_TASK_INPUT_TOO_LARGE', `任务输入超过 ${ORCHESTRATION_TASK_MAX_INPUT_BYTES} 字节`);
    }
    const now = this.nowIso();
    const record = OrchestrationTaskRecordSchema.parse({
      hubTaskId: `hub-task-${this.idFactory()}`,
      tenantId: input.tenantId,
      fromSystem: input.fromSystem,
      taskId: input.taskId,
      requestHash: input.requestHash,
      conversationId: input.conversationId,
      turn: input.turn,
      plan: input.plan,
      context: input.context,
      constraints: input.constraints,
      status: 'pending',
      runs: input.plan.map((step) => ({
        stepId: step.stepId,
        systemId: step.systemId,
        capability: step.capability,
        status: 'pending',
      })),
      completedStepIds: [],
      partialReason: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
    });
    this.save({ ...snapshot, revision: snapshot.revision + 1, tasks: [...snapshot.tasks, record] });
    return record;
  }

  get(hubTaskId: string): OrchestrationTaskRecord | null {
    return this.load().tasks.find((task) => task.hubTaskId === hubTaskId) ?? null;
  }

  findByTaskId(fromSystem: string, taskId: string): OrchestrationTaskRecord | null {
    return this.load().tasks.find((task) => task.fromSystem === fromSystem && task.taskId === taskId) ?? null;
  }

  update(hubTaskId: string, updater: (task: OrchestrationTaskRecord) => OrchestrationTaskRecord): OrchestrationTaskRecord {
    const snapshot = this.load();
    const index = snapshot.tasks.findIndex((task) => task.hubTaskId === hubTaskId);
    if (index < 0) throw new OrchestrationTaskStoreError('ORCHESTRATION_TASK_NOT_FOUND', `任务不存在：${hubTaskId}`);
    const next = OrchestrationTaskRecordSchema.parse({ ...updater(snapshot.tasks[index]), updatedAt: this.nowIso() });
    const tasks = snapshot.tasks.slice();
    tasks[index] = next;
    this.save({ ...snapshot, revision: snapshot.revision + 1, tasks });
    return next;
  }

  list(filter: { fromSystem?: string; tenantId?: string; status?: OrchestrationTaskStatus; limit?: number } = {}): OrchestrationTaskRecord[] {
    const limit = Math.max(1, Math.min(Math.trunc(filter.limit ?? 100), 1_000));
    return this.load().tasks
      .filter((task) => !filter.tenantId || task.tenantId === filter.tenantId)
      .filter((task) => !filter.fromSystem || task.fromSystem === filter.fromSystem)
      .filter((task) => !filter.status || task.status === filter.status)
      .slice()
      .reverse()
      .slice(0, limit);
  }
}
