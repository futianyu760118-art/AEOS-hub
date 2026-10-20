import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTROL_ASSISTANT_AGENT_ID,
  CONTROL_ASSISTANT_EXTERNAL_ID,
  CONTROL_ASSISTANT_RUNTIME_ID,
  ensureControlAssistantAgent,
} from '../src/control-assistant-agent.ts';
import { HarborSnapshotSchema, type HarborSnapshot } from '../src/harbor-store.ts';

const NOW = '2026-10-20T08:00:00.000Z';

function fixture(): HarborSnapshot {
  return HarborSnapshotSchema.parse({
    version: 1,
    revision: 5,
    runtimes: [{
      id: 'runtime-codex-local', name: '本机 Codex', kind: 'codex-app-server', description: '',
      endpoint: 'stdio://test', workdir: '/tmp', owner: 'test', capabilities: [], status: 'ready',
      lastSeenAt: NOW, lastVerification: null, createdAt: NOW, updatedAt: NOW,
    }],
    agents: [{
      id: 'agent-aeos-hub', name: 'AEOS 中枢 Agent', role: '中枢', description: '', instructions: '',
      provider: 'deepseek', model: 'deepseek-chat', modelProfileId: 'deepseek-chat',
      runtimeId: 'runtime-codex-local', systemId: 'aeos-hub', primaryDomainId: 'cross-domain',
      domainIds: ['cross-domain'], externalAgentId: null, parentAgentId: null, hierarchyLevel: 'L0',
      registration: { code: 'aeos-hub', type: 'hub', ownerOrg: 'AEOS', domain: 'enterprise', lifecycle: 'active', allowedRuntimeCapabilities: [] },
      autonomyLevel: 'A2', access: 'workspace', skills: [], status: 'idle', createdAt: NOW, updatedAt: NOW,
    }],
    projects: [],
    runs: [],
  });
}

test('登记中台智能助手为真实港湾 Agent', () => {
  const { snapshot, changed, createdRuntime, createdAgent } = ensureControlAssistantAgent(fixture());
  assert.equal(changed, true);
  assert.equal(createdRuntime, true);
  assert.equal(createdAgent, true);
  assert.equal(snapshot.revision, 6);

  const runtime = snapshot.runtimes.find((item) => item.id === CONTROL_ASSISTANT_RUNTIME_ID);
  assert.equal(runtime?.kind, 'system-assistant');
  assert.equal(runtime?.status, 'ready');

  const agent = snapshot.agents.find((item) => item.id === CONTROL_ASSISTANT_AGENT_ID);
  assert.equal(agent?.name, '中台智能助手');
  assert.equal(agent?.externalAgentId, CONTROL_ASSISTANT_EXTERNAL_ID);
  assert.equal(agent?.systemId, 'control-platform');
  assert.equal(agent?.primaryDomainId, 'cross-domain');
  assert.deepEqual(agent?.domainIds, ['order', 'kitting', 'quality', 'production', 'cross-domain']);
  assert.equal(agent?.registration.code, 'control-platform-assistant');
  assert.equal(agent?.status, 'idle');
  assert.doesNotThrow(() => HarborSnapshotSchema.parse(snapshot));
});

test('重复登记幂等，不再增加 revision', () => {
  const first = ensureControlAssistantAgent(fixture());
  const second = ensureControlAssistantAgent(first.snapshot);
  assert.equal(second.changed, false);
  assert.equal(second.createdRuntime, false);
  assert.equal(second.createdAgent, false);
  assert.equal(second.snapshot.revision, first.snapshot.revision);
});
