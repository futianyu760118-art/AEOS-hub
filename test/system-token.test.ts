import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSystemToken, verifySystemToken } from '../src/system-token.ts';

test('派生确定性：同一 root+systemId 稳定产出 64 位 hex', () => {
  const token = deriveSystemToken('root-secret', 'erp');
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(token, deriveSystemToken('root-secret', 'erp'));
});

test('不同系统令牌互不相同', () => {
  assert.notEqual(deriveSystemToken('root-secret', 'erp'), deriveSystemToken('root-secret', 'mes'));
});

test('正确令牌校验通过', () => {
  assert.equal(verifySystemToken('root-secret', 'erp', deriveSystemToken('root-secret', 'erp')), true);
});

test('错误令牌 / 错系统 / 错根密钥一律拒绝', () => {
  assert.equal(verifySystemToken('root-secret', 'erp', deriveSystemToken('root-secret', 'mes')), false);
  assert.equal(verifySystemToken('root-secret', 'erp', 'deadbeef'), false);
  assert.equal(verifySystemToken('other-secret', 'erp', deriveSystemToken('root-secret', 'erp')), false);
});

test('空根密钥 fail-closed（派生仍可算，但校验必拒绝）', () => {
  assert.equal(verifySystemToken('', 'erp', deriveSystemToken('', 'erp')), false);
});

test('非 hex / 空令牌拒绝', () => {
  assert.equal(verifySystemToken('root-secret', 'erp', ''), false);
  assert.equal(verifySystemToken('root-secret', 'erp', 'not-a-hex-token!!'), false);
});
