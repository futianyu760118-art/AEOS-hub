// P0 归属迁移：为既有 AI 港湾 Agent 回填 系统 / 主属域 / 服务域 / 外部标识。
// 纯函数 + 确定性规则，便于测试与干跑；不直接读写文件。
import {
  DOMAIN_IDS,
  normalizeDomainIds,
  squadIdToDomainId,
  type DomainId,
} from './domain-registry.ts';
import { HarborSnapshotSchema, type HarborAgent, type HarborSnapshot } from './harbor-store.ts';

export interface SquadMembershipRecord {
  name: string;
  squadId: string;
}

export interface AgentAttribution {
  systemId: string;
  primaryDomainId: DomainId;
  domainIds: DomainId[];
  externalAgentId: string | null;
}

export interface AgentAttributionChange {
  agentId: string;
  name: string;
  before: AgentAttribution;
  after: AgentAttribution;
  changed: boolean;
}

export interface CatalogMigrationReport {
  changed: number;
  unchanged: number;
  agents: AgentAttributionChange[];
  warnings: string[];
}

export interface CatalogMigrationResult {
  snapshot: HarborSnapshot;
  report: CatalogMigrationReport;
}

const CONTROL_PLATFORM_RUNTIME_PREFIX = 'runtime-control-platform';
const CONTROL_PLATFORM_AGENT_CODE = 'execution-agent';
const CONTROL_PLATFORM_AGENT_NAME = '公司中台执行面智能体';

function attributionOf(agent: HarborAgent): AgentAttribution {
  return {
    systemId: agent.systemId,
    primaryDomainId: agent.primaryDomainId,
    domainIds: [...agent.domainIds],
    externalAgentId: agent.externalAgentId,
  };
}

function sameAttribution(left: AgentAttribution, right: AgentAttribution): boolean {
  return left.systemId === right.systemId
    && left.primaryDomainId === right.primaryDomainId
    && left.externalAgentId === right.externalAgentId
    && left.domainIds.length === right.domainIds.length
    && left.domainIds.every((value, index) => value === right.domainIds[index]);
}

/**
 * 按确定性规则计算归属：
 * - 唯一的 Hub Agent → aeos-hub / 跨域；
 * - 中台执行面 Agent → control-platform / 主属跨域 / 服务全部业务域；
 * - 其余 Agent 按旧小队名称映射到业务域，找不到则留在 aeos-hub / 跨域。
 */
export function planAgentAttribution(
  agent: HarborAgent,
  squadDomainByName: ReadonlyMap<string, DomainId>,
): AgentAttribution {
  if (agent.registration.type === 'hub') {
    return {
      systemId: 'aeos-hub',
      primaryDomainId: 'cross-domain',
      domainIds: ['cross-domain'],
      externalAgentId: null,
    };
  }

  const isControlPlatform = agent.name === CONTROL_PLATFORM_AGENT_NAME
    || agent.registration.code === CONTROL_PLATFORM_AGENT_CODE
    || (agent.runtimeId?.startsWith(CONTROL_PLATFORM_RUNTIME_PREFIX) ?? false);
  if (isControlPlatform) {
    return {
      systemId: 'control-platform',
      primaryDomainId: 'cross-domain',
      domainIds: [...DOMAIN_IDS],
      externalAgentId: agent.runtimeId ?? agent.externalAgentId,
    };
  }

  const domainId = squadDomainByName.get(agent.name);
  if (domainId) {
    return {
      systemId: 'aeos-hub',
      primaryDomainId: domainId,
      domainIds: normalizeDomainIds(domainId, [domainId]),
      externalAgentId: null,
    };
  }

  return {
    systemId: 'aeos-hub',
    primaryDomainId: 'cross-domain',
    domainIds: ['cross-domain'],
    externalAgentId: agent.externalAgentId,
  };
}

export function buildSquadDomainMap(members: readonly SquadMembershipRecord[]): Map<string, DomainId> {
  const map = new Map<string, DomainId>();
  for (const member of members) {
    const domainId = squadIdToDomainId(member.squadId);
    if (!domainId) continue;
    map.set(member.name.trim(), domainId);
  }
  return map;
}

export function migrateAgentCatalog(
  snapshot: HarborSnapshot,
  members: readonly SquadMembershipRecord[],
): CatalogMigrationResult {
  const squadDomainByName = buildSquadDomainMap(members);
  const warnings: string[] = [];
  const changes: AgentAttributionChange[] = [];

  const agents = snapshot.agents.map((agent) => {
    const before = attributionOf(agent);
    const after = planAgentAttribution(agent, squadDomainByName);
    const changed = !sameAttribution(before, after);
    if (!changed) {
      changes.push({ agentId: agent.id, name: agent.name, before, after, changed });
      return agent;
    }
    if (after.systemId === 'aeos-hub' && after.primaryDomainId === 'cross-domain' && agent.registration.type !== 'hub') {
      warnings.push(`${agent.name}：未匹配业务域，已留在 aeos-hub / 跨域`);
    }
    changes.push({ agentId: agent.id, name: agent.name, before, after, changed });
    return { ...agent, ...after };
  });

  const changed = changes.filter((change) => change.changed).length;
  const next = HarborSnapshotSchema.parse({
    ...snapshot,
    revision: changed > 0 ? snapshot.revision + 1 : snapshot.revision,
    agents,
  });

  return {
    snapshot: next,
    report: {
      changed,
      unchanged: changes.length - changed,
      agents: changes,
      warnings,
    },
  };
}
