import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { enqueueM02Evidence, flushM02Outbox, m02OutboxHealth, type M02DeliveryRecord } from '../src/m02-outbox.ts';
import type { EvidenceEntry } from '../src/evidence.ts';

const entry: EvidenceEntry = {
  event_id: '11111111-1111-4111-8111-111111111111',
  occurred_at: '2026-10-10T00:00:00.000Z',
  tenant_id: 'tenant-a',
  object_ref: 'business://order/SO-1',
  source_system: 'aeos-hub',
  correlation_id: 'corr-1',
  version: '1.0',
  kind: 'app_event',
  evidence_refs: [],
  payload_hash: 'a'.repeat(64),
  payload: { ok: true },
};

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-m02-'));
  const file = join(dir, 'm02-outbox.jsonl');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { file };
}

test('buffers evidence without an endpoint and reports local-buffer health', (t) => {
  const { file } = fixture(t);
  enqueueM02Evidence(entry, file);
  assert.equal(m02OutboxHealth(file).pending, 1);
  assert.equal(m02OutboxHealth(file).configured, false);
});

test('flushes buffered evidence with an idempotency key and marks it delivered', async (t) => {
  const { file } = fixture(t);
  enqueueM02Evidence(entry, file);
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await flushM02Outbox({
    file,
    endpoint: 'https://m02.example/events',
    token: 'secret',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 204 });
    }) as typeof fetch,
  });
  assert.deepEqual(result, { delivered: 1, failed: 0, pending: 0, configured: true });
  assert.equal(calls[0]?.url, 'https://m02.example/events');
  assert.equal((calls[0]?.init.headers as Record<string, string>)['idempotency-key'], entry.event_id);
  assert.equal((calls[0]?.init.headers as Record<string, string>).authorization, 'Bearer secret');
  const rows = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as M02DeliveryRecord);
  assert.ok(rows[0]?.deliveredAt);
});

test('keeps failed deliveries pending and exposes the last error', async (t) => {
  const { file } = fixture(t);
  enqueueM02Evidence(entry, file);
  const result = await flushM02Outbox({
    file,
    endpoint: 'https://m02.example/events',
    fetchImpl: (async () => new Response(null, { status: 503 })) as typeof fetch,
  });
  assert.equal(result.failed, 1);
  assert.equal(result.pending, 1);
  assert.match(m02OutboxHealth(file).lastError ?? '', /503/);
});
