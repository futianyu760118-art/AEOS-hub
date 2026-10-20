import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionPlaneRegistry, ExecutionPlaneError, isLoopbackExecutionPeer } from '../src/execution-plane.ts';
import type { UsageEventAppendInput } from '../src/usage-ledger-store.ts';

const QUERY_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', enum: ['/external/orders/list', '/external/material-kitting/shortages'] },
    params: { type: 'object' },
  },
  required: ['path'],
};

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
    {
      agentId,
      name: '查询智能体',
      version: '1.0.0',
      sourceSystem: '公司中控平台',
      capabilities: [{ name: 'query_control_platform', description: '中台只读查询', inputSchema: QUERY_SCHEMA, constraints: { readOnly: true } }],
    },
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
  assert.equal(agents[0].sourceSystem, '公司中控平台');
});

test('注册校验：来源系统不能为空', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  assert.throws(
    () => h.registry.onRegister({
      agentId: 'agent-source-empty', name: '查询智能体', version: '1.0.0', sourceSystem: ' ',
      capabilities: [{ name: 'query_control_platform', description: '中台只读查询' }],
    }, () => {}),
    (err: unknown) => err instanceof ExecutionPlaneError && err.code === 'INVALID_ARGUMENT' && /sourceSystem 不能为空/.test(err.message),
  );
});

test('注册校验：来源系统不能超过 160 字符', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  assert.throws(
    () => h.registry.onRegister({
      agentId: 'agent-source-long', name: '查询智能体', version: '1.0.0', sourceSystem: '系'.repeat(161),
      capabilities: [{ name: 'query_control_platform', description: '中台只读查询' }],
    }, () => {}),
    (err: unknown) => err instanceof ExecutionPlaneError && err.code === 'INVALID_ARGUMENT' && /sourceSystem 过长/.test(err.message),
  );
});

test('注册校验：缺少 capabilities 抛 INVALID_ARGUMENT', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  assert.throws(
    () => h.registry.onRegister({ agentId: 'agent-x', name: 'x', version: '1', capabilities: undefined }, () => {}),
    (err: unknown) => err instanceof ExecutionPlaneError && err.code === 'INVALID_ARGUMENT',
  );
});

