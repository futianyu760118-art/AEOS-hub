import { loadHarbor, updateHarborAgentM01Registration } from '../src/harbor-store.ts';
import { loadM01AgentBridgeConfig, registerAgentWithM01 } from '../src/m01-agent-bridge.ts';

const HUB_AGENT_ID = 'agent-aeos-hub';
const bridge = loadM01AgentBridgeConfig();
const agent = loadHarbor().agents.find((item) => item.id === HUB_AGENT_ID);

if (!agent) {
  console.error(`找不到 HUB 中枢 Agent: ${HUB_AGENT_ID}`);
  process.exitCode = 1;
} else {
  const result = await registerAgentWithM01(agent, bridge.config);
  const now = new Date().toISOString();
  const updated = updateHarborAgentM01Registration(agent.id, {
    state: result.state,
    m01AgentId: result.state === 'not_configured' ? null : result.agentId,
    eventId: result.eventId,
    tenantId: bridge.config?.tenantId ?? null,
    requestedScopes: result.requestedScopes,
    effectiveScopes: result.effectiveScopes,
    clampedScopes: result.clampedScopes,
    lastAttemptAt: result.state === 'not_configured' ? null : now,
    lastSuccessAt: result.state === 'active' ? now : null,
    reason: result.reason,
  });
  console.log(JSON.stringify({
    agentId: updated.id,
    state: updated.m01Registration.state,
    effectiveScopes: updated.m01Registration.effectiveScopes,
    clampedScopes: updated.m01Registration.clampedScopes,
    reason: updated.m01Registration.reason,
  }));
  process.exitCode = result.state === 'active' ? 0 : 1;
}
