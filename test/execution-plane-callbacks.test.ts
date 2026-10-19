import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ExecutionPlaneRegistry,
  type AgentOfflineEvent,
  type ExecutionRunStateEvent,
} from '../src/execution-plane.ts';
import type { UsageEventAppendInput } from '../src/usage-ledger-store.ts';

const CAPABILITIES = [{
  name: 'query_control_platform',
  description: '只读查询',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  constraints: { readOnly: true },
}];

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'execution-callbacks-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const events: Array<{ kind: 'state' | 'usage' | 'offline'; value: unknown }> = [];
  const clock = { current: new Date('2026-10-19T09:00:00.000Z') };
  const registry = new ExecutionPlaneRegistry({
    file: join(dir, 'execution-plane.json'),
    heartbeatTimeoutMs: 15_000,
    clock: () => clock.current,
    idFactory: (() => { let n = 0; return () => `cb-${++n}`; })(),
    onRunStateChange: (event: ExecutionRunStateEvent) => events.push({ kind: 'state', value: event }),
    onUsageEvent: (event: UsageEventAppendInput) => events.push({ kind: 'usage', value: event }),
    onAgentOffline: (event: AgentOfflineEvent) => events.push({ kind: 'offline', value: event }),
  });
  registry.onRegister({
    agentId: 'agent-1',
    name: '查询智能体',
    version: '1.0.0',
    sourceSystem: '公司中控平台',
    capabilities: CAPABILITIES,
  }, () => {});
  return { registry, events, clock };
}

function dispatch(registry: ExecutionPlaneRegistry): string {
  return registry.dispatch('agent-1', 'query_control_platform', { path: '/external/orders/list' }).runId;
}

test('getRun 返回执行记录', (t) => {
  const { registry } = fixture(t);
  const runId = dispatch(registry);
  assert.equal(registry.getRun(runId)?.runId, runId);
  assert.equal(registry.getRun('missing'), undefined);
});

test('update/complete 触发状态回调，且状态回调先于用量回调', (t) => {
  const { registry, events } = fixture(t);
  const runId = dispatch(registry);
  registry.onRunUpdate('agent-1', { runId, state: 'running' });
  registry.onRunComplete('agent-1', { runId, result: { ok: true }, usage: { modelId: 'deepseek-flash', tokensIn: 10, tokensOut: 2, cost: 0.001 } });
  const kinds = events.map((event) => event.kind);
  assert.deepEqual(kinds, ['state', 'state', 'usage']);
  const states = events.filter((event) => event.kind === 'state').map((event) => (event.value as ExecutionRunStateEvent).state);
  assert.deepEqual(states, ['running', 'completed']);
  assert.deepEqual((events[2].value as UsageEventAppendInput).runId, runId);
});

test('failed/recall 触发对应状态', (t) => {
  const { registry, events } = fixture(t);
  const runId = dispatch(registry);
  registry.onRunFailed('agent-1', { runId, error: { code: 'BOOM', message: '失败' } });
  const failed = events.filter((event) => event.kind === 'state').map((event) => (event.value as ExecutionRunStateEvent).state);
  assert.deepEqual(failed, ['failed']);

  const second = dispatch(registry);
  registry.recall('agent-1');
  const states = events.filter((event) => event.kind === 'state').map((event) => (event.value as ExecutionRunStateEvent).runId);
  assert.ok(states.includes(second));
  assert.equal(registry.getRun(second)?.state, 'recalled');
});

test('disconnect 与 deregister 触发离线回调并带出未完成 runId', (t) => {
  const { registry, events } = fixture(t);
  const runId = dispatch(registry);
  registry.disconnect('agent-1');
  const offline = events.filter((event) => event.kind === 'offline').map((event) => event.value as AgentOfflineEvent);
  assert.deepEqual(offline, [{ agentId: 'agent-1', runId }]);

  registry.onRegister({
    agentId: 'agent-1', name: '查询智能体', version: '1.0.0', sourceSystem: '公司中控平台', capabilities: CAPABILITIES,
  }, () => {});
  const secondRun = dispatch(registry);
  registry.deregister('agent-1', '公司中控平台');
  const all = events.filter((event) => event.kind === 'offline').map((event) => event.value as AgentOfflineEvent);
  assert.deepEqual(all[all.length - 1], { agentId: 'agent-1', runId: secondRun });
});

test('心跳超时触发离线回调', (t) => {
  const { registry, events, clock } = fixture(t);
  const runId = dispatch(registry);
  clock.current = new Date('2026-10-19T09:01:00.000Z');
  assert.equal(registry.markStaleOffline(), 1);
  const offline = events.filter((event) => event.kind === 'offline').map((event) => event.value as AgentOfflineEvent);
  assert.deepEqual(offline, [{ agentId: 'agent-1', runId }]);
});

test('回调抛异常不影响执行面状态机', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'execution-callbacks-throw-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const registry = new ExecutionPlaneRegistry({
    file: join(dir, 'execution-plane.json'),
    onRunStateChange: () => { throw new Error('subscriber boom'); },
    onAgentOffline: () => { throw new Error('subscriber boom'); },
  });
  registry.onRegister({ agentId: 'agent-1', name: 'x', version: '1', sourceSystem: 's', capabilities: CAPABILITIES }, () => {});
  const runId = dispatch(registry);
  assert.doesNotThrow(() => registry.onRunComplete('agent-1', { runId, result: {} }));
  assert.equal(registry.getRun(runId)?.state, 'completed');
});
