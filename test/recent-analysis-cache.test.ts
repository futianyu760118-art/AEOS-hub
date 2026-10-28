import assert from 'node:assert/strict';
import test from 'node:test';
import { RecentAnalysisCache } from '../src/recent-analysis-cache.ts';

test('TTL 内命中，过期后失效', () => {
  let now = 1_000;
  const cache = new RecentAnalysisCache<string>({ ttlMs: 5_000, now: () => now });
  cache.set('q', 'answer');
  now = 5_999;
  assert.equal(cache.get('q'), 'answer');
  now = 6_000;
  assert.equal(cache.get('q'), null);
  assert.equal(cache.size, 0);
});

test('覆盖同一 key 会刷新过期时间', () => {
  let now = 0;
  const cache = new RecentAnalysisCache<string>({ ttlMs: 1_000, now: () => now });
  cache.set('q', 'old');
  now = 800;
  cache.set('q', 'new');
  now = 1_200;
  assert.equal(cache.get('q'), 'new');
});

test('超过容量时淘汰最早写入的条目', () => {
  let now = 0;
  const cache = new RecentAnalysisCache<string>({ ttlMs: 10_000, maxEntries: 2, now: () => now });
  cache.set('a', '1');
  now = 1;
  cache.set('b', '2');
  now = 2;
  cache.set('c', '3');
  assert.equal(cache.get('a'), null);
  assert.equal(cache.get('b'), '2');
  assert.equal(cache.get('c'), '3');
  assert.equal(cache.size, 2);
});

test('可以主动删除缓存', () => {
  const cache = new RecentAnalysisCache<string>({ ttlMs: 10_000 });
  cache.set('q', 'answer');
  cache.delete('q');
  assert.equal(cache.get('q'), null);
});
