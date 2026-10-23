// AEOS 执行面智能体入口：读取配置 → 注册中台能力 → 连接 Hub → 待命。
import { ExecutionAgentCore } from './agent-core.js';
import { loadConfig } from './config.js';
import { capabilityHandlers, capabilityDefinitions } from './capabilities.js';
import { registerControlPlatformCapabilities } from './control-platform-capabilities.js';

const log = (...args) => console.log(...args);

function main() {
  const config = loadConfig(process.env);
  registerControlPlatformCapabilities(config);

  const core = new ExecutionAgentCore(
    {
      wsUrl: config.wsUrl,
      token: config.token,
      systemId: config.systemId,
      systemToken: config.systemToken,
      agentId: config.agentId,
      name: config.agentName,
      version: config.agentVersion,
      protocolVersion: config.protocolVersion,
      sourceSystem: config.sourceSystem,
      agentKind: config.agentKind,
      gatewayVersion: config.gatewayVersion,
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
