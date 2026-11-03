import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCapabilityCatalog,
  buildCatalogTree,
  getCatalogAgent,
  type CatalogSources,
} from '../src/agent-catalog.ts';
import { HarborSnapshotSchema } from '../src/harbor-store.ts';
import type { ExecutionAgentRecord } from '../src/execution-plane.ts';

const NOW = '2026-10-20T08:00:00.000Z';

function sources(): CatalogSources {
  const harbor = HarborSnapshotSchema.parse({
    version: 1,
    revision: 1,
    runtimes: [{
      id: 'runtime-codex-local',
      name: '本机 Codex',
      kind: 'codex-app-server',
      description: '',
      endpoint: 'stdio://test',
      workdir: '/tmp',
      owner: 'test',
      capabilities: [],
      status: 'ready',
      lastSeenAt: NOW,
      lastVerification: null,
      createdAt: NOW,
      updatedAt: NOW,
    }, {
      id: 'runtime-control-platform-agent',
      name: '中台执行面',
      kind: 'remote-execution-agent',
      description: '',
      endpoint: 'ws://test',
      workdir: '',
      owner: 'test',
      capabilities: [],
      status: 'online',
      lastSeenAt: NOW,
      lastVerification: null,
      createdAt: NOW,
      updatedAt: NOW,
    }],
    agents: [
      {
        id: 'agent-aeos-hub', name: 'AEOS 中枢 Agent', role: '中枢', description: '', instructions: '',
        provider: 'deepseek', model: 'deepseek-chat', modelProfileId: 'deepseek-chat',
        runtimeId: 'runtime-codex-local', systemId: 'aeos-hub', primaryDomainId: 'cross-domain',
        domainIds: ['cross-domain'], externalAgentId: null, parentAgentId: null, hierarchyLevel: 'L0',
        registration: { code: 'aeos-hub', type: 'hub', ownerOrg: 'AEOS', domain: 'enterprise', lifecycle: 'active', allowedRuntimeCapabilities: [] },
        autonomyLevel: 'A2', access: 'workspace', skills: ['经营综合判断'], status: 'idle', createdAt: NOW, updatedAt: NOW,
      },
      {
        id: 'agent-order', name: '风险交付Agent', role: '订单风险', description: '', instructions: '',
        provider: 'deepseek', model: 'deepseek-chat', modelProfileId: 'deepseek-chat',
        runtimeId: 'runtime-codex-local', systemId: 'aeos-hub', primaryDomainId: 'order',
        domainIds: ['order'], externalAgentId: null, parentAgentId: 'agent-aeos-hub', hierarchyLevel: 'L1',
        registration: { code: 'order-risk', type: 'master', ownerOrg: 'AEOS', domain: 'order', lifecycle: 'active', allowedRuntimeCapabilities: [] },
        autonomyLevel: 'A1', access: 'workspace', skills: ['订单风险扫描'], status: 'idle', createdAt: NOW, updatedAt: NOW,
      },
      {
        id: 'agent-exec', name: '公司中台执行面智能体', role: '中台查询', description: '', instructions: '',
        provider: 'deepseek', model: 'deepseek-chat', modelProfileId: 'deepseek-chat',
        runtimeId: 'runtime-control-platform-agent', systemId: 'control-platform', primaryDomainId: 'cross-domain',
        domainIds: ['order', 'kitting', 'quality', 'production', 'cross-domain'],
        externalAgentId: 'runtime-control-platform-agent', parentAgentId: 'agent-aeos-hub', hierarchyLevel: 'L1',
        registration: { code: 'execution-agent', type: 'master', ownerOrg: '中台', domain: 'operating-case-analysis', lifecycle: 'active', allowedRuntimeCapabilities: [] },
        autonomyLevel: 'A1', access: 'workspace', skills: ['中台只读查询', '订单风险扫描'], status: 'idle', createdAt: NOW, updatedAt: NOW,
      },
    ],
    projects: [],
    runs: [],
  });

  const execution = (overrides: Partial<ExecutionAgentRecord>): ExecutionAgentRecord => ({
    agentId: 'runtime-control-platform-agent',
    name: '公司中台执行面智能体',
    version: '1.0.0',
    capabilities: [{ name: 'query_control_platform', description: '只读查询' }],
    connectionStatus: 'online',
    runtimeStatus: 'idle',
    lastSeenAt: NOW,
    currentRunId: null,
    registeredAt: NOW,
    local: true,
    sourceSystem: '公司中控平台（本机演示）',
    simulated: false,
    deregisteredAt: null,
    ...overrides,
  });

  return {
    harbor,
    systems: [
      { systemId: 'aeos-hub', name: 'AEOS Hub', tenantId: 'pilot-default', owner: '平台团队', description: '', status: 'active', sourceSystemAliases: ['aeos-hub'], createdAt: NOW, updatedAt: NOW },
      { systemId: 'control-platform', name: '公司中控平台', tenantId: 'pilot-default', owner: '中台团队', description: '', status: 'active', sourceSystemAliases: ['公司中控平台（本机演示）'], createdAt: NOW, updatedAt: NOW },
      { systemId: 'hengjian-plm', name: '恒剑 PLM', tenantId: 'pilot-default', owner: 'PLM 团队', description: '', status: 'active', sourceSystemAliases: ['恒剑PLM'], createdAt: NOW, updatedAt: NOW },
    ],
    executionAgents: [
      execution({}),
      execution({ agentId: 'runtime-unknown-agent', name: '未登记执行面 Agent', sourceSystem: '未知系统', local: false }),
      execution({ agentId: 'runtime-simulated-agent', name: '模拟执行面', sourceSystem: '公司中控平台（本机演示）', simulated: true }),
      execution({ agentId: 'runtime-deregistered-agent', name: '已退场执行面', sourceSystem: '公司中控平台（本机演示）', deregisteredAt: NOW }),
    ],
    usage: {
      byAgent: [
        { agentId: 'agent-aeos-hub', tokensIn: 100, tokensOut: 50, cost: 0.01, events: 2, queryEvents: 0, modelEvents: 2, lastAt: NOW },
        { agentId: 'runtime-control-platform-agent', tokensIn: 0, tokensOut: 0, cost: 0, events: 3, queryEvents: 3, modelEvents: 0, lastAt: '2026-10-19T08:32:04.692Z' },
        { agentId: 'control-platform-assistant', tokensIn: 200, tokensOut: 20, cost: 1.5, events: 5, queryEvents: 0, modelEvents: 5, lastAt: NOW },
        { agentId: 'runtime-simulated-agent', tokensIn: 0, tokensOut: 0, cost: 0, events: 9, queryEvents: 9, modelEvents: 0, lastAt: NOW },
      ],
      bySystem: [
        { systemId: 'aeos-hub', tokensIn: 100, tokensOut: 50, cost: 0.01, events: 2, queryEvents: 0, modelEvents: 2, lastAt: NOW },
        { systemId: '公司中控平台（本机演示）', tokensIn: 200, tokensOut: 20, cost: 1.5, events: 17, queryEvents: 9, modelEvents: 8, lastAt: NOW },
      ],
    },
  };
}

