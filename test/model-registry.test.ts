import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  ModelRegistryStore,
  ModelRegistryConflictError,
  ModelRegistryNotFoundError,
} from '../src/model-registry.ts';

const FIXED_NOW = '2026-10-16T02:00:00.000Z';

function fixture(t: TestContext): { dir: string; file: string; store: ModelRegistryStore } {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-model-registry-'));
  const file = join(dir, 'data', 'model-registry.json');
  let id = 0;
  const store = new ModelRegistryStore({
    file,
    clock: () => new Date(FIXED_NOW),
    idFactory: () => `test-${++id}`,
    lockTimeoutMs: 50,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file, store };
}

test('首次加载生成含 DeepSeek 参考单价的默认快照', (t) => {
  const { file, store } = fixture(t);
  const snapshot = store.load();

  assert.equal(snapshot.version, 1);
  assert.ok(snapshot.models.length >= 2);
  const chat = snapshot.models.find((model) => model.model === 'deepseek-chat');
  assert.ok(chat);
  assert.equal(chat.pricing?.currency, 'CNY');
  assert.equal(chat.status, 'active');
  assert.ok(existsSync(file));
});

test('登记模型：能力去重、上下文窗口与单价解析', (t) => {
  const { store } = fixture(t);
  store.load();

  const created = store.create({
    name: 'GPT 代码模型',
    provider: 'openai',
    model: 'gpt-5.2-codex',
    capabilities: ['代码', '代码', ' 工具调用 '],
    contextWindow: '272000',
    pricing: { currency: 'USD', inputPerMTok: 1.25, cachedInputPerMTok: 0.125, outputPerMTok: 10 },
    notes: '订阅制下按 API 参考价估算',
  });

  assert.deepEqual(created.capabilities, ['代码', '工具调用']);
  assert.equal(created.contextWindow, 272_000);
  assert.equal(created.pricing?.inputPerMTok, 1.25);
  assert.equal(created.status, 'active');
});

test('同一提供商下重复的模型标识被拒绝（大小写不敏感）', (t) => {
  const { store } = fixture(t);
  store.load();

  store.create({ name: 'Chat', provider: 'deepseek', model: 'deepseek-chat-v2' });
  assert.throws(
    () => store.create({ name: 'Chat again', provider: 'DeepSeek', model: 'DeepSeek-Chat-V2' }),
    (error: unknown) => error instanceof ModelRegistryConflictError,
  );
});

test('更新模型单价与状态；找不到时抛 NotFound', (t) => {
  const { store } = fixture(t);
  store.load();
  const created = store.create({ name: 'Reasoner', provider: 'deepseek', model: 'deepseek-reasoner-v2', pricing: null });

  const updated = store.update(created.id, {
    pricing: { currency: 'CNY', inputPerMTok: 4, cachedInputPerMTok: 1, outputPerMTok: 16 },
    status: 'inactive',
  });

  assert.equal(updated.pricing?.outputPerMTok, 16);
  assert.equal(updated.status, 'inactive');
  assert.throws(
    () => store.update('model-missing', { name: 'x' }),
    (error: unknown) => error instanceof ModelRegistryNotFoundError,
  );
});

test('删除模型后快照不再包含该条目', (t) => {
  const { store } = fixture(t);
  store.load();
  const created = store.create({ name: '临时模型', provider: 'temp', model: 'tmp-model' });

  const removed = store.remove(created.id);

  assert.equal(removed.id, created.id);
  assert.ok(!store.load().models.some((model) => model.id === created.id));
});

test('findPricing 按 提供商+模型 匹配可用单价；停用或未定价返回 null', (t) => {
  const { store } = fixture(t);
  store.load();
  const priced = store.create({
    name: '测试模型', provider: 'vendor-a', model: 'Model-X',
    pricing: { currency: 'CNY', inputPerMTok: 1, cachedInputPerMTok: 0.2, outputPerMTok: 3 },
  });
  store.create({ name: '免费模型', provider: 'vendor-a', model: 'Model-Free', pricing: null });
  const disabled = store.create({
    name: '停用模型', provider: 'vendor-a', model: 'Model-Off',
    pricing: { currency: 'CNY', inputPerMTok: 1, cachedInputPerMTok: 1, outputPerMTok: 1 },
    status: 'inactive',
  });
  assert.equal(disabled.status, 'inactive');

  assert.equal(store.findPricing('VENDOR-A', 'model-x')?.inputPerMTok, 1);
  assert.equal(store.findPricing('vendor-a', 'Model-Free'), null);
  assert.equal(store.findPricing('vendor-a', 'Model-Off'), null);
  assert.equal(store.findPricing('vendor-b', 'Model-X'), null);
  assert.ok(priced.pricing);
});
