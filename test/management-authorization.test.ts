import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canManageHub,
  evidenceActorScope,
  isAgentSquadManagementRoute,
  isExecutionManagementRoute,
  isHarborManagementRoute,
} from '../src/management-authorization.ts';

test('only manager/supervisor roles manage Harbor, squads and execution dispatch', () => {
  assert.equal(canManageHub(['manager']), true);
  assert.equal(canManageHub(['supervisor']), true);
  assert.equal(canManageHub(['operator']), false);
  assert.equal(canManageHub([]), false);
  assert.equal(isHarborManagementRoute('/api/harbor'), true);
  assert.equal(isHarborManagementRoute('/api/harbor/agents/x/lifecycle'), true);
  assert.equal(isAgentSquadManagementRoute('/api/agent-squad/members'), true);
  assert.equal(isExecutionManagementRoute('/api/execution/agents/a/dispatch'), true);
  assert.equal(isExecutionManagementRoute('/api/execution/agents/a/recall'), true);
  assert.equal(isExecutionManagementRoute('/api/execution/agents'), false);
  assert.equal(isExecutionManagementRoute('/api/execution/parse-intent'), false);
});

test('non-managers cannot request another actor evidence', () => {
  assert.deepEqual(evidenceActorScope(['operator'], 'user-1', 'user-2'), { ok: false });
  assert.deepEqual(evidenceActorScope(['operator'], 'user-1', undefined), { ok: true, actorId: 'user-1' });
  assert.deepEqual(evidenceActorScope(['manager'], 'user-1', 'user-2'), { ok: true, actorId: 'user-2' });
});
