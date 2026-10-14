// AEOS 执行面智能体入口：读取配置 → 注册能力 → 连接 Hub → 待命。
import { ExecutionAgentCore } from './agent-core.js';
import { loadConfig } from './config.js';
import { registerCapability, capabilityHandlers, capabilityDefinitions } from './capabilities.js';
import { createQueryAdapter } from './adapters/query-adapter.js';
import { createReasoningAdapter } from './adapters/reasoning-adapter.js';

const log = (...args) => console.log(...args);

function main() {
  const config = loadConfig(process.env);

  // 查询能力：HMAC 只读查询目标系统。
  registerCapability({
    name: 'query_control_platform',
    description: '精确查询目标系统只读业务数据',
    handler: createQueryAdapter({ baseUrl: config.targetQueryBaseUrl, appKey: config.targetQueryAppKey, appSecret: config.targetQueryAppSecret }),
  });

  // 推理能力：调用目标系统自有大模型/推理智能体（占位，未接通前明确返回未接通）。
  registerCapability({
    name: 'reason_control_platform',
    description: '调用目标系统自有大模型或推理智能体完成只读分析',
    handler: createReasoningAdapter({ url: config.targetReasoningUrl, agentId: config.targetReasoningAgentId, token: config.targetReasoningToken }),
  });

  const core = new ExecutionAgentCore(
    {
      wsUrl: config.wsUrl,
      token: config.token,
      agentId: config.agentId,
      name: config.agentName,
      version: config.agentVersion,
      protocolVersion: config.protocolVersion,
      sourceSystem: config.sourceSystem,
      capabilities: capabilityDefinitions(),
    },
    capabilityHandlers(),
    log,
  );

  core.start();

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      log(`[agent] 收到 ${signal}，停止服务`);
      core.stop();
      process.exit(0);
    });
  }
}

main();
