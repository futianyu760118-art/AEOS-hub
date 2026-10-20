// 用量台账：把每次模型调用的 Token 与成本记账，按 Agent / 系统聚合账单（设计稿 §3.2「算钱」）。
// 独立存放 data/usage-ledger.json（与 ai-harbor.json 分开，避免大快照频繁整文件重写）。
// 数据来源两条：中枢自身 LLM（execution-intent-llm 的 DeepSeek 用量回调）+ 执行面 run_complete 用量上报。
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const usageLedgerFile = join(root, 'data', 'usage-ledger.json');

const trimmedString = (max: number, min = 0) => z.string()
  .min(min)
  .max(max)
  .refine((value) => value === value.trim(), '字符串前后不能包含空白');
const identifierSchema = trimmedString(160, 1);
const timestampSchema = z.string().min(1).max(64);
// 用量来源：direct=Hub 直连供应商；gateway=统一网关；app-server=Codex 运行时通知；
// reported=执行面 run_complete 上报；missing=调用发生但未拿到用量；legacy=引入该字段前的历史账。
const METERING_SOURCES = ['direct', 'gateway', 'app-server', 'reported', 'missing', 'legacy'] as const;

export const UsageEventSchema = z.object({
  id: identifierSchema,
  agentId: identifierSchema,
  systemId: identifierSchema,
  modelId: identifierSchema.nullable(),
  runId: identifierSchema.nullable(),
  // 借调归属：systemId/agentId 是执行方；以下三个字段描述请求方（消费方）。
  consumerSystemId: identifierSchema.nullable().default(null),
  consumerAgentId: identifierSchema.nullable().default(null),
  borrowOrderId: identifierSchema.nullable().default(null),
  tokensIn: z.number().int().nonnegative(),
  // 输入 Token 中命中缓存的部分（用于按缓存价计费与后续重算）。
  cachedTokens: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
  metering: z.enum(METERING_SOURCES).default('legacy'),
  startedAt: timestampSchema,
  endedAt: timestampSchema,
}).strict();

export const UsageLedgerSnapshotSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  events: z.array(UsageEventSchema),
}).strict();

export type UsageEvent = z.infer<typeof UsageEventSchema>;
export type UsageLedgerSnapshot = z.infer<typeof UsageLedgerSnapshotSchema>;

/** append 的入参：id / 时间戳由台账内部补齐，调用方只关心「谁、用什么模型、耗了多少」。 */
export interface UsageEventAppendInput {
  agentId: string;
  systemId: string;
  modelId: string | null;
  runId: string | null;
  consumerSystemId?: string | null;
  consumerAgentId?: string | null;
  borrowOrderId?: string | null;
  tokensIn: number;
  cachedTokens?: number;
  tokensOut: number;
  cost: number;
  metering?: (typeof METERING_SOURCES)[number];
  startedAt: string;
  endedAt: string;
}

export interface UsageByAgentRow {
  agentId: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  events: number;
  lastAt: string | null;
}

export interface UsageBySystemRow {
  systemId: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  events: number;
  lastAt: string | null;
}

export interface UsageByConsumerSystemRow {
  consumerSystemId: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  events: number;
}

function latestTimestamp(current: string | null, candidate: string | null | undefined): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

export class UsageLedgerStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'UsageLedgerStoreError';
    this.code = code;
  }
}

export interface UsageLedgerStoreOptions {
  file?: string;
  clock?: () => Date;
  idFactory?: () => string;
}

