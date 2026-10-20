import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveHubL1Agents, restoreHubL1Agents } from '../src/hub-agent-archive.ts';
import { HarborSnapshotSchema, type HarborSnapshot } from '../src/harbor-store.ts';

const NOW = '2026-10-20T08:00:00.000Z';

function fixture(): HarborSnapshot {
  const runtime = {
    id: 'runtime-codex-local', name: '本机 Codex', kind: 'codex-app-server', description: '',
    endpoint: 'stdio://test', workdir: '/tmp', owner: 'test', capabilities: [], status: 'ready',
    lastSeenAt: NOW, lastVerification: null, createdAt: NOW, updatedAt: NOW,
  };
  const agent = (overrides: Record<string, unknown>) => ({
    id: 'agent-test', name: 'test', role: 'test', description: '', instructions: '',
    provider: 'deepseek', model: 'deepseek-chat', modelProfileId: 'deepseek-chat',
    runtimeId: 'runtime-codex-local', systemId: 'aeos-hub', primaryDomainId: 'cross-domain',
    domainIds: ['cross-domain'], externalAgentId: null, parentAgentId: null, hierarchyLevel: 'L0',
    registration: { code: 'test-agent', type: 'hub', ownerOrg: 'AEOS', domain: 'test', lifecycle: 'active', allowedRuntimeCapabilities: [] },
    autonomyLevel: 'A1', access: 'workspace', skills: [], status: 'idle', createdAt: NOW, updatedAt: NOW,
    ...overrides,
  });
  return HarborSnapshotSchema.parse({
    version: 1, revision: 3, runtimes: [runtime],
    agents: [
      agent({ id: 'agent-aeos-hub', name: 'AEOS 中枢 Agent', registration: { code: 'aeos-hub', type: 'hub', ownerOrg: 'AEOS', domain: 'enterprise', lifecycle: 'active', allowedRuntimeCapabilities: [] } }),
      agent({ id: 'agent-order', name: '风险交付Agent', parentAgentId: 'agent-aeos-hub', hierarchyLevel: 'L1', primaryDomainId: 'order', domainIds: ['order'], registration: { code: 'order-risk', type: 'master', ownerOrg: 'AEOS', domain: 'order', lifecycle: 'active', allowedRuntimeCapabilities: [] } }),
      agent({ id: 'agent-quality', name: '质量证据 Agent', parentAgentId: 'agent-aeos-hub', hierarchyLevel: 'L1', primaryDomainId: 'quality', domainIds: ['quality'], registration: { code: 'quality-evidence', type: 'master', ownerOrg: 'AEOS', domain: 'quality', lifecycle: 'active', allowedRuntimeCapabilities: [] } }),
      agent({ id: 'agent-child', name: '专项 Agent', parentAgentId: 'agent-order', hierarchyLevel: 'L2', primaryDomainId: 'order', domainIds: ['order'], registration: { code: 'child-specialist', type: 'specialist', ownerOrg: 'AEOS', domain: 'order', lifecycle: 'active', allowedRuntimeCapabilities: [] } }),
      agent({ id: 'agent-control', name: '公司中台执行面智能体', parentAgentId: 'agent-aeos-hub', hierarchyLevel: 'L1', systemId: 'control-platform', primaryDomainId: 'cross-domain', domainIds: ['cross-domain'], registration: { code: 'execution-agent', type: 'master', ownerOrg: '中台', domain: 'operating', lifecycle: 'active', allowedRuntimeCapabilities: [] } }),
    ],
    projects: [], runs: [],
  });
}

test('只归档 Hub 名下 L1，保留 L0、L2 与其他系统', () => {
  const { snapshot, report, changed } = archiveHubL1Agents(fixture());
  assert.equal(changed, true);
  assert.equal(report.candidates, 2);
  assert.equal(report.archivedNow, 2);
  assert.equal(snapshot.revision, 4);

  const byId = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  assert.equal(byId.get('agent-aeos-hub')?.registration.lifecycle, 'active');
  assert.equal(byId.get('agent-aeos-hub')?.status, 'idle');
  assert.equal(byId.get('agent-order')?.registration.lifecycle, 'retired');
  assert.equal(byId.get('agent-order')?.status, 'archived');
  assert.equal(byId.get('agent-quality')?.status, 'archived');
  assert.equal(byId.get('agent-child')?.status, 'idle');
  assert.equal(byId.get('agent-control')?.status, 'idle');
  assert.doesNotThrow(() => HarborSnapshotSchema.parse(snapshot));
});

test('重复归档幂等，不再增加 revision', () => {
  const first = archiveHubL1Agents(fixture());
  const second = archiveHubL1Agents(first.snapshot);
  assert.equal(second.changed, false);
  assert.equal(second.report.archivedNow, 0);
  assert.equal(second.report.alreadyArchived, 2);
  assert.equal(second.snapshot.revision, first.snapshot.revision);
});

test('撤销归档恢复 Hub L1 为 active/idle，其他 Agent 不动', () => {
  const archived = archiveHubL1Agents(fixture());
  const restored = restoreHubL1Agents(archived.snapshot);
  assert.equal(restored.changed, true);
  assert.equal(restored.report.restoredNow, 2);
  assert.equal(restored.snapshot.revision, archived.snapshot.revision + 1);

  const byId = new Map(restored.snapshot.agents.map((agent) => [agent.id, agent]));
  assert.equal(byId.get('agent-order')?.registration.lifecycle, 'active');
  assert.equal(byId.get('agent-order')?.status, 'idle');
  assert.equal(byId.get('agent-quality')?.status, 'idle');
  assert.equal(byId.get('agent-aeos-hub')?.status, 'idle');
  assert.equal(byId.get('agent-control')?.status, 'idle');
  assert.doesNotThrow(() => HarborSnapshotSchema.parse(restored.snapshot));
});

test('未归档数据上执行撤销是幂等的', () => {
  const { changed, report, snapshot } = restoreHubL1Agents(fixture());
  assert.equal(changed, false);
  assert.equal(report.restoredNow, 0);
  assert.equal(report.alreadyActive, 2);
  assert.equal(snapshot.revision, 3);
});
