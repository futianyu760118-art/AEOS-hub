import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionPlaneRegistry, ExecutionPlaneError } from '../src/execution-plane.ts';

interface Harness {
  registry: ExecutionPlaneRegistry;
  file: string;
  sent: unknown[];
  clock: { current: Date };
  agentId: string;
  cleanup: () => void;
}

function makeHarness(t: { after: (fn: () => void) => void }): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'execution-plane-'));
  const file = join(dir, 'execution-plane.json');
  const sent: unknown[] = [];
  const clock = { current: new Date('2026-10-14T00:00:00.000Z') };
  const registry = new ExecutionPlaneRegistry({
    file,
    heartbeatTimeoutMs: 15_000,
    clock: () => clock.current,
    idFactory: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
  });
  const agentId = 'agent-query-1';
  registry.onRegister(
    { agentId, name: '查询智能体', version: '1.0.0', capabilities: [{ name: 'query_control_platform', description: '中台只读查询' }] },
    (msg) => sent.push(msg),
  );
  return {
    registry,
    file,
    sent,
    clock,
    agentId,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('注册后 agent 在线并出现在 list 中', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const { agents } = h.registry.list();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].agentId, h.agentId);
  assert.equal(agents[0].connectionStatus, 'online');
  assert.equal(agents[0].runtimeStatus, 'idle');
});

test('注册校验：缺少 capabilities 抛 INVALID_ARGUMENT', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  assert.throws(
    () => h.registry.onRegister({ agentId: 'agent-x', name: 'x', version: '1', capabilities: undefined }, () => {}),
    (err: unknown) => err instanceof ExecutionPlaneError && err.code === 'INVALID_ARGUMENT',
  );
});

test('心跳刷新 lastSeenAt 与 runtimeStatus', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  h.clock.current = new Date('2026-10-14T00:00:10.000Z');
  h.registry.onHeartbeat(h.agentId, { status: 'working', currentRunId: 'r1' });
  const agent = h.registry.list().agents[0];
  assert.equal(agent.runtimeStatus, 'working');
  assert.equal(agent.currentRunId, 'r1');
  assert.equal(agent.lastSeenAt, '2026-10-14T00:00:10.000Z');
});

test('派单下发 dispatch 并创建 run', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const { runId } = h.registry.dispatch(h.agentId, 'query_control_platform', { path: '/external/material-kitting/shortages', params: { demand_no: 'X' } });
  assert.ok(runId.startsWith('exec-run-'));
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0], {
    type: 'dispatch',
    runId,
    capability: 'query_control_platform',
    input: { path: '/external/material-kitting/shortages', params: { demand_no: 'X' } },
  });
  const run = h.registry.list().runs.find((r) => r.runId === runId);
  assert.equal(run?.state, 'dispatched');
});

test('派单未知 agent 抛 AGENT_NOT_FOUND', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  assert.throws(
    () => h.registry.dispatch('agent-none', 'query_control_platform', {}),
    (err: unknown) => err instanceof ExecutionPlaneError && err.code === 'AGENT_NOT_FOUND',
  );
});

test('派单不支持的能力抛 CAPABILITY_UNSUPPORTED', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  assert.throws(
    () => h.registry.dispatch(h.agentId, 'other_capability', {}),
    (err: unknown) => err instanceof ExecutionPlaneError && err.code === 'CAPABILITY_UNSUPPORTED',
  );
});

test('结果回传：run_complete 完成并保存结果', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const { runId } = h.registry.dispatch(h.agentId, 'query_control_platform', {});
  h.registry.onRunUpdate(h.agentId, { runId });
  h.registry.onRunComplete(h.agentId, { runId, result: { rows: [{ demand_no: 'HJY1' }] } });
  const run = h.registry.list().runs.find((r) => r.runId === runId);
  assert.equal(run?.state, 'completed');
  assert.deepEqual(run?.result, { rows: [{ demand_no: 'HJY1' }] });
  assert.equal(h.registry.list().agents[0].runtimeStatus, 'idle');
});

test('失败回传：run_failed 记录错误', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const { runId } = h.registry.dispatch(h.agentId, 'query_control_platform', {});
  h.registry.onRunFailed(h.agentId, { runId, error: { code: 'UPSTREAM_UNAVAILABLE', message: '不可达' } });
  const run = h.registry.list().runs.find((r) => r.runId === runId);
  assert.equal(run?.state, 'failed');
  assert.equal(run?.error?.code, 'UPSTREAM_UNAVAILABLE');
});

test('召回：发送 recall 并把进行中的 run 标记 recalled', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const { runId } = h.registry.dispatch(h.agentId, 'query_control_platform', {});
  const result = h.registry.recall(h.agentId);
  assert.equal(result.recalled, true);
  assert.equal(result.runId, runId);
  const recallMsg = h.sent.find((m) => (m as { type: string }).type === 'recall');
  assert.deepEqual(recallMsg, { type: 'recall', runId });
  const run = h.registry.list().runs.find((r) => r.runId === runId);
  assert.equal(run?.state, 'recalled');
});

test('断连：agent 变离线', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  h.registry.disconnect(h.agentId);
  assert.equal(h.registry.list().agents[0].connectionStatus, 'offline');
  assert.throws(
    () => h.registry.dispatch(h.agentId, 'query_control_platform', {}),
    (err: unknown) => err instanceof ExecutionPlaneError && err.code === 'AGENT_OFFLINE',
  );
});

test('心跳超时判离线', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  h.clock.current = new Date('2026-10-14T00:00:30.000Z');
  const marked = h.registry.markStaleOffline();
  assert.equal(marked, 1);
  assert.equal(h.registry.list().agents[0].connectionStatus, 'offline');
});

test('重启后从持久化文件恢复为离线', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const registry2 = new ExecutionPlaneRegistry({ file: h.file, clock: () => new Date('2026-10-14T01:00:00.000Z') });
  const agent = registry2.list().agents.find((a) => a.agentId === h.agentId);
  assert.ok(agent);
  assert.equal(agent.connectionStatus, 'offline');
});
