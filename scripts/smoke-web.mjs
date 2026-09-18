// Web 控制台聊天冒烟：连 WS → 建会话 → 发消息 → 自动处理 Guard → 等待完成
// 用法: node scripts/smoke-web.mjs
import { WebSocket } from 'ws';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokenFile = join(root, 'data', 'access-token.txt');
const TOKEN = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf-8').trim() : '';
const URL_WS = `ws://127.0.0.1:8787/ws${TOKEN ? '?token=' + TOKEN : ''}`;
const PROMPT = process.argv[2] || '一句话：你现在能调用哪些业务系统能力？都是只读的吗？';
let CHOICE = null;
if (process.argv[3]) { try { CHOICE = JSON.parse(process.argv[3]); } catch { CHOICE = null; } }
console.log(`模型选择: ${CHOICE ? `${CHOICE.provider} / ${CHOICE.model}` : '(默认)'}`);

const ws = new WebSocket(URL_WS);
let convId = null;
let agentText = '';
const tools = [];
let guards = 0;
let done = false;
let failReason = null;

function send(o) { ws.send(JSON.stringify(o)); }
const timeout = setTimeout(() => { fail('总体超时'); }, 240_000);

function finish(code) {
  clearTimeout(timeout);
  try { ws.close(); } catch { /* ignore */ }
  process.exit(code);
}
function fail(msg) {
  console.error('[FAIL] ' + msg);
  finish(1);
}

ws.on('open', () => console.log('[OK] WebSocket 已连接'));
ws.on('message', (raw) => {
  let m;
  try { m = JSON.parse(String(raw)); } catch { return; }
  switch (m.type) {
    case 'hello':
      console.log(`[OK] hello：已有 ${m.conversations.length} 个会话`);
      send({ type: 'new' });
      break;
    case 'conversation_created':
      convId = m.conversation.id;
      console.log(`[OK] 新建会话 ${m.conversation.id.slice(0, 8)}`);
      send({ type: 'view', conversationId: convId });
      send({ type: 'chat', conversationId: convId, text: PROMPT, choice: CHOICE });
      break;
    case 'evt':
      if (m.method === 'item/agentMessage/delta') agentText += m.params?.delta || '';
      if (m.method === 'item/completed' && m.params?.item?.type === 'mcpToolCall') {
        const it = m.params.item;
        tools.push(`${it.server}/${it.tool}:${it.status}`);
        console.log(`  [tool] ${it.server}/${it.tool} -> ${it.status}`);
      }
      break;
    case 'guard':
      guards++;
      console.log(`[Guard] 收到授权请求(${m.method})，自动允许（模拟用户点击）`);
      send({ type: 'decision', reqId: m.id, decision: 'accept' });
      break;
    case 'user_message': break;
    case 'turn_end':
      if (m.status === 'completed') {
        console.log('[OK] turn 完成');
        if (!agentText.trim()) { fail('agent 未返回任何文本'); return; }
        console.log('--- agent 回复 ---');
        console.log(agentText.trim().slice(0, 800));
        console.log('------------------');
        console.log(`[OK] Guard 授权 ${guards} 次，MCP 工具 ${tools.length} 个：${tools.join('; ')}`);
        console.log('PASS: Web 聊天链路（含 Guard 授权与流式文本）完整可用');
        finish(0);
      } else {
        fail('turn 失败: ' + (m.error || m.status));
      }
      break;
    case 'error':
      fail('服务端错误: ' + m.message);
      break;
    default: break;
  }
});
ws.on('error', (e) => fail('连接错误: ' + e.message));
ws.on('close', () => { if (!done) fail('连接提前关闭'); });
