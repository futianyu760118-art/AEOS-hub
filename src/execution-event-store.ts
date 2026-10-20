// 执行步骤事件存储：中台等执行面在任务过程中上报的「工序回执」。
// 追加写入 data/execution-events.jsonl；按 eventId 去重、按 runId 限流，文件超过 20MB 自动归档。
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { listSystems } from './system-registry.ts';
import { DEFAULT_TENANT_ID, resolveTenantId } from './tenant-registry.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const executionEventFile = join(root, 'data', 'execution-events.jsonl');
export const executionEventArchiveDir = join(root, 'data', 'execution-events-archive');

export const EXECUTION_EVENT_TYPES = [
  'run_received',
  'step_started',
  'step_completed',
  'tool_call',
  'tool_result',
  'model_call',
  'error',
  'note',
  'run_summary',
] as const;
export const EXECUTION_EVENT_STATUSES = ['started', 'completed', 'failed', 'info'] as const;

export const MAX_EVENT_DETAIL_BYTES = 8 * 1024;
export const MAX_EVENTS_PER_RUN = 200;
export const MAX_MEMORY_EVENTS = 20_000;
const ROTATE_BYTES = 20 * 1024 * 1024;
const ARCHIVE_RETENTION_DAYS = 30;

const trimmed = (max: number, min = 0) => z.string().min(min).max(max)
  .refine((value) => value === value.trim(), '字符串前后不能包含空白');

export const ExecutionEventSchema = z.object({
  eventId: trimmed(160, 1),
  tenantId: trimmed(160, 1).default(DEFAULT_TENANT_ID),
  runId: trimmed(160, 1),
  agentId: trimmed(160, 1),
  sourceSystem: trimmed(160, 1),
  seq: z.number().int().nonnegative(),
  event: z.enum(EXECUTION_EVENT_TYPES),
  name: trimmed(100),
  status: z.enum(EXECUTION_EVENT_STATUSES),
  startedAt: trimmed(64).nullable(),
  endedAt: trimmed(64).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  summary: trimmed(500),
  detail: z.unknown().nullable(),
  evidenceRefs: z.array(trimmed(200, 1)).max(20),
  receivedAt: trimmed(64, 1),
}).strict();

export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;

export interface ExecutionEventInput {
  eventId?: unknown;
  runId?: unknown;
  seq?: unknown;
  event?: unknown;
  name?: unknown;
  status?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  durationMs?: unknown;
  summary?: unknown;
  detail?: unknown;
  evidenceRefs?: unknown;
}

export interface ExecutionEventContext {
  agentId: string;
  sourceSystem: string;
  /** 该 run 在 Hub 记录的归属 Agent；null 表示 run 不存在。 */
  runAgentId: string | null;
}

export type ExecutionEventRecordResult =
  | { accepted: true; duplicate: boolean; event?: ExecutionEvent }
  | { accepted: false; duplicate: false; reason: string };

