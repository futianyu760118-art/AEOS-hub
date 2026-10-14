// 幂等注册「执行面查询智能体」到 AI 港湾，供 G1 受控任务分派。
// 桥接约定：Harbor runtime.id === 执行面 Agent 的 agentId === 'runtime-execution-query'
//（执行面模拟器以 EXECUTION_AGENT_ID=runtime-execution-query 连接，server 的 resolveRuntime 据此解析适配器）。
import { createHarborAgent, createHarborRuntime, loadHarbor } from './harbor-store.ts';

export const EXECUTION_QUERY_RUNTIME_ID = 'runtime-execution-query';
export const EXECUTION_QUERY_AGENT_CODE = 'execution-query';

export function ensureExecutionQueryAgent(): { runtimeId: string; agentId: string; createdRuntime: boolean; createdAgent: boolean } {
  let runtime = loadHarbor().runtimes.find((item) => item.id === EXECUTION_QUERY_RUNTIME_ID);
  const createdRuntime = !runtime;
  if (!runtime) {
    runtime = createHarborRuntime({
      id: EXECUTION_QUERY_RUNTIME_ID,
      name: '执行面查询运行时',
      kind: 'remote-execution-agent',
      endpoint: 'ws://127.0.0.1:8788/execution-agent',
      owner: 'workspace-owner',
      capabilities: ['query_control_platform'],
    });
  }

  let agent = loadHarbor().agents.find((item) => item.registration.code === EXECUTION_QUERY_AGENT_CODE);
  const createdAgent = !agent;
  if (!agent) {
    agent = createHarborAgent({
      code: EXECUTION_QUERY_AGENT_CODE,
      type: 'master',
      parentAgentId: 'agent-aeos-hub',
      ownerOrg: 'org-demo',
      domain: 'operating-case-analysis',
      lifecycle: 'active',
      allowedRuntimeCapabilities: ['query_control_platform'],
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
      runtimeId: EXECUTION_QUERY_RUNTIME_ID,
      name: '执行面查询智能体',
      role: '经营事项只读查询',
      description: '接入执行面的远程查询智能体：按 path+params 真查中台只读数据并回传结果。',
      instructions: '你是执行面查询智能体，仅执行管理面下发的只读查询，不写入任何业务数据。',
      provider: 'remote-execution',
      model: 'provider-default',
      autonomyLevel: 'A1',
      access: 'workspace',
      skills: ['中台只读查询'],
    });
  }

  return { runtimeId: runtime.id, agentId: agent.id, createdRuntime, createdAgent };
}
