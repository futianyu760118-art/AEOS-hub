import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateUsageCostCny, estimateUsageCostCnyAtPeak, isDeepSeekPeak } from '../src/model-pricing.ts';
import { ModelProfileSchema, type ModelProfile } from '../src/model-profile-store.ts';

const FLASH: ModelProfile = ModelProfileSchema.parse({
  id: 'deepseek-chat',
  provider: 'deepseek',
  modelName: 'deepseek-flash',
  tier: 'light',
  effort: 'low',
  inputPrice: 2,
  inputPriceCached: 0.04,
  outputPrice: 8,
  offPeakMultiplier: 0.5,
  latencyMs: 800,
  contextWindow: 1_048_576,
  description: '',
});

const FOLLOWS_DEFAULT: ModelProfile = ModelProfileSchema.parse({
  id: 'account-default',
  provider: 'account',
  modelName: 'account-default',
  tier: 'light',
  inputPrice: 0,
  outputPrice: 0,
  latencyMs: 0,
  contextWindow: 0,
  followsDefault: true,
  description: '',
});

test('高峰时段：北京时间周一至周五 9-12、14-18', () => {
  assert.equal(isDeepSeekPeak(new Date('2026-10-19T10:00:00+08:00')), true);
  assert.equal(isDeepSeekPeak(new Date('2026-10-19T11:59:00+08:00')), true);
  assert.equal(isDeepSeekPeak(new Date('2026-10-19T12:00:00+08:00')), false);
  assert.equal(isDeepSeekPeak(new Date('2026-10-19T14:00:00+08:00')), true);
  assert.equal(isDeepSeekPeak(new Date('2026-10-19T18:00:00+08:00')), false);
  assert.equal(isDeepSeekPeak(new Date('2026-10-19T08:59:00+08:00')), false);
});

test('周末全天空闲', () => {
  assert.equal(isDeepSeekPeak(new Date('2026-10-17T10:00:00+08:00')), false);
  assert.equal(isDeepSeekPeak(new Date('2026-10-18T15:00:00+08:00')), false);
});

test('高峰价：缓存未命中输入 ¥2/M + 输出 ¥8/M', () => {
  const cost = estimateUsageCostCnyAtPeak(FLASH, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, true);
  assert.equal(cost, 10);
});

test('空闲价 = 高峰价的一半', () => {
  const cost = estimateUsageCostCnyAtPeak(FLASH, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, false);
  assert.equal(cost, 5);
});

test('缓存命中按 ¥0.04/M 计费，未命中按 ¥2/M', () => {
  const cost = estimateUsageCostCnyAtPeak(FLASH, { inputTokens: 1_000_000, cachedInputTokens: 800_000, outputTokens: 0 }, true);
  assert.equal(cost, 0.432);
});

test('缓存命中数超过输入时被钳制', () => {
  const cost = estimateUsageCostCnyAtPeak(FLASH, { inputTokens: 1_000, cachedInputTokens: 5_000, outputTokens: 0 }, true);
  assert.equal(cost, 1_000 * 0.04 / 1_000_000);
});

test('按调用时刻自动选择峰谷价', () => {
  const peak = estimateUsageCostCny(FLASH, { inputTokens: 1_000_000, outputTokens: 0 }, new Date('2026-10-19T10:00:00+08:00'));
  const offPeak = estimateUsageCostCny(FLASH, { inputTokens: 1_000_000, outputTokens: 0 }, new Date('2026-10-19T13:00:00+08:00'));
  assert.equal(peak, 2);
  assert.equal(offPeak, 1);
});

test('跟随默认档不计价', () => {
  const cost = estimateUsageCostCnyAtPeak(FOLLOWS_DEFAULT, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, true);
  assert.equal(cost, 0);
});