function byteLength(value: unknown): number {
  if (value === undefined) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function capDetail(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  const bytes = byteLength(value);
  if (bytes <= MAX_EVENT_DETAIL_BYTES) return value;
  let text = '';
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return { truncated: true, bytes, preview: text.slice(0, 4_000) };
}

export interface ExecutionEventStoreOptions {
  file?: string;
  archiveDir?: string;
  clock?: () => Date;
}

export class ExecutionEventStore {
  readonly file: string;
  private readonly archiveDir: string;
  private readonly clock: () => Date;
  private readonly byRun = new Map<string, ExecutionEvent[]>();
  private readonly seen = new Set<string>();

  constructor(options: ExecutionEventStoreOptions = {}) {
    this.file = options.file ?? executionEventFile;
    this.archiveDir = options.archiveDir ?? executionEventArchiveDir;
    this.clock = options.clock ?? (() => new Date());
    this.hydrate();
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private hydrate(): void {
    if (!existsSync(this.file)) return;
    try {
      const lines = readFileSync(this.file, 'utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines.slice(-MAX_MEMORY_EVENTS)) {
        try {
          const parsed = ExecutionEventSchema.parse(JSON.parse(line));
          this.index(parsed);
        } catch {
          // 单行损坏不影响其余事件。
        }
      }
    } catch {
      // 文件不可读时从空内存索引开始，不影响新事件写入。
    }
  }

  private index(event: ExecutionEvent): void {
    if (this.seen.has(event.eventId)) return;
    this.seen.add(event.eventId);
    const list = this.byRun.get(event.runId) ?? [];
    list.push(event);
    this.byRun.set(event.runId, list);
  }

  record(input: ExecutionEventInput, context: ExecutionEventContext): ExecutionEventRecordResult {
    const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
    const eventId = typeof input.eventId === 'string' ? input.eventId.trim() : '';
    if (!runId || !eventId) return { accepted: false, duplicate: false, reason: 'EVENT_ID_AND_RUN_ID_REQUIRED' };
    if (!context.runAgentId) return { accepted: false, duplicate: false, reason: 'RUN_NOT_FOUND' };
    if (context.runAgentId !== context.agentId) return { accepted: false, duplicate: false, reason: 'RUN_OWNERSHIP_MISMATCH' };
    if (this.seen.has(eventId)) return { accepted: true, duplicate: true };

    const existing = this.byRun.get(runId)?.length ?? 0;
    if (existing >= MAX_EVENTS_PER_RUN) return { accepted: false, duplicate: false, reason: 'RUN_EVENT_LIMIT_EXCEEDED' };

    const parsed = ExecutionEventSchema.safeParse({
      eventId,
      tenantId: resolveTenantId(context.sourceSystem, listSystems()),
      runId,
      agentId: context.agentId,
      sourceSystem: context.sourceSystem || 'unknown',
      seq: typeof input.seq === 'number' && Number.isFinite(input.seq) && input.seq >= 0 ? Math.trunc(input.seq) : 0,
      event: input.event,
      name: typeof input.name === 'string' ? input.name.slice(0, 100) : '',
      status: input.status ?? 'info',
      startedAt: typeof input.startedAt === 'string' && input.startedAt.trim() ? input.startedAt.trim().slice(0, 64) : null,
      endedAt: typeof input.endedAt === 'string' && input.endedAt.trim() ? input.endedAt.trim().slice(0, 64) : null,
      durationMs: typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) && input.durationMs >= 0 ? Math.trunc(input.durationMs) : null,
      summary: typeof input.summary === 'string' ? input.summary.slice(0, 500) : '',
      detail: capDetail(input.detail),
      evidenceRefs: Array.isArray(input.evidenceRefs)
        ? input.evidenceRefs.filter((item): item is string => typeof item === 'string').slice(0, 20)
        : [],
      receivedAt: this.nowIso(),
    });
    if (!parsed.success) {
      return { accepted: false, duplicate: false, reason: `INVALID_EVENT: ${parsed.error.issues[0]?.message ?? 'schema'}` };
    }
    const event = parsed.data;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      this.rotateIfNeeded();
      appendFileSync(this.file, `${JSON.stringify(event)}\n`, 'utf8');
    } catch (error) {
      return { accepted: false, duplicate: false, reason: `STORE_WRITE_FAILED: ${(error as Error).message}` };
    }
    this.index(event);
    return { accepted: true, duplicate: false, event };
  }

  listByRun(runId: string, limit = MAX_EVENTS_PER_RUN, tenantId?: string): ExecutionEvent[] {
    const bounded = Math.max(1, Math.min(Math.trunc(limit), MAX_EVENTS_PER_RUN));
    const events = (this.byRun.get(runId) ?? []).filter((event) => !tenantId || event.tenantId === tenantId);
    return events.slice().sort((a, b) => a.seq - b.seq || a.receivedAt.localeCompare(b.receivedAt)).slice(-bounded);
  }

  countByRun(runId: string): number {
    return this.byRun.get(runId)?.length ?? 0;
  }

  private rotateIfNeeded(): void {
    try {
      if (!existsSync(this.file)) return;
      if (statSync(this.file).size <= ROTATE_BYTES) return;
      mkdirSync(this.archiveDir, { recursive: true });
      renameSync(this.file, join(this.archiveDir, `execution-events-${this.clock().getTime()}.jsonl`));
      this.pruneArchives();
    } catch {
      // 轮转失败时继续写当前文件，避免丢事件。
    }
  }

  private pruneArchives(): void {
    try {
      const cutoff = this.clock().getTime() - ARCHIVE_RETENTION_DAYS * 24 * 3_600_000;
      for (const name of readdirSync(this.archiveDir)) {
        const full = join(this.archiveDir, name);
        try {
          if (statSync(full).mtimeMs < cutoff) unlinkSync(full);
        } catch {
          // 单个归档清理失败不影响其它文件。
        }
      }
    } catch {
      // 归档目录不存在时忽略。
    }
  }
}
