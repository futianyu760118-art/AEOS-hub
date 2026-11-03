import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogApi } from '../src/catalog-api.ts';
import { HarborSnapshotSchema } from '../src/harbor-store.ts';
import type { CatalogSources } from '../src/agent-catalog.ts';

const NOW = '2026-10-20T08:00:00.000Z';

function api(): CatalogApi {
  const sources: CatalogSources = {
    harbor: HarborSnapshotSchema.parse({
      version: 1,
      revision: 0,
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
    }),
    systems: [{
      systemId: 'aeos-hub', name: 'AEOS Hub', tenantId: 'pilot-default', owner: '平台团队', description: '',
      status: 'active', sourceSystemAliases: ['aeos-hub'], createdAt: NOW, updatedAt: NOW,
    }],
    executionAgents: [{
      agentId: 'mes-agent',
      name: 'MES 查询 Agent',
      version: '1.0.0',
      capabilities: [{ name: 'orders_list', description: '订单查询', constraints: { readOnly: true } }],
      connectionStatus: 'online',
      runtimeStatus: 'idle',
      lastSeenAt: NOW,
      currentRunId: null,
      registeredAt: NOW,
      local: false,
      sourceSystem: 'MES',
      deregisteredAt: null,
    }],
  };
  return new CatalogApi(() => sources);
}

test('GET /api/catalog/tree 返回三级树与计数', () => {
  const response = api().handle({ method: 'GET', pathname: '/api/catalog/tree' });
  assert.equal(response?.status, 200);
  const tree = response?.body.tree as { systems: unknown[]; counts: { agents: number }; warnings: string[] };
  assert.equal(tree.systems.length, 2);
  assert.equal(tree.counts.agents, 2);
  assert.ok(tree.warnings[0]?.includes('MES'));
});

test('GET /api/catalog/systems 与 capabilities', () => {
  const systems = api().handle({ method: 'GET', pathname: '/api/catalog/systems' });
  assert.equal(systems?.status, 200);
  assert.equal((systems?.body.systems as unknown[]).length, 2);

  const capabilities = api().handle({ method: 'GET', pathname: '/api/catalog/capabilities' });
  assert.equal(capabilities?.status, 200);
  const list = capabilities?.body.capabilities as Array<{ name: string; source: string; providerAgentId: string; readOnly: boolean }>;
  const orders = list.find((item) => item.name === 'orders_list');
  assert.equal(orders?.source, 'execution');
  assert.equal(orders?.providerAgentId, 'mes-agent');
  assert.equal(orders?.readOnly, true);
});

test('GET /api/catalog/agents/:id 支持 URL 编码与 404', () => {
  const found = api().handle({ method: 'GET', pathname: '/api/catalog/agents/execution%3Ames-agent' });
  assert.equal(found?.status, 200);
  assert.equal((found?.body.agent as { agent: { id: string } }).agent.id, 'execution:mes-agent');

  const missing = api().handle({ method: 'GET', pathname: '/api/catalog/agents/missing' });
  assert.equal(missing?.status, 404);
  assert.equal((missing?.body as { code: string }).code, 'AGENT_NOT_FOUND');
});

test('非 GET 返回 405，未知目录路径返回 404，非目录路径不接管', () => {
  assert.equal(api().handle({ method: 'POST', pathname: '/api/catalog/tree' })?.status, 405);
  assert.equal(api().handle({ method: 'GET', pathname: '/api/catalog/unknown' })?.status, 404);
  assert.equal(api().handle({ method: 'GET', pathname: '/api/harbor' }), null);
});

test('把请求租户传给目录读模型', () => {
  let seen: string | undefined;
  const catalog = new CatalogApi((tenantId) => {
    seen = tenantId;
    return {
      harbor: { version: 1, revision: 0, agents: [], runtimes: [], projects: [], runs: [], lifecycleEvents: [] } as unknown as CatalogSources['harbor'],
      systems: [],
      executionAgents: [],
    };
  });
  const response = catalog.handle({ method: 'GET', pathname: '/api/catalog/tree', tenantId: 'tenant-demo' });
  assert.equal(response?.status, 200);
  assert.equal(seen, 'tenant-demo');
});