function parseSnapshot(raw: unknown, label: string): UsageLedgerSnapshot {
  const result = UsageLedgerSnapshotSchema.safeParse(raw);
  if (!result.success) {
    throw new UsageLedgerStoreError(
      'USAGE_LEDGER_INVALID',
      `${label} 校验失败: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  }
  return result.data;
}

function writeTextAtomic(target: string, payload: string): void {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temporary, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true });
    if (existsSync(target)) {
      // 保留上一版备份，便于人工回滚（尽力而为，失败不阻断写入）。
      try {
        writeFileSync(`${target}.bak`, readFileSync(target), { encoding: 'utf8', mode: 0o600, flush: true });
      } catch {
        // 备份失败不影响本次写入。
      }
    }
    renameSync(temporary, target);
  } catch (error) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      // 保留原始写入错误。
    }
    throw new UsageLedgerStoreError('USAGE_LEDGER_WRITE_FAILED', `写入用量台账失败: ${target}`, error);
  }
}

export class UsageLedgerStore {
  readonly file: string;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(options: UsageLedgerStoreOptions = {}) {
    this.file = options.file ?? usageLedgerFile;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  load(): UsageLedgerSnapshot {
    if (!existsSync(this.file)) return { version: 1, revision: 0, events: [] };
    try {
      return parseSnapshot(JSON.parse(readFileSync(this.file, 'utf8')), '用量台账快照');
    } catch {
      // 损坏的持久化文件不阻塞服务启动：隔离为 corrupt-*.json 后回退为空账本。
      try {
        renameSync(this.file, `${this.file}.corrupt-${this.clock().getTime()}.json`);
      } catch {
        // 隔离失败则保持原文件，交由下次重试。
      }
      return { version: 1, revision: 0, events: [] };
    }
  }

  save(snapshot: UsageLedgerSnapshot): UsageLedgerSnapshot {
    const validated = parseSnapshot(snapshot, '待保存的用量台账快照');
    writeTextAtomic(this.file, `${JSON.stringify(validated, null, 2)}\n`);
    return validated;
  }

  /** 幂等初始化：文件不存在时播种空账本。 */
  ensure(): UsageLedgerSnapshot {
    if (existsSync(this.file)) return this.load();
    return this.save({ version: 1, revision: 0, events: [] });
  }

  /** 追加一条用量事件；同一 runId 幂等（重复回传不重复记账）。 */
  append(input: UsageEventAppendInput): UsageEvent {
    const parsed = UsageEventSchema.safeParse({
      id: `usage-${this.idFactory()}`,
      agentId: input.agentId,
      systemId: input.systemId,
      modelId: input.modelId,
      runId: input.runId,
      consumerSystemId: typeof input.consumerSystemId === 'string' && input.consumerSystemId.trim() ? input.consumerSystemId.trim() : null,
      consumerAgentId: typeof input.consumerAgentId === 'string' && input.consumerAgentId.trim() ? input.consumerAgentId.trim() : null,
      borrowOrderId: typeof input.borrowOrderId === 'string' && input.borrowOrderId.trim() ? input.borrowOrderId.trim() : null,
      tokensIn: input.tokensIn,
      cachedTokens: input.cachedTokens ?? 0,
      tokensOut: input.tokensOut,
      cost: input.cost,
      metering: input.metering ?? 'reported',
      startedAt: input.startedAt,
      endedAt: input.endedAt,
    });
    if (!parsed.success) {
      throw new UsageLedgerStoreError(
        'USAGE_LEDGER_INVALID_ARGUMENT',
        `用量事件校验失败: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
      );
    }
    const event = parsed.data;
    const snapshot = this.load();
    if (event.runId) {
      const existing = snapshot.events.find((item) => item.runId === event.runId);
      if (existing) return existing;
    }
    this.save({ version: 1, revision: snapshot.revision + 1, events: [...snapshot.events, event] });
    return event;
  }

  aggregateByAgent(): UsageByAgentRow[] {
    const byAgent = new Map<string, UsageByAgentRow>();
    for (const event of this.load().events) {
      const row = byAgent.get(event.agentId) ?? { agentId: event.agentId, tokensIn: 0, tokensOut: 0, cost: 0, events: 0, lastAt: null };
      row.tokensIn += event.tokensIn;
      row.tokensOut += event.tokensOut;
      row.cost += event.cost;
      row.events += 1;
      row.lastAt = latestTimestamp(row.lastAt, event.endedAt);
      byAgent.set(event.agentId, row);
    }
    return [...byAgent.values()].sort((a, b) => b.cost - a.cost || b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut));
  }

  aggregateBySystem(): UsageBySystemRow[] {
    const bySystem = new Map<string, UsageBySystemRow>();
    for (const event of this.load().events) {
      const row = bySystem.get(event.systemId) ?? { systemId: event.systemId, tokensIn: 0, tokensOut: 0, cost: 0, events: 0, lastAt: null };
      row.tokensIn += event.tokensIn;
      row.tokensOut += event.tokensOut;
      row.cost += event.cost;
      row.events += 1;
      row.lastAt = latestTimestamp(row.lastAt, event.endedAt);
      bySystem.set(event.systemId, row);
    }
    return [...bySystem.values()].sort((a, b) => b.cost - a.cost || b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut));
  }

  /** 按借调请求方聚合（仅统计带 consumerSystemId 的事件）。 */
  aggregateByConsumerSystem(): UsageByConsumerSystemRow[] {
    const byConsumer = new Map<string, UsageByConsumerSystemRow>();
    for (const event of this.load().events) {
      if (!event.consumerSystemId) continue;
      const row = byConsumer.get(event.consumerSystemId)
        ?? { consumerSystemId: event.consumerSystemId, tokensIn: 0, tokensOut: 0, cost: 0, events: 0 };
      row.tokensIn += event.tokensIn;
      row.tokensOut += event.tokensOut;
      row.cost += event.cost;
      row.events += 1;
      byConsumer.set(event.consumerSystemId, row);
    }
    return [...byConsumer.values()].sort((a, b) => b.cost - a.cost || b.tokensIn + b.tokensOut - (a.tokensIn + a.tokensOut));
  }

  list(limit = 200): UsageEvent[] {
    const events = [...this.load().events].reverse();
    const bounded = Math.max(0, Math.min(Math.trunc(limit), 1000));
    return events.slice(0, bounded);
  }
}

const defaultStore = new UsageLedgerStore();

export function ensureUsageLedger(): UsageLedgerSnapshot {
  return defaultStore.ensure();
}

export function appendUsageEvent(input: UsageEventAppendInput): UsageEvent {
  return defaultStore.append(input);
}

export function aggregateUsageByAgent(): UsageByAgentRow[] {
  return defaultStore.aggregateByAgent();
}

export function aggregateUsageBySystem(): UsageBySystemRow[] {
  return defaultStore.aggregateBySystem();
}

export function aggregateUsageByConsumerSystem(): UsageByConsumerSystemRow[] {
  return defaultStore.aggregateByConsumerSystem();
}

export function listUsageEvents(limit = 200): UsageEvent[] {
  return defaultStore.list(limit);
}
