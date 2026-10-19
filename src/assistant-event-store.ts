// 外部智能助手观测事件：中台自己的助手（assistant 链路）不经过 Hub 派单，
// 由中台后端主动上报「会话/消息/工具调用/模型调用」摘要，Hub 只做留痕与展示。
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

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const assistantEventFile = join(root, 'data', 'assistant-events.jsonl');
export const assistantEventArchiveDir = join(root, 'data', 'assistant-events-archive');

export const ASSISTANT_EVENT_TYPES = [
  'conversation_started',
  'message',
  'tool_call',
  'tool_result',
  'model_call',
  'assistant_reply',
  'error',
  'conversation_ended',
  'note',
] as const;
export const ASSISTANT_EVENT_STATUSES = ['started', 'completed', 'failed', 'info'] as const;

export const MAX_ASSISTANT_DETAIL_BYTES = 8 * 1024;
export const MAX_ASSISTANT_EVENTS_PER_TRACE = 200;
const MAX_MEMORY_EVENTS = 20_000;
const ROTATE_BYTES = 20 * 1024 * 1024;
const ARCHIVE_RETENTION_DAYS = 30;

const trimmed = (max: number, min = 0) => z.string().min(min).max(max)
  .refine((value) => value === value.trim(), '字符串前后不能包含空白');

export const AssistantUsageSchema = z.object({
  modelId: trimmed(160).nullable(),
  tokensIn: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative(),
  cost: z.number().nonnegative().nullable(),
}).strict();

export const AssistantEventSchema = z.object({
  eventId: trimmed(160, 1),
  systemId: trimmed(160, 1),
  traceId: trimmed(160, 1),
  event: z.enum(ASSISTANT_EVENT_TYPES),
  name: trimmed(100),
  status: z.enum(ASSISTANT_EVENT_STATUSES),
  summary: trimmed(500),
  detail: z.unknown().nullable(),
  startedAt: trimmed(64).nullable(),
  endedAt: trimmed(64).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  usage: AssistantUsageSchema.nullable(),
  receivedAt: trimmed(64, 1),
}).strict();

export type AssistantEvent = z.infer<typeof AssistantEventSchema>;
export type AssistantUsage = z.infer<typeof AssistantUsageSchema>;

export interface AssistantEventInput {
  eventId?: unknown;
  traceId?: unknown;
  event?: unknown;
  name?: unknown;
  status?: unknown;
  summary?: unknown;
  detail?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  durationMs?: unknown;
  usage?: unknown;
}

export type AssistantEventRecordResult =
  | { accepted: true; duplicate: boolean; event?: AssistantEvent }
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
  if (bytes <= MAX_ASSISTANT_DETAIL_BYTES) return value;
  let text = '';
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return { truncated: true, bytes, preview: text.slice(0, 4_000) };
}

function parseUsage(value: unknown): AssistantUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const parsed = AssistantUsageSchema.safeParse({
    modelId: typeof record.modelId === 'string' && record.modelId.trim() ? record.modelId.trim().slice(0, 160) : null,
    tokensIn: int(record.tokensIn),
    cachedTokens: int(record.cachedTokens),
    tokensOut: int(record.tokensOut),
    cost: num(record.cost),
  });
  return parsed.success ? parsed.data : null;
}

export interface AssistantEventStoreOptions {
  file?: string;
  archiveDir?: string;
  clock?: () => Date;
}

export class AssistantEventStore {
  readonly file: string;
  private readonly archiveDir: string;
  private readonly clock: () => Date;
  private readonly events: AssistantEvent[] = [];
  private readonly seen = new Set<string>();

