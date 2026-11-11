import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { IdempotencyStore, requestHash } from '../src/idempotency-store.ts';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-idempotency-'));
  const file = join(dir, 'idempotency.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { file, store: new IdempotencyStore(file, () => new Date('2026-10-10T00:00:00.000Z')) };
}

test('replays a completed response for the same key and request', (t) => {
  const { store } = fixture(t);
  assert.deepEqual(store.lookup({ key: 'k1', actorId: 'user-1', method: 'POST', path: '/api/tasks', request: { title: 'x' } }), { kind: 'miss' });
  store.record({ key: 'k1', actorId: 'user-1', method: 'POST', path: '/api/tasks', request: { title: 'x' }, status: 201, body: { taskId: 't1' } });
  assert.deepEqual(store.lookup({ key: 'k1', actorId: 'user-1', method: 'POST', path: '/api/tasks', request: { title: 'x' } }), {
    kind: 'replay', status: 201, body: { taskId: 't1' },
  });
});

test('rejects the same key with different request content or actor', (t) => {
  const { store } = fixture(t);
  store.record({ key: 'k1', actorId: 'user-1', method: 'POST', path: '/api/tasks', request: { title: 'x' }, status: 201, body: {} });
  assert.deepEqual(store.lookup({ key: 'k1', actorId: 'user-1', method: 'POST', path: '/api/tasks', request: { title: 'y' } }), { kind: 'conflict' });
  assert.deepEqual(store.lookup({ key: 'k1', actorId: 'user-2', method: 'POST', path: '/api/tasks', request: { title: 'x' } }), { kind: 'conflict' });
});

test('expired entries are treated as misses', (t) => {
  const { file, store } = fixture(t);
  store.record({ key: 'k1', actorId: 'user-1', method: 'POST', path: '/api/tasks', request: {}, status: 201, body: {} });
  const later = new IdempotencyStore(file, () => new Date('2026-10-12T00:00:00.000Z'));
  assert.deepEqual(later.lookup({ key: 'k1', actorId: 'user-1', method: 'POST', path: '/api/tasks', request: {} }), { kind: 'miss' });
});


test('request hashes are stable across object key order', () => {
  assert.equal(requestHash({ a: 1, b: { c: 2, d: 3 } }), requestHash({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(requestHash({ a: 1 }), requestHash({ a: 2 }));
});
