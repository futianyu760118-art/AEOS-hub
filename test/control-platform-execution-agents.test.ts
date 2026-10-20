import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ensureControlPlatformExecutionAgents,
  CONTROL_EXECUTION_AGENT_DEFINITIONS,
} from '../src/control-platform-execution-agents.ts';
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

test('把中台查询/推理两个执行面 Agent 镜像登记到港湾', () => {
  const { snapshot, report, changed } = ensureControlPlatformExecutionAgents(fixture());
  assert.equal(changed, true);
  assert.equal(report.createdAgents.length, 2);
  assert.equal(report.createdRuntimes.length, 2);
  assert.equal(snapshot.revision, 6);

  for (const definition of CONTROL_EXECUTION_AGENT_DEFINITIONS) {
    const runtime = snapshot.runtimes.find((item) => item.id === definition.executionAgentId);
    assert.equal(runtime?.kind, 'remote-execution-agent');
    assert.equal(runtime?.capabilities[0], definition.capability);
    const agent = snapshot.agents.find((item) => item.id === definition.harborAgentId);
    assert.equal(agent?.name, definition.name);
    assert.equal(agent?.systemId, 'control-platform');
    assert.equal(agent?.externalAgentId, definition.executionAgentId);
    assert.equal(agent?.runtimeId, definition.executionAgentId);
    assert.equal(agent?.primaryDomainId, 'cross-domain');
    assert.deepEqual(agent?.domainIds, ['order', 'kitting', 'quality', 'production', 'cross-domain']);
    assert.equal(agent?.registration.code, definition.registrationCode);
    assert.equal(agent?.status, 'idle');
  }
  assert.doesNotThrow(() => HarborSnapshotSchema.parse(snapshot));
});

test('重复登记幂等，不再增加 revision', () => {
  const first = ensureControlPlatformExecutionAgents(fixture());
  const second = ensureControlPlatformExecutionAgents(first.snapshot);
  assert.equal(second.changed, false);
  assert.equal(second.report.createdAgents.length, 0);
  assert.equal(second.report.createdRuntimes.length, 0);
  assert.equal(second.report.existingAgents.length, 2);
  assert.equal(second.snapshot.revision, first.snapshot.revision);
});

test('已有同 externalAgentId 的 Agent 不会重复创建', () => {
  const first = ensureControlPlatformExecutionAgents(fixture());
  const firstAgent = first.snapshot.agents.find((agent) => agent.externalAgentId === 'runtime-control-platform-query')!;
  first.snapshot.agents = first.snapshot.agents.filter((agent) => agent.id !== firstAgent.id);
  first.snapshot.agents.push({ ...firstAgent, id: 'agent-existing-query' });
  const second = ensureControlPlatformExecutionAgents(first.snapshot);
  assert.equal(second.report.existingAgents.length, 2);
  assert.equal(second.snapshot.agents.filter((agent) => agent.externalAgentId === 'runtime-control-platform-query').length, 1);
});
