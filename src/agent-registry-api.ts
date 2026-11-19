import type { HarborSnapshot } from './harbor-store.ts';
import { isM01AgentDispatchable } from './m01-agent-bridge.ts';

export interface AgentRegistryItem {
  agentId: string;
  harborAgentId: string;
  name: string;
  role: string;
  skills: string[];
  autonomyLevel: string;
  status: string;
  runtimeId: string | null;
  runtimeStatus: string | null;
  m01State: string;
  effectiveScopes: string[];
  dispatchable: boolean;
  updatedAt: string;
}

export interface AgentRegistrySnapshot {
  registrySystem: 'M13';
  revision: number;
  generatedAt: string;
  items: AgentRegistryItem[];
}

export function buildAgentRegistrySnapshot(
  harbor: HarborSnapshot,
  options: { prefix?: string; generatedAt?: string } = {},
): AgentRegistrySnapshot {
  const prefix = (options.prefix ?? '').trim();
  const runtimeById = new Map(harbor.runtimes.map((runtime) => [runtime.id, runtime]));
  const items = harbor.agents
    .filter((agent) => {
      const externalId = agent.businessAgentId || agent.id;
      return !prefix || externalId.startsWith(prefix);
    })
    .map((agent) => {
      const runtime = agent.runtimeId ? runtimeById.get(agent.runtimeId) : undefined;
      return {
        agentId: agent.businessAgentId || agent.id,
        harborAgentId: agent.id,
        name: agent.name,
        role: agent.role,
        skills: [...agent.skills],
        autonomyLevel: agent.autonomyLevel,
        status: agent.status,
        runtimeId: agent.runtimeId,
        runtimeStatus: runtime?.status ?? null,
        m01State: agent.m01Registration.state,
        effectiveScopes: [...agent.m01Registration.effectiveScopes],
        dispatchable: isM01AgentDispatchable(agent),
        updatedAt: agent.updatedAt,
      };
    })
    .sort((a, b) => a.agentId.localeCompare(b.agentId, 'en'));

  return {
    registrySystem: 'M13',
    revision: harbor.revision,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    items,
  };
}
