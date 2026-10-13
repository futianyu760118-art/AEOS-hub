// Database-independent OA identity contract.  A concrete database adapter is
// deliberately separate: Hub never receives an OA connection string or writes
// to OA tables from a browser request.
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { atomicWrite } from './atomic-file.ts';

const value = z.string().trim().min(1).max(240);
export const OaIdentityRecordSchema = z.object({
  externalEmployeeId: value,
  displayName: value,
  tenantId: value,
  organizationId: value,
  departmentId: value.optional(),
  departmentName: value.optional(),
  positionCode: value.optional(),
  positionName: value.optional(),
  active: z.boolean(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type OaIdentityRecord = z.infer<typeof OaIdentityRecordSchema>;

export type OaSyncCursor = { value: string; updatedAt: string };
export interface OaIdentitySource {
  listInitial(): AsyncIterable<OaIdentityRecord>;
  listChanges(cursor: OaSyncCursor | null): AsyncIterable<OaIdentityRecord>;
}

export type OaIdentityProjection = {
  externalEmployeeId: string; displayName: string; tenantId: string; organizationId: string;
  departmentId?: string; departmentName?: string; positionCode?: string; positionName?: string;
  active: boolean; source: 'oa'; syncedAt: string;
};

export function projectOaIdentity(record: unknown, syncedAt = new Date().toISOString()): OaIdentityProjection {
  const parsed = OaIdentityRecordSchema.parse(record);
  return { ...parsed, source: 'oa', syncedAt };
}

export type OaSyncState = {
  version: 1;
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  cursor: OaSyncCursor | null;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  processed: number;
  errorCode?: 'SOURCE_UNAVAILABLE' | 'INVALID_SOURCE_DATA' | 'PROJECTION_FAILED';
};

const syncStateSchema = z.object({
  version: z.literal(1), status: z.enum(['idle', 'running', 'succeeded', 'failed']),
  cursor: z.object({ value: z.string().max(600), updatedAt: z.string().datetime({ offset: true }) }).nullable(),
  lastAttemptAt: z.string().datetime({ offset: true }).optional(), lastSuccessAt: z.string().datetime({ offset: true }).optional(),
  processed: z.number().int().min(0), errorCode: z.enum(['SOURCE_UNAVAILABLE', 'INVALID_SOURCE_DATA', 'PROJECTION_FAILED']).optional(),
}).strict();

export class OaSyncStateStore {
  private readonly file: string;
  constructor(file: string) { this.file = file; }
  load(): OaSyncState {
    if (!existsSync(this.file)) return { version: 1, status: 'idle', cursor: null, processed: 0 };
    return syncStateSchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))) as OaSyncState;
  }
  save(state: OaSyncState): OaSyncState {
    const parsed = syncStateSchema.parse(state) as OaSyncState;
    atomicWrite(this.file, `${JSON.stringify(parsed, null, 2)}\n`);
    return structuredClone(parsed);
  }
}

export type OaIdentityTarget = { upsertSyncedUser(record: OaIdentityRecord): Promise<unknown> };

/**
 * Database-independent runner. It validates a complete batch before applying
 * changes, advances the cursor only after success, and never infers deletions
 * from a missing OA row.
 */
export class OaIdentitySynchronizer {
  private readonly dependencies: {
    source: OaIdentitySource;
    target: OaIdentityTarget;
    state: OaSyncStateStore;
    now?: () => string;
    audit?: (event: { outcome: 'succeeded' | 'failed'; processed: number; errorCode?: OaSyncState['errorCode'] }) => void;
  };
  constructor(dependencies: {
    source: OaIdentitySource;
    target: OaIdentityTarget;
    state: OaSyncStateStore;
    now?: () => string;
    audit?: (event: { outcome: 'succeeded' | 'failed'; processed: number; errorCode?: OaSyncState['errorCode'] }) => void;
  }) { this.dependencies = dependencies; }

  async run(mode: 'initial' | 'incremental' = 'incremental'): Promise<OaSyncState> {
    const previous = this.dependencies.state.load();
    const attemptedAt = (this.dependencies.now ?? (() => new Date().toISOString()))();
    this.dependencies.state.save({ ...previous, status: 'running', lastAttemptAt: attemptedAt, processed: 0, errorCode: undefined });
    let records: OaIdentityRecord[];
    try {
      const iterable = mode === 'initial' ? this.dependencies.source.listInitial() : this.dependencies.source.listChanges(previous.cursor);
      records = [];
      const identifiers = new Set<string>();
      for await (const raw of iterable) {
        const record = OaIdentityRecordSchema.parse(raw);
        if (identifiers.has(record.externalEmployeeId)) throw new Error('duplicate employee identifier');
        identifiers.add(record.externalEmployeeId);
        records.push(record);
        if (records.length > 100_000) throw new Error('OA batch exceeds limit');
      }
    } catch (error) {
      const errorCode: OaSyncState['errorCode'] = error instanceof z.ZodError || (error as Error).message.includes('duplicate') ? 'INVALID_SOURCE_DATA' : 'SOURCE_UNAVAILABLE';
      const failed = this.dependencies.state.save({ ...previous, status: 'failed', lastAttemptAt: attemptedAt, processed: 0, errorCode });
      try { this.dependencies.audit?.({ outcome: 'failed', processed: 0, errorCode }); } catch { /* audit availability never changes sync state */ }
      return failed;
    }
    let processed = 0;
    try {
      for (const record of records) { await this.dependencies.target.upsertSyncedUser(record); processed += 1; }
      const last = records.toSorted((left, right) => left.updatedAt.localeCompare(right.updatedAt) || left.externalEmployeeId.localeCompare(right.externalEmployeeId)).at(-1);
      const cursor = last ? { value: `${last.updatedAt}|${last.externalEmployeeId}`, updatedAt: attemptedAt } : previous.cursor;
      const succeeded = this.dependencies.state.save({ version: 1, status: 'succeeded', cursor, lastAttemptAt: attemptedAt, lastSuccessAt: attemptedAt, processed });
      try { this.dependencies.audit?.({ outcome: 'succeeded', processed }); } catch { /* no credentials or records in audit */ }
      return succeeded;
    } catch {
      const errorCode = 'PROJECTION_FAILED' as const;
      const failed = this.dependencies.state.save({ ...previous, status: 'failed', lastAttemptAt: attemptedAt, processed, errorCode });
      try { this.dependencies.audit?.({ outcome: 'failed', processed, errorCode }); } catch { /* no-op */ }
      return failed;
    }
  }
}
