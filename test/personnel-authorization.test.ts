import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizePersonnelAction,
  authorizePersonnelOnboarding,
  type PersonnelAuthorizationScope,
} from '../src/personnel-authorization.ts';

const manager = {
  actorId: 'm01:user:manager-demo',
  actorType: 'human' as const,
  tenantId: 'demo-tenant',
  organizationId: '订单交付组',
  roles: ['manager'],
};

const readyScope: PersonnelAuthorizationScope = {
  readyForG1: true,
  firstScenario: 'order_delivery_risk',
  demoTenantId: 'demo-tenant',
  organizationScope: '订单交付组',
};

const target = {
  actorId: 'm01:user:operator-demo',
  enabled: true,
  roles: ['operator'],
};

test('allows a human manager in the exact G0 scope for every action', () => {
  for (const action of ['list', 'create', 'update', 'set_roles', 'reset_password'] as const) {
    const decision = authorizePersonnelAction({
      action,
      actor: manager,
      scope: readyScope,
      ...(action === 'create' || action === 'set_roles' ? { requestedRoles: ['operator'] } : {}),
      ...(action === 'update' ? { nextEnabled: false } : {}),
    });
    assert.equal(decision.allowed, true, `${action} should be allowed`);
  }
});

test('rejects non-human and non-manager actors before any scope lookup', () => {
  const service = { ...manager, actorType: 'service' as const };
  assert.deepEqual(authorizePersonnelAction({ action: 'list', actor: service, scope: readyScope }), { allowed: false, code: 'HUMAN_ACTOR_REQUIRED' });

  const operator = { ...manager, roles: ['operator'] };
  assert.deepEqual(authorizePersonnelAction({ action: 'list', actor: operator, scope: readyScope }), { allowed: false, code: 'MANAGER_ROLE_REQUIRED' });
});

test('requires a G0-ready scope that matches the actor tenant and organization exactly', () => {
  const cases: Array<[string, PersonnelAuthorizationScope | null, typeof manager]> = [
    ['null scope', null, manager],
    ['not ready', { ...readyScope, readyForG1: false }, manager],
    ['wrong scenario', { ...readyScope, firstScenario: 'other' }, manager],
    ['tenant mismatch', { ...readyScope, demoTenantId: 'other-tenant' }, manager],
    ['organization mismatch', { ...readyScope, organizationScope: '其他组' }, manager],
    ['missing actor organization', readyScope, { ...manager, organizationId: undefined }],
  ];
  for (const [label, scope, actor] of cases) {
    const decision = authorizePersonnelAction({ action: 'list', actor, scope });
    assert.deepEqual(decision, { allowed: false, code: 'G0_SCOPE_REQUIRED' }, label);
  }
});

test('rejects empty or unknown role sets for create and set_roles', () => {
  assert.deepEqual(
    authorizePersonnelAction({ action: 'create', actor: manager, scope: readyScope, requestedRoles: [] }),
    { allowed: false, code: 'ROLES_REQUIRED' },
  );
  assert.deepEqual(
    authorizePersonnelAction({ action: 'create', actor: manager, scope: readyScope, requestedRoles: ['realm-admin'] }),
    { allowed: false, code: 'UNKNOWN_ROLE' },
  );
  assert.deepEqual(
    authorizePersonnelAction({ action: 'set_roles', actor: manager, scope: readyScope, requestedRoles: ['manager', 'superuser'] }),
    { allowed: false, code: 'UNKNOWN_ROLE' },
  );
});

test('prevents a manager from disabling themself or removing their own manager role', () => {
  const self = { actorId: manager.actorId, enabled: true, roles: ['manager'] };
  assert.deepEqual(
    authorizePersonnelAction({ action: 'update', actor: manager, scope: readyScope, target: self, nextEnabled: false }),
    { allowed: false, code: 'SELF_DISABLE_DENIED' },
  );
  assert.deepEqual(
    authorizePersonnelAction({ action: 'set_roles', actor: manager, scope: readyScope, target: self, requestedRoles: ['operator'] }),
    { allowed: false, code: 'SELF_MANAGER_REMOVAL_DENIED' },
  );
  // Keeping manager is allowed even on self.
  assert.equal(
    authorizePersonnelAction({ action: 'set_roles', actor: manager, scope: readyScope, target: self, requestedRoles: ['manager', 'operator'] }).allowed,
    true,
  );
});

