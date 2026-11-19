import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { buildAgentRegistrySnapshot } from '../src/agent-registry-api.ts';
import { HarborStore } from '../src/harbor-store.ts';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-agent-registry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new HarborStore({
    file: join(dir, 'data', 'ai-harbor.json'),
    workspaceRoot: dir,
    clock: () => new Date('2026-11-19T01:00:00.000Z'),
    idFactory: (() => {
      let index = 0;
      return () => `registry-${++index}`;
    })(),
  });
}

test('registry projection exposes M01 dispatchability without leaking full harbor', (t) => {
  const store = fixture(t);
  const initial = store.load();
  const agent = initial.agents[0]!;
  store.updateAgentM01Registration(agent.id, {
    state: 'active',
    m01AgentId: agent.id,
    tenantId: 'HENGJIAN',
    requestedScopes: ['task:execute'],
    effectiveScopes: ['task:execute'],
    clampedScopes: [],
    lastAttemptAt: '2026-11-19T01:00:00.000Z',
    lastSuccessAt: '2026-11-19T01:00:00.000Z',
    reason: null,
  });

  const snapshot = buildAgentRegistrySnapshot(store.load(), {
    generatedAt: '2026-11-19T01:01:00.000Z',
  });
  const item = snapshot.items.find((candidate) => candidate.agentId === agent.id)!;

  assert.equal(snapshot.registrySystem, 'M13');
  assert.equal(item.dispatchable, true);
  assert.equal(item.m01State, 'active');
  assert.deepEqual(item.effectiveScopes, ['task:execute']);
  assert.equal('instructions' in item, false);
});

test('registry prefix filter returns only matching agents', (t) => {
  const store = fixture(t);
  const snapshot = buildAgentRegistrySnapshot(store.load(), {
    prefix: 'does-not-exist-',
  });
  assert.deepEqual(snapshot.items, []);
});
