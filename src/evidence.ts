// Evidence 落库（试点版：JSONL 文件）
// 后续替换为 AEOS EDP Evidence Store（source_system=hub, 通过 Event 通道写入）。
import { mkdirSync, appendFileSync, statSync, renameSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const dataDir = join(here, '..', 'data');
export const evidenceFile = join(dataDir, 'evidence.jsonl');

export interface EvidenceEntry {
  event_id: string;
  occurred_at: string; // ISO 8601
  kind: string; // notification | turn_result | approval_decision | app_event
  method?: string; // JSON-RPC 通知方法名，如 item/completed
  thread_id?: string;
  turn_id?: string;
  item_type?: string; // agentMessage | mcpToolCall | ...
  summary?: string;
  payload?: unknown; // 原始载荷（通知 params / 决策结果等）
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
let writeFailure: string | null = null;
export function evidenceHealth(): string | null { return writeFailure; }

export function ensureDataDir(): void {
  mkdirSync(dataDir, { recursive: true });
}

export function appendEvidence(partial: Omit<EvidenceEntry, 'event_id' | 'occurred_at'>, file = evidenceFile): EvidenceEntry {
  const entry: EvidenceEntry = {
    event_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    ...partial,
  };
  try {
    mkdirSync(dirname(file), { recursive: true });
    if (entry.payload !== undefined) {
      const json = JSON.stringify(entry.payload);
      if (Buffer.byteLength(json) > 100_000) {
        const hash = createHash('sha256').update(json).digest('hex');
        const directory = join(dirname(file), 'evidence-payloads');
        mkdirSync(directory, { recursive: true });
        const payloadFile = join(directory, `${hash}.json`);
        if (!existsSync(payloadFile)) writeFileSync(payloadFile, json, { mode: 0o600 });
        entry.payload = { archived: true, sha256: hash, bytes: Buffer.byteLength(json), file: `evidence-payloads/${hash}.json` };
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
export async function readRecentEvidence(limit: number, file = evidenceFile): Promise<{ rows: EvidenceEntry[]; total: number; totalIsExact: false; archivedFiles: number }> {
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
          try { rows.push(JSON.parse(line)); } catch { /* Skip partial/corrupt tail. */ }
          if (rows.length >= limit) break;
        }
      }
    } finally { await handle.close(); }
  }
  return { rows: rows.reverse(), total: rows.length, totalIsExact: false, archivedFiles: archived.length };
}
