import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TENANT_ID, resolveTenantId } from '../src/tenant-registry.ts';
import type { SystemRecord } from '../src/system-registry.ts';

const NOW = '2026-10-20T08:00:00.000Z';

const systems: SystemRecord[] = [
  {
    systemId: 'control-platform', name: '公司中控平台', tenantId: 'tenant-demo', owner: '中台团队',
    description: '', status: 'active', sourceSystemAliases: ['公司中控平台（UAT）'], createdAt: NOW, updatedAt: NOW,
  },
  {
    systemId: 'hengjian-plm', name: '恒剑 PLM', tenantId: 'tenant-plm', owner: 'PLM 团队',
    description: '', status: 'active', sourceSystemAliases: ['恒剑PLM'], createdAt: NOW, updatedAt: NOW,
  },
];

test('按 systemId 解析租户', () => {
  assert.equal(resolveTenantId('control-platform', systems), 'tenant-demo');
  assert.equal(resolveTenantId('hengjian-plm', systems), 'tenant-plm');
});

test('按执行面自报系统名/别名解析租户', () => {
  assert.equal(resolveTenantId('公司中控平台（UAT）', systems), 'tenant-demo');
  assert.equal(resolveTenantId('恒剑PLM', systems), 'tenant-plm');
});

test('未知系统回落到默认租户', () => {
  assert.equal(resolveTenantId('unknown', systems), DEFAULT_TENANT_ID);
  assert.equal(resolveTenantId('', systems), DEFAULT_TENANT_ID);
  assert.equal(resolveTenantId('unknown', systems, 'tenant-fallback'), 'tenant-fallback');
});
