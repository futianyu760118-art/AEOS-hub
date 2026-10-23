// 把恒剑 PLM 真实执行面的只读 Agent 镜像登记到港湾目录。
// 只补登记档案与 Runtime，不改变执行面连接、不向执行面派单。
import { HarborSnapshotSchema, type HarborSnapshot } from './harbor-store.ts';

export interface PlmExecutionAgentDefinition {
  executionAgentId: string;
  harborAgentId: string;
  name: string;
  role: string;
  description: string;
  instructions: string;
  capabilities: string[];
  registrationCode: string;
  skills: string[];
  ownerOrg: string;
}

export const PLM_EXECUTION_AGENT_DEFINITION: PlmExecutionAgentDefinition = {
  executionAgentId: 'runtime-execution-query',
  harborAgentId: 'agent-hengjian-plm-execution',
  name: '恒剑PLM执行面智能体',
  role: 'PLM 研发项目只读查询与推理',
  description: '恒剑 PLM 真实执行面的只读智能体：查询研发项目、立项、跟踪、证据与研发工作表，并可调用 PLM 自有推理智能体完成只读分析。',
  instructions: '你是恒剑 PLM 执行面智能体，只执行管理面下发的只读查询或只读推理；严格使用能力白名单路径；必须引用 evidence_refs；不写入任何业务数据。',
  capabilities: ['query_plm', 'reason_plm'],
  registrationCode: 'hengjian-plm-execution',
  skills: ['PLM 研发项目查询', 'PLM 只读推理'],
  ownerOrg: 'PLM 团队',
};

export interface PlmExecutionAgentSeedReport {
  createdRuntime: string | null;
  createdAgent: string | null;
  existingAgent: string | null;
}

export function ensureHengjianPlmExecutionAgent(
  snapshot: HarborSnapshot,
  now = new Date().toISOString(),
): { snapshot: HarborSnapshot; report: PlmExecutionAgentSeedReport; changed: boolean } {
  const definition = PLM_EXECUTION_AGENT_DEFINITION;
  const runtimes = [...snapshot.runtimes];
  const agents = [...snapshot.agents];
  let createdRuntime: string | null = null;
  let createdAgent: string | null = null;
  let existingAgent: string | null = null;

  if (!runtimes.some((runtime) => runtime.id === definition.executionAgentId)) {
    runtimes.push({
      id: definition.executionAgentId,
      name: `${definition.name}（执行面）`,
      kind: 'remote-execution-agent',
      description: definition.description,
      endpoint: 'ws://127.0.0.1:8788/execution-agent',
      workdir: '',
      owner: definition.ownerOrg,
      capabilities: [...definition.capabilities],
      status: 'ready',
      lastSeenAt: now,
      lastVerification: null,
      createdAt: now,
      updatedAt: now,
    });
    createdRuntime = definition.executionAgentId;
  }

  const existing = agents.find((agent) => agent.id === definition.harborAgentId
    || agent.externalAgentId === definition.executionAgentId
    || agent.registration.code === definition.registrationCode);
  if (existing) {
    existingAgent = existing.name;
  } else {
    agents.push({
      id: definition.harborAgentId,
      name: definition.name,
      role: definition.role,
      description: definition.description,
      instructions: definition.instructions,
      provider: 'remote-execution',
      model: 'provider-default',
      modelProfileId: 'provider-default',
      runtimeId: definition.executionAgentId,
      systemId: 'hengjian-plm',
      primaryDomainId: 'cross-domain',
      domainIds: ['cross-domain'],
      externalAgentId: definition.executionAgentId,
      parentAgentId: 'agent-aeos-hub',
      hierarchyLevel: 'L1',
      registration: {
        code: definition.registrationCode,
        type: 'master',
        ownerOrg: definition.ownerOrg,
        domain: 'plm-analysis',
        lifecycle: 'active',
        allowedRuntimeCapabilities: [...definition.capabilities],
        taskServiceProfile: {
          profileVersion: '1.0.0',
          businessOwner: definition.ownerOrg,
          technicalOwner: definition.ownerOrg,
          supportedTaskTypes: [],
          tenantIds: ['tenant-demo'],
          inputSchemaVersion: '1.0.0',
          outputSchemaVersion: '1.0.0',
          accessMode: 'read_only',
          dataFreshnessMinutes: 15,
        },
      },
      autonomyLevel: 'A1',
      access: 'workspace',
      skills: [...definition.skills],
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    });
    createdAgent = definition.name;
  }

  const changed = createdRuntime !== null || createdAgent !== null;
  const next = HarborSnapshotSchema.parse({
    ...snapshot,
    revision: changed ? snapshot.revision + 1 : snapshot.revision,
    runtimes,
    agents,
  });

  return {
    snapshot: next,
    changed,
    report: { createdRuntime, createdAgent, existingAgent },
  };
}
