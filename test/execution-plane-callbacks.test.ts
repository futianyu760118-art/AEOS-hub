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
}, {
  name: 'reason_control_platform',
  description: '只读推理',
  inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
  constraints: { readOnly: true },
}];

function fixture(
  t: { after: (fn: () => void) => void },
  options: {
    dispatchTimeoutMs?: number;
    queryTimeoutMs?: number;
    reasoningTimeoutMs?: number;
    idleReconcileGraceMs?: number;
  } = {},
) {
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
    ...options,
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

test('派单后超过 dispatchTimeoutMs 无响应，标记 DISPATCH_TIMEOUT', (t) => {
  const { registry, events, clock } = fixture(t, { dispatchTimeoutMs: 1_000 });
  const runId = dispatch(registry);
  clock.current = new Date('2026-10-19T09:00:02.000Z');
  assert.equal(registry.markRunTimeouts(), 1);
  const run = registry.getRun(runId);
  assert.equal(run?.state, 'failed');
  assert.equal(run?.error?.code, 'DISPATCH_TIMEOUT');
  assert.equal(registry.list().agents[0].runtimeStatus, 'error');
  const states = events.filter((event) => event.kind === 'state').map((event) => (event.value as ExecutionRunStateEvent).state);
  assert.deepEqual(states, ['failed']);
});

test('推理 run 在 dispatched 状态使用推理超时，不被 30s 派单超时误杀', (t) => {
  const { registry, clock } = fixture(t, { dispatchTimeoutMs: 1_000, reasoningTimeoutMs: 240_000 });
  const runId = registry.dispatch('agent-1', 'reason_control_platform', { prompt: '分析订单' }).runId;
  clock.current = new Date('2026-10-19T09:00:31.000Z');
  assert.equal(registry.markRunTimeouts(), 0);
  clock.current = new Date('2026-10-19T09:04:01.000Z');
  assert.equal(registry.markRunTimeouts(), 1);
  assert.equal(registry.getRun(runId)?.error?.code, 'DISPATCH_TIMEOUT');
});

test('执行中超过 queryTimeoutMs，标记 RUN_TIMEOUT', (t) => {
  const { registry, clock } = fixture(t, { queryTimeoutMs: 1_000 });
  const runId = dispatch(registry);
  registry.onRunUpdate('agent-1', { runId, state: 'running' });
  clock.current = new Date('2026-10-19T09:00:02.000Z');
  assert.equal(registry.markRunTimeouts(), 1);
  const run = registry.getRun(runId);
  assert.equal(run?.state, 'failed');
  assert.equal(run?.error?.code, 'RUN_TIMEOUT');
});

test('超时后迟到的 run_complete 不得覆盖 failed/不得重复记账', (t) => {
  const { registry, events, clock } = fixture(t, { dispatchTimeoutMs: 1_000 });
  const runId = dispatch(registry);
  clock.current = new Date('2026-10-19T09:00:02.000Z');
  assert.equal(registry.markRunTimeouts(), 1);
  registry.onRunComplete('agent-1', { runId, result: { late: true }, usage: { modelId: 'x', tokensIn: 1, tokensOut: 1 } });
  assert.equal(registry.getRun(runId)?.state, 'failed');
  assert.equal(events.filter((event) => event.kind === 'usage').length, 0);
  assert.equal(events.filter((event) => event.kind === 'state').length, 1);
});

test('已完成的 run 不会被超时扫描误杀', (t) => {
  const { registry, clock } = fixture(t, { dispatchTimeoutMs: 1_000 });
  const runId = dispatch(registry);
  registry.onRunComplete('agent-1', { runId, result: { ok: true } });
  clock.current = new Date('2026-10-19T09:00:02.000Z');
  assert.equal(registry.markRunTimeouts(), 0);
  assert.equal(registry.getRun(runId)?.state, 'completed');
});

test('Agent 空闲超过宽限期，回收未回写的 run', (t) => {
  const { registry, clock } = fixture(t, { idleReconcileGraceMs: 1_000 });
  const runId = dispatch(registry);
  registry.onHeartbeat('agent-1', { status: 'idle', currentRunId: null });
  clock.current = new Date('2026-10-19T09:00:02.000Z');
  assert.equal(registry.reconcileIdleRuns(), 1);
  const run = registry.getRun(runId);
  assert.equal(run?.state, 'failed');
  assert.equal(run?.error?.code, 'ORPHANED_AGENT_IDLE');
});

test('Agent 仍在 working 时不回收', (t) => {
  const { registry, clock } = fixture(t, { idleReconcileGraceMs: 1_000 });
  const runId = dispatch(registry);
  registry.onHeartbeat('agent-1', { status: 'working', currentRunId: runId });
  clock.current = new Date('2026-10-19T09:00:02.000Z');
  assert.equal(registry.reconcileIdleRuns(), 0);
  assert.equal(registry.getRun(runId)?.state, 'dispatched');
});

test('Agent 离线超过宽限期，回收未回写的 run', (t) => {
  const { registry, clock } = fixture(t, { idleReconcileGraceMs: 1_000 });
  const runId = dispatch(registry);
  registry.disconnect('agent-1');
  clock.current = new Date('2026-10-19T09:00:02.000Z');
  assert.equal(registry.reconcileIdleRuns(), 1);
  const run = registry.getRun(runId);
  assert.equal(run?.state, 'failed');
  assert.equal(run?.error?.code, 'ORPHANED_AGENT_OFFLINE');
});

test('宽限期内不回收，避免与正常派单竞争', (t) => {
  const { registry, clock } = fixture(t, { idleReconcileGraceMs: 1_000 });
  const runId = dispatch(registry);
  clock.current = new Date('2026-10-19T09:00:00.500Z');
  assert.equal(registry.reconcileIdleRuns(), 0);
  assert.equal(registry.getRun(runId)?.state, 'dispatched');
});

