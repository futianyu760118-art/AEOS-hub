// 归档 AEOS Hub 名下的 L1 演示 Agent：保留数据与历史，仅从默认目录隐藏。
// 只处理 systemId = aeos-hub 且 registration.type = master 的 Agent；L0 中枢与执行面 Agent 不动。
import { HarborSnapshotSchema, type HarborSnapshot } from './harbor-store.ts';

export interface ArchivedAgentSummary {
  id: string;
  name: string;
  primaryDomainId: string;
  alreadyArchived: boolean;
}

export interface HubAgentArchiveReport {
  candidates: number;
  archivedNow: number;
  alreadyArchived: number;
  agents: ArchivedAgentSummary[];
}

export function archiveHubL1Agents(
  snapshot: HarborSnapshot,
  now = new Date().toISOString(),
): { snapshot: HarborSnapshot; report: HubAgentArchiveReport; changed: boolean } {
  const candidates = snapshot.agents.filter((agent) => agent.systemId === 'aeos-hub' && agent.registration.type === 'master');
  let archivedNow = 0;
  let alreadyArchived = 0;
  const agents = snapshot.agents.map((agent) => {
    if (!candidates.some((candidate) => candidate.id === agent.id)) return agent;
    if (agent.registration.lifecycle === 'retired' && agent.status === 'archived') {
      alreadyArchived += 1;
      return agent;
    }
    archivedNow += 1;
    const updatedAt = Date.parse(now) < Date.parse(agent.createdAt) ? agent.createdAt : now;
    return {
      ...agent,
      status: 'archived' as const,
      registration: { ...agent.registration, lifecycle: 'retired' as const },
      updatedAt,
    };
  });

  const changed = archivedNow > 0;
  const next = HarborSnapshotSchema.parse({
    ...snapshot,
    revision: changed ? snapshot.revision + 1 : snapshot.revision,
    agents,
  });

  return {
    snapshot: next,
    changed,
    report: {
      candidates: candidates.length,
      archivedNow,
      alreadyArchived,
      agents: candidates.map((agent) => ({
        id: agent.id,
        name: agent.name,
        primaryDomainId: agent.primaryDomainId,
        alreadyArchived: agent.registration.lifecycle === 'retired' && agent.status === 'archived',
      })),
    },
  };
}
