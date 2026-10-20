// 统一三级目录读模型：系统 → 业务域 → 智能体。
// 只读聚合 AI 港湾、系统登记与执行面注册表，不写任何数据。
import { BUSINESS_DOMAINS, type DomainId } from './domain-registry.ts';
import type {
  AgentHierarchyLevel,
  AgentLifecycle,
  AgentType,
  HarborAgent,
  HarborAgentStatus,
  HarborSnapshot,
} from './harbor-store.ts';
import type { ExecutionAgentAuthMode, ExecutionAgentRecord } from './execution-plane.ts';
import type { SystemRecord } from './system-registry.ts';
import type { UsageByAgentRow, UsageBySystemRow } from './usage-ledger-store.ts';

export interface CatalogUsageTotals {
  tokensIn: number;
  tokensOut: number;
  cost: number;
  events: number;
  lastAt: string | null;
}

export interface CatalogUsageSummary {
  byAgent: UsageByAgentRow[];
  bySystem: UsageBySystemRow[];
}

export interface CatalogExecutionState {
  connectionStatus: 'online' | 'offline';
  runtimeStatus: 'idle' | 'working' | 'error';
  lastSeenAt: string;
  local: boolean;
  sourceSystem: string;
  sourceSystemName: string | null;
  authMode: ExecutionAgentAuthMode;
  currentRunId: string | null;
}

export interface CatalogAgentNode {
  id: string;
  name: string;
  role: string;
  type: AgentType | 'execution';
  hierarchyLevel: AgentHierarchyLevel;
  lifecycle: AgentLifecycle;
  status: HarborAgentStatus;
  systemId: string;
  primaryDomainId: DomainId;
  domainIds: DomainId[];
  externalAgentId: string | null;
  parentAgentId: string | null;
  runtimeId: string | null;
  modelProfileId: string | null;
  registeredInHarbor: boolean;
  execution: CatalogExecutionState | null;
  usage: CatalogUsageTotals | null;
  skills: string[];
  updatedAt: string;
}

export interface CatalogDomainNode {
  id: DomainId;
  name: string;
  agentCount: number;
  agents: CatalogAgentNode[];
}

export interface CatalogSystemNode {
  id: string;
  name: string;
  owner: string;
  status: 'active' | 'disabled' | 'unregistered';
  unregistered: boolean;
  agentCount: number;
  usage: CatalogUsageTotals | null;
  domains: CatalogDomainNode[];
}

export interface CatalogTree {
  generatedAt: string;
  systems: CatalogSystemNode[];
  counts: {
    systems: number;
    domains: number;
    agents: number;
    unregisteredInHarbor: number;
  };
  warnings: string[];
}

export interface CatalogAgentDetail {
  agent: CatalogAgentNode;
  system: CatalogSystemNode;
  domain: CatalogDomainNode;
  ancestors: Array<{ id: string; name: string; hierarchyLevel: AgentHierarchyLevel }>;
  children: Array<{ id: string; name: string; hierarchyLevel: AgentHierarchyLevel }>;
}

export interface CatalogCapability {
  name: string;
  agentCount: number;
  agents: Array<{ id: string; name: string; systemId: string; primaryDomainId: DomainId }>;
}

export interface CatalogSources {
  harbor: HarborSnapshot;
  systems: SystemRecord[];
  executionAgents: ExecutionAgentRecord[];
  /** 用量聚合；缺省时目录不展示用量。 */
  usage?: CatalogUsageSummary;
}

const UNREGISTERED_SYSTEM_ID = 'unregistered';
const UNREGISTERED_SYSTEM_NAME = '未登记系统';
const HIERARCHY_ORDER: Record<AgentHierarchyLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

function executionNodeId(agentId: string): string {
  return `execution:${agentId}`;
}

function harborStatusFromExecution(record: ExecutionAgentRecord): HarborAgentStatus {
  if (record.deregisteredAt) return 'archived';
  if (record.connectionStatus === 'offline') return 'offline';
  return record.runtimeStatus === 'working' ? 'working' : 'idle';
}

