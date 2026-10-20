// 把中台真实执行面的「查询」「推理」两个 Agent 镜像登记到港湾目录。
// 只补登记档案与 Runtime，不改变执行面连接、不向执行面派单。
import { DOMAIN_IDS } from './domain-registry.ts';
import { HarborSnapshotSchema, type HarborSnapshot } from './harbor-store.ts';

export interface ControlExecutionAgentDefinition {
  executionAgentId: string;
  harborAgentId: string;
  name: string;
  role: string;
  description: string;
  instructions: string;
  capability: string;
  registrationCode: string;
  skills: string[];
}

export const CONTROL_EXECUTION_AGENT_DEFINITIONS: ControlExecutionAgentDefinition[] = [
  {
    executionAgentId: 'runtime-control-platform-query',
    harborAgentId: 'agent-control-platform-query',
    name: '公司中台查询智能体',
    role: '中台只读业务数据查询',
    description: '中台真实执行面的查询智能体，负责按白名单路径查询订单、齐套、质量、生产等只读数据。',
    instructions: '只执行中台只读查询；严格使用能力白名单路径；不写入任何业务数据。',
    capability: 'query_control_platform',
    registrationCode: 'control-platform-query',
    skills: ['中台只读查询'],
  },
  {
    executionAgentId: 'runtime-control-platform-reasoning',
    harborAgentId: 'agent-control-platform-reasoning',
    name: '公司中台推理智能体',
    role: '中台只读推理与风险分析',
    description: '中台真实执行面的推理智能体，负责对具体业务对象做只读分析并返回 evidence_refs。',
    instructions: '只执行中台只读推理；必须引用 evidence_refs；数据缺失或过期时明确说明数据置信度不足。',
    capability: 'reason_control_platform',
    registrationCode: 'control-platform-reasoning',
    skills: ['中台只读推理'],
  },
];

export interface ControlExecutionAgentSeedReport {
  createdRuntimes: string[];
  createdAgents: string[];
  existingAgents: string[];
}

export function ensureControlPlatformExecutionAgents(
  snapshot: HarborSnapshot,
  now = new Date().toISOString(),
): { snapshot: HarborSnapshot; report: ControlExecutionAgentSeedReport; changed: boolean } {
  const runtimes = [...snapshot.runtimes];
  const agents = [...snapshot.agents];
  const createdRuntimes: string[] = [];
  const createdAgents: string[] = [];
  const existingAgents: string[] = [];

  for (const definition of CONTROL_EXECUTION_AGENT_DEFINITIONS) {
    if (!runtimes.some((runtime) => runtime.id === definition.executionAgentId)) {
      runtimes.push({
        id: definition.executionAgentId,
        name: `${definition.name}（执行面）`,
        kind: 'remote-execution-agent',
        description: definition.description,
        endpoint: 'ws://127.0.0.1:8788/execution-agent',
        workdir: '',
        owner: '中台团队',
        capabilities: [definition.capability],
        status: 'ready',
        lastSeenAt: now,
        lastVerification: null,
        createdAt: now,
        updatedAt: now,
      });
      createdRuntimes.push(definition.executionAgentId);
    }

    const existing = agents.find((agent) => agent.id === definition.harborAgentId
      || agent.externalAgentId === definition.executionAgentId
      || agent.registration.code === definition.registrationCode);
    if (existing) {
      existingAgents.push(existing.name);
      continue;
    }

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
      systemId: 'control-platform',
      primaryDomainId: 'cross-domain',
      domainIds: [...DOMAIN_IDS],
      externalAgentId: definition.executionAgentId,
      parentAgentId: 'agent-aeos-hub',
      hierarchyLevel: 'L1',
      registration: {
        code: definition.registrationCode,
        type: 'master',
        ownerOrg: '中台团队',
        domain: 'operating-case-analysis',
        lifecycle: 'active',
        allowedRuntimeCapabilities: [],
        taskServiceProfile: {
          profileVersion: '1.0.0',
          businessOwner: '中台团队',
          technicalOwner: '中台团队',
          supportedTaskTypes: ['operating-case-analysis'],
          tenantIds: ['pilot-default'],
          inputSchemaVersion: '1.0.0',
          outputSchemaVersion: '1.0.0',
          accessMode: 'read_only',
          dataFreshnessMinutes: 15,
        },
      },
      autonomyLevel: 'A1',
      access: 'workspace',
      skills: definition.skills,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    });
    createdAgents.push(definition.name);
  }

  const changed = createdRuntimes.length > 0 || createdAgents.length > 0;
  const next = HarborSnapshotSchema.parse({
    ...snapshot,
    revision: changed ? snapshot.revision + 1 : snapshot.revision,
    runtimes,
    agents,
  });

  return {
    snapshot: next,
    changed,
    report: { createdRuntimes, createdAgents, existingAgents },
  };
}
