import assert from 'node:assert/strict';
import test from 'node:test';
import { isBorrowCapabilityAllowed } from '../src/borrow-policy.ts';

test('允许中台查询/推理与 PLM 查询/推理跨系统借调', () => {
  assert.equal(isBorrowCapabilityAllowed('control-platform', 'query_control_platform'), true);
  assert.equal(isBorrowCapabilityAllowed('control-platform', 'reason_control_platform'), true);
  assert.equal(isBorrowCapabilityAllowed('hengjian-plm', 'query_plm'), true);
  assert.equal(isBorrowCapabilityAllowed('hengjian-plm', 'reason_plm'), true);
});

test('敏感能力 query_local_files 与写能力默认拒绝', () => {
  assert.equal(isBorrowCapabilityAllowed('hengjian-plm', 'query_local_files'), false);
  assert.equal(isBorrowCapabilityAllowed('control-platform', 'update_control_platform_order'), false);
  assert.equal(isBorrowCapabilityAllowed('control-platform', 'unknown_capability'), false);
});

test('兼容显示名与短名，未登记系统一律拒绝', () => {
  assert.equal(isBorrowCapabilityAllowed('公司中控平台（UAT）', 'query_control_platform'), true);
  assert.equal(isBorrowCapabilityAllowed('中控', 'query_control_platform'), true);
  assert.equal(isBorrowCapabilityAllowed('PLM', 'query_plm'), true);
  assert.equal(isBorrowCapabilityAllowed('unknown-system', 'query_plm'), false);
  assert.equal(isBorrowCapabilityAllowed(null, 'query_plm'), false);
});
