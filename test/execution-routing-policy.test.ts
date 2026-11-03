import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  findRoutingRule,
  loadExecutionRoutingPolicy,
  orderAgentsByPolicy,
  type ExecutionRoutingPolicy,
} from '../src/execution-routing-policy.ts';

const BASE: ExecutionRoutingPolicy = {
  version: 1,
  revision: 1,
  updatedAt: '2026-10-26T06:10:00.000Z',
  fallback: 'first-online',
  rules: [],
};

function policy(overrides: Partial<ExecutionRoutingPolicy> = {}): ExecutionRoutingPolicy {
  return { ...BASE, ...overrides };
}

const AGENTS = [{ agentId: 'a' }, { agentId: 'gw' }, { agentId: 'b' }];

test('规则内 Agent 按声明顺序优先，其余保持原顺序', () => {
  const rules = policy({ rules: [{ systemId: 'control-platform', capability: '*', agents: ['gw'] }] });
  assert.deepEqual(
    orderAgentsByPolicy(AGENTS, { systemId: 'control-platform', capability: 'reason_control_platform', policy: rules }).map((agent) => agent.agentId),
    ['gw', 'a', 'b'],
  );
});

test('精确规则优先于系统/能力通配规则', () => {
  const rules = policy({
    rules: [
      { systemId: 'control-platform', capability: '*', agents: ['gw'] },
      { systemId: 'control-platform', capability: 'reason_control_platform', agents: ['r1', 'r2'] },
      { systemId: '*', capability: '*', agents: ['global'] },
    ],
  });
  assert.deepEqual(findRoutingRule(rules, 'control-platform', 'reason_control_platform')?.agents, ['r1', 'r2']);
  assert.deepEqual(findRoutingRule(rules, 'other-system', 'query_x')?.agents, ['global']);
  assert.equal(findRoutingRule(rules, 'other-system', 'query_x')?.systemId, '*');
});

test('fallback=deny 时只返回规则内 Agent', () => {
  const rules = policy({ fallback: 'deny', rules: [{ systemId: 'control-platform', capability: '*', agents: ['gw'] }] });
  assert.deepEqual(
    orderAgentsByPolicy(AGENTS, { systemId: 'control-platform', capability: 'query_control_platform', policy: rules }).map((agent) => agent.agentId),
    ['gw'],
  );
});

test('无规则时保持原顺序，不改变旧行为', () => {
  assert.deepEqual(
    orderAgentsByPolicy(AGENTS, { systemId: 'control-platform', capability: 'query_control_platform', policy: policy() }).map((agent) => agent.agentId),
    ['a', 'gw', 'b'],
  );
});

test('配置按 mtime 热加载；损坏时回落默认值', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'routing-policy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'policy.json');
  writeFileSync(file, JSON.stringify({ ...BASE, rules: [{ systemId: 'control-platform', capability: '*', agents: ['gw'] }] }));
  utimesSync(file, new Date('2026-10-26T06:00:00Z'), new Date('2026-10-26T06:00:00Z'));
  assert.deepEqual(loadExecutionRoutingPolicy(file).rules[0]?.agents, ['gw']);

  writeFileSync(file, JSON.stringify({ ...BASE, revision: 2, rules: [{ systemId: 'control-platform', capability: '*', agents: ['b'] }] }));
  utimesSync(file, new Date('2026-10-26T06:05:00Z'), new Date('2026-10-26T06:05:00Z'));
  assert.equal(loadExecutionRoutingPolicy(file).revision, 2);
  assert.deepEqual(loadExecutionRoutingPolicy(file).rules[0]?.agents, ['b']);

  writeFileSync(file, '{ broken');
  utimesSync(file, new Date('2026-10-26T06:10:00Z'), new Date('2026-10-26T06:10:00Z'));
  assert.equal(loadExecutionRoutingPolicy(file).rules.length, 0);
});