function executionNode(record: ExecutionAgentRecord, systemId: string): CatalogAgentNode {
  return {
    id: executionNodeId(record.agentId),
    name: record.name,
    role: record.sourceSystemName ?? record.sourceSystem,
    type: 'execution',
    hierarchyLevel: 'L1',
    lifecycle: record.deregisteredAt ? 'retired' : record.connectionStatus === 'online' ? 'active' : 'suspended',
    status: harborStatusFromExecution(record),
    systemId,
    primaryDomainId: 'cross-domain',
    domainIds: ['cross-domain'],
    externalAgentId: record.agentId,
    parentAgentId: null,
    runtimeId: null,
    modelProfileId: null,
    registeredInHarbor: false,
    execution: {
      connectionStatus: record.connectionStatus,
      runtimeStatus: record.runtimeStatus,
      lastSeenAt: record.lastSeenAt,
      local: record.local,
      sourceSystem: record.sourceSystem,
      sourceSystemName: record.sourceSystemName ?? null,
      authMode: record.authMode,
      currentRunId: record.currentRunId,
    },
    usage: null,
    skills: record.capabilities.map((capability) => capability.name),
    updatedAt: record.lastSeenAt,
  };
}

function harborNode(agent: HarborAgent, execution: ExecutionAgentRecord | null): CatalogAgentNode {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    type: agent.registration.type,
    hierarchyLevel: agent.hierarchyLevel,
    lifecycle: agent.registration.lifecycle,
    status: agent.status,
    systemId: agent.systemId,
    primaryDomainId: agent.primaryDomainId,
    domainIds: [...agent.domainIds],
    externalAgentId: agent.externalAgentId,
    parentAgentId: agent.parentAgentId,
    runtimeId: agent.runtimeId,
    modelProfileId: agent.modelProfileId,
    registeredInHarbor: true,
    execution: execution ? {
      connectionStatus: execution.connectionStatus,
      runtimeStatus: execution.runtimeStatus,
      lastSeenAt: execution.lastSeenAt,
      local: execution.local,
      sourceSystem: execution.sourceSystem,
      sourceSystemName: execution.sourceSystemName ?? null,
      authMode: execution.authMode,
      currentRunId: execution.currentRunId,
    } : null,
    usage: null,
    skills: [...agent.skills],
    updatedAt: agent.updatedAt,
  };
}

function sortAgents(agents: CatalogAgentNode[]): CatalogAgentNode[] {
  return agents.slice().sort((left, right) => {
    const level = HIERARCHY_ORDER[left.hierarchyLevel] - HIERARCHY_ORDER[right.hierarchyLevel];
    return level !== 0 ? level : left.name.localeCompare(right.name, 'zh-CN');
  });
}

function emptyUsage(): CatalogUsageTotals {
  return { tokensIn: 0, tokensOut: 0, cost: 0, events: 0, lastAt: null };
}

function addUsage(target: CatalogUsageTotals, row: { tokensIn: number; tokensOut: number; cost: number; events: number; lastAt: string | null }): void {
  target.tokensIn += row.tokensIn;
  target.tokensOut += row.tokensOut;
  target.cost += row.cost;
  target.events += row.events;
  if (row.lastAt && (!target.lastAt || Date.parse(row.lastAt) > Date.parse(target.lastAt))) {
    target.lastAt = row.lastAt;
  }
}

function buildAgentUsage(rows: UsageByAgentRow[] | undefined): Map<string, UsageByAgentRow> {
  return new Map((rows ?? []).map((row) => [row.agentId, row]));
}

function usageForAgent(
  keys: Array<string | null | undefined>,
  lookup: Map<string, UsageByAgentRow>,
  excluded: Set<string> = new Set(),
): CatalogUsageTotals | null {
  const totals = emptyUsage();
  const seen = new Set<string>();
  for (const key of keys) {
    if (!key || seen.has(key) || excluded.has(key)) continue;
    seen.add(key);
    const row = lookup.get(key);
    if (row) addUsage(totals, row);
  }
  return totals.events > 0 ? totals : null;
}

function resolveRecordSystemId(record: ExecutionAgentRecord, systems: SystemRecord[]): string | null {
  const system = systems.find((candidate) => candidate.systemId === record.systemId
    || candidate.systemId === record.sourceSystem
    || candidate.sourceSystemAliases.includes(record.sourceSystem));
  return system?.systemId ?? null;
}

