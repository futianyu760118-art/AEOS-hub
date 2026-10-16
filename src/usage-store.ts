// 用量与费用台账：捕获 Runtime 的 tokenUsage 事件，按智能体 / 会话 / 模型记账，
// 依据模型注册中心的单价估算费用。存储模式与 harbor-store 一致：锁 + 备份 + revision。
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
import type { ModelPricing } from './model-registry.ts';

const tokenCount = z.number().int().min(0).max(1_000_000_000_000);
const timestampSchema = z.string().datetime({ offset: true });
const MAX_USAGE_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_RECORDS = 20_000;

export interface TokenUsageCounts {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export const UsageRecordSchema = z.object({
  id: z.string().min(1).max(160),
  occurredAt: timestampSchema,
  conversationId: z.string().min(1).max(160).nullable(),
  sessionId: z.string().min(1).max(160),
  runId: z.string().min(1).max(160).nullable(),
  agentId: z.string().min(1).max(160),
  agentName: z.string().min(1).max(160),
  scope: z.enum(['hub', 'agent']),
  provider: z.string().min(1).max(80),
  model: z.string().min(1).max(160),
  inputTokens: tokenCount,
  cachedInputTokens: tokenCount,
  cacheWriteInputTokens: tokenCount,
  outputTokens: tokenCount,
  reasoningOutputTokens: tokenCount,
  totalTokens: tokenCount,
  currency: z.enum(['CNY', 'USD']).nullable(),
  cost: z.number().min(0).nullable(),
  priced: z.boolean(),
}).strict();

export const UsageBucketSchema = z.object({
  records: z.number().int().nonnegative(),
  totalTokens: tokenCount,
  inputTokens: tokenCount,
  cachedInputTokens: tokenCount,
  cacheWriteInputTokens: tokenCount,
  outputTokens: tokenCount,
  reasoningOutputTokens: tokenCount,
  cost: z.record(z.string().max(8), z.number().min(0)),
  unpricedRecords: z.number().int().nonnegative(),
}).strict();

export const UsageSnapshotSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative().default(0),
  // 每个会话最近一次上报的累计用量，用于把累计值换算成增量，避免重复记账。
  threadTotals: z.record(z.string().min(1).max(160), UsageRecordSchema.partial().extend({
    inputTokens: tokenCount,
    cachedInputTokens: tokenCount,
    cacheWriteInputTokens: tokenCount,
    outputTokens: tokenCount,
    reasoningOutputTokens: tokenCount,
    totalTokens: tokenCount,
  })),
  // 明细滚动归档后按月汇总（含按 Agent 拆分），保证长周期费用统计不丢失。
  monthlyRollup: z.record(z.string().regex(/^\d{4}-\d{2}$/), UsageBucketSchema.extend({
    byAgent: z.record(z.string().min(1).max(160), UsageBucketSchema.extend({
      agentName: z.string().min(1).max(160),
    })),
  })),
  records: z.array(UsageRecordSchema),
}).strict();

export type UsageRecord = z.infer<typeof UsageRecordSchema>;
export type UsageBucket = z.infer<typeof UsageBucketSchema>;
export type UsageSnapshot = z.infer<typeof UsageSnapshotSchema>;

export interface RecordUsageInput {
  sessionId: string;
  runId?: string | null;
  conversationId?: string | null;
  agentId: string;
  agentName: string;
  scope: 'hub' | 'agent';
  provider: string;
  model: string;
  /** 事件上报的会话累计用量（非增量）。 */
  usage: TokenUsageCounts;
}

export interface UsageSummaryQuery {
  from?: string;
  to?: string;
  agentId?: string;
  recentLimit?: number;
}

export interface UsageAgentSummary extends UsageBucket {
  agentId: string;
  agentName: string;
}

export interface UsageModelSummary extends UsageBucket {
  provider: string;
  model: string;
}

export interface UsageDaySummary extends UsageBucket {
  day: string;
}

