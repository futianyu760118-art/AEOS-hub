import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeModel, parseRouteRequest, ModelRouterError, isHubExecutableProfile } from '../src/model-router.ts';
import type { ModelProfile } from '../src/model-profile-store.ts';

const FLASH = {
  provider: 'deepseek' as const,
  modelName: 'deepseek-flash',
  inputPrice: 2,
  inputPriceCached: 0.04,
  outputPrice: 8,
  offPeakMultiplier: 0.5,
  contextWindow: 1_048_576,
  followsDefault: false,
  description: '',
};

const SEED = [
  { ...FLASH, id: 'deepseek-chat', tier: 'light', effort: 'low', latencyMs: 800 },
  { ...FLASH, id: 'deepseek-reasoner', tier: 'medium', effort: 'high', latencyMs: 3_000 },
  { ...FLASH, id: 'deepseek-flash-max', tier: 'heavy', effort: 'max', latencyMs: 6_000 },
  { id: 'local-llama', provider: 'local', modelName: 'llama3.1', tier: 'light', inputPrice: 0, outputPrice: 0, latencyMs: 200, contextWindow: 8_192, followsDefault: false, description: '' },
].map((p) => ({ inputPriceCached: 0, offPeakMultiplier: 1, ...p })) as ModelProfile[];

const FOLLOWS_DEFAULT = [
  { id: 'account-default', provider: 'account', modelName: 'account-default', tier: 'light', inputPrice: 0, outputPrice: 0, latencyMs: 0, contextWindow: 0, followsDefault: true, description: '' },
  { id: 'provider-default', provider: 'remote', modelName: 'provider-default', tier: 'light', inputPrice: 0, outputPrice: 0, latencyMs: 0, contextWindow: 0, followsDefault: true, description: '' },
] as ModelProfile[];

const ANCHOR = [
  ...SEED,
  { id: 'deepseek-flash-cheap', provider: 'deepseek', modelName: 'deepseek-flash', tier: 'light', inputPrice: 1, inputPriceCached: 0.02, outputPrice: 4, offPeakMultiplier: 0.5, latencyMs: 400, contextWindow: 1_048_576, followsDefault: false, description: '' },
] as ModelProfile[];

test('轻难度非脱敏 → deepseek-chat（flash/effort=low），可执行', () => {
  const decision = routeModel({ difficulty: 'light' }, SEED);
  assert.equal(decision.satisfied, true);
  assert.equal(decision.profileId, 'deepseek-chat');
  assert.equal(decision.profile?.modelName, 'deepseek-flash');
  assert.equal(decision.profile?.effort, 'low');
  assert.equal(decision.executable, true);
  assert.ok(decision.reasons.some((r) => r.includes('非脱敏')));
});

test('中难度 → deepseek-reasoner（flash/effort=high），可执行', () => {
  const decision = routeModel({ difficulty: 'medium' }, SEED);
  assert.equal(decision.satisfied, true);
  assert.equal(decision.profileId, 'deepseek-reasoner');
  assert.equal(decision.profile?.effort, 'high');
  assert.equal(decision.executable, true);
});

test('重难度 → deepseek-flash-max（flash/effort=max），可执行', () => {
  const decision = routeModel({ difficulty: 'heavy' }, SEED);
  assert.equal(decision.satisfied, true);
  assert.equal(decision.profileId, 'deepseek-flash-max');
  assert.equal(decision.profile?.effort, 'max');
  assert.equal(decision.executable, true);
});

test('脱敏轻任务 → local-llama', () => {
  const decision = routeModel({ difficulty: 'light', dataSensitive: true }, SEED);
  assert.equal(decision.satisfied, true);
  assert.equal(decision.profileId, 'local-llama');
  assert.equal(decision.executable, false);
});

test('脱敏中任务无本地中档 → 不满足且不可回退云端', () => {
  const decision = routeModel({ difficulty: 'medium', dataSensitive: true }, SEED);
  assert.equal(decision.satisfied, false);
  assert.equal(decision.profileId, null);
  assert.equal(decision.fallbackProfileId, null);
  assert.ok(decision.reasons.some((r) => r.includes('不可回退')));
});

test('最小上下文约束过滤后回退', () => {
  const decision = routeModel({ difficulty: 'light', minContextWindow: 2_000_000 }, SEED);
  assert.equal(decision.satisfied, false);
  assert.equal(decision.fallbackProfileId, 'deepseek-chat');
});

test('最大时延约束过滤后回退', () => {
  const decision = routeModel({ difficulty: 'light', maxLatencyMs: 600 }, SEED);
  assert.equal(decision.satisfied, false);
  assert.equal(decision.fallbackProfileId, 'deepseek-chat');
});

test('每百万 Token 成本上限过滤后回退', () => {
  const decision = routeModel({ difficulty: 'light', maxCostPerMillion: 2 }, SEED);
  assert.equal(decision.satisfied, false);
  assert.equal(decision.fallbackProfileId, 'deepseek-chat');
});

test('followsDefault 档从不进入候选', () => {
  const decision = routeModel({ difficulty: 'light' }, FOLLOWS_DEFAULT);
  assert.equal(decision.satisfied, false);
  assert.notEqual(decision.fallbackProfileId, 'account-default');
});

test('同档内成本优先：无锚点时选更便宜的 deepseek-flash-cheap', () => {
  const decision = routeModel({ difficulty: 'light' }, ANCHOR);
  assert.equal(decision.profileId, 'deepseek-flash-cheap');
});

test('Agent 默认档锚点：满足约束时沿用而非换更便宜的档', () => {
  const decision = routeModel({ difficulty: 'light', agentModelProfileId: 'deepseek-chat' }, ANCHOR);
  assert.equal(decision.profileId, 'deepseek-chat');
  assert.ok(decision.reasons.some((r) => r.includes('沿用 Agent 默认档')));
});

test('parseRouteRequest 校验非法输入', () => {
  assert.throws(
    () => parseRouteRequest({ difficulty: 'extreme' }),
    (err: unknown) => err instanceof ModelRouterError && err.code === 'INVALID_ROUTE_REQUEST',
  );
  assert.throws(
    () => parseRouteRequest({ maxLatencyMs: -1 }),
    (err: unknown) => err instanceof ModelRouterError && err.code === 'INVALID_ROUTE_REQUEST',
  );
});

test('isHubExecutableProfile 仅认 deepseek', () => {
  assert.equal(isHubExecutableProfile(SEED.find((p) => p.id === 'deepseek-chat')!), true);
  assert.equal(isHubExecutableProfile(SEED.find((p) => p.id === 'local-llama')!), false);
});