function buildSystemUsage(systems: SystemRecord[], rows: UsageBySystemRow[] | undefined): Map<string, CatalogUsageTotals> {
  const usage = new Map<string, CatalogUsageTotals>();
  for (const row of rows ?? []) {
    const system = systems.find((candidate) => candidate.systemId === row.systemId
      || candidate.sourceSystemAliases.includes(row.systemId));
    const key = system?.systemId ?? row.systemId;
    const totals = usage.get(key) ?? emptyUsage();
    addUsage(totals, row);
    usage.set(key, totals);
  }
  return usage;
}

export function buildCatalogTree(sources: CatalogSources, now = new Date()): CatalogTree {
  const warnings: string[] = [];
  const knownSystems = new Map(sources.systems.map((system) => [system.systemId, system]));
  const executionByExternalId = new Map<string, ExecutionAgentRecord>();
  for (const record of sources.executionAgents) executionByExternalId.set(record.agentId, record);
  const agentUsage = buildAgentUsage(sources.usage?.byAgent);
  const systemUsage = buildSystemUsage(sources.systems, sources.usage?.bySystem);
  const simulatedAgentIds = new Set(sources.executionAgents.filter((record) => record.simulated).map((record) => record.agentId));
  // 模拟器产生的用量不计入真实系统统计。
  const simulatedUsageBySystem = new Map<string, CatalogUsageTotals>();
  for (const record of sources.executionAgents) {
    if (!record.simulated) continue;
    const row = agentUsage.get(record.agentId);
    const systemId = resolveRecordSystemId(record, sources.systems);
    if (!row || !systemId) continue;
    const totals = simulatedUsageBySystem.get(systemId) ?? emptyUsage();
    addUsage(totals, row);
    simulatedUsageBySystem.set(systemId, totals);
  }
  for (const [systemId, simulated] of simulatedUsageBySystem) {
    const totals = systemUsage.get(systemId);
    if (!totals) continue;
    totals.tokensIn = Math.max(0, totals.tokensIn - simulated.tokensIn);
    totals.tokensOut = Math.max(0, totals.tokensOut - simulated.tokensOut);
    totals.cost = Math.max(0, totals.cost - simulated.cost);
    totals.events = Math.max(0, totals.events - simulated.events);
    if (totals.events === 0) systemUsage.delete(systemId);
  }

  const claimedExecution = new Set<string>();
  const nodesBySystem = new Map<string, CatalogAgentNode[]>();
  const addNode = (systemId: string, node: CatalogAgentNode) => {
    const list = nodesBySystem.get(systemId) ?? [];
    list.push(node);
    nodesBySystem.set(systemId, list);
  };

  for (const agent of sources.harbor.agents) {
    const execution = (agent.externalAgentId ? executionByExternalId.get(agent.externalAgentId) : undefined)
      ?? (agent.runtimeId ? executionByExternalId.get(agent.runtimeId) : undefined)
      ?? null;
    const realExecution = execution && !execution.simulated && !execution.deregisteredAt ? execution : null;
    if (realExecution) claimedExecution.add(realExecution.agentId);
    if (!knownSystems.has(agent.systemId)) {
      warnings.push(`${agent.name} 归属的系统 ${agent.systemId} 未在系统登记中`);
    }
    const node = harborNode(agent, realExecution);
    node.usage = usageForAgent([node.id, node.externalAgentId, node.runtimeId], agentUsage, simulatedAgentIds);
    addNode(agent.systemId, node);
  }

  for (const record of sources.executionAgents) {
    if (record.simulated || record.deregisteredAt || claimedExecution.has(record.agentId)) continue;
    const resolvedSystemId = resolveRecordSystemId(record, sources.systems);
    const systemId = resolvedSystemId ?? UNREGISTERED_SYSTEM_ID;
    if (!resolvedSystemId) warnings.push(`执行面 Agent ${record.name} 的系统「${record.sourceSystem}」未登记，暂归未登记系统`);
    const node = executionNode(record, systemId);
    node.usage = usageForAgent([record.agentId, node.externalAgentId], agentUsage, simulatedAgentIds);
    addNode(systemId, node);
  }

  const systemEntries: Array<{ id: string; name: string; owner: string; status: CatalogSystemNode['status']; unregistered: boolean }> = [
    ...sources.systems.map((system) => ({
      id: system.systemId,
      name: system.name,
      owner: system.owner,
      status: system.status,
      unregistered: false,
    })),
  ];
  for (const systemId of nodesBySystem.keys()) {
    if (knownSystems.has(systemId)) continue;
    systemEntries.push({
      id: systemId,
      name: systemId === UNREGISTERED_SYSTEM_ID ? UNREGISTERED_SYSTEM_NAME : systemId,
      owner: '',
      status: 'unregistered',
      unregistered: true,
    });
  }

  let domainCount = 0;
  let agentCount = 0;
  const systems: CatalogSystemNode[] = systemEntries.map((system) => {
    const agents = sortAgents(nodesBySystem.get(system.id) ?? []);
    agentCount += agents.length;
    const domains = BUSINESS_DOMAINS.flatMap((domain): CatalogDomainNode[] => {
      const members = agents.filter((agent) => agent.primaryDomainId === domain.domainId);
      if (members.length === 0) return [];
      domainCount += 1;
      return [{
        id: domain.domainId,
        name: domain.name,
        agentCount: members.length,
        agents: members,
      }];
    });
    return {
      ...system,
      agentCount: agents.length,
      usage: systemUsage.get(system.id) ?? null,
      domains,
    };
  });

  return {
    generatedAt: now.toISOString(),
    systems,
    counts: {
      systems: systems.length,
      domains: domainCount,
      agents: agentCount,
      unregisteredInHarbor: sources.executionAgents.filter((record) => !record.simulated && !record.deregisteredAt && !claimedExecution.has(record.agentId)).length,
    },
    warnings,
  };
}

