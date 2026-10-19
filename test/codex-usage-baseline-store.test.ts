import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getThreadUsageBaseline, recordThreadUsageTotal } from '../src/codex-usage-baseline-store.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-codex-usage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'baselines.json');
}

test('新线程首报即全量增量', (t) => {
  const file = fixture(t);
  const delta = recordThreadUsageTotal('thread-1', { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 }, file);
  assert.deepEqual(delta, { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 });
});

test('重复上报同一累计值 → 零增量', (t) => {
  const file = fixture(t);
  recordThreadUsageTotal('thread-1', { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 }, file);
  const delta = recordThreadUsageTotal('thread-1', { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 }, file);
  assert.deepEqual(delta, { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
});

test('累计增长时只记增量，且跨实例持久化', (t) => {
  const file = fixture(t);
  recordThreadUsageTotal('thread-1', { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 }, file);
  const delta = recordThreadUsageTotal('thread-1', { inputTokens: 180, cachedInputTokens: 60, outputTokens: 50 }, file);
  assert.deepEqual(delta, { inputTokens: 80, cachedInputTokens: 20, outputTokens: 30 });
  assert.deepEqual(getThreadUsageBaseline('thread-1', file), { inputTokens: 180, cachedInputTokens: 60, outputTokens: 50 });
});

test('累计值下降视为重置：不重复记账，基线更新为当前值', (t) => {
  const file = fixture(t);
  recordThreadUsageTotal('thread-1', { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 }, file);
  const delta = recordThreadUsageTotal('thread-1', { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 }, file);
  assert.deepEqual(delta, { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
  assert.deepEqual(getThreadUsageBaseline('thread-1', file), { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 });
});

test('不同线程互不影响', (t) => {
  const file = fixture(t);
  recordThreadUsageTotal('thread-1', { inputTokens: 100, cachedInputTokens: 0, outputTokens: 0 }, file);
  const delta = recordThreadUsageTotal('thread-2', { inputTokens: 30, cachedInputTokens: 10, outputTokens: 5 }, file);
  assert.deepEqual(delta, { inputTokens: 30, cachedInputTokens: 10, outputTokens: 5 });
});
