// 把「中台智能助手」登记为真实港湾 Agent：它不通过 Hub 执行面派单，
// 只承接中台 assistant-events 上报的真实用量，便于在目录系统/Agent 上展示。
import { DOMAIN_IDS } from './domain-registry.ts';
import { HarborSnapshotSchema, type HarborSnapshot } from './harbor-store.ts';

export const CONTROL_ASSISTANT_AGENT_ID = 'agent-control-platform-assistant';
export const CONTROL_ASSISTANT_RUNTIME_ID = 'runtime-control-platform-assistant';
export const CONTROL_PLATFORM_SYSTEM_ID = 'control-platform';
export const CONTROL_ASSISTANT_EXTERNAL_ID = 'control-platform-assistant';

export interface ControlAssistantSeedResult {
  snapshot: HarborSnapshot;
  changed: boolean;
  createdRuntime: boolean;
  createdAgent: boolean;
}

export function ensureControlAssistantAgent(
  snapshot: HarborSnapshot,
  now = new Date().toISOString(),
): ControlAssistantSeedResult {
  const hasRuntime = snapshot.runtimes.some((runtime) => runtime.id === CONTROL_ASSISTANT_RUNTIME_ID);
  const hasAgent = snapshot.agents.some((agent) => agent.id === CONTROL_ASSISTANT_AGENT_ID
    || agent.externalAgentId === CONTROL_ASSISTANT_EXTERNAL_ID);
  if (hasRuntime && hasAgent) {
    return { snapshot, changed: false, createdRuntime: false, createdAgent: false };
  }

  const runtimes = hasRuntime ? snapshot.runtimes : [...snapshot.runtimes, {
    id: CONTROL_ASSISTANT_RUNTIME_ID,
    name: '中台智能助手（系统托管）',
    kind: 'system-assistant' as const,
    description: '中台系统自带助手，通过 assistant-events 上报真实用量；不参与 Hub 执行面派单。',
    endpoint: 'system://control-platform/assistant',
    workdir: '',
    owner: '中台团队',
    capabilities: [],
    status: 'ready' as const,
    lastSeenAt: now,
    lastVerification: null,
    createdAt: now,
    updatedAt: now,
  }];

  const agents = hasAgent ? snapshot.agents : [...snapshot.agents, {
    id: CONTROL_ASSISTANT_AGENT_ID,
    name: '中台智能助手',
    role: '系统级经营问答与只读分析',
    description: '中台系统自带的智能助手，真实用量来自 assistant-events；Hub 只做观测与汇总，不向其派单。',
    instructions: '仅进行只读问答与分析；结论必须引用 evidence_refs；不执行任何写操作。',
    provider: 'deepseek',
    model: 'deepseek-flash',
    modelProfileId: 'deepseek-flash',
    runtimeId: CONTROL_ASSISTANT_RUNTIME_ID,
    systemId: CONTROL_PLATFORM_SYSTEM_ID,
    primaryDomainId: 'cross-domain' as const,
    domainIds: [...DOMAIN_IDS],
    externalAgentId: CONTROL_ASSISTANT_EXTERNAL_ID,
    parentAgentId: 'agent-aeos-hub',
    hierarchyLevel: 'L1' as const,
    registration: {
      code: 'control-platform-assistant',
      type: 'master' as const,
      ownerOrg: '中台团队',
      domain: 'operating-case-analysis',
      lifecycle: 'active' as const,
      allowedRuntimeCapabilities: [],
    },
    autonomyLevel: 'A1' as const,
    access: 'workspace' as const,
    skills: ['中台只读问答', '经营分析', '用量观测'],
    status: 'idle' as const,
    createdAt: now,
    updatedAt: now,
  }];

  const next = HarborSnapshotSchema.parse({
    ...snapshot,
    revision: snapshot.revision + 1,
    runtimes,
    agents,
  });

  return {
    snapshot: next,
    changed: true,
    createdRuntime: !hasRuntime,
    createdAgent: !hasAgent,
  };
}