export interface UsageSummary {
  from: string;
  to: string;
  agentId: string | null;
  totals: UsageBucket;
  byAgent: UsageAgentSummary[];
  byModel: UsageModelSummary[];
  byDay: UsageDaySummary[];
  recent: UsageRecord[];
  rolledUpMonths: string[];
}

export type PricingResolver = (provider: string, model: string) => ModelPricing | null;

export class UsageStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
  }
}

export class UsageStoreCorruptError extends UsageStoreError {
  constructor(message: string, cause?: unknown) {
    super('USAGE_STORE_CORRUPT', message, cause);
  }
}

export class UsageStoreBusyError extends UsageStoreError {
  constructor(message: string, cause?: unknown) {
    super('USAGE_STORE_BUSY', message, cause);
  }
}

export interface UsageStoreOptions {
  file?: string;
  clock?: () => Date;
  idFactory?: () => string;
  lockTimeoutMs?: number;
  staleLockMs?: number;
  maxRecords?: number;
  /** 定价解析器；缺省时不估算费用（priced=false）。 */
  pricingResolver?: PricingResolver;
}

function emptyBucket(): UsageBucket {
  return {
    records: 0,
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    cost: {},
    unpricedRecords: 0,
  };
}

function addToBucket(bucket: UsageBucket, record: UsageRecord): void {
  bucket.records += 1;
  bucket.totalTokens += record.totalTokens;
  bucket.inputTokens += record.inputTokens;
  bucket.cachedInputTokens += record.cachedInputTokens;
  bucket.cacheWriteInputTokens += record.cacheWriteInputTokens;
  bucket.outputTokens += record.outputTokens;
  bucket.reasoningOutputTokens += record.reasoningOutputTokens;
  if (record.priced && record.currency && record.cost !== null) {
    bucket.cost[record.currency] = roundCost((bucket.cost[record.currency] ?? 0) + record.cost);
  } else {
    bucket.unpricedRecords += 1;
  }
}

