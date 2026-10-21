import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateUsageCostForModel } from '../src/usage-cost.ts';
import { getSeedProfiles } from '../src/model-profile-store.ts';

const usage = { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 500 };
const at = new Date('2026-10-21T06:00:00.000Z');

test('按模型 ID 补算成本', () => {
  const cost = estimateUsageCostForModel('deepseek-v4-flash', usage, at, getSeedProfiles());
  assert.equal(typeof cost, 'number');
  assert.ok((cost ?? 0) > 0);
});

test('按模型名补算成本', () => {
  const cost = estimateUsageCostForModel('deepseek-v4-flash', usage, at, getSeedProfiles());
  assert.ok((cost ?? 0) > 0);
});

test('未知模型不补算', () => {
  assert.equal(estimateUsageCostForModel('unknown-model', usage, at, getSeedProfiles()), null);
  assert.equal(estimateUsageCostForModel(null, usage, at, getSeedProfiles()), null);
});

test('followsDefault 档不补算', () => {
  assert.equal(estimateUsageCostForModel('account-default', usage, at, getSeedProfiles()), null);
});
