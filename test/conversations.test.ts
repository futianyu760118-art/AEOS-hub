import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConversations, saveConversations, upsertConversation, type ConversationMessage } from '../src/conversations.ts';

function message(index: number): ConversationMessage {
  return {
    id: `message-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    text: `message ${index}`,
    createdAt: '2026-09-24T00:00:00.000Z',
  };
}

test('conversation transcripts persist, validate records, and stay bounded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-conversations-'));
  const file = join(dir, 'threads.json');
  try {
    saveConversations([{
      id: 'conversation-1', threadId: 'thread-1', title: '历史会话',
      createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z', turnCount: 1,
      messages: Array.from({ length: 205 }, (_, index) => message(index)),
    }, {
      id: 'legacy', threadId: null, title: '旧会话',
      createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z', turnCount: 0,
    }], file);

    const rows = loadConversations(file);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].messages?.length, 200);
    assert.equal(rows[0].messages?.[0].id, 'message-5');
    assert.deepEqual(rows[1].messages, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsert retains a conversation transcript when it updates metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-conversations-'));
  const file = join(dir, 'threads.json');
  try {
    upsertConversation({
      id: 'conversation-1', threadId: 'thread-1', title: '新对话',
      createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z', turnCount: 0,
      messages: [message(1)],
    }, file);
    upsertConversation({
      id: 'conversation-1', threadId: 'thread-1', title: '已更新',
      createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T01:00:00.000Z', turnCount: 1,
      messages: [message(1), message(2)],
    }, file);
    const [row] = loadConversations(file);
    assert.equal(row.title, '已更新');
    assert.deepEqual(row.messages?.map((item) => item.id), ['message-1', 'message-2']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