function roundCost(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

/** 依据模型单价估算一次增量用量的费用；缓存写入按输入单价计（保守估算）。 */
export function estimateCost(pricing: ModelPricing, usage: TokenUsageCounts): { currency: 'CNY' | 'USD'; amount: number } {
  const inputBillable = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const inputTokens = inputBillable + usage.cacheWriteInputTokens;
  const amount = (
    inputTokens * pricing.inputPerMTok
    + usage.cachedInputTokens * pricing.cachedInputPerMTok
    + usage.outputTokens * pricing.outputPerMTok
  ) / 1_000_000;
  return { currency: pricing.currency, amount: roundCost(amount) };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '<root>'}: ${issue.message}`)
    .join('; ');
}

function parseSnapshot(value: unknown, source: string): UsageSnapshot {
  const result = UsageSnapshotSchema.safeParse(value);
  if (!result.success) {
    throw new UsageStoreCorruptError(`${source} 数据结构无效: ${formatIssues(result.error)}`, result.error);
  }
  return result.data;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

function startOfDay(value: string): string {
  return `${value}T00:00:00.000Z`;
}

function endOfDay(value: string): string {
  return `${value}T23:59:59.999Z`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 取日期边界（YYYY-MM-DD）；不合法时回退到默认日期。 */
function normalizeBound(value: string | undefined, fallbackDate: string): string {
  const raw = (value ?? '').trim().slice(0, 10);
  if (DATE_ONLY.test(raw)) return raw;
  return fallbackDate;
}

export class UsageStore {
  readonly file: string;
  readonly backupFile: string;
  readonly lockFile: string;

  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;
  private readonly maxRecords: number;
  private readonly pricingResolver: PricingResolver;

  constructor(options: UsageStoreOptions = {}) {
    this.file = options.file ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'usage.json');
    this.backupFile = `${this.file}.bak`;
    this.lockFile = `${this.file}.lock`;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 2_000;
    this.staleLockMs = options.staleLockMs ?? 30_000;
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.pricingResolver = options.pricingResolver ?? (() => null);
  }

  load(): UsageSnapshot {
    return this.withLock(() => clone(this.loadUnlocked()));
  }

  /**
   * 记录一次会话累计用量：与 threadTotals 求正增量后入库。
   * 返回新建的记录；无正向增量（重复事件 / 回退）时返回 null。
   */
  record(input: RecordUsageInput): UsageRecord | null {
    return this.mutate((snapshot) => {
      const previous = snapshot.threadTotals[input.sessionId];
      const delta: TokenUsageCounts = {
        inputTokens: Math.max(0, input.usage.inputTokens - (previous?.inputTokens ?? 0)),
        cachedInputTokens: Math.max(0, input.usage.cachedInputTokens - (previous?.cachedInputTokens ?? 0)),
        cacheWriteInputTokens: Math.max(0, input.usage.cacheWriteInputTokens - (previous?.cacheWriteInputTokens ?? 0)),
        outputTokens: Math.max(0, input.usage.outputTokens - (previous?.outputTokens ?? 0)),
        reasoningOutputTokens: Math.max(0, input.usage.reasoningOutputTokens - (previous?.reasoningOutputTokens ?? 0)),
        totalTokens: Math.max(0, input.usage.totalTokens - (previous?.totalTokens ?? 0)),
      };
      snapshot.threadTotals[input.sessionId] = {
        inputTokens: input.usage.inputTokens,
        cachedInputTokens: input.usage.cachedInputTokens,
        cacheWriteInputTokens: input.usage.cacheWriteInputTokens,
        outputTokens: input.usage.outputTokens,
        reasoningOutputTokens: input.usage.reasoningOutputTokens,
        totalTokens: input.usage.totalTokens,
      };
      const hasDelta = delta.totalTokens > 0 || delta.inputTokens > 0 || delta.outputTokens > 0;
      if (!hasDelta) return null;

      const pricing = this.pricingResolver(input.provider, input.model);
      const cost = pricing ? estimateCost(pricing, delta) : null;
      const record = UsageRecordSchema.parse({
        id: `usage-${this.idFactory()}`,
        occurredAt: this.now(),
        conversationId: input.conversationId ?? null,
        sessionId: input.sessionId,
        runId: input.runId ?? null,
        agentId: input.agentId,
        agentName: input.agentName,
        scope: input.scope,
        provider: input.provider,
        model: input.model,
        ...delta,
        currency: cost?.currency ?? null,
        cost: cost?.amount ?? null,
        priced: cost !== null,
      });
      snapshot.records.push(record);
      this.foldOverflow(snapshot);
      return record;
    });
  }

  summary(query: UsageSummaryQuery = {}): UsageSummary {
    const snapshot = this.load();
    const today = this.now().slice(0, 10);
    const from = startOfDay(normalizeBound(query.from, `${today.slice(0, 7)}-01`));
    const to = endOfDay(normalizeBound(query.to, today));
    const agentFilter = query.agentId?.trim() || null;

    const totals = emptyBucket();
    const agents = new Map<string, UsageAgentSummary>();
    const models = new Map<string, UsageModelSummary>();
    const days = new Map<string, UsageDaySummary>();

    const agentBucket = (agentId: string, agentName: string): UsageAgentSummary => {
      const existing = agents.get(agentId);
      if (existing) {
        if (agentName) existing.agentName = agentName;
        return existing;
      }
      const created = { agentId, agentName: agentName || agentId, ...emptyBucket() };
      agents.set(agentId, created);
      return created;
    };
    const modelBucket = (provider: string, model: string): UsageModelSummary => {
      const key = `${provider}/${model}`;
      const existing = models.get(key);
      if (existing) return existing;
      const created = { provider, model, ...emptyBucket() };
      models.set(key, created);
      return created;
    };
    const dayBucket = (day: string): UsageDaySummary => {
      const existing = days.get(day);
      if (existing) return existing;
      const created = { day, ...emptyBucket() };
      days.set(day, created);
      return created;
    };

    // 1) 滚动归档的整月汇总（月粒度，与明细区间并集后不重复计数）。
    const rolledUpMonths: string[] = [];
    for (const [month, rollup] of Object.entries(snapshot.monthlyRollup)) {
      const monthStart = `${month}-01`;
      if (monthStart > to.slice(0, 10) || month < from.slice(0, 7)) continue;
      rolledUpMonths.push(month);
      const agentFiltered = agentFilter ? null : rollup;
      const target = agentFiltered ?? (agentFilter && rollup.byAgent[agentFilter] ? rollup.byAgent[agentFilter] : null);
      if (target) {
        totals.records += target.records;
        totals.totalTokens += target.totalTokens;
        totals.inputTokens += target.inputTokens;
        totals.cachedInputTokens += target.cachedInputTokens;
        totals.cacheWriteInputTokens += target.cacheWriteInputTokens;
        totals.outputTokens += target.outputTokens;
        totals.reasoningOutputTokens += target.reasoningOutputTokens;
        totals.unpricedRecords += target.unpricedRecords;
        for (const [currency, amount] of Object.entries(target.cost)) {
          totals.cost[currency] = roundCost((totals.cost[currency] ?? 0) + amount);
        }
      }
      const agentSources = agentFilter
        ? rollup.byAgent[agentFilter] ? [[agentFilter, rollup.byAgent[agentFilter]] as const] : []
        : Object.entries(rollup.byAgent);
      for (const [agentId, bucket] of agentSources) {
        const target2 = agentBucket(agentId, bucket.agentName);
        target2.records += bucket.records;
        target2.totalTokens += bucket.totalTokens;
        target2.inputTokens += bucket.inputTokens;
        target2.cachedInputTokens += bucket.cachedInputTokens;
        target2.cacheWriteInputTokens += bucket.cacheWriteInputTokens;
        target2.outputTokens += bucket.outputTokens;
        target2.reasoningOutputTokens += bucket.reasoningOutputTokens;
        target2.unpricedRecords += bucket.unpricedRecords;
        for (const [currency, amount] of Object.entries(bucket.cost)) {
          target2.cost[currency] = roundCost((target2.cost[currency] ?? 0) + amount);
        }
      }
    }

    // 2) 当前明细记录。
    const recentLimit = Math.max(1, Math.min(200, query.recentLimit ?? 20));
    const recent: UsageRecord[] = [];
    for (let index = snapshot.records.length - 1; index >= 0; index -= 1) {
      const record = snapshot.records[index];
      const inRange = record.occurredAt >= from && record.occurredAt <= to;
      if (!inRange) continue;
      if (agentFilter && record.agentId !== agentFilter) continue;
      if (recent.length < recentLimit) recent.push(record);
      addToBucket(totals, record);
      addToBucket(agentBucket(record.agentId, record.agentName), record);
      addToBucket(modelBucket(record.provider, record.model), record);
      addToBucket(dayBucket(record.occurredAt.slice(0, 10)), record);
    }

    return {
      from,
      to,
      agentId: agentFilter,
      totals: clone(totals),
      byAgent: [...agents.values()].map((bucket) => clone(bucket))
        .sort((left, right) => (right.cost.CNY ?? 0) + (right.cost.USD ?? 0) - (left.cost.CNY ?? 0) - (left.cost.USD ?? 0) || right.totalTokens - left.totalTokens),
      byModel: [...models.values()].map((bucket) => clone(bucket))
        .sort((left, right) => right.totalTokens - left.totalTokens),
      byDay: [...days.values()].map((bucket) => clone(bucket))
        .sort((left, right) => left.day.localeCompare(right.day)),
      recent: recent.map(clone).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
      rolledUpMonths,
    };
  }

  /** 清除某个会话的累计基线（会话被删除时调用，避免下次误记全量增量）。 */
  forgetThread(sessionId: string): void {
    this.mutate((snapshot) => {
      delete snapshot.threadTotals[sessionId];
      return null;
    });
  }

  private foldOverflow(snapshot: UsageSnapshot): void {
    if (snapshot.records.length <= this.maxRecords) return;
    const overflow = snapshot.records.slice(0, snapshot.records.length - this.maxRecords);
    snapshot.records = snapshot.records.slice(snapshot.records.length - this.maxRecords);
    for (const record of overflow) {
      const month = monthKeyOf(record.occurredAt);
      const rollup = snapshot.monthlyRollup[month] ?? {
        ...emptyBucket(),
        byAgent: {},
      };
      addToBucket(rollup, record);
      const agent = rollup.byAgent[record.agentId] ?? { agentName: record.agentName, ...emptyBucket() };
      addToBucket(agent, record);
      agent.agentName = record.agentName;
      rollup.byAgent[record.agentId] = agent;
      snapshot.monthlyRollup[month] = rollup;
    }
  }

  private mutate<T>(mutation: (snapshot: UsageSnapshot) => T): T {
    return this.withLock(() => {
      const snapshot = this.loadUnlocked();
      const result = mutation(snapshot);
      snapshot.revision += 1;
      const validated = parseSnapshot(snapshot, '待保存的用量台账快照');
      this.writeSnapshotUnlocked(validated);
      return clone(result);
    });
  }

  private now(): string {
    return this.clock().toISOString();
  }

  private defaultSnapshot(): UsageSnapshot {
    return parseSnapshot({ version: 1, revision: 0, threadTotals: {}, monthlyRollup: {}, records: [] }, '用量台账默认快照');
  }

  private loadUnlocked(): UsageSnapshot {
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
          throw new UsageStoreCorruptError(
            `用量台账主数据和备份均不可读取: ${this.file}`,
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

  private readSnapshotFile(file: string): UsageSnapshot {
    let raw: string;
    try {
      const size = statSync(file).size;
      if (size > MAX_USAGE_FILE_BYTES) {
        throw new UsageStoreCorruptError(`用量台账超过 ${MAX_USAGE_FILE_BYTES} 字节上限: ${file}`);
      }
      raw = readFileSync(file, 'utf8');
    } catch (error) {
      if (error instanceof UsageStoreCorruptError) throw error;
      throw new UsageStoreError('USAGE_STORE_READ_FAILED', `读取用量台账失败: ${file}`, error);
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new UsageStoreCorruptError(`用量台账不是有效 JSON: ${file}`, error);
    }
    return parseSnapshot(value, file);
  }

  private writeSnapshotUnlocked(snapshot: UsageSnapshot, preservePrevious = true): void {
    const validated = parseSnapshot(snapshot, '待保存的用量台账快照');
    const payload = `${JSON.stringify(validated, null, 2)}\n`;
    if (Buffer.byteLength(payload, 'utf8') > MAX_USAGE_FILE_BYTES) {
      throw new UsageStoreError('USAGE_STORE_TOO_LARGE', `用量台账超过 ${MAX_USAGE_FILE_BYTES} 字节上限`);
    }
    mkdirSync(dirname(this.file), { recursive: true });

    if (preservePrevious && existsSync(this.file)) {
      try {
        const previousPayload = readFileSync(this.file, 'utf8');
        parseSnapshot(JSON.parse(previousPayload), this.file);
        this.writeTextAtomic(this.backupFile, previousPayload);
      } catch (error) {
        if (!(error instanceof UsageStoreCorruptError) && !(error instanceof SyntaxError)) throw error;
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
      throw new UsageStoreError('USAGE_STORE_WRITE_FAILED', `写入用量台账失败: ${target}`, error);
    }
  }

  private quarantineCorruptPrimary(): void {
    if (!existsSync(this.file)) return;
    const stamp = this.now().replace(/[:.]/g, '-');
    const quarantineFile = `${this.file}.corrupt-${stamp}-${randomUUID()}`;
    try {
      renameSync(this.file, quarantineFile);
    } catch (error) {
      throw new UsageStoreError('USAGE_STORE_RECOVERY_FAILED', `隔离损坏数据失败: ${this.file}`, error);
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
          throw new UsageStoreBusyError(`创建用量台账数据锁失败: ${this.lockFile}`, error);
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
          throw new UsageStoreBusyError(`用量台账正被其他进程写入: ${this.file}`, error);
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
        throw new UsageStoreBusyError(`写入用量台账数据锁失败: ${this.lockFile}`, error);
      }
    }
  }
}