test('回环连接地址会被识别为本机执行面', () => {
  assert.equal(isLoopbackExecutionPeer('127.0.0.1'), true);
  assert.equal(isLoopbackExecutionPeer('::1'), true);
  assert.equal(isLoopbackExecutionPeer('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackExecutionPeer('10.0.0.25'), false);
  assert.equal(isLoopbackExecutionPeer(undefined), false);
});

test('执行面注册仅信任连接对端地址判定本机身份', () => {
  const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  assert.match(server, /executionWss\.on\('connection', \(ws, request\) => \{[\s\S]{0,400}?const peerAddress = request\.socket\.remoteAddress;/);
  assert.match(server, /local: isLoopbackExecutionPeer\(peerAddress\),/);
  assert.doesNotMatch(server, /local:\s*msg\.local/);
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
  const { runId } = h.registry.dispatch(h.agentId, 'query_control_platform', { path: '/external/orders/list', params: {} });
  h.registry.onRunUpdate(h.agentId, { runId });
  h.registry.onRunComplete(h.agentId, { runId, result: { rows: [{ demand_no: 'HJY1' }] } });
  const run = h.registry.list().runs.find((r) => r.runId === runId);
  assert.equal(run?.state, 'completed');
  assert.deepEqual(run?.result, { rows: [{ demand_no: 'HJY1' }] });
  assert.equal(h.registry.list().agents[0].runtimeStatus, 'idle');
});

test('run_complete 携带 usage 时经 onUsageEvent 记账', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'execution-plane-usage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const usageEvents: UsageEventAppendInput[] = [];
  const registry = new ExecutionPlaneRegistry({
    file: join(dir, 'execution-plane.json'),
    clock: () => new Date('2026-10-14T00:00:00.000Z'),
    idFactory: (() => {
      let n = 0;
      return () => `id-${++n}`;
    })(),
    onUsageEvent: (event) => usageEvents.push(event),
  });
  registry.onRegister(
    {
      agentId: 'agent-query-1',
      name: '查询智能体',
      version: '1.0.0',
      sourceSystem: '公司中控平台',
      capabilities: [{ name: 'query_control_platform', description: '中台只读查询', inputSchema: QUERY_SCHEMA, constraints: { readOnly: true } }],
    },
    () => {},
  );
  const { runId } = registry.dispatch('agent-query-1', 'query_control_platform', { path: '/external/orders/list', params: {} });
  registry.onRunComplete('agent-query-1', {
    runId,
    result: { rows: [] },
    usage: { modelId: 'deepseek-chat', tokensIn: 120, tokensOut: 30, cost: 0.00018 },
  });
  assert.equal(usageEvents.length, 1);
  assert.equal(usageEvents[0].agentId, 'agent-query-1');
  assert.equal(usageEvents[0].systemId, '公司中控平台');
  assert.equal(usageEvents[0].modelId, 'deepseek-chat');
  assert.equal(usageEvents[0].runId, runId);
  assert.equal(usageEvents[0].tokensIn, 120);
  assert.equal(usageEvents[0].tokensOut, 30);
  assert.equal(usageEvents[0].cost, 0.00018);
});

test('注册身份来自认证上下文：规范 systemId 覆盖自报值并进入用量归属', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'execution-plane-identity-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const usageEvents: UsageEventAppendInput[] = [];
  const registry = new ExecutionPlaneRegistry({
    file: join(dir, 'execution-plane.json'),
    clock: () => new Date('2026-10-14T00:00:00.000Z'),
    idFactory: (() => { let n = 0; return () => `id-${++n}`; })(),
    onUsageEvent: (event) => usageEvents.push(event),
  });
  registry.onRegister(
    {
      agentId: 'agent-query-identity',
      name: '查询智能体',
      version: '1.0.0',
      sourceSystem: '冒用其他系统',
      capabilities: [{ name: 'query_control_platform', description: '中台只读查询', inputSchema: QUERY_SCHEMA, constraints: { readOnly: true } }],
    },
    () => {},
    {
      authMode: 'system-token',
      systemId: 'control-platform',
      sourceSystem: 'control-platform',
      sourceSystemName: '公司中控平台',
      legacyUnresolved: false,
    },
  );

  const agent = registry.list().agents.find((item) => item.agentId === 'agent-query-identity');
  assert.equal(agent?.systemId, 'control-platform');
  assert.equal(agent?.sourceSystem, 'control-platform');
  assert.equal(agent?.sourceSystemName, '公司中控平台');
  assert.equal(agent?.authMode, 'system-token');

  const { runId } = registry.dispatch('agent-query-identity', 'query_control_platform', { path: '/external/orders/list', params: {} });
  registry.onRunComplete('agent-query-identity', { runId, result: { rows: [] } });
  assert.equal(usageEvents[0]?.systemId, 'control-platform');
});

test('未提供认证上下文时保持 legacy 自报口径', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const agent = h.registry.list().agents[0];
  assert.equal(agent?.systemId, null);
  assert.equal(agent?.authMode, 'legacy-root');
  assert.equal(agent?.sourceSystemName, '公司中控平台');
});

test('模拟器注册被标记 simulated，供目录排除', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  h.registry.onRegister({
    agentId: 'agent-simulated',
    name: '模拟执行面',
    version: '1.0.0',
    sourceSystem: '公司中控平台',
    simulated: true,
    capabilities: [{ name: 'query_control_platform', description: '模拟查询', constraints: { readOnly: true } }],
  }, () => {});
  assert.equal(h.registry.list().agents.find((agent) => agent.agentId === 'agent-simulated')?.simulated, true);
  assert.equal(h.registry.list().agents.find((agent) => agent.agentId === h.agentId)?.simulated, false);
});

test('失败回传：run_failed 记录错误', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const { runId } = h.registry.dispatch(h.agentId, 'query_control_platform', { path: '/external/orders/list', params: {} });
  h.registry.onRunFailed(h.agentId, { runId, error: { code: 'UPSTREAM_UNAVAILABLE', message: '不可达' } });
  const run = h.registry.list().runs.find((r) => r.runId === runId);
  assert.equal(run?.state, 'failed');
  assert.equal(run?.error?.code, 'UPSTREAM_UNAVAILABLE');
});

