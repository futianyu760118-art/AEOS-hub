import { atomicWrite } from './atomic-file.ts';
// 会话（对话）元数据存储：data/threads.json
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const hubRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = join(hubRoot, 'data');
export const convFile = join(dataDir, 'threads.json');

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  itemId?: string;
  phase?: string;
}

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
  messages?: ConversationMessage[]; // 本地可回放的用户与 Agent 消息，不含工具原始输出
  /** hub 会话只在中枢显示；agent 会话只在对应 Agent / 小队工作区显示。 */
  scope?: 'hub' | 'agent';
  agentId?: string;
  squadId?: string;
}

export function loadConversations(file = convFile): Conversation[] {
  try {
    if (!existsSync(file)) return [];
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is Conversation => item && typeof item === 'object' && typeof item.id === 'string')
      .map((item) => ({
        ...item,
        scope: item.scope === 'agent' ? 'agent' : 'hub',
        agentId: typeof item.agentId === 'string' ? item.agentId : undefined,
        squadId: typeof item.squadId === 'string' ? item.squadId : undefined,
        messages: Array.isArray(item.messages) ? item.messages
          .filter((message): message is ConversationMessage => message && typeof message === 'object'
            && typeof message.id === 'string' && (message.role === 'user' || message.role === 'assistant')
            && typeof message.text === 'string' && typeof message.createdAt === 'string')
          .slice(-200) : [],
      }));
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[], file = convFile): void {
  mkdirSync(dirname(file), { recursive: true });
  atomicWrite(file, JSON.stringify(list, null, 2));
}

export function upsertConversation(conv: Conversation, file = convFile): void {
  const list = loadConversations(file);
  const i = list.findIndex((c) => c.id === conv.id);
  if (i >= 0) list[i] = conv;
  else list.unshift(conv);
  saveConversations(list, file);
}
