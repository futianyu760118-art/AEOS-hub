// 幂等注册「公司中台执行面智能体」到 AI 港湾，供 G1 受控任务分派。
// 桥接约定：Harbor runtime.id === 执行面 Agent 的 agentId === 'runtime-control-platform-agent'
//（执行面以 EXECUTION_AGENT_ID=runtime-control-platform-agent 连接，server 的 resolveRuntime 据此解析适配器）。
import { createHarborAgent, createHarborRuntime, loadHarbor } from './harbor-store.ts';

export const EXECUTION_AGENT_CODE = 'execution-agent';
export const DEFAULT_EXECUTION_AGENT_ID = 'runtime-control-platform-agent';
const EXECUTION_AGENT_CAPABILITIES = ['query_control_platform', 'reason_control_platform'];

export function ensureExecutionAgent(agentId: string = process.env.EXECUTION_AGENT_ID || DEFAULT_EXECUTION_AGENT_ID): { runtimeId: string; agentId: string; createdRuntime: boolean; createdAgent: boolean } {
  // 桥接约定：Harbor runtime.id === 执行面 Agent 的 agentId；Agent ID 由管理面通过 EXECUTION_AGENT_ID 配置。
  const runtimeId = agentId;
  let runtime = loadHarbor().runtimes.find((item) => item.id === runtimeId);
  const createdRuntime = !runtime;
  if (!runtime) {
    runtime = createHarborRuntime({
      id: runtimeId,
      name: '中台执行面运行时',
      kind: 'remote-execution-agent',
      endpoint: 'ws://127.0.0.1:8788/execution-agent',
      owner: 'workspace-owner',
      capabilities: EXECUTION_AGENT_CAPABILITIES,
    });
  }

  let agent = loadHarbor().agents.find((item) => item.registration.code === EXECUTION_AGENT_CODE);
  const createdAgent = !agent;
  if (!agent) {
    agent = createHarborAgent({
      code: EXECUTION_AGENT_CODE,
      type: 'master',
      parentAgentId: 'agent-aeos-hub',
      ownerOrg: 'org-demo',
      domain: 'operating-case-analysis',
      lifecycle: 'active',
      allowedRuntimeCapabilities: EXECUTION_AGENT_CAPABILITIES,
      taskServiceProfile: {
        profileVersion: '1.0.0',
        businessOwner: 'm01:user:8b323683-02f7-4bdb-a3ab-b4f17743b32c',
        technicalOwner: 'm01:user:4c0b3d40-ed1d-47ae-a0e1-2729bb97499d',
        supportedTaskTypes: ['operating-case-analysis'],
        tenantIds: ['tenant-demo'],
        inputSchemaVersion: '1.0.0',
        outputSchemaVersion: '1.0.0',
        accessMode: 'read_only',
        dataFreshnessMinutes: 15,
      },
      runtimeId,
      name: '公司中台执行面智能体',
      role: '经营事项只读查询与推理',
      description: '正式中台执行面智能体：精确查询中台只读业务数据，并调用中台自有推理智能体完成只读分析。',
      instructions: '你是公司中台执行面智能体，只执行管理面下发的只读查询或只读推理，不写入任何业务数据。',
      provider: 'remote-execution',
      model: 'provider-default',
      autonomyLevel: 'A1',
      access: 'workspace',
      skills: ['中台只读查询', '中台只读推理'],
    });
  }

  return { runtimeId: runtime.id, agentId: agent.id, createdRuntime, createdAgent };
}
