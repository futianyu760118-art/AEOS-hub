// 模型注册中心：登记不同能力的大模型（提供商 / 模型 / 能力标签 / 上下文 / 单价），
// 供智能体选型与用量费用估算使用。存储模式与 harbor-store 一致：锁 + 备份 + revision。
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

const MODEL_STATUSES = ['active', 'inactive'] as const;
const CURRENCIES = ['CNY', 'USD'] as const;
const MAX_REGISTRY_FILE_BYTES = 5 * 1024 * 1024;

export const ModelStatusSchema = z.enum(MODEL_STATUSES);
export const CurrencySchema = z.enum(CURRENCIES);

const trimmedString = (max: number, min = 0) => z.string()
  .min(min)
  .max(max)
  .refine((value) => value === value.trim(), '字符串前后不能包含空白');
const identifierSchema = trimmedString(160, 1);
const timestampSchema = z.string().datetime({ offset: true });
const priceSchema = z.number().min(0).max(1_000_000);

export const ModelPricingSchema = z.object({
  currency: CurrencySchema,
  /** 每百万 token 输入单价（缓存未命中部分）。 */
  inputPerMTok: priceSchema,
  /** 每百万 token 缓存命中输入单价；未填写时按输入单价估算。 */
  cachedInputPerMTok: priceSchema,
  /** 每百万 token 输出单价（含推理输出）。 */
  outputPerMTok: priceSchema,
}).strict();

export const ModelEntrySchema = z.object({
  id: identifierSchema,
  name: trimmedString(120, 1),
  provider: trimmedString(80, 1),
  model: trimmedString(160, 1),
  capabilities: z.array(trimmedString(60, 1)).max(20),
  contextWindow: z.number().int().min(0).max(100_000_000).nullable(),
  pricing: ModelPricingSchema.nullable(),
  status: ModelStatusSchema,
  notes: trimmedString(500),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();

export const ModelRegistrySnapshotSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative().default(0),
  models: z.array(ModelEntrySchema).max(2_000),
}).strict().superRefine((snapshot, ctx) => {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  snapshot.models.forEach((model, index) => {
    if (seenIds.has(model.id)) {
      ctx.addIssue({ code: 'custom', path: ['models', index, 'id'], message: `模型 id 不能重复: ${model.id}` });
    }
    seenIds.add(model.id);
    const key = `${model.provider.toLocaleLowerCase('en-US')}/${model.model.toLocaleLowerCase('en-US')}`;
    if (seenKeys.has(key)) {
      ctx.addIssue({ code: 'custom', path: ['models', index, 'model'], message: `同一提供商下模型标识不能重复: ${model.provider}/${model.model}` });
    }
    seenKeys.add(key);
    const seenCapabilities = new Set<string>();
    for (const capability of model.capabilities) {
      const normalized = capability.toLocaleLowerCase('en-US');
      if (seenCapabilities.has(normalized)) {
        ctx.addIssue({ code: 'custom', path: ['models', index, 'capabilities'], message: `能力标签不能重复: ${capability}` });
      }
      seenCapabilities.add(normalized);
    }
    if (Date.parse(model.updatedAt) < Date.parse(model.createdAt)) {
      ctx.addIssue({ code: 'custom', path: ['models', index, 'updatedAt'], message: 'updatedAt 不能早于 createdAt' });
    }
  });
});

export type ModelStatus = z.infer<typeof ModelStatusSchema>;
export type Currency = z.infer<typeof CurrencySchema>;
export type ModelPricing = z.infer<typeof ModelPricingSchema>;
export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export type ModelRegistrySnapshot = z.infer<typeof ModelRegistrySnapshotSchema>;

export type ModelCreateInput = Readonly<Record<string, unknown>>;
export type ModelUpdateInput = Readonly<Record<string, unknown>>;

const MODEL_CREATE_KEYS = new Set([
  'name', 'provider', 'model', 'capabilities', 'contextWindow', 'pricing', 'status', 'notes',
]);
const MODEL_UPDATE_KEYS = new Set([...MODEL_CREATE_KEYS]);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const modelRegistryFile = join(root, 'data', 'model-registry.json');

