import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  UsageLedgerSnapshotSchema,
  UsageLedgerStore,
  type UsageEventAppendInput,
} from '../src/usage-ledger-store.ts';

const FIXED_NOW = '2026-10-16T08:00:00.000Z';

function fixture(t: TestContext): { dir: string; file: string; store: UsageLedgerStore } {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-usage-ledger-'));
  const file = join(dir, 'data', 'usage-ledger.json');
  let id = 0;
  const store = new UsageLedgerStore({
    file,
    clock: () => new Date(FIXED_NOW),
    idFactory: () => `test-${++id}`,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file, store };
}

function input(overrides: Partial<UsageEventAppendInput> = {}): UsageEventAppendInput {
  return {
    agentId: 'agent-aeos-hub',
    systemId: 'aeos-hub',
    modelId: 'deepseek-chat',
    runId: null,
    tokensIn: 100,
    tokensOut: 50,
    cost: 0.0002,
    startedAt: '2026-10-16T08:00:00.000Z',
    endedAt: '2026-10-16T08:00:01.000Z',
    ...overrides,
  };
}

test('ensure 初始化一个空账本', (t) => {
  const { file, store } = fixture(t);
  const snapshot = store.ensure();
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.revision, 0);
  assert.deepEqual(snapshot.events, []);
  assert.ok(existsSync(file));
  assert.doesNotThrow(() => UsageLedgerSnapshotSchema.parse(JSON.parse(readFileSync(file, 'utf8'))));
});

test('append 落一条用量事件并持久化', (t) => {
  const { file, store } = fixture(t);
  const event = store.append(input());
  assert.equal(event.id, 'usage-test-1');
  assert.equal(event.tokensIn, 100);
  assert.equal(event.tokensOut, 50);
  const snapshot = UsageLedgerSnapshotSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].runId, null);
});

test('append 对同一 runId 幂等去重', (t) => {
  const { store } = fixture(t);
  const first = store.append(input({ runId: 'exec-run-1' }));
  const second = store.append(input({ runId: 'exec-run-1', tokensIn: 999 }));
  assert.equal(first.id, second.id);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].tokensIn, 100);
});

test('缓存 Token 与计量来源落库；缺省按 0 / reported', (t) => {
  const { store } = fixture(t);
  const withCache = store.append(input({ cachedTokens: 60, metering: 'direct' }));
  assert.equal(withCache.cachedTokens, 60);
  assert.equal(withCache.metering, 'direct');
  const noCache = store.append(input({ runId: 'exec-run-2' }));
  assert.equal(noCache.cachedTokens, 0);
  assert.equal(noCache.metering, 'reported');
});

test('旧版无新字段的账本可解析为 legacy，不触发隔离', (t) => {
  const { file, store } = fixture(t);
  store.ensure();
  writeFileSync(file, JSON.stringify({
    version: 1,
    revision: 1,
    events: [{
      id: 'usage-old-1', agentId: 'a', systemId: 's', modelId: null, runId: null,
      tokensIn: 1, tokensOut: 2, cost: 0.1,
      startedAt: '2026-10-01T00:00:00.000Z', endedAt: '2026-10-01T00:00:01.000Z',
    }],
  }), 'utf8');
  const snapshot = store.load();
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].cachedTokens, 0);
  assert.equal(snapshot.events[0].metering, 'legacy');
  assert.equal(snapshot.events[0].consumerSystemId, null);
  assert.equal(snapshot.events[0].consumerAgentId, null);
  assert.equal(snapshot.events[0].borrowOrderId, null);
});

test('消费者字段落库并按消费者聚合', (t) => {
  const { store } = fixture(t);
  store.append(input({
    runId: 'exec-run-borrow-1',
    consumerSystemId: 'erp',
    consumerAgentId: 'purchase-assistant',
    borrowOrderId: 'borrow-1',
  }));
  store.append(input({
    runId: 'exec-run-borrow-2',
    consumerSystemId: 'erp',
    tokensIn: 20,
    tokensOut: 5,
    cost: 0.2,
  }));
  store.append(input({ runId: 'exec-run-plain' }));
  const events = store.list();
  assert.equal(events.find((event) => event.runId === 'exec-run-borrow-1')?.borrowOrderId, 'borrow-1');
  const rows = store.aggregateByConsumerSystem();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].consumerSystemId, 'erp');
  assert.equal(rows[0].events, 2);
  assert.equal(rows[0].tokensIn, 120);
});

test('list 按新到旧返回明细', (t) => {
  const { store } = fixture(t);
  store.append(input({ runId: 'exec-run-1', tokensIn: 1 }));
  store.append(input({ runId: 'exec-run-2', tokensIn: 2 }));
  const events = store.list();
  assert.equal(events.length, 2);
  assert.equal(events[0].runId, 'exec-run-2');
  assert.equal(events[1].runId, 'exec-run-1');
});

test('aggregateByAgent 按成本降序聚合', (t) => {
  const { store } = fixture(t);
  store.append(input({ agentId: 'agent-a', cost: 1, tokensIn: 10, tokensOut: 0 }));
  store.append(input({ agentId: 'agent-b', cost: 5, tokensIn: 0, tokensOut: 20 }));
  store.append(input({ agentId: 'agent-a', cost: 2, tokensIn: 5, tokensOut: 5 }));
  const rows = store.aggregateByAgent();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { agentId: 'agent-b', tokensIn: 0, tokensOut: 20, cost: 5, events: 1 });
  assert.deepEqual(rows[1], { agentId: 'agent-a', tokensIn: 15, tokensOut: 5, cost: 3, events: 2 });
});

test('aggregateBySystem 按系统聚合', (t) => {
  const { store } = fixture(t);
  store.append(input({ systemId: 'sys-a', cost: 2, tokensIn: 1, tokensOut: 1 }));
  store.append(input({ systemId: 'sys-b', cost: 3, tokensIn: 1, tokensOut: 1 }));
  const rows = store.aggregateBySystem();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].systemId, 'sys-b');
  assert.equal(rows[1].systemId, 'sys-a');
});

test('损坏文件被隔离为 corrupt-*.json 并回退空账本', (t) => {
  const { dir, file, store } = fixture(t);
  store.append(input());
  writeFileSync(file, '{ not valid json', 'utf8');
  const snapshot = store.load();
  assert.equal(snapshot.revision, 0);
  assert.deepEqual(snapshot.events, []);
  const quarantined = readdirSync(join(dir, 'data')).filter((name) => name.includes('corrupt-'));
  assert.equal(quarantined.length, 1);
});
