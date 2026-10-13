import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessControlStore, hasGrantedOperation } from '../src/access-control-store.ts';

const scope = { tenantId: 'tenant-demo', organizationId: 'org-demo' };
test('seeds an isolated hierarchical resource tree and persists grants', () => {
  const store = new AccessControlStore(mkdtempSync(join(tmpdir(), 'aeos-access-')));
  assert.equal(store.listResources(scope).some((resource) => resource.code === 'dashboard'), true);
  store.createResource(scope, { code: 'system_users', name: '用户管理', route: '/system/users', operations: ['read', 'update'], sort: 50, enabled: true, parentCode: 'system' });
  store.replaceRolePermissions(scope, 'manager', [{ resourceCode: 'system_users', operations: ['read', 'update'] }]);
  assert.deepEqual(store.listRolePermissions(scope, 'manager'), [{ resourceCode: 'system_users', operations: ['read', 'update'] }]);
  assert.equal(store.listResources({ tenantId: 'other', organizationId: 'org-demo' }).some((resource) => resource.code === 'system_users'), false);
});
test('rejects duplicate resources and deleting a parent with children', () => {
  const store = new AccessControlStore(mkdtempSync(join(tmpdir(), 'aeos-access-')));
  store.createResource(scope, { code: 'system_users', name: '用户管理', operations: ['read'], sort: 50, enabled: true, parentCode: 'system' });
  assert.throws(() => store.createResource(scope, { code: 'system_users', name: '重复', operations: ['read'], sort: 51, enabled: true }));
  assert.throws(() => store.deleteResource(scope, 'system'));
});

test('checks grants only after exact scope and enabled-resource matching', () => {
  const store = new AccessControlStore(mkdtempSync(join(tmpdir(), 'aeos-access-')));
  store.replaceRolePermissions(scope, 'quality_reviewer', [{ resourceCode: 'analysis', operations: ['read'] }]);
  const actor = { tenantId: scope.tenantId, organizationId: scope.organizationId, roles: ['quality_reviewer'] };
  assert.equal(hasGrantedOperation({ actor, scope, resourceCode: 'analysis', operation: 'read', store }), true);
  assert.equal(hasGrantedOperation({ actor, scope, resourceCode: 'analysis', operation: 'update', store }), false);
  assert.equal(hasGrantedOperation({ actor: { ...actor, organizationId: 'other' }, scope, resourceCode: 'analysis', operation: 'read', store }), false);
  store.updateResource(scope, 'analysis', { name: '经营分析', operations: ['read'], sort: 3, enabled: false });
  assert.equal(hasGrantedOperation({ actor, scope, resourceCode: 'analysis', operation: 'read', store }), false);
});
