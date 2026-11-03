import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BorrowPolicySchema,
  DEFAULT_BORROW_POLICY,
  isBorrowCapabilityAllowed,
  loadBorrowPolicy,
} from '../src/borrow-policy.ts';

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

test('配置覆盖：白名单与别名可按文件生效', () => {
  const policy = BorrowPolicySchema.parse({
    ...DEFAULT_BORROW_POLICY,
    revision: 2,
    systemAliases: { ...DEFAULT_BORROW_POLICY.systemAliases, '新PLM': 'hengjian-plm' },
    allowlist: { ...DEFAULT_BORROW_POLICY.allowlist, 'hengjian-plm': ['query_plm'] },
  });
  assert.equal(isBorrowCapabilityAllowed('新PLM', 'query_plm', policy), true);
  assert.equal(isBorrowCapabilityAllowed('hengjian-plm', 'query_plm', policy), true);
  assert.equal(isBorrowCapabilityAllowed('hengjian-plm', 'reason_plm', policy), false);
  assert.equal(isBorrowCapabilityAllowed('control-platform', 'query_control_platform', policy), true);
});

test('loadBorrowPolicy 读取文件；损坏时回落默认值', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'borrow-policy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const validFile = join(dir, 'valid.json');
  const invalidFile = join(dir, 'invalid.json');
  writeFileSync(validFile, JSON.stringify({
    ...DEFAULT_BORROW_POLICY,
    revision: 3,
    allowlist: { 'hengjian-plm': ['query_plm'] },
  }), 'utf8');
  const loaded = loadBorrowPolicy(validFile);
  assert.equal(loaded.revision, 3);
  assert.equal(isBorrowCapabilityAllowed('PLM', 'query_plm', loaded), true);
  assert.equal(isBorrowCapabilityAllowed('PLM', 'reason_plm', loaded), false);

  writeFileSync(invalidFile, '{ not json', 'utf8');
  assert.equal(loadBorrowPolicy(invalidFile), DEFAULT_BORROW_POLICY);
});