test('目录树按系统 → 主属域 → Agent 分组，并保留空系统', () => {
  const tree = buildCatalogTree(sources());

  assert.deepEqual(tree.systems.map((system) => system.id), ['aeos-hub', 'control-platform', 'hengjian-plm', 'unregistered']);
  const hub = tree.systems[0]!;
  assert.equal(hub.agentCount, 2);
  assert.deepEqual(hub.domains.map((domain) => domain.id), ['order', 'cross-domain']);
  assert.deepEqual(hub.domains[0]?.agents.map((agent) => agent.id), ['agent-order']);

  assert.equal(tree.systems[1]?.domains[0]?.agents[0]?.id, 'agent-exec');
  assert.equal(tree.systems[1]?.domains[0]?.agents[0]?.execution?.connectionStatus, 'online');
  assert.equal(tree.systems[2]?.agentCount, 0);

  assert.equal(tree.counts.systems, 4);
  assert.equal(tree.counts.agents, 4);
  assert.equal(tree.counts.unregisteredInHarbor, 1);
  assert.ok(tree.warnings.some((warning) => warning.includes('未登记系统')));
});

test('执行面网关在目录中标记 agentKind 与 gatewayVersion', () => {
  const base = sources();
  const gateway: ExecutionAgentRecord = {
    ...base.executionAgents[0]!,
    agentId: 'gateway-control-platform',
    name: '公司中控平台网关',
    agentKind: 'system-gateway',
    gatewayVersion: '1.0.0',
  };
  const tree = buildCatalogTree({ ...base, executionAgents: [...base.executionAgents, gateway] });
  const agents = tree.systems.find((system) => system.id === 'control-platform')?.domains.flatMap((domain) => domain.agents) ?? [];
  const gatewayNode = agents.find((agent) => agent.externalAgentId === 'gateway-control-platform');
  assert.equal(gatewayNode?.execution?.agentKind, 'system-gateway');
  assert.equal(gatewayNode?.execution?.gatewayVersion, '1.0.0');
  const directNode = agents.find((agent) => agent.externalAgentId === 'runtime-control-platform-agent');
  assert.equal(directNode?.execution?.agentKind, 'execution-agent');
  assert.equal(directNode?.execution?.gatewayVersion, null);
});

