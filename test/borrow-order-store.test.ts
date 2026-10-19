import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BORROW_ORDER_MAX_INPUT_BYTES,
  BORROW_ORDER_MAX_RESULT_BYTES,
  BorrowOrderSnapshotSchema,
  BorrowOrderStore,
  BorrowOrderStoreError,
  canTransitionBorrowOrder,
  capBorrowResult,
  type CreateBorrowOrderRecordInput,
} from '../src/borrow-order-store.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-borrow-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let id = 0;
  const clock = { current: new Date('2026-10-19T09:00:00.000Z') };
  const store = new BorrowOrderStore({
    file: join(dir, 'borrow-orders.json'),
    clock: () => clock.current,
    idFactory: () => `test-${++id}`,
  });
  return { dir, store, clock };
}

function input(overrides: Partial<CreateBorrowOrderRecordInput> = {}): CreateBorrowOrderRecordInput {
  return {
    tenantId: 'pilot-default',
    requestId: 'req-1',
    requestHash: 'a'.repeat(64),
    fromSystem: 'erp',
    fromAgentId: 'purchase-assistant',
    capability: 'query_control_platform',
    input: { path: '/external/orders/list' },
    toSystem: null,
    toAgent: null,
    providerSystem: '公司中控平台',
    providerAgentId: 'agent-1',
    ...overrides,
  };
}

test('ensure 初始化空快照', (t) => {
  const { store } = fixture(t);
  const snapshot = store.ensure();
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.revision, 0);
  assert.deepEqual(snapshot.orders, []);
});

test('create 落全部字段并递增 revision', (t) => {
  const { store, clock } = fixture(t);
  const order = store.create(input());
  assert.equal(order.orderId, 'borrow-test-1');
  assert.equal(order.status, 'pending');
  assert.equal(order.fromSystem, 'erp');
  assert.equal(order.requestHash, 'a'.repeat(64));
  assert.equal(order.createdAt, clock.current.toISOString());
  const snapshot = BorrowOrderSnapshotSchema.parse(store.load());
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.orders.length, 1);
});

test('create 拒绝重复的 (fromSystem, requestId)', (t) => {
  const { store } = fixture(t);
  store.create(input());
  assert.throws(() => store.create(input()), (error: unknown) => error instanceof BorrowOrderStoreError && error.code === 'BORROW_ORDER_DUPLICATE_REQUEST');
});

test('create 拒绝超过上限的 input', (t) => {
  const { store } = fixture(t);
  const big = { text: 'x'.repeat(BORROW_ORDER_MAX_INPUT_BYTES + 10) };
  assert.throws(() => store.create(input({ input: big })), (error: unknown) => error instanceof BorrowOrderStoreError && error.code === 'BORROW_ORDER_INPUT_TOO_LARGE');
});

test('状态机：合法流转成功，非法流转被拒绝，终态不可回退', (t) => {
  const { store } = fixture(t);
  const order = store.create(input());
  const dispatched = store.update(order.orderId, { status: 'dispatched', runId: 'run-1' });
  assert.equal(dispatched.status, 'dispatched');
  const running = store.update(order.orderId, { status: 'running' });
  assert.equal(running.status, 'running');
  const completed = store.update(order.orderId, { status: 'completed', result: { ok: true } });
  assert.equal(completed.status, 'completed');
  assert.throws(() => store.update(order.orderId, { status: 'running' }), (error: unknown) => error instanceof BorrowOrderStoreError && error.code === 'BORROW_ORDER_STATE_INVALID');
  assert.equal(canTransitionBorrowOrder('pending', 'running'), false);
  assert.equal(canTransitionBorrowOrder('dispatched', 'running'), true);
});

test('结果超限时保存截断摘要与原始大小', () => {
  const big = { rows: Array.from({ length: 20_000 }, (_, index) => ({ index, text: 'x'.repeat(30) })) };
  const capped = capBorrowResult(big);
  assert.equal(capped.resultTruncated, true);
  assert.equal(capped.resultBytes > BORROW_ORDER_MAX_RESULT_BYTES, true);
  const marker = capped.result as { truncated: boolean; bytes: number; preview: string };
  assert.equal(marker.truncated, true);
  assert.equal(marker.bytes, capped.resultBytes);
  assert.ok(marker.preview.length > 0);
});

test('list 按新到旧并支持过滤', (t) => {
  const { store } = fixture(t);
  const first = store.create(input({ requestId: 'req-1' }));
  const second = store.create(input({ requestId: 'req-2', fromSystem: 'mes' }));
  store.update(first.orderId, { status: 'failed' });
  assert.equal(store.list()[0].orderId, second.orderId);
  assert.equal(store.list({ fromSystem: 'mes' }).length, 1);
  assert.equal(store.list({ status: 'failed' })[0].orderId, first.orderId);
});

test('countOpenForSystem 只统计非终态', (t) => {
  const { store } = fixture(t);
  const a = store.create(input({ requestId: 'req-1' }));
  store.create(input({ requestId: 'req-2' }));
  store.update(a.orderId, { status: 'failed' });
  assert.equal(store.countOpenForSystem('erp'), 1);
});

test('损坏文件被隔离并从空账本开始', (t) => {
  const { dir, store } = fixture(t);
  store.ensure();
  writeFileSync(store.file, '{ not json', 'utf8');
  const snapshot = store.load();
  assert.deepEqual(snapshot.orders, []);
  const quarantined = readdirSync(join(dir)).filter((name) => name.includes('corrupt-'));
  assert.equal(quarantined.length, 1);
});

test('主文件损坏时优先从 .bak 恢复', (t) => {
  const { store } = fixture(t);
  store.create(input());
  store.create(input({ requestId: 'req-2' }));
  // atomicWrite 会在第二次写入前生成 .bak（内容是第一次写入的快照）。
  assert.equal(existsSync(`${store.file}.bak`), true);
  writeFileSync(store.file, '{ broken', 'utf8');
  const recovered = store.load();
  assert.equal(recovered.orders.length, 1);
});
