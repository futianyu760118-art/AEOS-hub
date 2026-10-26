import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  authorizeCapability,
  grantedCapabilities,
  loadExecutionAgentPermissions,
  type ExecutionAgentPermissions,
} from '../src/execution-agent-permissions.ts';

const BASE: ExecutionAgentPermissions = {
  version: 1,
  revision: 1,
  updatedAt: '2026-10-26T06:20:00.000Z',
  enforcement: 'enforce',
  defaultPolicy: 'deny',
  grants: [
    { systemId: 'control-platform', agentId: 'gateway-control-platform', tenantId: 'tenant-demo', capabilities: ['query_control_platform', 'reason_control_platform'] },
  ],
};

function policy(overrides: Partial<ExecutionAgentPermissions> = {}): ExecutionAgentPermissions {
  return { ...BASE, ...overrides };
}

test('命中 grant 且能力在清单内：授权通过', () => {
  const decision = authorizeCapability(policy(), {
    systemId: 'control-platform', agentId: 'gateway-control-platform', capability: 'reason_control_platform', tenantId: 'tenant-demo',
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'granted');
  assert.equal(decision.matchedGrant, true);
});

test('grant 存在但能力不在清单内：拒绝', () => {
  const decision = authorizeCapability(policy(), {
    systemId: 'control-platform', agentId: 'gateway-control-platform', capability: 'update_control_platform_order', tenantId: 'tenant-demo',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'capability_not_granted');
});

test('没有 grant：按 defaultPolicy 拒绝或放行', () => {
  const denied = authorizeCapability(policy(), {
    systemId: 'control-platform', agentId: 'unknown-agent', capability: 'query_control_platform', tenantId: 'tenant-demo',
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'no_grant');

  const allowed = authorizeCapability(policy({ defaultPolicy: 'allow' }), {
    systemId: 'control-platform', agentId: 'unknown-agent', capability: 'query_control_platform', tenantId: 'tenant-demo',
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, 'default_allow');
});

test('租户不匹配时不命中 grant', () => {
  const decision = authorizeCapability(policy(), {
    systemId: 'control-platform', agentId: 'gateway-control-platform', capability: 'reason_control_platform', tenantId: 'tenant-other',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.matchedGrant, false);
  assert.equal(decision.reason, 'no_grant');
});

test('tenantId=null 的 grant 对所有租户生效', () => {
  const shared = policy({
    grants: [{ systemId: 'control-platform', agentId: 'gateway-control-platform', tenantId: null, capabilities: ['reason_control_platform'] }],
  });
  const decision = authorizeCapability(shared, {
    systemId: 'control-platform', agentId: 'gateway-control-platform', capability: 'reason_control_platform', tenantId: 'tenant-other',
  });
  assert.equal(decision.allowed, true);
});

test('observe 模式仍然返回 allowed=false，由调用方决定只告警', () => {
  const decision = authorizeCapability(policy({ enforcement: 'observe' }), {
    systemId: 'control-platform', agentId: 'unknown-agent', capability: 'query_control_platform', tenantId: 'tenant-demo',
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.enforcement, 'observe');
});

test('grantedCapabilities 返回去重后的授权能力', () => {
  assert.deepEqual(
    grantedCapabilities(policy(), { systemId: 'control-platform', agentId: 'gateway-control-platform', tenantId: 'tenant-demo' }),
    ['query_control_platform', 'reason_control_platform'],
  );
  assert.deepEqual(grantedCapabilities(policy(), { systemId: 'control-platform', agentId: 'unknown', tenantId: 'tenant-demo' }), []);
});

test('配置按 mtime 热加载；损坏时回落 observe + deny', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-permissions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'permissions.json');
  writeFileSync(file, JSON.stringify(BASE));
  utimesSync(file, new Date('2026-10-26T06:00:00Z'), new Date('2026-10-26T06:00:00Z'));
  assert.equal(loadExecutionAgentPermissions(file).grants.length, 1);

  writeFileSync(file, JSON.stringify({ ...BASE, revision: 2, enforcement: 'observe' }));
  utimesSync(file, new Date('2026-10-26T06:05:00Z'), new Date('2026-10-26T06:05:00Z'));
  assert.equal(loadExecutionAgentPermissions(file).revision, 2);
  assert.equal(loadExecutionAgentPermissions(file).enforcement, 'observe');

  writeFileSync(file, '{ broken');
  utimesSync(file, new Date('2026-10-26T06:10:00Z'), new Date('2026-10-26T06:10:00Z'));
  const fallback = loadExecutionAgentPermissions(file);
  assert.equal(fallback.enforcement, 'observe');
  assert.equal(fallback.grants.length, 0);
});
