import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { EvidenceEntry } from './evidence.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const m02OutboxFile = join(root, 'data', 'm02-outbox.jsonl');

export type M02DeliveryRecord = {
  eventId: string;
  queuedAt: string;
  attempts: number;
  lastError: string | null;
  deliveredAt: string | null;
  entry: EvidenceEntry;
};

export type M02FlushOptions = {
  endpoint?: string;
  token?: string;
  file?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  limit?: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseRecord(line: string): M02DeliveryRecord | null {
  try {
    const value = record(JSON.parse(line));
    if (!value || typeof value.eventId !== 'string' || !value.entry) return null;
    return {
      eventId: value.eventId,
      queuedAt: typeof value.queuedAt === 'string' ? value.queuedAt : new Date().toISOString(),
      attempts: typeof value.attempts === 'number' ? value.attempts : 0,
      lastError: typeof value.lastError === 'string' ? value.lastError : null,
      deliveredAt: typeof value.deliveredAt === 'string' ? value.deliveredAt : null,
      entry: value.entry as EvidenceEntry,
    };
  } catch {
    return null;
  }
}

function readRecords(file: string): M02DeliveryRecord[] {
  if (!existsSync(file)) return [];
  const content = readFileSync(file, 'utf8');
  const records: M02DeliveryRecord[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const parsed = parseRecord(line);
    if (parsed) records.push(parsed);
  }
  return records;
}

function writeRecords(file: string, records: readonly M02DeliveryRecord[]): void {
  const temp = `${file}.tmp-${randomUUID()}`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(temp, records.map((item) => JSON.stringify(item)).join('\n') + (records.length ? '\n' : ''), { mode: 0o600 });
  renameSync(temp, file);
}

/** Buffers one Evidence event for later reliable delivery to M02/EDP. */
export function enqueueM02Evidence(entry: EvidenceEntry, file = m02OutboxFile): M02DeliveryRecord {
  const delivery: M02DeliveryRecord = {
    eventId: entry.event_id,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    deliveredAt: null,
    entry,
  };
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(delivery)}\n`, { mode: 0o600 });
  return delivery;
}

/**
 * Delivers buffered Evidence entries to the configured M02 endpoint. A failed
 * delivery remains in the local buffer with its attempt/error metadata; it is
 * never silently dropped. Without an endpoint the buffer is the pilot source.
 */
export async function flushM02Outbox(options: M02FlushOptions = {}): Promise<{
  delivered: number;
  failed: number;
  pending: number;
  configured: boolean;
}> {
  const file = options.file ?? m02OutboxFile;
  const endpoint = (options.endpoint ?? process.env.M02_ENDPOINT ?? '').trim();
  const token = (options.token ?? process.env.M02_TOKEN ?? '').trim();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const records = readRecords(file);
  if (!endpoint) {
    return { delivered: 0, failed: 0, pending: records.filter((item) => !item.deliveredAt).length, configured: false };
  }

  let delivered = 0;
  let failed = 0;
  let attempted = 0;
  for (const item of records) {
    if (item.deliveredAt || attempted >= limit) continue;
    attempted += 1;
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'idempotency-key': item.eventId,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(item.entry),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`M02 HTTP ${response.status}`);
      item.deliveredAt = now().toISOString();
      item.lastError = null;
      delivered += 1;
    } catch (error) {
      item.attempts += 1;
      item.lastError = (error as Error).message.slice(0, 500);
      failed += 1;
    }
  }
  if (attempted > 0) writeRecords(file, records);
  return {
    delivered,
    failed,
    pending: records.filter((item) => !item.deliveredAt).length,
    configured: true,
  };
}

export function m02OutboxHealth(file = m02OutboxFile): {
  configured: boolean;
  pending: number;
  lastError: string | null;
  fileBytes: number;
} {
  const records = readRecords(file);
  const pending = records.filter((item) => !item.deliveredAt);
  const lastError = [...pending].reverse().find((item) => item.lastError)?.lastError ?? null;
  return {
    configured: Boolean((process.env.M02_ENDPOINT ?? '').trim()),
    pending: pending.length,
    lastError,
    fileBytes: existsSync(file) ? statSync(file).size : 0,
  };
}
