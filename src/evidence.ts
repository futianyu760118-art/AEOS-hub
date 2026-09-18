// Evidence 落库（试点版：JSONL 文件）
// 后续替换为 AEOS EDP Evidence Store（source_system=hub, 通过 Event 通道写入）。
import { mkdirSync, appendFileSync } from 'node:fs';
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

let seq = 0;

export function ensureDataDir(): void {
  mkdirSync(dataDir, { recursive: true });
}

export function appendEvidence(partial: Omit<EvidenceEntry, 'event_id' | 'occurred_at'>): EvidenceEntry {
  ensureDataDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const entry: EvidenceEntry = {
    event_id: partial.event_id ?? `${stamp}-${(seq++).toString().padStart(4, '0')}`,
    occurred_at: new Date().toISOString(),
    ...partial,
  };
  // 防止单条超大 payload 撑爆试点文件
  if (entry.payload !== undefined) {
    const json = JSON.stringify(entry.payload);
    if (json.length > 100_000) {
      entry.payload = { truncated: true, raw_length: json.length };
    }
  }
  appendFileSync(evidenceFile, JSON.stringify(entry) + '\n');
  return entry;
}
