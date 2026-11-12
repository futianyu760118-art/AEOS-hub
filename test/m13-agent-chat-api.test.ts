import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { M13AgentChatApi, type M13ChatRuntimePort } from '../src/m13-agent-chat-api.ts';
import type { RuntimeEvent, RuntimeEventListener, RuntimeRun, RuntimeSession } from '../src/runtime/types.ts';

const API_KEY = 'test-m13-secret';

function fakeRuntime(replyText = '这是 Agent 的回复。') {
  let listener: RuntimeEventListener | null = null;
  let threadSeq = 0;
  let runSeq = 0;
  const replies: Array<{ sessionId: string; message: string }> = [];

  const emit = (event: RuntimeEvent) => { if (listener) listener(event); };
  const runtime: M13ChatRuntimePort = {
    async createSession(request) {
      const id = `thread-${++threadSeq}`;
      const session: RuntimeSession = {
        id,
        runtimeInstanceId: 'test-runtime',
        state: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        workingDirectory: request.workingDirectory,
      };
      return session;
    },
    async resumeSession(sessionId, _request) {
      return {
        id: sessionId,
        runtimeInstanceId: 'test-runtime',
        state: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    async startRun(sessionId, request) {
      const message = Array.isArray(request.input)
        ? request.input.map((item) => (typeof item.text === 'string' ? item.text : '')).join('')
        : String(request.input);
      replies.push({ sessionId, message });
      const runId = `run-${++runSeq}`;
      const now = new Date().toISOString();
      emit({ sequence: 1, runtimeInstanceId: 'test-runtime', kind: 'notification', name: 'item/agentMessage/delta', occurredAt: now, sessionId, runId, data: { delta: replyText } });
      emit({ sequence: 2, runtimeInstanceId: 'test-runtime', kind: 'notification', name: 'item/completed', occurredAt: now, sessionId, runId, data: { item: { type: 'agentMessage', text: replyText } } });
      // 真实序列里 item/completed 之后紧跟 tokenUsage 事件；它不得覆盖已捕获的回复文本。
      emit({ sequence: 3, runtimeInstanceId: 'test-runtime', kind: 'notification', name: 'thread/tokenUsage/updated', occurredAt: now, sessionId, runId, data: { threadId: sessionId, tokenUsage: { total: { outputTokens: 42 } } } });
      const run: RuntimeRun = { id: runId, runtimeInstanceId: 'test-runtime', sessionId, state: 'running', createdAt: now };
      return run;
    },
    async waitForRun(runId) {
      return { id: runId, runtimeInstanceId: 'test-runtime', sessionId: '', state: 'completed', createdAt: new Date().toISOString() };
    },
    onEvent(fn) {
      listener = fn;
      return () => { listener = null; };
    },
  };
  return { runtime, replies };
}

function fixture(t: { after: (fn: () => void) => void }, replyText?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-m13-chat-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const evidence: unknown[] = [];
  const { runtime, replies } = fakeRuntime(replyText);
  const api = new M13AgentChatApi({
    apiKey: API_KEY,
    runtime,
    appendEvidence: (entry) => { evidence.push(entry); return entry; },
    storeFile: join(dir, 'm13-agent-chat-sessions.json'),
    rateLimitPerMinute: 1000,
  });
  return { api, evidence, replies };
}

function chat(body: Record<string, unknown>) {
  return {
    method: 'POST',
    pathname: '/poms/v1/agents/agent-sales/chat',
    apiKey: API_KEY,
    body,
  };
}

test('GET /poms/v1/agents 返回 3 个已连接 Agent', async () => {
  const { api } = fixture({ after: () => {} });
  const res = await api.handle({ method: 'GET', pathname: '/poms/v1/agents', apiKey: API_KEY });
  assert.equal(res?.status, 200);
  const agents = (res!.body as { agents: Array<{ id: string; hub_connected: boolean; status: string }> }).agents;
  assert.deepEqual(agents.map((a) => a.id), ['agent-main', 'agent-quality', 'agent-sales']);
  for (const agent of agents) {
    assert.equal(agent.hub_connected, true);
    assert.equal(agent.status, 'active');
  }
});

test('GET /poms/v1/agents/health 返回 chat_available', async () => {
  const { api } = fixture({ after: () => {} });
  const res = await api.handle({ method: 'GET', pathname: '/poms/v1/agents/health', apiKey: API_KEY });
  assert.equal(res?.status, 200);
  assert.equal((res!.body as { chat_available: boolean }).chat_available, true);
});

test('POST chat 首轮返回 reply 与 session_id，并落会话', async () => {
  const { api, replies } = fixture({ after: () => {} });
  const res = await api.handle(chat({ message: '帮我看下这条线索下一步怎么跟' }));
  assert.equal(res?.status, 200);
  const body = res!.body as { session_id: string; reply: string; agent_id: string; finish_reason: string };
  assert.equal(body.reply, '这是 Agent 的回复。');
  assert.equal(body.agent_id, 'agent-sales');
  assert.equal(body.finish_reason, 'stop');
  assert.match(body.session_id, /^sess_/);
  assert.equal(replies.length, 1);
});

test('POST chat 回传 session_id 可续聊', async () => {
  const { api } = fixture({ after: () => {} });
  const first = await api.handle(chat({ message: '第一条消息' }));
  const sessionId = (first!.body as { session_id: string }).session_id;
  const second = await api.handle({ ...chat({ message: '续聊', session_id: sessionId }), pathname: '/poms/v1/agents/agent-sales/chat' });
  assert.equal(second?.status, 200);
  assert.equal((second!.body as { session_id: string }).session_id, sessionId);
});

test('GET messages 返回会话历史', async () => {
  const { api } = fixture({ after: () => {} });
  const first = await api.handle(chat({ message: '你好' }));
  const sessionId = (first!.body as { session_id: string }).session_id;
  const res = await api.handle({ method: 'GET', pathname: `/poms/v1/agents/agent-sales/sessions/${sessionId}/messages`, apiKey: API_KEY });
  assert.equal(res?.status, 200);
  const body = res!.body as { session_id: string; agent_id: string; messages: Array<{ role: string; text: string }> };
  assert.equal(body.session_id, sessionId);
  assert.equal(body.agent_id, 'agent-sales');
  assert.deepEqual(body.messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(body.messages[0].text, '你好');
});

test('未带密钥返回 401', async () => {
  const { api } = fixture({ after: () => {} });
  const res = await api.handle({ method: 'GET', pathname: '/poms/v1/agents/health' });
  assert.equal(res?.status, 401);
  assert.equal((res!.body as { code: number }).code, 401);
});

test('错误密钥返回 401', async () => {
  const { api } = fixture({ after: () => {} });
  const res = await api.handle({ method: 'GET', pathname: '/poms/v1/agents/health', apiKey: 'wrong' });
  assert.equal(res?.status, 401);
});

test('Bearer 鉴权可用', async () => {
  const { api } = fixture({ after: () => {} });
  const res = await api.handle({ method: 'GET', pathname: '/poms/v1/agents/health', authorization: `Bearer ${API_KEY}` });
  assert.equal(res?.status, 200);
});

test('未知 Agent 返回 404', async () => {
  const { api } = fixture({ after: () => {} });
  const res = await api.handle({ method: 'POST', pathname: '/poms/v1/agents/agent-unknown/chat', apiKey: API_KEY, body: { message: 'hi' } });
  assert.equal(res?.status, 404);
});

test('空 message 返回 400', async () => {
  const { api } = fixture({ after: () => {} });
  const res = await api.handle(chat({ message: '   ' }));
  assert.equal(res?.status, 400);
});

test('不存在的 session_id 返回 404', async () => {
  const { api } = fixture({ after: () => {} });
  const res = await api.handle(chat({ message: 'hi', session_id: 'sess_nope' }));
  assert.equal(res?.status, 404);
});

test('未配置密钥时返回 503', async () => {
  const { runtime } = fakeRuntime();
  const api = new M13AgentChatApi({ apiKey: '', runtime, appendEvidence: () => undefined });
  const res = await api.handle({ method: 'GET', pathname: '/poms/v1/agents/health', apiKey: API_KEY });
  assert.equal(res?.status, 503);
});

test('verifyKey 回调可放行已签发密钥', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-m13-chat-cb-'));
  const { runtime } = fakeRuntime();
  const api = new M13AgentChatApi({
    apiKey: API_KEY,
    runtime,
    appendEvidence: () => undefined,
    storeFile: join(dir, 'sessions.json'),
    verifyKey: (key) => key === 'issued-key-123',
  });
  const res = await api.handle({ method: 'GET', pathname: '/poms/v1/agents/health', apiKey: 'issued-key-123' });
  assert.equal(res?.status, 200);
});
