// P3 统一能力目录读模型：执行面能力 + 港湾技能 + MCP 只读工具。
// 只读聚合，不改变借调/派单；供后续统一能力查询与版本兼容判断。
import { createHash } from 'node:crypto';
import type { ExecutionAgentRecord } from './execution-plane.ts';
import type { HarborAgent } from './harbor-store.ts';
import type { McpRegistry } from './mcp-registry.ts';
import type { SystemRecord } from './system-registry.ts';
import { resolveTenantId } from './tenant-registry.ts';

export type CapabilityKind = 'query' | 'reason' | 'tool' | 'skill';
export type CapabilityStatus = 'available' | 'offline' | 'disabled';
export type CapabilitySource = 'execution' | 'harbor' | 'mcp';

export interface UnifiedCapability {
  capabilityId: string;
  name: string;
  kind: CapabilityKind;
  description: string;
  providerSystemId: string;
  providerSystemName: string;
  providerAgentId: string;
  providerAgentName: string;
  readOnly: boolean;
  version: string | null;
  inputSchemaHash: string | null;
  outputSchemaHash: string | null;
  status: CapabilityStatus;
  source: CapabilitySource;
  tenantId: string;
}

export interface CapabilityCatalogSources {
  executionAgents: ExecutionAgentRecord[];
  harborAgents: HarborAgent[];
  systems: SystemRecord[];
  mcp?: McpRegistry | null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function hashSchema(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function systemOf(systemId: string, systems: SystemRecord[]): SystemRecord | null {
  return systems.find((system) => system.systemId === systemId
    || system.sourceSystemAliases.includes(systemId)) ?? null;
}

function executionKind(name: string): CapabilityKind {
  if (name.startsWith('reason')) return 'reason';
  if (name.startsWith('query')) return 'query';
  return 'tool';
}

function executionStatus(agent: ExecutionAgentRecord): CapabilityStatus {
  if (agent.deregisteredAt) return 'disabled';
  return agent.connectionStatus === 'online' ? 'available' : 'offline';
}

function harborStatus(agent: HarborAgent): CapabilityStatus {
  if (agent.registration.lifecycle === 'retired' || agent.status === 'archived') return 'disabled';
  return 'available';
}

export function buildUnifiedCapabilityCatalog(
  sources: CapabilityCatalogSources,
  options: { tenantId?: string } = {},
): UnifiedCapability[] {
  const systems = sources.systems;
  const entries: UnifiedCapability[] = [];

  for (const agent of sources.executionAgents) {
    const rawSystemId = agent.systemId ?? agent.sourceSystem;
    const system = systemOf(rawSystemId, systems);
    const providerSystemId = system?.systemId ?? rawSystemId;
    const tenantId = system?.tenantId ?? resolveTenantId(rawSystemId, systems);
    for (const capability of agent.capabilities) {
      entries.push({
        capabilityId: `${providerSystemId}:${agent.agentId}:${capability.name}`,
        name: capability.name,
        kind: executionKind(capability.name),
        description: capability.description,
        providerSystemId,
        providerSystemName: system?.name ?? rawSystemId,
        providerAgentId: agent.agentId,
        providerAgentName: agent.name,
        readOnly: capability.constraints?.readOnly === true,
        version: capability.version ?? null,
        inputSchemaHash: hashSchema(capability.inputSchema),
        outputSchemaHash: hashSchema(capability.outputSchema),
        status: executionStatus(agent),
        source: 'execution',
        tenantId,
      });
    }
  }

  for (const agent of sources.harborAgents) {
    const system = systemOf(agent.systemId, systems);
    const providerSystemId = system?.systemId ?? agent.systemId;
    const tenantId = system?.tenantId ?? resolveTenantId(agent.systemId, systems);
    for (const skill of agent.skills) {
      entries.push({
        capabilityId: `${providerSystemId}:${agent.id}:skill:${skill}`,
        name: skill,
        kind: 'skill',
        description: agent.role,
        providerSystemId,
        providerSystemName: system?.name ?? agent.systemId,
        providerAgentId: agent.id,
        providerAgentName: agent.name,
        readOnly: true,
        version: null,
        inputSchemaHash: null,
        outputSchemaHash: null,
        status: harborStatus(agent),
        source: 'harbor',
        tenantId,
      });
    }
  }

  for (const server of sources.mcp?.servers ?? []) {
    const system = systemOf('aeos-hub', systems);
    const tenantId = system?.tenantId ?? resolveTenantId('aeos-hub', systems);
    for (const tool of server.tools) {
      entries.push({
        capabilityId: `aeos-hub:mcp:${server.id}:${tool.name}`,
        name: tool.name,
        kind: 'tool',
        description: `MCP ${server.id} 只读工具`,
        providerSystemId: 'aeos-hub',
        providerSystemName: system?.name ?? 'AEOS Hub',
        providerAgentId: `mcp:${server.id}`,
        providerAgentName: `MCP ${server.id}`,
        readOnly: true,
        version: null,
        inputSchemaHash: null,
        outputSchemaHash: null,
        status: server.enabled ? 'available' : 'disabled',
        source: 'mcp',
        tenantId,
      });
    }
  }

  const filtered = options.tenantId ? entries.filter((entry) => entry.tenantId === options.tenantId) : entries;
  return filtered.sort((left, right) => left.kind.localeCompare(right.kind)
    || left.name.localeCompare(right.name, 'zh-CN')
    || left.providerAgentId.localeCompare(right.providerAgentId));
}
