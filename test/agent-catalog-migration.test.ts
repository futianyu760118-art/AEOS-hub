import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSquadDomainMap,
  migrateAgentCatalog,
  planAgentAttribution,
  type SquadMembershipRecord,
} from '../src/agent-catalog-migration.ts';
import { HarborSnapshotSchema, type HarborSnapshot } from '../src/harbor-store.ts';

const NOW = '2026-10-20T08:00:00.000Z';

function fixture(): HarborSnapshot {
  const runtime = (id: string) => ({
    id,
    name: id,
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
  });
  const agent = (overrides: Record<string, unknown>) => ({
    id: 'agent-test',
    name: 'test',
    role: 'test',
    description: '',
    instructions: '',
    provider: 'deepseek',
    model: 'deepseek-chat',
    modelProfileId: 'deepseek-chat',
    runtimeId: 'runtime-codex-local',
    parentAgentId: null,
    hierarchyLevel: 'L0',
    registration: {
      code: 'test-agent',
      type: 'hub',
      ownerOrg: 'AEOS',
      domain: 'test',
      lifecycle: 'active',
      allowedRuntimeCapabilities: [],
    },
    autonomyLevel: 'A1',
    access: 'workspace',
    skills: [],
    status: 'idle',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return HarborSnapshotSchema.parse({
    version: 1,
    revision: 3,
    runtimes: [runtime('runtime-codex-local'), runtime('runtime-control-platform-agent')],
    agents: [
      agent({ id: 'agent-aeos-hub', name: 'AEOS 中枢 Agent', registration: { code: 'aeos-hub', type: 'hub', ownerOrg: 'AEOS', domain: 'enterprise-operation', lifecycle: 'active', allowedRuntimeCapabilities: [] } }),
      agent({ id: 'agent-order', name: '风险交付Agent', parentAgentId: 'agent-aeos-hub', hierarchyLevel: 'L1', registration: { code: 'order-risk', type: 'master', ownerOrg: 'AEOS', domain: 'order', lifecycle: 'active', allowedRuntimeCapabilities: [] } }),
      agent({ id: 'agent-exec', name: '公司中台执行面智能体', runtimeId: 'runtime-control-platform-agent', parentAgentId: 'agent-aeos-hub', hierarchyLevel: 'L1', registration: { code: 'execution-agent', type: 'master', ownerOrg: 'control-platform', domain: 'operating-case-analysis', lifecycle: 'active', allowedRuntimeCapabilities: [] } }),
      agent({ id: 'agent-unknown', name: '未分类 Agent', parentAgentId: 'agent-aeos-hub', hierarchyLevel: 'L1', registration: { code: 'unknown-master', type: 'master', ownerOrg: 'AEOS', domain: 'unclassified', lifecycle: 'active', allowedRuntimeCapabilities: [] } }),
    ],
    projects: [],
    runs: [],
  });
}

const MEMBERS: SquadMembershipRecord[] = [
  { name: '风险交付Agent', squadId: 'business-squad-orders' },
  { name: '齐套研判 Agent', squadId: 'business-squad-material-kitting' },
  { name: '未知小队 Agent', squadId: 'unknown-squad' },
];

test('buildSquadDomainMap 只保留已知小队的业务域', () => {
  const map = buildSquadDomainMap(MEMBERS);
  assert.equal(map.get('风险交付Agent'), 'order');
  assert.equal(map.get('齐套研判 Agent'), 'kitting');
  assert.equal(map.has('未知小队 Agent'), false);
});

test('planAgentAttribution 按 Hub / 中台 / 小队 / 兜底规则归属', () => {
  const snapshot = fixture();
  const map = buildSquadDomainMap(MEMBERS);

  assert.deepEqual(planAgentAttribution(snapshot.agents[0]!, map), {
    systemId: 'aeos-hub', primaryDomainId: 'cross-domain', domainIds: ['cross-domain'], externalAgentId: null,
  });
  assert.deepEqual(planAgentAttribution(snapshot.agents[1]!, map), {
    systemId: 'aeos-hub', primaryDomainId: 'order', domainIds: ['order'], externalAgentId: null,
  });
  assert.deepEqual(planAgentAttribution(snapshot.agents[2]!, map), {
    systemId: 'control-platform',
    primaryDomainId: 'cross-domain',
    domainIds: ['order', 'kitting', 'quality', 'production', 'cross-domain'],
    externalAgentId: 'runtime-control-platform-agent',
  });
  assert.equal(planAgentAttribution(snapshot.agents[3]!, map).primaryDomainId, 'cross-domain');
});

test('migrateAgentCatalog 写回归属并给出变更报告', () => {
  const { snapshot, report } = migrateAgentCatalog(fixture(), MEMBERS);

  assert.equal(snapshot.revision, 4);
  assert.equal(report.changed, 4);
  assert.equal(report.unchanged, 0);
  assert.ok(report.warnings.some((warning) => warning.includes('未分类 Agent')));
  assert.equal(snapshot.agents.find((agent) => agent.id === 'agent-exec')?.systemId, 'control-platform');
  assert.deepEqual(
    snapshot.agents.find((agent) => agent.id === 'agent-order')?.domainIds,
    ['order'],
  );
  assert.equal(snapshot.agents.find((agent) => agent.id === 'agent-aeos-hub')?.externalAgentId, null);
  assert.doesNotThrow(() => HarborSnapshotSchema.parse(snapshot));
});

test('migrateAgentCatalog 幂等：第二次不再改 revision', () => {
  const first = migrateAgentCatalog(fixture(), MEMBERS);
  const second = migrateAgentCatalog(first.snapshot, MEMBERS);

  assert.equal(second.report.changed, 0);
  assert.equal(second.report.unchanged, 4);
  assert.equal(second.snapshot.revision, first.snapshot.revision);
});
