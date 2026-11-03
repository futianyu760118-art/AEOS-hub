import assert from 'node:assert/strict';
import test from 'node:test';
import { gatewayRegistrationEvidence } from '../src/execution-gateway-audit.ts';

const base = {
  agentId: 'gateway-control-platform',
  name: '公司中控平台网关',
  systemId: 'control-platform',
  sourceSystem: 'control-platform',
  agentKind: 'system-gateway' as const,
  gatewayVersion: '1.0.0',
  capabilities: [
    { name: 'query_control_platform', description: '中台只读查询' },
    { name: 'reason_control_platform', description: '中台只读推理' },
  ],
};

test('网关注册生成审计事件', () => {
  const event = gatewayRegistrationEvidence(base, { systemId: 'control-platform', authMode: 'system-token' });
  assert.ok(event);
  assert.equal(event.actor_id, 'execution-token:system:control-platform');
  assert.equal(event.actor_type, 'system');
  assert.equal(event.correlation_id, 'execution-gateway-registered');
  assert.equal(event.source_system, 'control-platform');
  assert.equal(event.object_ref, 'hub://execution-agent/gateway-control-platform');
  assert.deepEqual(event.payload, {
    agentId: 'gateway-control-platform',
    agentName: '公司中控平台网关',
    systemId: 'control-platform',
    sourceSystem: 'control-platform',
    gatewayVersion: '1.0.0',
    capabilities: ['query_control_platform', 'reason_control_platform'],
    authMode: 'system-token',
  });
});

test('普通执行体不生成网关注册审计', () => {
  const event = gatewayRegistrationEvidence(
    { ...base, agentKind: 'execution-agent' as const, gatewayVersion: null },
    { systemId: 'control-platform', authMode: 'system-token' },
  );
  assert.equal(event, null);
});
