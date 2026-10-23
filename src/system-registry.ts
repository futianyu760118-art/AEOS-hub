// 系统登记：归属轴的第一层（系统 → 业务域 → 智能体）。
// 只登记系统身份与执行面自报名称别名，不改变任何 Agent 的运行位置。
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { atomicWrite } from './atomic-file.ts';
import { DEFAULT_TENANT_ID } from './tenant-registry.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const systemRegistryFile = join(root, 'data', 'systems.json');

export const SYSTEM_STATUSES = ['active', 'disabled'] as const;
const trimmed = (max: number, min = 0) => z.string().min(min).max(max)
  .refine((value) => value === value.trim(), '字符串前后不能包含空白');
const identifier = trimmed(160, 1);
const timestamp = trimmed(64, 1);
const MAX_SYSTEMS = 1_000;

export const SystemRecordSchema = z.object({
  systemId: identifier,
  name: trimmed(120, 1),
  tenantId: identifier,
  owner: trimmed(120),
  description: trimmed(500).default(''),
  status: z.enum(SYSTEM_STATUSES).default('active'),
  /** 执行面注册时自报的系统名称，归一到 systemId。 */
  sourceSystemAliases: z.array(trimmed(160, 1)).max(50).default([]),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const SystemSnapshotSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  updatedAt: timestamp,
  systems: z.array(SystemRecordSchema).max(MAX_SYSTEMS),
}).strict().superRefine((snapshot, ctx) => {
  const ids = new Set<string>();
  for (const [index, system] of snapshot.systems.entries()) {
    if (ids.has(system.systemId)) {
      ctx.addIssue({ code: 'custom', path: ['systems', index, 'systemId'], message: `系统 ID 重复：${system.systemId}` });
    }
    ids.add(system.systemId);
  }
});

export type SystemRecord = z.infer<typeof SystemRecordSchema>;
export type SystemSnapshot = z.infer<typeof SystemSnapshotSchema>;

export interface SystemRegistryOptions {
  file?: string;
  clock?: () => Date;
}

export interface SystemUpsertInput {
  systemId?: unknown;
  name?: unknown;
  tenantId?: unknown;
  owner?: unknown;
  description?: unknown;
  status?: unknown;
  sourceSystemAliases?: unknown;
}

export class SystemRegistryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SystemRegistryError';
    this.code = code;
  }
}

const DEFAULT_SYSTEMS: Array<Omit<SystemRecord, 'createdAt' | 'updatedAt'>> = [
  {
    systemId: 'aeos-hub',
    name: 'AEOS Hub',
    tenantId: DEFAULT_TENANT_ID,
    owner: '平台团队',
    description: 'Hub 自身与中枢 Agent',
    status: 'active',
    sourceSystemAliases: ['aeos-hub'],
  },
  {
    systemId: 'control-platform',
    name: '公司中控平台',
    tenantId: DEFAULT_TENANT_ID,
    owner: '中台团队',
    description: '中台执行面与智能助手',
    status: 'active',
    sourceSystemAliases: ['公司中控平台', '公司中控平台（本机演示）', '公司中控平台（UAT）'],
  },
  {
    systemId: 'hengjian-plm',
    name: '恒剑 PLM',
    tenantId: DEFAULT_TENANT_ID,
    owner: 'PLM 团队',
    description: '恒剑 PLM 执行面',
    status: 'active',
    sourceSystemAliases: ['恒剑PLM'],
  },
];

function requiredText(value: unknown, field: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SystemRegistryError('SYSTEM_INVALID_ARGUMENT', `${field} 必填且必须是非空字符串`);
  }
  const text = value.trim();
  if (text.length > max) throw new SystemRegistryError('SYSTEM_INVALID_ARGUMENT', `${field} 不能超过 ${max} 个字符`);
  return text;
}

function optionalText(value: unknown, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new SystemRegistryError('SYSTEM_INVALID_ARGUMENT', '字段必须是字符串');
  const text = value.trim();
  if (text.length > max) throw new SystemRegistryError('SYSTEM_INVALID_ARGUMENT', `字段不能超过 ${max} 个字符`);
  return text;
}

function aliases(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SystemRegistryError('SYSTEM_INVALID_ARGUMENT', 'sourceSystemAliases 必须是数组');
  return [...new Set(value.map((item) => requiredText(item, 'sourceSystemAliases')))].slice(0, 50);
}

