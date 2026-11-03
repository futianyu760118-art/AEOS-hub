// 写操作请求台账：记录“谁在什么时候、经谁审批、对哪个系统执行了什么写操作”。
// 仅存元数据与结果，不存令牌；文件写入走 atomicWrite（含 Windows 占用重试）。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { atomicWrite } from './atomic-file.ts';
import type { CallerContext } from './caller-context.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const writeRequestFile = process.env.AEOS_WRITE_REQUEST_FILE?.trim()
  || join(root, 'data', 'write-requests.json');

export type WriteRequestStatus = 'pending_approval' | 'rejected' | 'dispatched' | 'completed' | 'failed' | 'cancelled';

export interface WriteRequestRecord {
  id: string;
  tenantId: string;
  systemId: string;
  agentId: string;
  capability: string;
  operation: string;
  input: unknown;
  reason: string;
  idempotencyKey: string;
  requestedBy: { kind: 'user' | 'system'; id: string; name: string | null };
  /** 对话内发起时记录来源会话；Hub 重启后据此恢复“待确认”按钮。 */
  conversationId?: string | null;
  caller: CallerContext | null;
  status: WriteRequestStatus;
  runId: string | null;
  result: unknown;
  error: { code: string; message: string } | null;
  approval: { by: string; at: string; note: string | null } | null;
  rejection: { by: string; at: string; reason: string } | null;
  createdAt: string;
  updatedAt: string;
}

type Snapshot = { version: 1; requests: WriteRequestRecord[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readSnapshot(file: string): Snapshot {
  if (!existsSync(file)) return { version: 1, requests: [] };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!isRecord(raw) || !Array.isArray(raw.requests)) return { version: 1, requests: [] };
    return { version: 1, requests: raw.requests.filter(isRecord) as unknown as WriteRequestRecord[] };
  } catch {
    return { version: 1, requests: [] };
  }
}

function writeSnapshot(file: string, snapshot: Snapshot): void {
  atomicWrite(file, `${JSON.stringify(snapshot, null, 2)}\n`);
}

export interface WriteRequestStoreOptions {
  file?: string;
  now?: () => Date;
  idFactory?: () => string;
}

export class WriteRequestStore {
  private readonly file: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: WriteRequestStoreOptions = {}) {
    this.file = options.file ?? writeRequestFile;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  load(): WriteRequestRecord[] {
    return readSnapshot(this.file).requests;
  }

  get(id: string): WriteRequestRecord | null {
    const key = id.trim();
    if (!key) return null;
    return this.load().find((request) => request.id === key) ?? null;
  }

  list(options: { tenantId: string; status?: WriteRequestStatus | null; limit?: number } = { tenantId: '' }): WriteRequestRecord[] {
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    return this.load()
      .filter((request) => request.tenantId === options.tenantId)
      .filter((request) => !options.status || request.status === options.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  findByIdempotency(tenantId: string, idempotencyKey: string): WriteRequestRecord | null {
    return this.load().find((request) => request.tenantId === tenantId && request.idempotencyKey === idempotencyKey) ?? null;
  }

  create(input: Omit<WriteRequestRecord, 'id' | 'status' | 'runId' | 'result' | 'error' | 'approval' | 'rejection' | 'createdAt' | 'updatedAt'>): WriteRequestRecord {
    const snapshot = readSnapshot(this.file);
    const at = this.now().toISOString();
    const record: WriteRequestRecord = {
      ...input,
      conversationId: typeof input.conversationId === 'string' && input.conversationId.trim()
        ? input.conversationId.trim()
        : null,
      id: `write-${this.idFactory()}`,
      status: 'pending_approval',
      runId: null,
      result: null,
      error: null,
      approval: null,
      rejection: null,
      createdAt: at,
      updatedAt: at,
    };
    snapshot.requests.push(record);
    snapshot.requests = snapshot.requests.slice(-2000);
    writeSnapshot(this.file, snapshot);
    return record;
  }

  update(id: string, patch: Partial<WriteRequestRecord>): WriteRequestRecord {
    const snapshot = readSnapshot(this.file);
    const index = snapshot.requests.findIndex((request) => request.id === id);
    if (index < 0) throw new Error(`写操作请求不存在：${id}`);
    const updated: WriteRequestRecord = {
      ...snapshot.requests[index]!,
      ...patch,
      id,
      updatedAt: this.now().toISOString(),
    };
    snapshot.requests[index] = updated;
    writeSnapshot(this.file, snapshot);
    return updated;
  }
}
