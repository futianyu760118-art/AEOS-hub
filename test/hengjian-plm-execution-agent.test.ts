import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ensureHengjianPlmExecutionAgent,
  PLM_EXECUTION_AGENT_DEFINITION,
} from '../src/hengjian-plm-execution-agent.ts';
import { HarborSnapshotSchema, type HarborSnapshot } from '../src/harbor-store.ts';

const NOW = '2026-10-23T02:00:00.000Z';

function fixture(): HarborSnapshot {
  return HarborSnapshotSchema.parse({
    version: 1,
    revision: 7,
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

test('把恒剑 PLM 执行面 Agent 镜像登记到港湾', () => {
  const { snapshot, report, changed } = ensureHengjianPlmExecutionAgent(fixture(), NOW);
  assert.equal(changed, true);
  assert.equal(report.createdRuntime, 'runtime-execution-query');
  assert.equal(report.createdAgent, '恒剑PLM执行面智能体');
  assert.equal(snapshot.revision, 8);

  const runtime = snapshot.runtimes.find((item) => item.id === 'runtime-execution-query');
  assert.equal(runtime?.kind, 'remote-execution-agent');
  assert.deepEqual(runtime?.capabilities, ['query_plm', 'reason_plm']);

  const agent = snapshot.agents.find((item) => item.id === PLM_EXECUTION_AGENT_DEFINITION.harborAgentId);
  assert.equal(agent?.name, '恒剑PLM执行面智能体');
  assert.equal(agent?.systemId, 'hengjian-plm');
  assert.equal(agent?.externalAgentId, 'runtime-execution-query');
  assert.equal(agent?.runtimeId, 'runtime-execution-query');
  assert.equal(agent?.registration.code, 'hengjian-plm-execution');
  assert.deepEqual(agent?.registration.allowedRuntimeCapabilities, ['query_plm', 'reason_plm']);
  assert.deepEqual(agent?.registration.taskServiceProfile.supportedTaskTypes, []);
  assert.doesNotThrow(() => HarborSnapshotSchema.parse(snapshot));
});

test('重复登记幂等，不再增加 revision', () => {
  const first = ensureHengjianPlmExecutionAgent(fixture(), NOW);
  const second = ensureHengjianPlmExecutionAgent(first.snapshot, NOW);
  assert.equal(second.changed, false);
  assert.equal(second.report.createdAgent, null);
  assert.equal(second.report.createdRuntime, null);
  assert.equal(second.report.existingAgent, '恒剑PLM执行面智能体');
  assert.equal(second.snapshot.revision, first.snapshot.revision);
});

test('已有同 externalAgentId 的 Agent 不会重复创建', () => {
  const first = ensureHengjianPlmExecutionAgent(fixture(), NOW);
  const agent = first.snapshot.agents.find((item) => item.externalAgentId === 'runtime-execution-query')!;
  first.snapshot.agents = first.snapshot.agents.filter((item) => item.id !== agent.id);
  first.snapshot.agents.push({ ...agent, id: 'agent-existing-plm' });
  const second = ensureHengjianPlmExecutionAgent(first.snapshot, NOW);
  assert.equal(second.report.createdAgent, null);
  assert.equal(second.snapshot.agents.filter((item) => item.externalAgentId === 'runtime-execution-query').length, 1);
});
