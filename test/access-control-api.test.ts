import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessControlApi } from '../src/access-control-api.ts';
import { AccessControlStore } from '../src/access-control-store.ts';

const manager = { actorId: 'm01:user:manager-1', actorType: 'human' as const, tenantId: 'tenant-demo', organizationId: 'org-demo', roles: ['manager'] };
const snapshot = { readyForG1: true, decisions: { firstScenario: { value: 'order_delivery_risk' }, scope: { value: { demoTenantId: 'tenant-demo', organizationScope: 'org-demo' } } } };

function fixture() {
  const events: unknown[] = [];
  const roles = [{ code: 'manager', name: 'manager', protected: true, userCount: 1 }];
  const admin = {
    listHubRoles: async () => roles,
    createHubRole: async (_scope: unknown, input: { code: string; name: string }) => { const role = { ...input, protected: false, userCount: 0 }; roles.push(role); return role; },
    deleteHubRole: async () => undefined,
  };
  const api = new AccessControlApi({ admin: admin as never, store: new AccessControlStore(mkdtempSync(join(tmpdir(), 'aeos-access-api-'))), g0DecisionStore: { load: () => snapshot as never }, appendEvidence: (event) => events.push(event) });
  return { api, events };
}

test('allows only an in-scope human manager to read access-control modules', async () => {
  const { api } = fixture();
  const ok = await api.handle({ method: 'GET', pathname: '/api/system/access-control/resources', actor: manager });
  assert.equal(ok?.status, 200);
  const denied = await api.handle({ method: 'GET', pathname: '/api/system/access-control/resources', actor: { ...manager, roles: ['operator'] } });
  assert.equal(denied?.status, 403);
});

test('creates a scoped role and replaces its permission grants', async () => {
  const { api, events } = fixture();
  const role = await api.handle({ method: 'POST', pathname: '/api/system/access-control/roles', actor: manager, body: { code: 'planner', name: '生产计划员' } });
  assert.equal(role?.status, 200);
  const grants = await api.handle({ method: 'PUT', pathname: '/api/system/access-control/roles/planner/permissions', actor: manager, body: { grants: [{ resourceCode: 'dashboard', operations: ['read'] }] } });
  assert.equal(grants?.status, 200);
  assert.equal(events.length, 2);
});

test('rejects browser-forged scope fields by ignoring them', async () => {
  const { api } = fixture();
  const response = await api.handle({ method: 'POST', pathname: '/api/system/access-control/resources', actor: manager, body: { code: 'system_users', name: '用户管理', operations: ['read'], sort: 20, enabled: true, tenantId: 'forged', organizationId: 'forged' } });
  assert.equal(response?.status, 200);
});

test('refuses permission grants for a role that is not present in the scoped Keycloak catalog', async () => {
  const { api } = fixture();
  const response = await api.handle({ method: 'PUT', pathname: '/api/system/access-control/roles/missing_role/permissions', actor: manager, body: { grants: [{ resourceCode: 'dashboard', operations: ['read'] }] } });
  assert.equal(response?.status, 404);
});

test('exposes the current actor grants via a read-only my-grants endpoint without requiring manager', async () => {
  const { api } = fixture();
  const managerGrants = await api.handle({ method: 'GET', pathname: '/api/system/access-control/my-grants', actor: manager });
  assert.equal(managerGrants?.status, 200);
  assert.ok(((managerGrants?.body as { grants: { resourceCode: string }[] }).grants).some((grant) => grant.resourceCode === 'dashboard'));

  const operator = { actorId: 'm01:user:operator-1', actorType: 'human' as const, tenantId: 'tenant-demo', organizationId: 'org-demo', roles: ['operator'] };
  const operatorGrants = await api.handle({ method: 'GET', pathname: '/api/system/access-control/my-grants', actor: operator });
  assert.equal(operatorGrants?.status, 200);
  assert.deepEqual((operatorGrants?.body as { grants: unknown[] }).grants, []);
});
