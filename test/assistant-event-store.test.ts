import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssistantEventStore,
  MAX_ASSISTANT_EVENTS_PER_TRACE,
} from '../src/assistant-event-store.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-assistant-events-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { current: new Date('2026-10-19T09:00:00.000Z') };
  const store = new AssistantEventStore({
    file: join(dir, 'assistant-events.jsonl'),
    archiveDir: join(dir, 'archive'),
    clock: () => clock.current,
  });
  return { dir, clock, store };
}

function event(overrides: Record<string, unknown> = {}) {
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

test('记录并读取助手事件', (t) => {
  const { store } = fixture(t);
  const result = store.record(event(), '中台');
  assert.equal(result.accepted, true);
  const events = store.listEvents({ systemId: '中台' });
  assert.equal(events.length, 1);
  assert.equal(events[0].systemId, '中台');
  assert.equal(events[0].tenantId, 'tenant-demo');
  assert.equal(events[0].traceId, 'trace-1');
  assert.equal(store.countEvents({ systemId: '中台' }), 1);
});

test('eventId 按系统 + 事件去重', (t) => {
  const { store } = fixture(t);
  store.record(event(), '中台');
  const duplicate = store.record(event({ summary: '重复' }), '中台');
  assert.deepEqual(duplicate, { accepted: true, duplicate: true });
  assert.equal(store.listEvents({ systemId: '中台' }).length, 1);
  // 不同系统可以使用相同 eventId
  const other = store.record(event(), 'ERP');
  assert.equal(other.accepted, true);
  assert.equal(store.countEvents({ systemId: 'ERP' }), 1);
});

test('单个会话最多 200 条', (t) => {
  const { store } = fixture(t);
  for (let index = 0; index < MAX_ASSISTANT_EVENTS_PER_TRACE; index += 1) {
    assert.equal(store.record(event({ eventId: `evt-${index}` }), '中台').accepted, true);
  }
  const rejected = store.record(event({ eventId: 'evt-over' }), '中台');
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'TRACE_EVENT_LIMIT_EXCEEDED');
});

test('超长 detail 截断并保留原始大小', (t) => {
  const { store } = fixture(t);
  store.record(event({ detail: { text: 'x'.repeat(20_000) } }), '中台');
  const stored = store.listEvents({ systemId: '中台' })[0];
  const capped = stored.detail as { truncated: boolean; bytes: number; preview: string };
  assert.equal(capped.truncated, true);
  assert.ok(capped.bytes > 8 * 1024);
  assert.ok(capped.preview.length > 0);
});

test('解析模型用量', (t) => {
  const { store } = fixture(t);
  store.record(event({
    usage: { modelId: 'deepseek-flash', tokensIn: 1200, cachedTokens: 800, tokensOut: 180 },
  }), '中台');
  const stored = store.listEvents({ systemId: '中台' })[0];
  assert.equal(stored.usage?.modelId, 'deepseek-flash');
  assert.equal(stored.usage?.tokensIn, 1200);
  assert.equal(stored.usage?.cachedTokens, 800);
  assert.equal(stored.usage?.cost, null);
});

test('会话归并：数量、最早/最近时间、错误标记', (t) => {
  const { store, clock } = fixture(t);
  store.record(event({ eventId: 'e1', event: 'conversation_started', summary: '开始', startedAt: '2026-10-19T09:00:00.000Z' }), '中台');
  clock.current = new Date('2026-10-19T09:01:00.000Z');
  store.record(event({ eventId: 'e2', event: 'error', status: 'failed', summary: '工具失败', startedAt: '2026-10-19T09:01:00.000Z' }), '中台');
  const traces = store.listTraces({ systemId: '中台' });
  assert.equal(traces.length, 1);
  assert.equal(traces[0].count, 2);
  assert.equal(traces[0].firstAt, '2026-10-19T09:00:00.000Z');
  assert.equal(traces[0].lastAt, '2026-10-19T09:01:00.000Z');
  assert.equal(traces[0].hasError, true);
});

test('系统之间互不串数据', (t) => {
  const { store } = fixture(t);
  store.record(event({ eventId: 'e1', traceId: 't1' }), '中台');
  store.record(event({ eventId: 'e2', traceId: 't2' }), 'ERP');
  assert.equal(store.listEvents({ systemId: '中台' }).length, 1);
  assert.equal(store.listEvents({ systemId: 'ERP' }).length, 1);
  assert.equal(store.listTraces({ systemId: '中台' })[0].systemId, '中台');
});

test('重载后仍能读取历史事件', (t) => {
  const { dir, store } = fixture(t);
  store.record(event(), '中台');
  const reloaded = new AssistantEventStore({
    file: join(dir, 'assistant-events.jsonl'),
    archiveDir: join(dir, 'archive'),
  });
  assert.equal(reloaded.listEvents({ systemId: '中台' }).length, 1);
});
