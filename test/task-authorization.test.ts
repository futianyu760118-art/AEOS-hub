import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeCollaborationAction, authorizeTaskAction, type TaskAuthorizationActor } from '../src/task-authorization.ts';

const assignedTask = {
  tenantId: 'demo-tenant',
  currentAssignee: {
    kind: 'responsibility_role' as const,
    role: '订单交付负责人',
    actorId: 'm01:user:operator-demo',
    assignedAt: '2026-10-10T08:30:00.000Z',
  },
};
const actor = (actorId: string, roles: readonly string[], actorType: TaskAuthorizationActor['actorType'] = 'human'): TaskAuthorizationActor => ({
  actorId, actorType, tenantId: 'demo-tenant', roles,
});

test('maps each G1 action to the required human role', () => {
  for (const action of ['create', 'assign', 'reassign'] as const) {
    assert.equal(authorizeTaskAction({ action, actor: actor('m01:user:manager-demo', ['manager']), task: assignedTask }).allowed, true);
    assert.equal(authorizeTaskAction({ action, actor: actor('m01:user:operator-demo', ['operator']), task: assignedTask }).code, 'MANAGER_ROLE_REQUIRED');
  }
  for (const action of ['accept', 'start', 'supplement_evidence', 'submit_result'] as const) {
    assert.equal(authorizeTaskAction({ action, actor: actor('m01:user:operator-demo', ['operator']), task: assignedTask }).allowed, true);
  }
  for (const action of ['verify', 'reject'] as const) {
    assert.equal(authorizeTaskAction({ action, actor: actor('m01:user:manager-demo', ['manager']), task: assignedTask }).allowed, true);
    assert.equal(authorizeTaskAction({ action, actor: actor('m01:user:supervisor-other', ['supervisor']), task: assignedTask }).allowed, true);
    assert.equal(authorizeTaskAction({ action, actor: actor('m01:user:operator-demo', ['operator']), task: assignedTask }).code, 'MANAGER_ROLE_REQUIRED');
  }
});

test('allows only the assigned operator to perform operator actions', () => {
  for (const action of ['accept', 'start', 'supplement_evidence', 'submit_result'] as const) {
    const assigned = authorizeTaskAction({ action, actor: actor('m01:user:operator-demo', ['operator']), task: assignedTask });
    const other = authorizeTaskAction({ action, actor: actor('m01:user:operator-other', ['operator']), task: assignedTask });
    assert.deepEqual(assigned, { allowed: true, code: 'ALLOWED' });
    assert.deepEqual(other, { allowed: false, code: 'ASSIGNEE_MISMATCH' });
  }
});

test('denies an operator action for an unassigned legacy task and blocks non-human identities', () => {
  assert.deepEqual(
    authorizeTaskAction({ action: 'accept', actor: actor('m01:user:operator-demo', ['operator']), task: { ...assignedTask, currentAssignee: null } }),
    { allowed: false, code: 'ASSIGNMENT_REQUIRED' },
  );
  assert.deepEqual(
    authorizeTaskAction({ action: 'submit_result', actor: actor('agent:order-analysis', ['operator'], 'agent'), task: assignedTask }),
    { allowed: false, code: 'HUMAN_ACTOR_REQUIRED' },
  );
  assert.deepEqual(
    authorizeTaskAction({ action: 'verify', actor: actor('system:sync', ['owner'], 'system'), task: assignedTask, registeredOwnerActorId: 'system:sync' }),
    { allowed: false, code: 'HUMAN_ACTOR_REQUIRED' },
  );
});

test('authorizes human collaboration work without weakening controlled-task rules', () => {
  const project = { tenantId: 'demo-tenant', ownerActorId: 'm01:user:manager-demo', memberActorIds: ['m01:user:manager-demo'] };
  assert.deepEqual(authorizeCollaborationAction({ action: 'project_create', actor: actor('m01:user:manager-demo', ['manager']) }), { allowed: true, code: 'ALLOWED' });
  assert.equal(authorizeCollaborationAction({ action: 'project_create', actor: actor('m01:user:operator-demo', ['operator']) }).code, 'MANAGER_ROLE_REQUIRED');
  assert.deepEqual(authorizeCollaborationAction({ action: 'project_update', actor: actor('m01:user:manager-demo', ['manager']), project }), { allowed: true, code: 'ALLOWED' });
  assert.equal(authorizeCollaborationAction({ action: 'project_update', actor: actor('m01:user:operator-demo', ['operator']), project }).code, 'MANAGER_ROLE_REQUIRED');
  assert.deepEqual(authorizeCollaborationAction({ action: 'task_update_manual', actor: actor('m01:user:operator-demo', ['operator']), task: assignedTask }), { allowed: true, code: 'ALLOWED' });
  assert.equal(authorizeCollaborationAction({ action: 'task_update_manual', actor: actor('agent:planner', ['manager'], 'agent'), task: assignedTask }).code, 'HUMAN_ACTOR_REQUIRED');
  assert.equal(authorizeCollaborationAction({ action: 'project_read', actor: { ...actor('m01:user:manager-other', ['manager']), tenantId: 'other' }, project }).code, 'TENANT_MISMATCH');
});
