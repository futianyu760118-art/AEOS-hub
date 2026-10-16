import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { UsageStore, estimateCost } from '../src/usage-store.ts';
import type { ModelPricing } from '../src/model-registry.ts';

const PRICING: ModelPricing = { currency: 'CNY', inputPerMTok: 2, cachedInputPerMTok: 0.5, outputPerMTok: 8 };

function fixture(t: TestContext, options: { maxRecords?: number } = {}): UsageStore {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-usage-store-'));
  let id = 0;
  let day = 0;
  const store = new UsageStore({
    file: join(dir, 'data', 'usage.json'),
    clock: () => new Date(`2026-10-${String(16 + day).padStart(2, '0')}T08:00:00.000Z`),
    idFactory: () => `test-${++id}`,
    lockTimeoutMs: 50,
    maxRecords: options.maxRecords,
    pricingResolver: (provider, model) => (provider === 'deepseek' && model === 'deepseek-chat' ? PRICING : null),
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return store;
}

function counts(overrides: Partial<Record<'inputTokens' | 'cachedInputTokens' | 'cacheWriteInputTokens' | 'outputTokens' | 'reasoningOutputTokens' | 'totalTokens', number>>) {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    ...overrides,
  };
}

test('estimateCost：缓存命中按较低单价、缓存写入按输入单价估算', () => {
  const cost = estimateCost(PRICING, counts({
    inputTokens: 1_000_000,
    cachedInputTokens: 200_000,
    cacheWriteInputTokens: 100_000,
    outputTokens: 500_000,
    totalTokens: 1_800_000,
  }));
  assert.equal(cost.currency, 'CNY');
  // (800K+100K)*2 + 200K*0.5 + 500K*8 = 1.8 + 0.1 + 4 = 5.9 元 / 百万token口径
  assert.equal(cost.amount, 5.9);
});

test('record：按会话累计值求增量；重复上报不重复记账', (t) => {
  const store = fixture(t);
  const first = store.record({
    sessionId: 'thread-1', runId: 'turn-1', conversationId: 'conv-1',
    agentId: 'agent-aeos-hub', agentName: 'AEOS 中枢 Agent', scope: 'hub',
    provider: 'deepseek', model: 'deepseek-chat',
    usage: counts({ inputTokens: 1_000_000, cachedInputTokens: 200_000, cacheWriteInputTokens: 100_000, outputTokens: 500_000, totalTokens: 1_800_000 }),
  });
  assert.ok(first);
  assert.equal(first.cost, 5.9);
  assert.equal(first.priced, true);

  const duplicate = store.record({
    sessionId: 'thread-1', agentId: 'agent-aeos-hub', agentName: 'AEOS 中枢 Agent', scope: 'hub',
    provider: 'deepseek', model: 'deepseek-chat',
    usage: counts({ inputTokens: 1_000_000, cachedInputTokens: 200_000, cacheWriteInputTokens: 100_000, outputTokens: 500_000, totalTokens: 1_800_000 }),
  });
  assert.equal(duplicate, null);

  const growth = store.record({
    sessionId: 'thread-1', agentId: 'agent-aeos-hub', agentName: 'AEOS 中枢 Agent', scope: 'hub',
    provider: 'deepseek', model: 'deepseek-chat',
    usage: counts({ inputTokens: 1_000_000, cachedInputTokens: 200_000, cacheWriteInputTokens: 100_000, outputTokens: 600_000, totalTokens: 1_900_000 }),
  });
  assert.ok(growth);
  assert.equal(growth.outputTokens, 100_000);
  assert.equal(growth.cost, 0.8);
});

test('record：未登记单价的模型只计用量不计费', (t) => {
  const store = fixture(t);
  const record = store.record({
    sessionId: 'thread-2', agentId: 'agent-x', agentName: '未知模型 Agent', scope: 'agent',
    provider: 'openai', model: 'account-default',
    usage: counts({ inputTokens: 1_000, outputTokens: 2_000, totalTokens: 3_000 }),
  });
  assert.ok(record);
  assert.equal(record.priced, false);
  assert.equal(record.cost, null);
  assert.equal(record.currency, null);
});

test('forgetThread：清除基线后会话重新按全量累计记账', (t) => {
  const store = fixture(t);
  store.record({
    sessionId: 'thread-3', agentId: 'a', agentName: 'A', scope: 'hub',
    provider: 'deepseek', model: 'deepseek-chat',
    usage: counts({ outputTokens: 100_000, totalTokens: 100_000 }),
  });
  store.forgetThread('thread-3');
  const again = store.record({
    sessionId: 'thread-3', agentId: 'a', agentName: 'A', scope: 'hub',
    provider: 'deepseek', model: 'deepseek-chat',
    usage: counts({ outputTokens: 100_000, totalTokens: 100_000 }),
  });
  assert.ok(again);
  assert.equal(again.totalTokens, 100_000);
});

test('summary：按智能体 / 模型 / 日期聚合，并支持智能体过滤', (t) => {
  const store = fixture(t);
  store.record({
    sessionId: 't-a', agentId: 'agent-hub', agentName: '中枢', scope: 'hub',
    provider: 'deepseek', model: 'deepseek-chat',
    usage: counts({ inputTokens: 500_000, outputTokens: 250_000, totalTokens: 750_000 }),
  });
  store.record({
    sessionId: 't-b', agentId: 'agent-risk', agentName: '风险 Agent', scope: 'agent',
    provider: 'deepseek', model: 'deepseek-chat',
    usage: counts({ inputTokens: 100_000, outputTokens: 50_000, totalTokens: 150_000 }),
  });

  const summary = store.summary({ from: '2026-10-01', to: '2026-10-31' });
  assert.equal(summary.totals.records, 2);
  assert.equal(summary.totals.totalTokens, 900_000);
  // 500K*2 + 250K*8 = 3 元；100K*2 + 50K*8 = 0.6 元
  assert.equal(summary.totals.cost.CNY, 3.6);
  assert.equal(summary.byAgent.length, 2);
  assert.equal(summary.byAgent[0]?.agentId, 'agent-hub');
  assert.equal(summary.byModel[0]?.model, 'deepseek-chat');
  assert.equal(summary.byDay.length, 1);
  assert.equal(summary.recent.length, 2);

  const filtered = store.summary({ from: '2026-10-01', to: '2026-10-31', agentId: 'agent-risk' });
  assert.equal(filtered.totals.records, 1);
  assert.equal(filtered.totals.totalTokens, 150_000);
  assert.equal(filtered.recent.length, 1);
});

test('summary：默认区间为当月，范围外记录不计入', (t) => {
  const store = fixture(t);
  store.record({
    sessionId: 't-c', agentId: 'a', agentName: 'A', scope: 'hub',
    provider: 'deepseek', model: 'deepseek-chat',
    usage: counts({ outputTokens: 10, totalTokens: 10 }),
  });
  // fixture 时钟固定在 2026-10-16，默认区间为当月，应包含该记录。
  const summary = store.summary({});
  assert.equal(summary.totals.records, 1);
  assert.equal(summary.from, '2026-10-01T00:00:00.000Z');
  assert.ok(summary.to.startsWith('2026-10-16'));
});

test('明细超过上限时滚动进月度汇总，长周期费用统计保持完整', (t) => {
  const store = fixture(t, { maxRecords: 2 });
  for (let index = 0; index < 3; index += 1) {
    const record = store.record({
      sessionId: `t-${index}`, agentId: 'agent-hub', agentName: '中枢', scope: 'hub',
      provider: 'deepseek', model: 'deepseek-chat',
      usage: counts({ outputTokens: 100_000, totalTokens: 100_000 }),
    });
    assert.ok(record);
  }
  const snapshot = store.load();
  assert.equal(snapshot.records.length, 2);
  const rollup = snapshot.monthlyRollup['2026-10'];
  assert.ok(rollup);
  assert.equal(rollup.records, 1);
  assert.equal(rollup.byAgent['agent-hub']?.records, 1);

  // 汇总 = 滚动归档 1 条 + 明细 2 条。
  const summary = store.summary({ from: '2026-10-01', to: '2026-10-31' });
  assert.equal(summary.totals.records, 3);
  assert.equal(summary.totals.cost.CNY, 2.4);
  assert.deepEqual(summary.rolledUpMonths, ['2026-10']);
});
