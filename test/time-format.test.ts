import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBeijingDateTime,
  formatBeijingTime,
  formatBeijingDate,
  isSameBeijingDay,
} from '../public/time-format.js';

test('Hub 时间统一按北京时间展示', () => {
  assert.equal(formatBeijingDateTime('2026-10-23T00:04:41.658Z'), '2026/10/23 08:04:41');
  assert.equal(formatBeijingTime('2026-10-23T00:04:41.658Z'), '08:04');
  assert.equal(formatBeijingDate('2026-10-23T00:04:41.658Z'), '2026/10/23');
});

test('北京日期判断跨 UTC 日界正确', () => {
  assert.equal(isSameBeijingDay('2026-10-23T00:04:41.658Z', '2026-10-23T08:04:41+08:00'), true);
  assert.equal(isSameBeijingDay('2026-10-22T16:30:00Z', '2026-10-23T00:30:00+08:00'), true);
  assert.equal(isSameBeijingDay('2026-10-22T15:30:00Z', '2026-10-23T00:30:00+08:00'), false);
});

test('无效值保留可读回退', () => {
  assert.equal(formatBeijingDateTime(''), '—');
  assert.equal(formatBeijingDateTime('not-a-date'), 'not-a-date');
});
