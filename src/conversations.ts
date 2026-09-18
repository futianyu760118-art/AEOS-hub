// 会话（对话）元数据存储：data/threads.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const hubRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = join(hubRoot, 'data');
export const convFile = join(dataDir, 'threads.json');

export interface Conversation {
  id: string; // 本地会话 id
  threadId: string | null; // codex Thread id
  title: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  archived?: boolean; // 归档后从主列表隐藏，保留线程与证据
  lastChoice?: { provider: string; model: string } | null; // 最近一次选择的模型
  lastError?: string;
}

export function loadConversations(): Conversation[] {
  try {
    if (!existsSync(convFile)) return [];
    return JSON.parse(readFileSync(convFile, 'utf-8')) as Conversation[];
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(convFile, JSON.stringify(list, null, 2), 'utf-8');
}

export function upsertConversation(conv: Conversation): void {
  const list = loadConversations();
  const i = list.findIndex((c) => c.id === conv.id);
  if (i >= 0) list[i] = conv;
  else list.unshift(conv);
  saveConversations(list);
}
