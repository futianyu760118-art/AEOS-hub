import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeModel, parseRouteRequest, ModelRouterError, isHubExecutableProfile } from '../src/model-router.ts';
import type { ModelProfile } from '../src/model-profile-store.ts';

const SEED = [
  { id: 'deepseek-chat', provider: 'deepseek', modelName: 'deepseek-chat', tier: 'light', inputPrice: 1, outputPrice: 2, latencyMs: 800, contextWindow: 64_000 },
  { id: 'deepseek-reasoner', provider: 'deepseek', modelName: 'deepseek-reasoner', tier: 'medium', inputPrice: 4, outputPrice: 16, latencyMs: 3_000, contextWindow: 64_000 },
  { id: 'gpt-4o', provider: 'openai', modelName: 'gpt-4o', tier: 'heavy', inputPrice: 18, outputPrice: 72, latencyMs: 1_200, contextWindow: 128_000 },
  { id: 'local-llama', provider: 'local', modelName: 'llama3.1', tier: 'light', inputPrice: 0, outputPrice: 0, latencyMs: 200, contextWindow: 8_192 },
].map((p) => ({ followsDefault: false, description: '', ...p })) as ModelProfile[];

const FOLLOWS_DEFAULT = [
  { id: 'account-default', provider: 'account', modelName: 'account-default', tier: 'light', inputPrice: 0, outputPrice: 0, latencyMs: 0, contextWindow: 0, followsDefault: true, description: '' },
  { id: 'provider-default', provider: 'remote', modelName: 'provider-default', tier: 'light', inputPrice: 0, outputPrice: 0, latencyMs: 0, contextWindow: 0, followsDefault: true, description: '' },
] as ModelProfile[];

const ANCHOR = [
  ...SEED,
  { id: 'deepseek-flash', provider: 'deepseek', modelName: 'deepseek-flash', tier: 'light', inputPrice: 0.5, outputPrice: 1, latencyMs: 400, contextWindow: 32_000, followsDefault: false, description: '' },
] as ModelProfile[];

test('轻难度非脱敏 → deepseek-chat，可执行', () => {
  const decision = routeModel({ difficulty: 'light' }, SEED);
  assert.equal(decision.satisfied, true);
  assert.equal(decision.profileId, 'deepseek-chat');
  assert.equal(decision.executable, true);
  assert.ok(decision.reasons.some((r) => r.includes('非脱敏')));
});

test('中难度 → deepseek-reasoner，可执行', () => {
  const decision = routeModel({ difficulty: 'medium' }, SEED);
  assert.equal(decision.satisfied, true);
  assert.equal(decision.profileId, 'deepseek-reasoner');
  assert.equal(decision.executable, true);
});

test('重难度 → gpt-4o，但 Hub 尚不可执行', () => {
  const decision = routeModel({ difficulty: 'heavy' }, SEED);
  assert.equal(decision.satisfied, true);
  assert.equal(decision.profileId, 'gpt-4o');
  assert.equal(decision.executable, false);
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
  const decision = routeModel({ difficulty: 'light', minContextWindow: 100_000 }, SEED);
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

test('同档内成本优先：无锚点时选更便宜的 deepseek-flash', () => {
  const decision = routeModel({ difficulty: 'light' }, ANCHOR);
  assert.equal(decision.profileId, 'deepseek-flash');
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
  assert.equal(isHubExecutableProfile(SEED.find((p) => p.id === 'gpt-4o')!), false);
});