  constructor(options: AssistantEventStoreOptions = {}) {
    this.file = options.file ?? assistantEventFile;
    this.archiveDir = options.archiveDir ?? assistantEventArchiveDir;
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
          this.index(AssistantEventSchema.parse(JSON.parse(line)));
        } catch {
          // 单行损坏不影响其余事件。
        }
      }
    } catch {
      // 文件不可读时从空索引开始。
    }
  }

  private index(event: AssistantEvent): void {
    const key = `${event.systemId}:${event.eventId}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.events.push(event);
    if (this.events.length > MAX_MEMORY_EVENTS) this.events.splice(0, this.events.length - MAX_MEMORY_EVENTS);
  }

  record(input: AssistantEventInput, systemId: string): AssistantEventRecordResult {
    const eventId = typeof input.eventId === 'string' ? input.eventId.trim() : '';
    const traceId = typeof input.traceId === 'string' ? input.traceId.trim() : '';
    if (!eventId || !traceId) return { accepted: false, duplicate: false, reason: 'EVENT_ID_AND_TRACE_ID_REQUIRED' };
    if (this.seen.has(`${systemId}:${eventId}`)) return { accepted: true, duplicate: true };
    const count = this.events.filter((item) => item.systemId === systemId && item.traceId === traceId).length;
    if (count >= MAX_ASSISTANT_EVENTS_PER_TRACE) {
      return { accepted: false, duplicate: false, reason: 'TRACE_EVENT_LIMIT_EXCEEDED' };
    }
    const parsed = AssistantEventSchema.safeParse({
      eventId,
      systemId,
      traceId,
      event: input.event,
      name: typeof input.name === 'string' ? input.name.slice(0, 100) : '',
      status: input.status ?? 'info',
      summary: typeof input.summary === 'string' ? input.summary.slice(0, 500) : '',
      detail: capDetail(input.detail),
      startedAt: typeof input.startedAt === 'string' && input.startedAt.trim() ? input.startedAt.trim().slice(0, 64) : null,
      endedAt: typeof input.endedAt === 'string' && input.endedAt.trim() ? input.endedAt.trim().slice(0, 64) : null,
      durationMs: typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) && input.durationMs >= 0 ? Math.trunc(input.durationMs) : null,
      usage: parseUsage(input.usage),
      receivedAt: this.nowIso(),
    });
    if (!parsed.success) {
      return { accepted: false, duplicate: false, reason: `INVALID_EVENT: ${parsed.error.issues[0]?.message ?? 'schema'}` };
    }
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      this.rotateIfNeeded();
      appendFileSync(this.file, `${JSON.stringify(parsed.data)}\n`, 'utf8');
    } catch (error) {
      return { accepted: false, duplicate: false, reason: `STORE_WRITE_FAILED: ${(error as Error).message}` };
    }
    this.index(parsed.data);
    return { accepted: true, duplicate: false, event: parsed.data };
  }

  listEvents(filter: { systemId?: string; traceId?: string; limit?: number } = {}): AssistantEvent[] {
    const limit = Math.max(1, Math.min(Math.trunc(filter.limit ?? 200), 1_000));
    return this.events
      .filter((event) => !filter.systemId || event.systemId === filter.systemId)
      .filter((event) => !filter.traceId || event.traceId === filter.traceId)
      .slice()
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .slice(-limit);
  }

  listTraces(filter: { systemId?: string; limit?: number } = {}): Array<{
    traceId: string;
    systemId: string;
    count: number;
    firstAt: string;
    lastAt: string;
    lastSummary: string;
    hasError: boolean;
  }> {
    const byTrace = new Map<string, {
      traceId: string; systemId: string; count: number; firstAt: string; lastAt: string; lastSummary: string; hasError: boolean;
    }>();
    for (const event of this.events) {
      if (filter.systemId && event.systemId !== filter.systemId) continue;
      const key = `${event.systemId}:${event.traceId}`;
      const at = event.endedAt || event.startedAt || event.receivedAt;
      const existing = byTrace.get(key);
      if (!existing) {
        byTrace.set(key, {
          traceId: event.traceId,
          systemId: event.systemId,
          count: 1,
          firstAt: at,
          lastAt: at,
          lastSummary: event.summary,
          hasError: event.status === 'failed' || event.event === 'error',
        });
      } else {
        existing.count += 1;
        if (at < existing.firstAt) existing.firstAt = at;
        if (at >= existing.lastAt) {
          existing.lastAt = at;
          existing.lastSummary = event.summary;
        }
        if (event.status === 'failed' || event.event === 'error') existing.hasError = true;
      }
    }
    const limit = Math.max(1, Math.min(Math.trunc(filter.limit ?? 100), 500));
    return [...byTrace.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, limit);
  }

  countEvents(filter: { systemId?: string; traceId?: string } = {}): number {
    return this.events.filter((event) => (!filter.systemId || event.systemId === filter.systemId)
      && (!filter.traceId || event.traceId === filter.traceId)).length;
  }

  private rotateIfNeeded(): void {
    try {
      if (!existsSync(this.file)) return;
      if (statSync(this.file).size <= ROTATE_BYTES) return;
      mkdirSync(this.archiveDir, { recursive: true });
      renameSync(this.file, join(this.archiveDir, `assistant-events-${this.clock().getTime()}.jsonl`));
      this.pruneArchives();
    } catch {
      // 轮转失败时继续写当前文件。
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