test('protects the last active manager in scope from disable and de-role', () => {
  const lastManager = { actorId: 'm01:user:last-manager', enabled: true, roles: ['manager'] };
  assert.deepEqual(
    authorizePersonnelAction({
      action: 'update', actor: manager, scope: readyScope, target: lastManager, nextEnabled: false,
      activeManagerActorIds: ['m01:user:last-manager'],
    }),
    { allowed: false, code: 'LAST_ACTIVE_MANAGER_DENIED' },
  );
  assert.deepEqual(
    authorizePersonnelAction({
      action: 'set_roles', actor: manager, scope: readyScope, target: lastManager, requestedRoles: ['operator'],
      activeManagerActorIds: ['m01:user:last-manager'],
    }),
    { allowed: false, code: 'LAST_ACTIVE_MANAGER_DENIED' },
  );
});

test('allows disable and de-role when another active manager remains', () => {
  assert.equal(
    authorizePersonnelAction({
      action: 'update', actor: manager, scope: readyScope, target,
      nextEnabled: false, activeManagerActorIds: ['m01:user:manager-demo', target.actorId],
    }).allowed,
    true,
  );
  assert.equal(
    authorizePersonnelAction({
      action: 'set_roles', actor: manager, scope: readyScope, target, requestedRoles: ['owner'],
      activeManagerActorIds: ['m01:user:manager-demo', target.actorId],
    }).allowed,
    true,
  );
});

test('allows the last active manager to keep the manager role while adding another role', () => {
  const lastManager = { actorId: 'm01:user:last-manager', enabled: true, roles: ['manager'] };
  assert.equal(
    authorizePersonnelAction({
      action: 'set_roles', actor: manager, scope: readyScope, target: lastManager, requestedRoles: ['manager', 'operator'],
      activeManagerActorIds: ['m01:user:last-manager'],
    }).allowed,
    true,
  );
});

test('onboarding allows only a human manager with an organization, regardless of G0 readiness', () => {
  assert.equal(authorizePersonnelOnboarding(manager).allowed, true);
  assert.deepEqual(authorizePersonnelOnboarding({ ...manager, actorType: 'service' }), { allowed: false, code: 'HUMAN_ACTOR_REQUIRED' });
  assert.deepEqual(authorizePersonnelOnboarding({ ...manager, roles: ['operator'] }), { allowed: false, code: 'MANAGER_ROLE_REQUIRED' });
  assert.deepEqual(authorizePersonnelOnboarding({ ...manager, organizationId: undefined }), { allowed: false, code: 'G0_SCOPE_REQUIRED' });
});

test('delete forbids self-deletion and removing the last active manager, but allows deleting others', () => {
  const self = { actorId: manager.actorId, enabled: true, roles: ['manager'] };
  assert.deepEqual(
    authorizePersonnelAction({ action: 'delete', actor: manager, scope: readyScope, target: self, activeManagerActorIds: [manager.actorId] }),
    { allowed: false, code: 'SELF_DELETE_DENIED' },
  );

  const lastManager = { actorId: 'm01:user:last-manager', enabled: true, roles: ['manager'] };
  assert.deepEqual(
    authorizePersonnelAction({ action: 'delete', actor: manager, scope: readyScope, target: lastManager, activeManagerActorIds: ['m01:user:last-manager'] }),
    { allowed: false, code: 'LAST_ACTIVE_MANAGER_DENIED' },
  );

  assert.equal(
    authorizePersonnelAction({ action: 'delete', actor: manager, scope: readyScope, target, activeManagerActorIds: ['m01:user:manager-demo'] }).allowed,
    true,
  );
});
