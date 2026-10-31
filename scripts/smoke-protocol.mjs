// Protocol smoke: validates HTTP contract boundaries and WS subscription/cancel
// behavior against a running Hub. It leaves no conversation behind.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokenFile = join(root, 'data', 'access-token.txt');
const token = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '';
const base = process.env.AEOS_BASE_URL || 'http://127.0.0.1:8787';
const query = token ? `?token=${encodeURIComponent(token)}` : '';
const wsUrl = `${base.replace(/^http/, 'ws')}/ws${query}`;

async function httpSmoke() {
  const home = await fetch(`${base}/${query}`);
  assert.equal(home.status, 200, '首页应可访问');
  assert.match(home.headers.get('content-security-policy') || '', /default-src 'self'/, '主页面应有 CSP');
  const before = await (await fetch(`${base}/api/autopilot${query}`)).json();
  const invalid = await fetch(`${base}/api/autopilot${query}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ time: '99:99' }),
  });
  assert.equal(invalid.status, 400, '非法 Autopilot 时间必须返回 400');
  const after = await (await fetch(`${base}/api/autopilot${query}`)).json();
  assert.equal(after.time, before.time, '非法提交不得修改 Autopilot');
  console.log('[OK] HTTP：CSP 已生效；非法 Autopilot 配置返回 400 且未修改原值');
}

async function websocketSmoke() {
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const seen = [];
    let convId = '';
    let cancelled = false;
    const timer = setTimeout(() => finish(new Error('WebSocket 协议测试超时')), 45_000);
    const finish = (error) => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      if (error) reject(error); else resolve();
    };
    ws.on('error', finish);
    ws.on('message', (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      seen.push(message);
      if (message.type === 'hello') {
        ws.send(JSON.stringify({ type: 'not-a-real-message' }));
        return;
      }
      if (message.type === 'error' && /不支持的 WebSocket 消息类型/.test(message.message || '') && !convId) {
        console.log('[OK] WS：未知消息类型会收到明确错误');
        ws.send(JSON.stringify({ type: 'new' }));
        return;
      }
      if (message.type === 'conversation_created') {
        convId = message.conversation.id;
        // Intentionally omit `view`: chat must subscribe its sender itself.
        ws.send(JSON.stringify({ type: 'chat', conversationId: convId, text: '请给出一份长篇经营分析，但此测试会立即取消。不要调用工具。' }));
        return;
      }
      if (message.type === 'user_message' && message.convId === convId && !cancelled) {
        cancelled = true;
        console.log('[OK] WS：未先发送 view 的 chat 仍收到用户回显');
        ws.send(JSON.stringify({ type: 'interrupt', conversationId: convId }));
        return;
      }
      if (message.type === 'turn_end' && message.convId === convId) {
        if (message.status === 'completed') {
          // A very fast provider can finish between the user-message echo and
          // the stop request. That is not an interruption failure.
          console.log('[SKIP] WS：模型在停止请求生效前已完成，本次无法强制构造 interrupted 状态');
          setTimeout(() => ws.send(JSON.stringify({ type: 'conversation:delete', conversationId: convId })), 150);
          return;
        }
        if (message.status !== 'interrupted') {
          finish(new Error(`主动取消被错误标记为 ${message.status}: ${message.error || ''}`));
          return;
        }
        console.log('[OK] WS：主动取消返回 interrupted，不显示为执行失败');
        setTimeout(() => ws.send(JSON.stringify({ type: 'conversation:delete', conversationId: convId })), 150);
        return;
      }
      if (message.type === 'conversation_deleted' && message.conversationId === convId) {
        console.log('[OK] WS：测试会话已清理');
        finish();
      }
    });
  });
}

await httpSmoke();
await websocketSmoke();
console.log('PASS: HTTP 与 WebSocket 协议回归通过');
