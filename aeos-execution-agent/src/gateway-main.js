// 中控平台网关入口（单 Agent 兼容模式）。
// 一条 WS 连接、两个能力（query/reason），身份为 gateway-control-platform；
// 不包含 PLM/ERP，也不做多 Agent roster（后续再扩展）。
import { ExecutionAgentCore } from './agent-core.js';
import { loadGatewayConfig } from './config.js';
import { capabilityHandlers, capabilityDefinitions } from './capabilities.js';
import { registerControlPlatformCapabilities } from './control-platform-capabilities.js';

const log = (...args) => console.log(...args);

function main() {
  const config = loadGatewayConfig(process.env);
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
  log(`[gateway] 中控平台网关已启动：${config.agentId}（单 Agent 兼容模式）`);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      log(`[gateway] 收到 ${signal}，停止服务`);
      core.stop();
      process.exit(0);
    });
  }
}

main();