export class SystemRegistry {
  readonly file: string;
  private readonly clock: () => Date;

  constructor(options: SystemRegistryOptions = {}) {
    this.file = options.file ?? systemRegistryFile;
    this.clock = options.clock ?? (() => new Date());
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private empty(): SystemSnapshot {
    return { version: 1, revision: 0, updatedAt: this.nowIso(), systems: [] };
  }

  load(): SystemSnapshot {
    if (!existsSync(this.file)) return this.empty();
    try {
      return SystemSnapshotSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      // 损坏文件隔离后从空账本开始；ensure() 会补种子。
      try {
        renameSync(this.file, `${this.file}.corrupt-${this.clock().getTime()}.json`);
      } catch {
        // 隔离失败则保留原文件，交由下次重试。
      }
      return this.empty();
    }
  }

  save(snapshot: SystemSnapshot): SystemSnapshot {
    const validated = SystemSnapshotSchema.parse({ ...snapshot, updatedAt: this.nowIso() });
    atomicWrite(this.file, `${JSON.stringify(validated, null, 2)}\n`);
    return validated;
  }

  /** 幂等补齐默认系统；不覆盖已有同 systemId 的记录。 */
  ensure(): SystemSnapshot {
    const snapshot = this.load();
    const byId = new Map(snapshot.systems.map((system) => [system.systemId, system]));
    let changed = false;
    const now = this.nowIso();
    for (const seed of DEFAULT_SYSTEMS) {
      if (byId.has(seed.systemId)) continue;
      byId.set(seed.systemId, SystemRecordSchema.parse({ ...seed, createdAt: now, updatedAt: now }));
      changed = true;
    }
    if (!changed) return snapshot;
    return this.save({ ...snapshot, revision: snapshot.revision + 1, systems: [...byId.values()] });
  }

  list(): SystemRecord[] {
    return this.load().systems.slice().sort((a, b) => a.systemId.localeCompare(b.systemId));
  }

  get(systemId: string): SystemRecord | null {
    const id = systemId.trim();
    if (!id) return null;
    return this.load().systems.find((system) => system.systemId === id) ?? null;
  }

  /** 按执行面自报名称查系统；找不到返回 null。 */
  findBySourceSystem(sourceSystem: string): SystemRecord | null {
    const name = sourceSystem.trim();
    if (!name) return null;
    return this.load().systems.find((system) => system.sourceSystemAliases.includes(name)) ?? null;
  }

  /** 新增或更新一个系统；不改动其他系统。 */
  upsert(input: SystemUpsertInput): SystemRecord {
    const systemId = requiredText(input.systemId, 'systemId');
    const name = requiredText(input.name, 'name', 120);
    const tenantId = requiredText(input.tenantId, 'tenantId');
    const owner = optionalText(input.owner, 120);
    const description = optionalText(input.description, 500);
    const status = input.status === undefined ? 'active' : input.status;
    if (status !== 'active' && status !== 'disabled') {
      throw new SystemRegistryError('SYSTEM_INVALID_ARGUMENT', 'status 必须是 active 或 disabled');
    }
    const now = this.nowIso();
    const snapshot = this.load();
    const index = snapshot.systems.findIndex((system) => system.systemId === systemId);
    const existing = index >= 0 ? snapshot.systems[index] : null;
    const record = SystemRecordSchema.parse({
      systemId,
      name,
      tenantId,
      owner,
      description,
      status,
      sourceSystemAliases: input.sourceSystemAliases === undefined
        ? existing?.sourceSystemAliases ?? []
        : aliases(input.sourceSystemAliases),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    const systems = [...snapshot.systems];
    if (index >= 0) systems[index] = record;
    else systems.push(record);
    this.save({ ...snapshot, revision: snapshot.revision + 1, systems });
    return record;
  }
}

const defaultRegistry = new SystemRegistry();

export function ensureSystems(): SystemSnapshot {
  return defaultRegistry.ensure();
}

export function listSystems(): SystemRecord[] {
  return defaultRegistry.list();
}

export function getSystem(systemId: string): SystemRecord | null {
  return defaultRegistry.get(systemId);
}

export function findSystemBySourceSystem(sourceSystem: string): SystemRecord | null {
  return defaultRegistry.findBySourceSystem(sourceSystem);
}
