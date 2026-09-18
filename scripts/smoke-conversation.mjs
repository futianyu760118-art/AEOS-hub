// 会话归档/删除链路冒烟：连 WS → 建会话 → 归档 → 验证隐藏与恢复 → 删除 → 验证移除
import { WebSocket } from 'ws';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokenFile = join(root, 'data', 'access-token.txt');
const TOKEN = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf-8').trim() : '';
const ws = new WebSocket(`ws://127.0.0.1:8787/ws${TOKEN ? '?token=' + TOKEN : ''}`);

let convId = null;
const waiters = [];
const seen = []; // 未被等待消费的消息缓存（解决通知先于 expect 注册的时序）
function expect(type, timeoutMs = 15000) {
  const idx = seen.findIndex((m) => m.type === type);
  if (idx >= 0) return Promise.resolve(seen.splice(idx, 1)[0]);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('等待 ' + type + ' 超时')), timeoutMs);
    waiters.push({ type, resolve: (v) => { clearTimeout(t); resolve(v); } });
  });
}
function send(o) { ws.send(JSON.stringify(o)); }
function fail(msg) { console.error('[FAIL] ' + msg); try { ws.close(); } catch {} process.exit(1); }

ws.on('message', (raw) => {
  let m; try { m = JSON.parse(String(raw)); } catch { return; }
  const w = waiters.findIndex((x) => x.type === m.type);
  if (w >= 0) waiters.splice(w, 1)[0].resolve(m);
  else seen.push(m);
});

ws.on('open', async () => {
  try {
    await expect('hello');
    send({ type: 'new' });
    const before = await expect('conversation_created');
    convId = before.conversation.id;
    seen.length = 0; // 丢弃创建期间广播的旧列表快照，避免后续断言误消费
    console.log(`[OK] 新建会话 ${convId.slice(0, 8)}`);

    // 归档
    send({ type: 'conversation:archive', conversationId: convId, archived: true });
    const arch = await expect('conversation_archived');
    if (arch.conversationId !== convId || arch.archived !== true) throw new Error('归档响应异常: ' + JSON.stringify(arch));
    const upd1 = await expect('conversations_updated');
    const a1 = (upd1.conversations || []).find((c) => c.id === convId);
    if (!a1?.archived) throw new Error('会话列表中未标记 archived');
    console.log('[OK] 归档：列表标记 archived=true');
    seen.length = 0;

    // 恢复
    send({ type: 'conversation:archive', conversationId: convId, archived: false });
    await expect('conversation_archived');
    const upd2 = await expect('conversations_updated');
    const a2 = (upd2.conversations || []).find((c) => c.id === convId);
    if (a2?.archived) throw new Error('恢复后仍标记 archived');
    console.log('[OK] 恢复：archived 已清除');
    seen.length = 0;

    // 删除
    send({ type: 'conversation:delete', conversationId: convId });
    await expect('conversation_deleted');
    const upd3 = await expect('conversations_updated');
    if ((upd3.conversations || []).some((c) => c.id === convId)) throw new Error('删除后仍在列表');
    console.log('[OK] 删除：列表已移除');

    console.log('PASS: 会话归档/恢复/删除链路完整可用');
    ws.close();
    process.exit(0);
  } catch (e) {
    fail(e.message);
  }
});
ws.on('error', (e) => fail('连接错误: ' + e.message));
