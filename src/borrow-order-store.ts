// 跨系统借调单存储：一张「工作委托单」从创建到终态的完整记录。
// 独立存放 data/borrow-orders.json；沿用台账/任务中心的快照 + revision + 原子写模式。
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { atomicWrite } from './atomic-file.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const borrowOrderFile = join(root, 'data', 'borrow-orders.json');

export const BORROW_ORDER_MAX_INPUT_BYTES = 64 * 1024;
export const BORROW_ORDER_MAX_RESULT_BYTES = 256 * 1024;
export const BORROW_ORDER_MAX_ORDERS = 10_000;
const RESULT_PREVIEW_CHARS = 8_192;

const trimmedString = (max: number, min = 0) => z.string().min(min).max(max)
  .refine((value) => value === value.trim(), '字符串前后不能包含空白');
const identifierSchema = trimmedString(160, 1);
const optionalIdentifierSchema = trimmedString(160).nullable();

export const BORROW_ORDER_STATUSES = ['pending', 'dispatched', 'running', 'completed', 'failed', 'cancelled'] as const;
export type BorrowOrderStatus = (typeof BORROW_ORDER_STATUSES)[number];

export const BORROW_ORDER_TRANSITIONS: Record<BorrowOrderStatus, readonly BorrowOrderStatus[]> = {
  pending: ['dispatched', 'failed', 'cancelled'],
  dispatched: ['running', 'completed', 'failed', 'cancelled'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionBorrowOrder(from: BorrowOrderStatus, to: BorrowOrderStatus): boolean {
  return BORROW_ORDER_TRANSITIONS[from].includes(to);
}

export const BorrowOrderErrorInfoSchema = z.object({
  code: trimmedString(100, 1),
  message: trimmedString(1_000, 1),
  stage: z.enum(['resolution', 'dispatch', 'execution', 'reconcile']).optional(),
}).strict();

export const BorrowOrderRecordSchema = z.object({
  orderId: identifierSchema,
  tenantId: identifierSchema,
  requestId: identifierSchema,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/, 'requestHash 必须是 64 位十六进制'),
  fromSystem: identifierSchema,
  fromAgentId: optionalIdentifierSchema,
  capability: trimmedString(100, 1),
  capabilityVersion: trimmedString(40).nullable().default(null),
  inputSchemaHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  outputSchemaHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  input: z.unknown(),
  toSystem: optionalIdentifierSchema,
  toAgent: optionalIdentifierSchema,
  providerSystem: optionalIdentifierSchema,
  providerAgentId: optionalIdentifierSchema,
  runId: optionalIdentifierSchema,
  status: z.enum(BORROW_ORDER_STATUSES),
  error: BorrowOrderErrorInfoSchema.nullable(),
  result: z.unknown().nullable(),
  resultBytes: z.number().int().nonnegative(),
  resultTruncated: z.boolean(),
  createdAt: trimmedString(64, 1),
  updatedAt: trimmedString(64, 1),
  dispatchedAt: trimmedString(64).nullable(),
  startedAt: trimmedString(64).nullable(),
  endedAt: trimmedString(64).nullable(),
}).strict();

export const BorrowOrderSnapshotSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  updatedAt: trimmedString(64, 1),
  orders: z.array(BorrowOrderRecordSchema).max(BORROW_ORDER_MAX_ORDERS),
}).strict();

export type BorrowOrderRecord = z.infer<typeof BorrowOrderRecordSchema>;
export type BorrowOrderSnapshot = z.infer<typeof BorrowOrderSnapshotSchema>;

export interface CreateBorrowOrderRecordInput {
  tenantId: string;
  requestId: string;
  requestHash: string;
  fromSystem: string;
  fromAgentId: string | null;
  capability: string;
  capabilityVersion?: string | null;
  inputSchemaHash?: string | null;
  outputSchemaHash?: string | null;
  input: unknown;
  toSystem: string | null;
  toAgent: string | null;
  providerSystem: string;
  providerAgentId: string;
}

