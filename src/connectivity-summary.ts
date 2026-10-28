// 分析通道连通性聚合：按系统统计在线执行面，供页头状态胶囊与明细面板使用。
// 只统计真实执行面（排除软删除与模拟器），不包含本地助手运行时。
import type { ExecutionAgentRecord } from './execution-plane.ts';

export interface ConnectivitySystem {
  systemId: string;
  name: string;
  online: number;
  total: number;
  lastSeenAt: string | null;
}

export interface ConnectivitySummary {
  systems: ConnectivitySystem[];
  summary: {
    online: number;
    total: number;
    status: 'ok' | 'partial' | 'down' | 'empty';
  };
}

export function buildConnectivitySummary(agents: ExecutionAgentRecord[]): ConnectivitySummary {
  const groups = new Map<string, ConnectivitySystem>();
  for (const agent of agents) {
    if (agent.deregisteredAt || agent.simulated) continue;
    const systemId = agent.systemId ?? agent.sourceSystem;
    const group = groups.get(systemId) ?? {
      systemId,
      name: agent.sourceSystemName ?? systemId,
      online: 0,
      total: 0,
      lastSeenAt: null,
    };
    group.total += 1;
    if (agent.connectionStatus === 'online') group.online += 1;
    if (agent.lastSeenAt && (!group.lastSeenAt || agent.lastSeenAt > group.lastSeenAt)) {
      group.lastSeenAt = agent.lastSeenAt;
    }
    groups.set(systemId, group);
  }
  const systems = [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  const online = systems.reduce((sum, system) => sum + system.online, 0);
  const total = systems.reduce((sum, system) => sum + system.total, 0);
  const status = total === 0 ? 'empty' : online === total ? 'ok' : online > 0 ? 'partial' : 'down';
  return { systems, summary: { online, total, status } };
}
