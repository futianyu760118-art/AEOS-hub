import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ExecutionEventStore,
  MAX_EVENTS_PER_RUN,
} from '../src/execution-event-store.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-exec-events-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { current: new Date('2026-10-19T09:00:00.000Z') };
  const store = new ExecutionEventStore({
    file: join(dir, 'execution-events.jsonl'),
    archiveDir: join(dir, 'archive'),
    clock: () => clock.current,
  });
  return { dir, clock, store };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'evt-1',
    runId: 'run-1',
    seq: 1,
    event: 'step_completed',
    name: '查询订单接口',
    status: 'completed',
    summary: '返回 20 条',
    ...overrides,
  };
}

const context = { agentId: 'agent-1', sourceSystem: '公司中控平台', runAgentId: 'agent-1' };

test('记录并读取执行步骤', (t) => {
  const { store } = fixture(t);
  const result = store.record(event(), context);
  assert.equal(result.accepted, true);
  const events = store.listByRun('run-1');
  assert.equal(events.length, 1);
  assert.equal(events[0].name, '查询订单接口');
  assert.equal(events[0].tenantId, 'tenant-demo');
  assert.equal(events[0].sourceSystem, '公司中控平台');
  assert.equal(store.countByRun('run-1'), 1);
});

test('同一 eventId 去重', (t) => {
  const { store } = fixture(t);
  store.record(event(), context);
  const again = store.record(event({ summary: '重复' }), context);
  assert.deepEqual(again, { accepted: true, duplicate: true });
  assert.equal(store.listByRun('run-1').length, 1);
});

test('run 不存在或归属不符时拒绝', (t) => {
  const { store } = fixture(t);
  const missing = store.record(event(), { ...context, runAgentId: null });
  assert.equal(missing.accepted, false);
  assert.equal(missing.reason, 'RUN_NOT_FOUND');
  const mismatch = store.record(event(), { ...context, runAgentId: 'agent-2' });
  assert.equal(mismatch.accepted, false);
  assert.equal(mismatch.reason, 'RUN_OWNERSHIP_MISMATCH');
});

test('单次任务最多 200 条', (t) => {
  const { store } = fixture(t);
  for (let index = 0; index < MAX_EVENTS_PER_RUN; index += 1) {
    const result = store.record(event({ eventId: `evt-${index}`, seq: index }), context);
    assert.equal(result.accepted, true);
  }
  const rejected = store.record(event({ eventId: 'evt-over', seq: 999 }), context);
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, 'RUN_EVENT_LIMIT_EXCEEDED');
});

test('超长 detail 截断并保留原始大小', (t) => {
  const { store } = fixture(t);
  const detail = { text: 'x'.repeat(20_000) };
  store.record(event({ detail }), context);
  const stored = store.listByRun('run-1')[0];
  const capped = stored.detail as { truncated: boolean; bytes: number; preview: string };
  assert.equal(capped.truncated, true);
  assert.ok(capped.bytes > 8 * 1024);
  assert.ok(capped.preview.length > 0);
});

test('非法事件类型被拒绝', (t) => {
  const { store } = fixture(t);
  const result = store.record(event({ event: 'not-a-type' }), context);
  assert.equal(result.accepted, false);
  assert.match(result.reason, /INVALID_EVENT/);
});

test('重载后仍能读取历史步骤', (t) => {
  const { dir, store } = fixture(t);
  store.record(event(), context);
  store.record(event({ eventId: 'evt-2', seq: 2, event: 'run_summary', status: 'info' }), context);
  const reloaded = new ExecutionEventStore({
    file: join(dir, 'execution-events.jsonl'),
    archiveDir: join(dir, 'archive'),
  });
  assert.equal(reloaded.listByRun('run-1').length, 2);
});

test('按 seq 排序返回', (t) => {
  const { store } = fixture(t);
  store.record(event({ eventId: 'evt-2', seq: 2, name: '第二步' }), context);
  store.record(event({ eventId: 'evt-1', seq: 1, name: '第一步' }), context);
  const events = store.listByRun('run-1');
  assert.deepEqual(events.map((item) => item.name), ['第一步', '第二步']);
});
