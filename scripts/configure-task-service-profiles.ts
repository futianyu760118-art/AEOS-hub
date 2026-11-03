// 幂等补齐「旧 Agent」的 taskServiceProfile，使 v2 任务中心派单/运行不再报
// AGENT_PROFILE_UNCONFIGURED / TENANT_NOT_APPROVED / TASK_TYPE_NOT_APPROVED。
// 只作用于 type=master 且档案未配置的 Agent；hub 型编排 Agent 不是派单目标，跳过。
// 用法：node --experimental-strip-types scripts/configure-task-service-profiles.ts
import {
  AgentTaskServiceProfileSchema,
  loadHarbor,
  saveHarbor,
  isAgentTaskServiceProfileConfigured,
} from '../src/harbor-store.ts';

// 与 src/execution-agent-seed.ts 的 G0 试点档案保持一致：tenant-demo + operating-case-analysis。
const G0_TASK_SERVICE_PROFILE = AgentTaskServiceProfileSchema.parse({
  profileVersion: '1.0.0',
  businessOwner: 'm01:user:8b323683-02f7-4bdb-a3ab-b4f17743b32c',
  technicalOwner: 'm01:user:4c0b3d40-ed1d-47ae-a0e1-2729bb97499d',
  supportedTaskTypes: ['operating-case-analysis'],
  tenantIds: ['tenant-demo'],
  inputSchemaVersion: '1.0.0',
  outputSchemaVersion: '1.0.0',
  accessMode: 'read_only',
  dataFreshnessMinutes: 15,
});

const snapshot = loadHarbor();
const configured: string[] = [];
const skipped: string[] = [];

for (const agent of snapshot.agents) {
  if (agent.registration.type !== 'master') {
    skipped.push(`${agent.name}（type=${agent.registration.type}）`);
    continue;
  }
  if (isAgentTaskServiceProfileConfigured(agent.registration.taskServiceProfile)) {
    skipped.push(`${agent.name}（已配置）`);
    continue;
  }
  agent.registration.taskServiceProfile = { ...G0_TASK_SERVICE_PROFILE };
  configured.push(agent.name);
}

if (configured.length) saveHarbor(snapshot);

console.log(JSON.stringify({ configured, skipped, total: snapshot.agents.length }, null, 2));
