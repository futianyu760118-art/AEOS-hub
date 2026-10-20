// Evidence 落库（试点版：JSONL 文件）
// 后续替换为 AEOS EDP Evidence Store（source_system=hub, 通过 Event 通道写入）。
import { mkdirSync, appendFileSync, statSync, renameSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEvidenceEntry, type EvidenceEntryContract } from './evidence-contract.ts';
import { DEFAULT_TENANT_ID } from './tenant-registry.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const dataDir = join(here, '..', 'data');
export const evidenceFile = join(dataDir, 'evidence.jsonl');

export type EvidenceEntry = EvidenceEntryContract;
export type EvidenceActorType = NonNullable<EvidenceEntry['actor_type']>;
export type EvidenceQuery = { actorId?: string; actorType?: EvidenceActorType };

/** Callers may omit pilot defaults, but persisted records always satisfy EvidenceEntryContract. */
export type EvidenceInput = Omit<
  EvidenceEntry,
  'event_id' | 'occurred_at' | 'tenant_id' | 'object_ref' | 'source_system' | 'correlation_id' | 'version' | 'evidence_refs' | 'payload_hash'
> & Partial<Pick<EvidenceEntry, 'tenant_id' | 'object_ref' | 'source_system' | 'correlation_id' | 'version' | 'evidence_refs'>>;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
let writeFailure: string | null = null;
export function evidenceHealth(): string | null { return writeFailure; }

export function ensureDataDir(): void {
  mkdirSync(dataDir, { recursive: true });
}

function tenantId(): string {
  return process.env.AEOS_TENANT_ID?.trim() || DEFAULT_TENANT_ID;
}

function hubRuntimeObjectRef(partial: EvidenceInput): string {
  const identifier = partial.thread_id ?? partial.turn_id ?? 'system';
  return `hub://runtime/${encodeURIComponent(identifier)}`;
}

function payloadJson(payload: unknown): string {
  const json = JSON.stringify(payload ?? null);
  if (typeof json !== 'string') throw new Error('Evidence payload 无法序列化');
  return json;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeStoredEvidence(value: unknown): EvidenceEntry {
  const legacy = value !== null && typeof value === 'object' ? value as Partial<EvidenceEntry> : {};
  return validateEvidenceEntry({
    ...legacy,
    tenant_id: legacy.tenant_id ?? tenantId(),
    object_ref: legacy.object_ref ?? hubRuntimeObjectRef(legacy as EvidenceInput),
    source_system: legacy.source_system ?? 'aeos-hub',
    correlation_id: legacy.correlation_id ?? legacy.thread_id ?? legacy.turn_id ?? legacy.event_id,
    version: legacy.version ?? '1.0',
    evidence_refs: legacy.evidence_refs ?? [],
    payload_hash: legacy.payload_hash ?? sha256(payloadJson(legacy.payload)),
  });
}

export function appendEvidence(partial: EvidenceInput, file = evidenceFile): EvidenceEntry {
  const eventId = randomUUID();
  const payload = payloadJson(partial.payload);
  const entry = validateEvidenceEntry({
    ...partial,
    event_id: eventId,
    occurred_at: new Date().toISOString(),
    tenant_id: partial.tenant_id ?? tenantId(),
    object_ref: partial.object_ref ?? hubRuntimeObjectRef(partial),
    source_system: partial.source_system ?? 'aeos-hub',
    correlation_id: partial.correlation_id ?? partial.thread_id ?? partial.turn_id ?? eventId,
    version: partial.version ?? '1.0',
    evidence_refs: partial.evidence_refs ?? [],
    payload_hash: sha256(payload),
  });
  try {
    mkdirSync(dirname(file), { recursive: true });
    if (entry.payload !== undefined) {
      if (Buffer.byteLength(payload) > 100_000) {
        const hash = entry.payload_hash;
        const directory = join(dirname(file), 'evidence-payloads');
        mkdirSync(directory, { recursive: true });
        const payloadFile = join(directory, `${hash}.json`);
        if (!existsSync(payloadFile)) writeFileSync(payloadFile, payload, { mode: 0o600 });
        entry.payload = { archived: true, sha256: hash, bytes: Buffer.byteLength(payload), file: `evidence-payloads/${hash}.json` };
      }
    }
    if (existsSync(file) && statSync(file).size >= MAX_FILE_BYTES) {
      const archive = join(dirname(file), 'evidence-archive');
      mkdirSync(archive, { recursive: true });
      renameSync(file, join(archive, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.jsonl`));
    }
    appendFileSync(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
    writeFailure = null;
  } catch (error) {
    writeFailure = (error as Error).message;
    throw new Error(`Evidence 写入失败，已停止本次操作：${writeFailure}`);
  }
  return entry;
}

/** Reads a bounded tail asynchronously. Archives are retained for audit/backup. */
function matchesEvidenceQuery(entry: EvidenceEntry, query: EvidenceQuery): boolean {
  return (!query.actorId || entry.actor_id === query.actorId)
    && (!query.actorType || entry.actor_type === query.actorType);
}

export async function readRecentEvidence(limit: number, file = evidenceFile, query: EvidenceQuery = {}): Promise<{ rows: EvidenceEntry[]; total: number; totalIsExact: false; archivedFiles: number }> {
  const archive = join(dirname(file), 'evidence-archive');
  const archived = existsSync(archive) ? readdirSync(archive).filter((name) => name.endsWith('.jsonl')).sort().reverse() : [];
  const files = [file, ...archived.map((name) => join(archive, name))];
  const rows: EvidenceEntry[] = [];
  let budget = 4 * 1024 * 1024;
  for (const candidate of files) {
    if (!budget || rows.length >= limit) break;
    const handle = await open(candidate, 'r').catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!handle) continue;
    try {
      let position = (await handle.stat()).size;
      let suffix = Buffer.alloc(0);
      while (position > 0 && budget > 0 && rows.length < limit) {
        const size = Math.min(position, budget, 64 * 1024);
        position -= size; budget -= size;
        const chunk = Buffer.alloc(size);
        const { bytesRead } = await handle.read(chunk, 0, size, position);
        const buffer = Buffer.concat([chunk.subarray(0, bytesRead), suffix]);
        const firstNewline = position > 0 ? buffer.indexOf(10) : -1;
        if (position > 0 && firstNewline < 0) { suffix = buffer; continue; }
        const complete = position > 0 ? buffer.subarray(firstNewline + 1) : buffer;
        suffix = position > 0 ? buffer.subarray(0, firstNewline + 1) : Buffer.alloc(0);
        for (const line of complete.toString('utf8').split('\n').reverse()) {
          if (!line.trim()) continue;
          try {
            const entry = normalizeStoredEvidence(JSON.parse(line));
            if (matchesEvidenceQuery(entry, query)) rows.push(entry);
          } catch { /* Skip partial or corrupt tail. */ }
          if (rows.length >= limit) break;
        }
      }
    } finally { await handle.close(); }
  }
  return { rows: rows.reverse(), total: rows.length, totalIsExact: false, archivedFiles: archived.length };
}