test('召回：发送 recall 并把进行中的 run 标记 recalled', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  const { runId } = h.registry.dispatch(h.agentId, 'query_control_platform', { path: '/external/orders/list', params: {} });
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
    () => h.registry.dispatch(h.agentId, 'query_control_platform', { path: '/external/orders/list', params: {} }),
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

test('历史执行面记录缺少来源系统时标记待补充', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  writeFileSync(h.file, JSON.stringify({
    agents: [{
      agentId: 'legacy-agent', name: '旧查询智能体', version: '0.9.0',
      capabilities: [{ name: 'query_control_platform', description: '旧能力' }],
      connectionStatus: 'online', runtimeStatus: 'working', lastSeenAt: '2026-10-14T00:00:00.000Z',
      currentRunId: 'legacy-run', registeredAt: '2026-10-14T00:00:00.000Z',
    }],
    runs: [],
  }), 'utf8');
  const reloaded = new ExecutionPlaneRegistry({ file: h.file });
  const agent = reloaded.list().agents.find((item) => item.agentId === 'legacy-agent');
  assert.equal(agent?.sourceSystem, '历史记录（来源待补充）');
  assert.equal(agent?.local, false);
  assert.equal(agent?.connectionStatus, 'offline');
});

test('拒绝不支持的协议版本', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  assert.throws(
    () => h.registry.onRegister({ agentId: 'agent-x', name: 'x', version: '1', sourceSystem: 's', protocolVersion: '99.0', capabilities: [{ name: 'query_control_platform', description: '' }] }, () => {}),
    (err: unknown) => err instanceof ExecutionPlaneError && err.code === 'PROTOCOL_VERSION_UNSUPPORTED',
  );
});

test('派单拒绝白名单外的查询 path', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  assert.throws(
    () => h.registry.dispatch(h.agentId, 'query_control_platform', { path: '/external/orders/delete', params: {} }),
    (err: unknown) => err instanceof ExecutionPlaneError && err.code === 'INVALID_ARGUMENT',
  );
});

test('派单未声明只读的能力抛 WRITE_FORBIDDEN', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  h.registry.onRegister(
    { agentId: 'write-agent', name: '写操作智能体', version: '1', sourceSystem: 's', capabilities: [{ name: 'write_capability', description: '未声明只读' }] },
    () => {},
  );
  assert.throws(
    () => h.registry.dispatch('write-agent', 'write_capability', {}),
    (err: unknown) => err instanceof ExecutionPlaneError && err.code === 'WRITE_FORBIDDEN',
  );
});

test('推理结果缺少 evidence_refs 标记低置信度', (t) => {
  const h = makeHarness(t);
  t.after(h.cleanup);
  h.registry.onRegister(
    {
      agentId: 'reason-agent',
      name: '推理智能体',
      version: '1',
      sourceSystem: 's',
      capabilities: [{
        name: 'reason_control_platform',
        description: '中台推理',
        inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, task_type: { type: 'string' } }, required: ['prompt', 'task_type'] },
        outputSchema: { type: 'object', properties: { conclusions: { type: 'array', items: { type: 'object', properties: { evidence_refs: { type: 'array', minItems: 1 } }, required: ['evidence_refs'] } } } },
        constraints: { readOnly: true, requireEvidence: true },
      }],
    },
    () => {},
  );
  const { runId } = h.registry.dispatch('reason-agent', 'reason_control_platform', { prompt: '分析订单', task_type: 'order_delivery_analysis', constraints: { read_only: true, require_evidence: true } });
  h.registry.onRunComplete('reason-agent', { runId, result: { summary: 's', conclusions: [{ matter: 'x', evidence_refs: [] }] } });
  const run = h.registry.list().runs.find((r) => r.runId === runId);
  assert.equal(run?.state, 'completed');
  assert.equal((run?.result as { data_confidence?: string }).data_confidence, 'low');
  assert.ok((run?.result as { validation_note?: string }).validation_note);
});
