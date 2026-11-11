import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { atomicWrite } from './atomic-file.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const idempotencyFile = join(root, 'data', 'idempotency.json');
const MAX_ENTRIES = 2_000;
const TTL_MS = 24 * 60 * 60 * 1000;

const timestamp = z.string().datetime({ offset: true });
const entrySchema = z.object({
  key: z.string().min(1).max(200),
  actorId: z.string().min(1).max(200),
  method: z.string().min(1).max(20),
  path: z.string().min(1).max(2_048),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.number().int().min(100).max(599),
  body: z.unknown(),
  createdAt: timestamp,
  expiresAt: timestamp,
}).strict();
const snapshotSchema = z.object({
  version: z.literal(1),
  entries: z.array(entrySchema).max(MAX_ENTRIES),
}).strict();

export type IdempotencyEntry = z.infer<typeof entrySchema>;
export type IdempotencySnapshot = z.infer<typeof snapshotSchema>;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function requestHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export class IdempotencyStore {
  private readonly file: string;
  private readonly now: () => Date;

  constructor(file = idempotencyFile, now: () => Date = () => new Date()) {
    this.file = file;
    this.now = now;
  }

  load(): IdempotencySnapshot {
    if (!existsSync(this.file)) return { version: 1, entries: [] };
    try {
      return snapshotSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      return { version: 1, entries: [] };
    }
  }

  lookup(input: { key: string; actorId: string; method: string; path: string; request: unknown }): { kind: 'miss' } | { kind: 'replay'; status: number; body: unknown } | { kind: 'conflict' } {
    const key = input.key.trim();
    if (!key) return { kind: 'miss' };
    const now = this.now().getTime();
    const entry = this.load().entries.find((candidate) => candidate.key === key && Date.parse(candidate.expiresAt) > now);
    if (!entry) return { kind: 'miss' };
    if (entry.actorId !== input.actorId || entry.method !== input.method || entry.path !== input.path) return { kind: 'conflict' };
    if (entry.requestHash !== requestHash(input.request)) return { kind: 'conflict' };
    return { kind: 'replay', status: entry.status, body: entry.body };
  }

  record(input: { key: string; actorId: string; method: string; path: string; request: unknown; status: number; body: unknown }): void {
    const key = input.key.trim();
    if (!key) return;
    const now = this.now();
    const snapshot = this.load();
    const entry: IdempotencyEntry = {
      key,
      actorId: input.actorId,
      method: input.method,
      path: input.path,
      requestHash: requestHash(input.request),
      status: input.status,
      body: input.body,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
    };
    const entries = snapshot.entries
      .filter((candidate) => Date.parse(candidate.expiresAt) > now.getTime() && candidate.key !== key)
      .concat(entry)
      .slice(-MAX_ENTRIES);
    atomicWrite(this.file, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`);
  }
}
