import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUnifiedCapabilityCatalog } from '../src/capability-catalog.ts';
import { HarborAgentSchema } from '../src/harbor-store.ts';
import type { ExecutionAgentRecord } from '../src/execution-plane.ts';
import type { McpRegistry } from '../src/mcp-registry.ts';
import type { SystemRecord } from '../src/system-registry.ts';

const NOW = '2026-10-20T08:00:00.000Z';

const systems: SystemRecord[] = [
  {
    systemId: 'aeos-hub', name: 'AEOS Hub', tenantId: 'tenant-demo', owner: '平台团队',
    description: '', status: 'active', sourceSystemAliases: ['aeos-hub'], createdAt: NOW, updatedAt: NOW,
  },
  {
    systemId: 'control-platform', name: '公司中控平台', tenantId: 'tenant-demo', owner: '中台团队',
    description: '', status: 'active', sourceSystemAliases: ['公司中控平台'], createdAt: NOW, updatedAt: NOW,
  },
  {
    systemId: 'other-system', name: '其他系统', tenantId: 'tenant-b', owner: '其他团队',
    description: '', status: 'active', sourceSystemAliases: ['other'], createdAt: NOW, updatedAt: NOW,
  },
];

function executionAgent(overrides: Record<string, unknown>): ExecutionAgentRecord {
  return {
    agentId: 'agent', name: 'agent', version: '1.0.0', capabilities: [],
    connectionStatus: 'online', runtimeStatus: 'idle', lastSeenAt: NOW, currentRunId: null,
    registeredAt: NOW, local: false, systemId: 'control-platform', sourceSystem: 'control-platform',
    sourceSystemName: '公司中控平台', authMode: 'legacy-root', simulated: false, deregisteredAt: null,
    ...overrides,
  } as ExecutionAgentRecord;
}

function harborAgent(overrides: Record<string, unknown>) {
  return HarborAgentSchema.parse({
    id: 'agent-hub', name: '中枢 Agent', role: '编排', description: '', instructions: '',
    provider: 'deepseek', model: 'deepseek-chat', modelProfileId: 'deepseek-chat',
    runtimeId: 'runtime-codex-local', systemId: 'aeos-hub', primaryDomainId: 'cross-domain',
    domainIds: ['cross-domain'], externalAgentId: null, parentAgentId: null, hierarchyLevel: 'L0',
    registration: { code: 'aeos-hub', type: 'hub', ownerOrg: 'AEOS', domain: 'enterprise', lifecycle: 'active', allowedRuntimeCapabilities: [] },
    autonomyLevel: 'A2', access: 'workspace', skills: ['经营综合判断'], status: 'idle', createdAt: NOW, updatedAt: NOW,
    ...overrides,
  });
}

const mcp = {
  version: 1,
  servers: [{ id: 'demo', command: 'node', args: [], metadataFile: 'x', enabled: true, tools: [{ name: 'list_orders', readOnly: true }] }],
} as unknown as McpRegistry;

test('合并执行面能力、港湾技能与 MCP 工具', () => {
  const entries = buildUnifiedCapabilityCatalog({
    systems,
    mcp,
    executionAgents: [
      executionAgent({
        agentId: 'runtime-control-platform-query', name: '中台查询智能体',
        capabilities: [{ name: 'query_control_platform', description: '只读查询', version: '1.0.0', inputSchema: { type: 'object' }, constraints: { readOnly: true } }],
      }),
      executionAgent({
        agentId: 'runtime-control-platform-reasoning', name: '中台推理智能体', connectionStatus: 'offline',
        capabilities: [{ name: 'reason_control_platform', description: '只读推理', constraints: { readOnly: true } }],
      }),
      executionAgent({
        agentId: 'other-agent', name: '其他 Agent', systemId: 'other-system', sourceSystem: 'other',
        capabilities: [{ name: 'query_other', description: '其他查询', constraints: { readOnly: true } }],
      }),
    ],
    harborAgents: [harborAgent({})],
  });

  const query = entries.find((entry) => entry.name === 'query_control_platform');
  assert.equal(query?.kind, 'query');
  assert.equal(query?.status, 'available');
  assert.equal(query?.readOnly, true);
  assert.equal(query?.providerSystemId, 'control-platform');
  assert.equal(query?.tenantId, 'tenant-demo');
  assert.match(query?.inputSchemaHash ?? '', /^[a-f0-9]{64}$/);

  const reasoning = entries.find((entry) => entry.name === 'reason_control_platform');
  assert.equal(reasoning?.kind, 'reason');
  assert.equal(reasoning?.status, 'offline');

  assert.equal(entries.find((entry) => entry.name === '经营综合判断')?.kind, 'skill');
  assert.equal(entries.find((entry) => entry.name === 'list_orders')?.kind, 'tool');
  assert.equal(entries.find((entry) => entry.name === 'list_orders')?.source, 'mcp');
});

test('按租户过滤统一能力目录', () => {
  const entries = buildUnifiedCapabilityCatalog({
    systems,
    executionAgents: [
      executionAgent({ agentId: 'a', capabilities: [{ name: 'query_control_platform', description: '', constraints: { readOnly: true } }] }),
      executionAgent({ agentId: 'b', systemId: 'other-system', sourceSystem: 'other', capabilities: [{ name: 'query_other', description: '', constraints: { readOnly: true } }] }),
    ],
    harborAgents: [],
  }, { tenantId: 'tenant-demo' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.name, 'query_control_platform');
});

test('退役/离线状态进入目录，供后续筛选', () => {
  const entries = buildUnifiedCapabilityCatalog({
    systems,
    executionAgents: [
      executionAgent({ agentId: 'retired', deregisteredAt: NOW, capabilities: [{ name: 'query_retired', description: '', constraints: { readOnly: true } }] }),
    ],
    harborAgents: [],
  });
  assert.equal(entries[0]?.status, 'disabled');
});
