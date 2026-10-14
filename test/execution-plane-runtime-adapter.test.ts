import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionPlaneRegistry } from '../src/execution-plane.ts';
import { ExecutionPlaneRuntimeAdapter } from '../src/execution-plane-runtime-adapter.ts';

interface Harness {
  registry: ExecutionPlaneRegistry;
  adapter: ExecutionPlaneRuntimeAdapter;
  clock: { current: Date };
  cleanup: () => void;
}

function makeHarness(t: { after: (fn: () => void) => void }): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'exec-adapter-'));
  const clock = { current: new Date('2026-10-14T00:00:00.000Z') };
  const registry = new ExecutionPlaneRegistry({ file: join(dir, 'execution-plane.json'), clock: () => clock.current });
  const agentId = 'runtime-execution-query';
  registry.onRegister(
    { agentId, name: '查询智能体', version: '1.0.0', capabilities: [{ name: 'query_control_platform', description: '中台只读查询' }] },
    () => {},
  );
  const adapter = new ExecutionPlaneRuntimeAdapter(registry, agentId, () => clock.current);
  return { registry, adapter, clock, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function dispatchInput(): string {
  return JSON.stringify({
    capability: 'query_control_platform',
    input: { path: '/external/material-kitting/results', params: { demand_no: 'HJY1' } },
  });
}

test('startRun 用合法 JSON 派单并返回 running run', async (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const session = await h.adapter.createSession({ developerInstructions: 'x' });
  const run = await h.adapter.startRun(session.id, { input: dispatchInput() });
  assert.equal(run.state, 'running');
  assert.ok(run.id.startsWith('exec-run-'));
});

test('waitForRun 在 run_complete 后返回 completed', async (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const session = await h.adapter.createSession();
  const run = await h.adapter.startRun(session.id, { input: dispatchInput() });
  h.registry.onRunComplete('runtime-execution-query', { runId: run.id, result: { items: [{ demand_no: 'HJY1' }] } });
  const final = await h.adapter.waitForRun(run.id);
  assert.equal(final.state, 'completed');
});

test('waitForRun 在 run_failed 后返回 failed', async (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const session = await h.adapter.createSession();
  const run = await h.adapter.startRun(session.id, { input: dispatchInput() });
  h.registry.onRunFailed('runtime-execution-query', { runId: run.id, error: { code: 'UPSTREAM_UNAVAILABLE', message: '不可达' } });
  const final = await h.adapter.waitForRun(run.id);
  assert.equal(final.state, 'failed');
  assert.equal(final.failure?.code, 'UPSTREAM_UNAVAILABLE');
});

test('waitForRun 在召回后返回 interrupted', async (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const session = await h.adapter.createSession();
  const run = await h.adapter.startRun(session.id, { input: dispatchInput() });
  h.registry.recall('runtime-execution-query');
  const final = await h.adapter.waitForRun(run.id);
  assert.equal(final.state, 'interrupted');
});

test('startRun 非法 JSON 直接返回 failed run', async (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const session = await h.adapter.createSession();
  const run = await h.adapter.startRun(session.id, { input: 'not-json' });
  assert.equal(run.state, 'failed');
  assert.equal(run.failure?.code, 'INVALID_ARGUMENT');
});

test('startRun 缺少 capability 直接返回 failed run', async (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const session = await h.adapter.createSession();
  const run = await h.adapter.startRun(session.id, { input: JSON.stringify({ input: { path: '/x' } }) });
  assert.equal(run.state, 'failed');
  assert.equal(run.failure?.code, 'INVALID_ARGUMENT');
});

test('startRun 执行面离线返回 failed run（AGENT_OFFLINE）', async (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  h.registry.disconnect('runtime-execution-query');
  const session = await h.adapter.createSession();
  const run = await h.adapter.startRun(session.id, { input: dispatchInput() });
  assert.equal(run.state, 'failed');
  assert.equal(run.failure?.code, 'AGENT_OFFLINE');
});

test('getHealth 反映执行面在线状态', async (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  assert.equal((await h.adapter.getHealth()).status, 'healthy');
  h.registry.disconnect('runtime-execution-query');
  assert.equal((await h.adapter.getHealth()).status, 'unhealthy');
});
