import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssistantEventStore } from '../src/assistant-event-store.ts';
import { AssistantEventApi } from '../src/assistant-event-api.ts';
import { deriveSystemToken } from '../src/system-token.ts';
import type { UsageEventAppendInput } from '../src/usage-ledger-store.ts';

const ROOT = 'test-root-secret';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-assistant-api-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new AssistantEventStore({ file: join(dir, 'assistant-events.jsonl'), archiveDir: join(dir, 'archive') });
  const usage: UsageEventAppendInput[] = [];
  const api = new AssistantEventApi({
    rootSecret: ROOT,
    store,
    appendEvidence: () => ({}),
    recordUsage: (event) => { usage.push(event); },
  });
  return { api, store, usage, token: (systemId: string) => deriveSystemToken(ROOT, systemId) };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'evt-1',
    traceId: 'trace-1',
    event: 'assistant_reply',
    name: '库存问答',
    status: 'completed',
    summary: '用户询问库存，助手返回摘要',
    ...overrides,
  };
}

test('鉴权失败返回 401', (t) => {
  const { api } = fixture(t);
  const missing = api.handle({ method: 'POST', pathname: '/api/system/assistant-events', systemId: '', token: '', body: body() });
  assert.equal(missing?.status, 401);
  const wrong = api.handle({ method: 'POST', pathname: '/api/system/assistant-events', systemId: '中台', token: 'wrong', body: body() });
  assert.equal(wrong?.status, 401);
});

test('上报成功 201，重复 200', (t) => {
  const { api, token } = fixture(t);
  const first = api.handle({ method: 'POST', pathname: '/api/system/assistant-events', systemId: '中台', token: token('中台'), body: body() });
  assert.equal(first?.status, 201);
  assert.equal(first?.body.accepted, true);
  const second = api.handle({ method: 'POST', pathname: '/api/system/assistant-events', systemId: '中台', token: token('中台'), body: body() });
  assert.equal(second?.status, 200);
  assert.equal(second?.body.duplicate, true);
});

test('接受 ReAct 步骤与写确认字段', (t) => {
  const { api, token } = fixture(t);
  const result = api.handle({
    method: 'POST',
    pathname: '/api/system/assistant-events',
    systemId: '中台',
    token: token('中台'),
    body: body({
      eventId: 'evt-step',
      event: 'step_started',
      status: 'started',
      taskId: 'task-1',
      stepId: 1,
      tool: 'call_query_agent',
    }),
  });
  assert.equal(result?.status, 201);
  const confirmation = api.handle({
    method: 'POST',
    pathname: '/api/system/assistant-events',
    systemId: '中台',
    token: token('中台'),
    body: body({
      eventId: 'evt-confirm',
      event: 'confirmation_required',
      status: 'info',
      taskId: 'task-1',
      stepId: 2,
      tool: 'call_order_agent',
      confirmationId: 'confirm-1',
    }),
  });
  assert.equal(confirmation?.status, 201);
  const list = api.handle({
    method: 'GET',
    pathname: '/api/system/assistant-events',
    systemId: '中台',
    token: token('中台'),
    query: new URLSearchParams(),
  });
  const events = list?.body.events as Array<Record<string, unknown>>;
  assert.equal(events[0].taskId, 'task-1');
  assert.equal(events[0].stepId, 1);
  assert.equal(events[1].confirmationId, 'confirm-1');
});

test('未知字段被拒绝', (t) => {
  const { api, token } = fixture(t);
  const result = api.handle({
    method: 'POST',
    pathname: '/api/system/assistant-events',
    systemId: '中台',
    token: token('中台'),
    body: body({ systemId: 'ERP' }),
  });
  assert.equal(result?.status, 400);
});

test('上报用量时写入用量台账，字段归属请求方系统', (t) => {
  const { api, token, usage } = fixture(t);
  const result = api.handle({
    method: 'POST',
    pathname: '/api/system/assistant-events',
    systemId: '中台',
    token: token('中台'),
    body: body({
      usage: { modelId: 'deepseek-chat', tokensIn: 1200, cachedTokens: 800, tokensOut: 180 },
      startedAt: '2026-10-19T09:00:00.000Z',
      endedAt: '2026-10-19T09:00:02.000Z',
    }),
  });
  assert.equal(result?.status, 201);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].systemId, '中台');
  assert.equal(usage[0].agentId, 'control-platform-assistant');
  assert.equal(usage[0].tokensIn, 1200);
  assert.equal(usage[0].cachedTokens, 800);
  assert.equal(usage[0].tokensOut, 180);
  assert.equal(usage[0].metering, 'reported');
  assert.equal(typeof usage[0].cost, 'number');
});

test('未上报用量时不写用量台账', (t) => {
  const { api, token, usage } = fixture(t);
  api.handle({ method: 'POST', pathname: '/api/system/assistant-events', systemId: '中台', token: token('中台'), body: body() });
  assert.equal(usage.length, 0);
});

test('列表只返回本系统事件', (t) => {
  const { api, token } = fixture(t);
  api.handle({ method: 'POST', pathname: '/api/system/assistant-events', systemId: '中台', token: token('中台'), body: body() });
  api.handle({ method: 'POST', pathname: '/api/system/assistant-events', systemId: 'ERP', token: token('ERP'), body: body() });
  const own = api.handle({
    method: 'GET',
    pathname: '/api/system/assistant-events',
    systemId: '中台',
    token: token('中台'),
    query: new URLSearchParams(),
  });
  assert.equal(own?.status, 200);
  assert.equal((own?.body.events as unknown[]).length, 1);
  assert.equal((own?.body.traces as unknown[]).length, 1);
});

test('bodyParseFailed 返回 400', (t) => {
  const { api, token } = fixture(t);
  const result = api.handle({
    method: 'POST',
    pathname: '/api/system/assistant-events',
    systemId: '中台',
    token: token('中台'),
    bodyParseFailed: true,
  });
  assert.equal(result?.status, 400);
});