export class ModelRegistryError extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
  }
}

export class ModelRegistryCorruptError extends ModelRegistryError {
  constructor(message: string, cause?: unknown) {
    super('MODEL_REGISTRY_CORRUPT', message, cause);
  }
}

export class ModelRegistryBusyError extends ModelRegistryError {
  constructor(message: string, cause?: unknown) {
    super('MODEL_REGISTRY_BUSY', message, cause);
  }
}

export class ModelRegistryConflictError extends ModelRegistryError {
  constructor(message: string) {
    super('MODEL_REGISTRY_CONFLICT', message);
  }
}

export class ModelRegistryNotFoundError extends ModelRegistryError {
  constructor(message: string) {
    super('MODEL_REGISTRY_NOT_FOUND', message);
  }
}

export interface ModelRegistryStoreOptions {
  file?: string;
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

function parseSnapshot(value: unknown, source: string): ModelRegistrySnapshot {
  const result = ModelRegistrySnapshotSchema.safeParse(value);
  if (!result.success) {
    throw new ModelRegistryCorruptError(`${source} 数据结构无效: ${formatIssues(result.error)}`, result.error);
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

function stringList(input: unknown, itemMax: number, max = 20): string[] {
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

function parsePricing(input: unknown): ModelPricing | null {
  if (input === undefined || input === null || input === '') return null;
  const raw = input as Record<string, unknown>;
  const currency = raw.currency === 'USD' ? 'USD' : raw.currency === 'CNY' ? 'CNY' : undefined;
  if (!currency) throw new Error('pricing.currency 仅支持 CNY 或 USD');
  const numbers = [raw.inputPerMTok, raw.cachedInputPerMTok, raw.outputPerMTok];
  if (numbers.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    throw new Error('单价必须是不小于 0 的数字（每百万 token）');
  }
  return ModelPricingSchema.parse({
    currency,
    inputPerMTok: raw.inputPerMTok,
    cachedInputPerMTok: raw.cachedInputPerMTok,
    outputPerMTok: raw.outputPerMTok,
  });
}

function parseContextWindow(input: unknown): number | null {
  if (input === undefined || input === null || input === '') return null;
  const value = typeof input === 'string' ? Number(input.trim()) : input;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('上下文窗口必须是非负整数（token 数）');
  }
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class ModelRegistryStore {
  readonly file: string;
  readonly backupFile: string;
  readonly lockFile: string;

  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;

  constructor(options: ModelRegistryStoreOptions = {}) {
    this.file = options.file ?? modelRegistryFile;
    this.backupFile = `${this.file}.bak`;
    this.lockFile = `${this.file}.lock`;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 2_000;
    this.staleLockMs = options.staleLockMs ?? 30_000;
  }

  load(): ModelRegistrySnapshot {
    return this.withLock(() => clone(this.loadUnlocked()));
  }

  create(input: ModelCreateInput): ModelEntry {
    return this.mutate((snapshot) => {
      const unknownKeys = Object.keys(input).filter((key) => !MODEL_CREATE_KEYS.has(key));
      if (unknownKeys.length) throw new Error(`模型创建包含未知字段：${unknownKeys.join(', ')}`);
      const timestamp = this.now();
      const provider = requiredText(input, 'provider', 80);
      const model = requiredText(input, 'model', 160);
      const conflict = snapshot.models.some((item) =>
        item.provider.toLocaleLowerCase('en-US') === provider.toLocaleLowerCase('en-US')
        && item.model.toLocaleLowerCase('en-US') === model.toLocaleLowerCase('en-US'));
      if (conflict) throw new ModelRegistryConflictError(`该模型已登记: ${provider}/${model}`);
      const entry = ModelEntrySchema.parse({
        id: `model-${this.idFactory()}`,
        name: requiredText(input, 'name', 120),
        provider,
        model,
        capabilities: stringList(input.capabilities, 60),
        contextWindow: parseContextWindow(input.contextWindow),
        pricing: parsePricing(input.pricing),
        status: input.status === 'inactive' ? 'inactive' : 'active',
        notes: optionalText(input, 'notes', 500),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      snapshot.models.push(entry);
      return entry;
    });
  }

  update(id: string, input: ModelUpdateInput): ModelEntry {
    return this.mutate((snapshot) => {
      const unknownKeys = Object.keys(input).filter((key) => !MODEL_UPDATE_KEYS.has(key));
      if (unknownKeys.length) throw new Error(`模型更新包含未知字段：${unknownKeys.join(', ')}`);
      const entry = snapshot.models.find((item) => item.id === id);
      if (!entry) throw new ModelRegistryNotFoundError(`模型不存在: ${id}`);
      const provider = input.provider === undefined ? entry.provider : requiredText(input, 'provider', 80);
      const model = input.model === undefined ? entry.model : requiredText(input, 'model', 160);
      const conflict = snapshot.models.some((item) => item.id !== id
        && item.provider.toLocaleLowerCase('en-US') === provider.toLocaleLowerCase('en-US')
        && item.model.toLocaleLowerCase('en-US') === model.toLocaleLowerCase('en-US'));
      if (conflict) throw new ModelRegistryConflictError(`该模型已登记: ${provider}/${model}`);
      entry.name = input.name === undefined ? entry.name : requiredText(input, 'name', 120);
      entry.provider = provider;
      entry.model = model;
      if (input.capabilities !== undefined) entry.capabilities = stringList(input.capabilities, 60);
      if (input.contextWindow !== undefined) entry.contextWindow = parseContextWindow(input.contextWindow);
      if (input.pricing !== undefined) entry.pricing = parsePricing(input.pricing);
      if (input.status !== undefined) {
        if (input.status !== 'active' && input.status !== 'inactive') throw new Error('status 仅支持 active 或 inactive');
        entry.status = input.status;
      }
      if (input.notes !== undefined) entry.notes = optionalText(input, 'notes', 500);
      entry.updatedAt = this.now();
      return entry;
    });
  }

  remove(id: string): ModelEntry {
    return this.mutate((snapshot) => {
      const index = snapshot.models.findIndex((item) => item.id === id);
      if (index < 0) throw new ModelRegistryNotFoundError(`模型不存在: ${id}`);
      const [removed] = snapshot.models.splice(index, 1);
      return removed;
    });
  }

  /** 按 提供商 + 模型标识 查询可用定价（模型标识大小写不敏感）。 */
  findPricing(provider: string, model: string): ModelPricing | null {
    const snapshot = this.load();
    const providerKey = provider.trim().toLocaleLowerCase('en-US');
    const modelKey = model.trim().toLocaleLowerCase('en-US');
    const entry = snapshot.models.find((item) =>
      item.provider.toLocaleLowerCase('en-US') === providerKey
      && item.model.toLocaleLowerCase('en-US') === modelKey);
    if (!entry || entry.status !== 'active' || !entry.pricing) return null;
    return entry.pricing;
  }

  private mutate<T>(mutation: (snapshot: ModelRegistrySnapshot) => T): T {
    return this.withLock(() => {
      const snapshot = this.loadUnlocked();
      const result = mutation(snapshot);
      snapshot.revision += 1;
      const validated = parseSnapshot(snapshot, '待保存的模型注册快照');
      this.writeSnapshotUnlocked(validated);
      return clone(result);
    });
  }

  private now(): string {
    return this.clock().toISOString();
  }

  private defaultSnapshot(): ModelRegistrySnapshot {
    const createdAt = this.now();
    return parseSnapshot({
      version: 1,
      revision: 0,
      models: [
        {
          id: 'model-deepseek-chat',
          name: 'DeepSeek Chat（通用）',
          provider: 'deepseek',
          model: 'deepseek-chat',
          capabilities: ['通用推理', '工具调用', '代码'],
          contextWindow: 128_000,
          // 参考单价（人民币 / 每百万 token）；请按供应商最新报价在模型中心校正。
          pricing: { currency: 'CNY', inputPerMTok: 2, cachedInputPerMTok: 0.5, outputPerMTok: 8 },
          status: 'active',
          notes: '默认参考价，实际计费以供应商账单为准。',
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: 'model-deepseek-reasoner',
          name: 'DeepSeek Reasoner（深度推理）',
          provider: 'deepseek',
          model: 'deepseek-reasoner',
          capabilities: ['深度推理', '复杂分析'],
          contextWindow: 128_000,
          pricing: { currency: 'CNY', inputPerMTok: 4, cachedInputPerMTok: 1, outputPerMTok: 16 },
          status: 'active',
          notes: '默认参考价，实际计费以供应商账单为准。',
          createdAt,
          updatedAt: createdAt,
        },
      ],
    }, '模型注册默认快照');
  }

  private loadUnlocked(): ModelRegistrySnapshot {
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
          throw new ModelRegistryCorruptError(
            `模型注册主数据和备份均不可读取: ${this.file}`,
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

  private readSnapshotFile(file: string): ModelRegistrySnapshot {
    let raw: string;
    try {
      const size = statSync(file).size;
      if (size > MAX_REGISTRY_FILE_BYTES) {
        throw new ModelRegistryCorruptError(`模型注册数据超过 ${MAX_REGISTRY_FILE_BYTES} 字节上限: ${file}`);
      }
      raw = readFileSync(file, 'utf8');
    } catch (error) {
      if (error instanceof ModelRegistryCorruptError) throw error;
      throw new ModelRegistryError('MODEL_REGISTRY_READ_FAILED', `读取模型注册数据失败: ${file}`, error);
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new ModelRegistryCorruptError(`模型注册数据不是有效 JSON: ${file}`, error);
    }
    return parseSnapshot(value, file);
  }

  private writeSnapshotUnlocked(snapshot: ModelRegistrySnapshot, preservePrevious = true): void {
    const validated = parseSnapshot(snapshot, '待保存的模型注册快照');
    const payload = `${JSON.stringify(validated, null, 2)}\n`;
    if (Buffer.byteLength(payload, 'utf8') > MAX_REGISTRY_FILE_BYTES) {
      throw new ModelRegistryError('MODEL_REGISTRY_TOO_LARGE', `模型注册数据超过 ${MAX_REGISTRY_FILE_BYTES} 字节上限`);
    }
    mkdirSync(dirname(this.file), { recursive: true });

    if (preservePrevious && existsSync(this.file)) {
      try {
        const previousPayload = readFileSync(this.file, 'utf8');
        parseSnapshot(JSON.parse(previousPayload), this.file);
        this.writeTextAtomic(this.backupFile, previousPayload);
      } catch (error) {
        if (!(error instanceof ModelRegistryCorruptError) && !(error instanceof SyntaxError)) throw error;
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
      throw new ModelRegistryError('MODEL_REGISTRY_WRITE_FAILED', `写入模型注册数据失败: ${target}`, error);
    }
  }

  private quarantineCorruptPrimary(): void {
    if (!existsSync(this.file)) return;
    const stamp = this.now().replace(/[:.]/g, '-');
    const quarantineFile = `${this.file}.corrupt-${stamp}-${randomUUID()}`;
    try {
      renameSync(this.file, quarantineFile);
    } catch (error) {
      throw new ModelRegistryError('MODEL_REGISTRY_RECOVERY_FAILED', `隔离损坏数据失败: ${this.file}`, error);
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
          throw new ModelRegistryBusyError(`创建模型注册数据锁失败: ${this.lockFile}`, error);
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
          throw new ModelRegistryBusyError(`模型注册数据正被其他进程写入: ${this.file}`, error);
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
        throw new ModelRegistryBusyError(`写入模型注册数据锁失败: ${this.lockFile}`, error);
      }
    }
  }
}

const defaultStore = new ModelRegistryStore();

export function loadModelRegistry(): ModelRegistrySnapshot {
  return defaultStore.load();
}

export function createModel(input: ModelCreateInput): ModelEntry {
  return defaultStore.create(input);
}

export function updateModel(id: string, input: ModelUpdateInput): ModelEntry {
  return defaultStore.update(id, input);
}

export function deleteModel(id: string): ModelEntry {
  return defaultStore.remove(id);
}

export function findModelPricing(provider: string, model: string): ModelPricing | null {
  return defaultStore.findPricing(provider, model);
}