test('执行面独有 Agent 标记为未登记港湾', () => {
  const tree = buildCatalogTree(sources());
  const unregistered = tree.systems.find((system) => system.id === 'unregistered')!;
  const agent = unregistered.domains[0]?.agents[0];
  assert.equal(agent?.id, 'execution:runtime-unknown-agent');
  assert.equal(agent?.registeredInHarbor, false);
  assert.equal(agent?.externalAgentId, 'runtime-unknown-agent');
  assert.equal(agent?.systemId, 'unregistered');
});

test('Agent 详情返回上下级与服务域', () => {
  const tree = buildCatalogTree(sources());
  const detail = getCatalogAgent(tree, 'agent-order');
  assert.equal(detail?.system.id, 'aeos-hub');
  assert.equal(detail?.domain.id, 'order');
  assert.deepEqual(detail?.ancestors.map((agent) => agent.id), ['agent-aeos-hub']);
  assert.deepEqual(detail?.agent.domainIds, ['order']);
  assert.equal(getCatalogAgent(tree, 'missing'), null);
});

test('能力目录按 Agent 技能去重聚合', () => {
  const capabilities = buildCapabilityCatalog(buildCatalogTree(sources()));
  const shared = capabilities.find((capability) => capability.name === '订单风险扫描');
  assert.equal(shared?.agentCount, 2);
  assert.deepEqual(shared?.agents.map((agent) => agent.id).sort(), ['agent-exec', 'agent-order']);
});

test('用量按规范系统与 Agent 落到目录节点', () => {
  const tree = buildCatalogTree(sources());
  const hub = tree.systems.find((system) => system.id === 'aeos-hub')!;
  const hubAgent = hub.domains.flatMap((domain) => domain.agents).find((agent) => agent.id === 'agent-aeos-hub');
  assert.equal(hub.usage?.cost, 0.01);
  assert.equal(hub.usage?.events, 2);
  assert.equal(hubAgent?.usage?.tokensIn, 100);

  const control = tree.systems.find((system) => system.id === 'control-platform')!;
  assert.equal(control.usage?.cost, 1.5);
  assert.equal(control.usage?.events, 8);
  const allAgents = tree.systems.flatMap((system) => system.domains.flatMap((domain) => domain.agents));
  assert.equal(allAgents.some((agent) => agent.id.includes('simulated')), false);
  assert.equal(allAgents.some((agent) => agent.id.includes('deregistered')), false);
  assert.equal(allAgents.some((agent) => agent.execution?.sourceSystem === '公司中控平台（本机演示）'), true);
  const exec = control.domains.flatMap((domain) => domain.agents).find((agent) => agent.id === 'agent-exec');
  assert.equal(exec?.usage?.events, 3);
  assert.equal(exec?.usage?.tokensIn, 0);
});

test('没有用量聚合时目录节点保持空用量', () => {
  const withoutUsage = sources();
  delete withoutUsage.usage;
  const tree = buildCatalogTree(withoutUsage);
  assert.equal(tree.systems.every((system) => system.usage === null), true);
  assert.equal(tree.systems.flatMap((system) => system.domains.flatMap((domain) => domain.agents)).every((agent) => agent.usage === null), true);
});