function findNode(tree: CatalogTree, agentId: string): { agent: CatalogAgentNode; system: CatalogSystemNode; domain: CatalogDomainNode } | null {
  for (const system of tree.systems) {
    for (const domain of system.domains) {
      const agent = domain.agents.find((candidate) => candidate.id === agentId);
      if (agent) return { agent, system, domain };
    }
  }
  return null;
}

export function getCatalogAgent(tree: CatalogTree, agentId: string): CatalogAgentDetail | null {
  const found = findNode(tree, agentId);
  if (!found) return null;
  const nodesById = new Map<string, CatalogAgentNode>();
  for (const system of tree.systems) {
    for (const domain of system.domains) {
      for (const agent of domain.agents) nodesById.set(agent.id, agent);
    }
  }
  const ancestors: CatalogAgentDetail['ancestors'] = [];
  let current = found.agent.parentAgentId ? nodesById.get(found.agent.parentAgentId) : undefined;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    ancestors.unshift({ id: current.id, name: current.name, hierarchyLevel: current.hierarchyLevel });
    current = current.parentAgentId ? nodesById.get(current.parentAgentId) : undefined;
  }
  const children = [...nodesById.values()]
    .filter((agent) => agent.parentAgentId === found.agent.id)
    .map((agent) => ({ id: agent.id, name: agent.name, hierarchyLevel: agent.hierarchyLevel }));
  return { ...found, ancestors, children };
}

export function buildCapabilityCatalog(tree: CatalogTree): CatalogCapability[] {
  const capabilities = new Map<string, CatalogCapability>();
  for (const system of tree.systems) {
    for (const domain of system.domains) {
      for (const agent of domain.agents) {
        for (const name of new Set(agent.skills)) {
          const entry = capabilities.get(name) ?? { name, agentCount: 0, agents: [] };
          entry.agents.push({
            id: agent.id,
            name: agent.name,
            systemId: agent.systemId,
            primaryDomainId: agent.primaryDomainId,
          });
          entry.agentCount = entry.agents.length;
          capabilities.set(name, entry);
        }
      }
    }
  }
  return [...capabilities.values()].sort((left, right) => {
    return right.agentCount - left.agentCount || left.name.localeCompare(right.name, 'zh-CN');
  });
}
