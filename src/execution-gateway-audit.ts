// 网关注册审计：只对 agentKind=system-gateway 生成 evidence，普通执行体不产生噪声。
import type { EvidenceInput } from './evidence.ts';
import type { ExecutionAgentRecord } from './execution-plane.ts';

type GatewayRecord = Pick<
  ExecutionAgentRecord,
  'agentId' | 'name' | 'systemId' | 'sourceSystem' | 'agentKind' | 'gatewayVersion' | 'capabilities'
>;

export function gatewayRegistrationEvidence(
  record: GatewayRecord,
  context: { systemId: string; authMode: string },
): EvidenceInput | null {
  if (record.agentKind !== 'system-gateway') return null;
  const systemId = context.systemId.trim() || record.systemId?.trim() || record.sourceSystem.trim() || 'unknown';
  return {
    kind: 'app_event',
    actor_id: `execution-token:system:${systemId}`,
    actor_type: 'system',
    object_ref: `hub://execution-agent/${encodeURIComponent(record.agentId)}`,
    source_system: systemId,
    correlation_id: 'execution-gateway-registered',
    summary: 'system gateway registered',
    payload: {
      agentId: record.agentId,
      agentName: record.name,
      systemId: record.systemId ?? null,
      sourceSystem: record.sourceSystem,
      gatewayVersion: record.gatewayVersion ?? null,
      capabilities: record.capabilities.map((capability) => capability.name),
      authMode: context.authMode,
    },
  };
}