export class BorrowOrderStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BorrowOrderStoreError';
    this.code = code;
  }
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

/** 结果超出上限时保留摘要，原始大小与预览仍可读。 */
export function capBorrowResult(value: unknown): { result: unknown; resultBytes: number; resultTruncated: boolean } {
  const bytes = byteLength(value);
  if (bytes <= BORROW_ORDER_MAX_RESULT_BYTES) return { result: value ?? null, resultBytes: bytes, resultTruncated: false };
  const text = JSON.stringify(value ?? null);
  return {
    result: { truncated: true, bytes, preview: text.slice(0, RESULT_PREVIEW_CHARS) },
    resultBytes: bytes,
    resultTruncated: true,
  };
}

export interface BorrowOrderStoreOptions {
  file?: string;
  clock?: () => Date;
  idFactory?: () => string;
}

export class BorrowOrderStore {
  readonly file: string;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(options: BorrowOrderStoreOptions = {}) {
    this.file = options.file ?? borrowOrderFile;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private empty(): BorrowOrderSnapshot {
    return { version: 1, revision: 0, updatedAt: this.nowIso(), orders: [] };
  }

  load(): BorrowOrderSnapshot {
    if (!existsSync(this.file)) return this.empty();
    const parse = (text: string): BorrowOrderSnapshot | null => {
      try {
        return BorrowOrderSnapshotSchema.parse(JSON.parse(text));
      } catch {
        return null;
      }
    };
    const primary = parse(readFileSync(this.file, 'utf8'));
    if (primary) return primary;
    // 主文件损坏时先尝试 .bak（atomicWrite 每次写入前生成），再隔离。
    const backupFile = `${this.file}.bak`;
    if (existsSync(backupFile)) {
      const backup = parse(readFileSync(backupFile, 'utf8'));
      if (backup) {
        console.warn('[borrow-order] 主文件损坏，已从 .bak 恢复');
        return backup;
      }
    }
    try {
      renameSync(this.file, `${this.file}.corrupt-${this.clock().getTime()}.json`);
    } catch {
      // 隔离失败则保持原文件，交由下次重试。
    }
    console.warn('[borrow-order] 借调单文件损坏，已隔离并从空账本开始');
    return this.empty();
  }

  save(snapshot: BorrowOrderSnapshot): BorrowOrderSnapshot {
    const validated = BorrowOrderSnapshotSchema.parse({ ...snapshot, updatedAt: this.nowIso() });
    atomicWrite(this.file, `${JSON.stringify(validated, null, 2)}\n`);
    return validated;
  }

  ensure(): BorrowOrderSnapshot {
    if (existsSync(this.file)) return this.load();
    return this.save(this.empty());
  }

  create(input: CreateBorrowOrderRecordInput): BorrowOrderRecord {
    if (byteLength(input.input) > BORROW_ORDER_MAX_INPUT_BYTES) {
      throw new BorrowOrderStoreError('BORROW_ORDER_INPUT_TOO_LARGE', `借调输入超过 ${BORROW_ORDER_MAX_INPUT_BYTES} 字节`);
    }
    const snapshot = this.load();
    if (snapshot.orders.length >= BORROW_ORDER_MAX_ORDERS) {
      throw new BorrowOrderStoreError('BORROW_ORDER_CAPACITY_EXCEEDED', '借调单存储已达上限');
    }
    const duplicate = snapshot.orders.find((order) => order.fromSystem === input.fromSystem && order.requestId === input.requestId);
    if (duplicate) {
      throw new BorrowOrderStoreError('BORROW_ORDER_DUPLICATE_REQUEST', '同一系统下 requestId 已存在');
    }
    const now = this.nowIso();
    const record = BorrowOrderRecordSchema.parse({
      orderId: `borrow-${this.idFactory()}`,
      tenantId: input.tenantId,
      requestId: input.requestId,
      requestHash: input.requestHash,
      fromSystem: input.fromSystem,
      fromAgentId: input.fromAgentId,
      capability: input.capability,
      capabilityVersion: input.capabilityVersion ?? null,
      inputSchemaHash: input.inputSchemaHash ?? null,
      outputSchemaHash: input.outputSchemaHash ?? null,
      input: input.input ?? null,
      toSystem: input.toSystem,
      toAgent: input.toAgent,
      providerSystem: input.providerSystem,
      providerAgentId: input.providerAgentId,
      runId: null,
      status: 'pending',
      error: null,
      result: null,
      resultBytes: 0,
      resultTruncated: false,
      createdAt: now,
      updatedAt: now,
      dispatchedAt: null,
      startedAt: null,
      endedAt: null,
    });
    this.save({ ...snapshot, revision: snapshot.revision + 1, orders: [...snapshot.orders, record] });
    return record;
  }

  get(orderId: string): BorrowOrderRecord | null {
    return this.load().orders.find((order) => order.orderId === orderId) ?? null;
  }

  findByRequest(fromSystem: string, requestId: string): BorrowOrderRecord | null {
    return this.load().orders.find((order) => order.fromSystem === fromSystem && order.requestId === requestId) ?? null;
  }

  findByRunId(runId: string): BorrowOrderRecord | null {
    return this.load().orders.find((order) => order.runId === runId) ?? null;
  }

  list(filter: { fromSystem?: string; providerSystem?: string; status?: BorrowOrderStatus; tenantId?: string; limit?: number } = {}): BorrowOrderRecord[] {
    const limit = Math.max(1, Math.min(Math.trunc(filter.limit ?? 100), 1_000));
    return this.load().orders
      .filter((order) => !filter.tenantId || order.tenantId === filter.tenantId)
      .filter((order) => !filter.fromSystem || order.fromSystem === filter.fromSystem)
      .filter((order) => !filter.providerSystem || order.providerSystem === filter.providerSystem)
      .filter((order) => !filter.status || order.status === filter.status)
      .slice()
      .reverse()
      .slice(0, limit);
  }

  /** 更新订单；状态变化必须符合状态机，终态不可回退。 */
  update(
    orderId: string,
    patch: Partial<Omit<BorrowOrderRecord, 'orderId' | 'createdAt'>>,
    options: { expectedStatuses?: readonly BorrowOrderStatus[] } = {},
  ): BorrowOrderRecord {
    const snapshot = this.load();
    const index = snapshot.orders.findIndex((order) => order.orderId === orderId);
    if (index < 0) throw new BorrowOrderStoreError('BORROW_ORDER_NOT_FOUND', `借调单不存在：${orderId}`);
    const current = snapshot.orders[index];
    if (options.expectedStatuses && !options.expectedStatuses.includes(current.status)) {
      throw new BorrowOrderStoreError('BORROW_ORDER_STATE_INVALID', `借调单状态 ${current.status} 不允许该操作`);
    }
    const nextStatus = patch.status;
    if (nextStatus && nextStatus !== current.status) {
      if (!canTransitionBorrowOrder(current.status, nextStatus)) {
        throw new BorrowOrderStoreError('BORROW_ORDER_STATE_INVALID', `借调单不能从 ${current.status} 变为 ${nextStatus}`);
      }
    }
    const updated = BorrowOrderRecordSchema.parse({
      ...current,
      ...patch,
      orderId: current.orderId,
      createdAt: current.createdAt,
      updatedAt: this.nowIso(),
    });
    const orders = [...snapshot.orders];
    orders[index] = updated;
    this.save({ ...snapshot, revision: snapshot.revision + 1, orders });
    return updated;
  }

  countOpenForSystem(fromSystem: string): number {
    return this.load().orders.filter((order) => order.fromSystem === fromSystem
      && order.status !== 'completed' && order.status !== 'failed' && order.status !== 'cancelled').length;
  }
}
