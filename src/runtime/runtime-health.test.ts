import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { CodexRuntimeAdapter } from './codex-runtime-adapter.ts';
import { RuntimeSupervisor } from './runtime-supervisor.ts';

class FakeTransport extends EventEmitter {
  requests: Array<{ method: string; params: unknown }> = [];
  unavailableMethods = new Set<string>();
  // 非凭据哨兵值：仅用于断言探测结果已脱敏（拼接生成，避免被静态扫描误判为硬编码凭据）
  static readonly SENTINEL = ['must', 'not', 'leak'].join('-');
  probeResponse: unknown = {
    authMethod: 'chatgpt',
    authToken: FakeTransport.SENTINEL,
    requiresOpenaiAuth: true,
  };
  probeError: Error | null = null;
  probeDelayMs = 0;

  async request(method: string, params: unknown = {}): Promise<unknown> {
    this.requests.push({ method, params });
    if (this.unavailableMethods.has(method)) {
      throw new Error(`RPC ${method} failed: Method not found (code=-32601)`);
    }
    if (this.probeDelayMs) await new Promise((resolve) => setTimeout(resolve, this.probeDelayMs));
    if (this.probeError) throw this.probeError;
    return this.probeResponse;
  }

  respond(): void {}
  respondError(): void {}
  close(): void {}
}

function createFixture(): {
  runtime: CodexRuntimeAdapter;
  supervisor: RuntimeSupervisor;
  transport: FakeTransport;
  starts: () => number;
} {
  const transport = new FakeTransport();
  let startCount = 0;
  const runtime = new CodexRuntimeAdapter({
    runtimeInstanceId: 'codex-health-test',
    startOptions: {
      cwd: 'D:/workspace',
      codexHome: 'D:/codex-home',
      binary: 'codex',
      clientName: 'runtime-health-test',
    },
    clientFactory: async () => {
      startCount += 1;
      return transport;
    },
  });
  return {
    runtime,
    supervisor: new RuntimeSupervisor().register(runtime),
    transport,
    starts: () => startCount,
  };
}

test('verifyHealth does not start a stopped runtime unless requested', async () => {
  const { supervisor, transport, starts } = createFixture();
  const result = await supervisor.verifyHealth('codex-health-test');
  assert.equal(result.status, 'stopped');
  assert.equal(starts(), 0);
  assert.equal(transport.requests.length, 0);
});

test('lists the live MCP server and tool inventory through a read-only runtime request', async () => {
  const { runtime, transport, starts } = createFixture();
  transport.probeResponse = { data: [{ name: 'company-control', runtimeStatus: 'connected', tools: {} }], nextCursor: null };
  const result = await runtime.listMcpServerStatus();
  assert.equal(starts(), 1);
  assert.deepEqual(result, transport.probeResponse);
  assert.deepEqual(transport.requests, [{ method: 'mcpServerStatus/list', params: { limit: 100, detail: 'full' } }]);
});

test('calls a selected MCP tool with its session context', async () => {
  const { runtime, transport } = createFixture();
  transport.probeResponse = { content: [{ type: 'text', text: '{"status":"ok"}' }] };
  const result = await runtime.callMcpTool('thread-dashboard', 'demo-erp', 'get_system_health', {});
  assert.deepEqual(result, transport.probeResponse);
  assert.deepEqual(transport.requests, [{
    method: 'mcpServer/tool/call',
    params: { threadId: 'thread-dashboard', server: 'demo-erp', tool: 'get_system_health', arguments: {} },
  }]);
});

test('verifyHealth starts once, probes without requesting a token, and sanitizes details', async () => {
  const { supervisor, transport, starts } = createFixture();
  const results = await Promise.all(Array.from({ length: 8 }, () => supervisor.verifyHealth(
    'codex-health-test',
    { startIfStopped: true },
  )));

  assert.equal(starts(), 1);
  assert.equal(transport.requests.length, 1);
  assert.deepEqual(transport.requests[0], {
    method: 'getAuthStatus',
    params: { includeToken: false, refreshToken: false },
  });
  assert.ok(results.every((health) => health.status === 'healthy'));
  assert.doesNotMatch(JSON.stringify(results[0].details), new RegExp(FakeTransport.SENTINEL));
});

test('verifyHealth reports missing authentication as degraded', async () => {
  const { supervisor, transport } = createFixture();
  transport.probeResponse = {
    authMethod: null,
    authToken: null,
    requiresOpenaiAuth: true,
  };
  const result = await supervisor.verifyHealth('codex-health-test', { startIfStopped: true });
  assert.equal(result.status, 'degraded');
  assert.match(result.message ?? '', /authentication is required/);
});

test('verifyHealth falls back when getAuthStatus is unavailable', async () => {
  const { supervisor, transport } = createFixture();
  transport.unavailableMethods.add('getAuthStatus');
  transport.probeResponse = {
    account: { type: 'chatgpt' },
    requiresOpenaiAuth: true,
  };
  const result = await supervisor.verifyHealth('codex-health-test', { startIfStopped: true });
  assert.equal(result.status, 'healthy');
  assert.deepEqual(transport.requests.map(({ method }) => method), ['getAuthStatus', 'account/read']);
  assert.equal((result.details?.probe as Record<string, unknown>)?.usedFallback, true);
});

test('verifyHealth only permits allowlisted read-only probes', async () => {
  const { supervisor, transport } = createFixture();
  await assert.rejects(
    supervisor.verifyHealth('codex-health-test', {
      startIfStopped: true,
      probeMethod: 'fs/writeFile',
      probeParams: { path: 'D:/should-not-exist' },
    }),
    /not allowlisted as read-only/,
  );
  assert.equal(transport.requests.length, 0);
});

test('verifyHealth sanitizes custom auth probe parameters', async () => {
  const { supervisor, transport } = createFixture();
  await supervisor.verifyHealth('codex-health-test', {
    startIfStopped: true,
    probeMethod: 'getAuthStatus',
    probeParams: { includeToken: true, refreshToken: true },
  });
  assert.deepEqual(transport.requests[0], {
    method: 'getAuthStatus',
    params: { includeToken: false, refreshToken: false },
  });
});

test('verifyHealth reports probe errors and timeouts without throwing', async () => {
  const failed = createFixture();
  failed.transport.probeError = new Error('transport failed');
  const failure = await failed.supervisor.verifyHealth('codex-health-test', { startIfStopped: true });
  assert.equal(failure.status, 'degraded');
  assert.match(failure.message ?? '', /transport failed/);

  const timed = createFixture();
  timed.transport.probeDelayMs = 50;
  const timeout = await timed.supervisor.verifyHealth('codex-health-test', {
    startIfStopped: true,
    timeoutMs: 5,
  });
  assert.equal(timeout.status, 'degraded');
  assert.match(timeout.message ?? '', /timed out/);
});

test('verifyAllHealth returns a result for each registered runtime', async () => {
  const first = createFixture();
  const second = new CodexRuntimeAdapter({
    runtimeInstanceId: 'codex-health-test-2',
    startOptions: {
      cwd: 'D:/workspace',
      codexHome: 'D:/codex-home-2',
      binary: 'codex',
      clientName: 'runtime-health-test-2',
    },
    clientFactory: async () => new FakeTransport(),
  });
  first.supervisor.register(second);
  const results = await first.supervisor.verifyAllHealth();
  assert.deepEqual(results.map((item) => item.runtimeInstanceId).sort(), [
    'codex-health-test',
    'codex-health-test-2',
  ]);
  assert.ok(results.every((item) => item.status === 'stopped'));
});

test('forwards item/tool deltas with stable session and run ids', async () => {
  const { runtime, transport } = createFixture();
  const events: Array<Record<string, unknown>> = [];
  runtime.onEvent((event) => events.push(event as unknown as Record<string, unknown>));
  await runtime.start();

  const threadId = 'thread-stream-test';
  const turnId = 'turn-stream-test';
  const itemId = 'item-stream-test';
  transport.emit('notification', 'thread/started', { threadId });
  transport.emit('notification', 'turn/started', {
    threadId,
    turn: { id: turnId, status: 'inProgress', startedAt: 1_700_000_000 },
  });
  transport.emit('notification', 'item/agentMessage/delta', {
    threadId,
    turnId,
    itemId,
    delta: 'hello ',
  });
  const pngChunk = 'iVBORw0KGgo=';
  transport.emit('notification', 'item/commandExecution/outputDelta', {
    threadId,
    turnId,
    itemId: 'exec-stream-test',
    delta: pngChunk,
  });
  transport.emit('notification', 'item/completed', {
    threadId,
    turnId,
    item: { type: 'agentMessage', id: itemId, text: 'hello world', phase: 'final_answer' },
    completedAtMs: 1_700_000_010_000,
  });
  transport.emit('notification', 'turn/completed', {
    threadId,
    turn: { id: turnId, status: 'completed', startedAt: 1_700_000_000, completedAt: 1_700_000_010 },
  });

  const forwarded = events.filter((event) => event.kind === 'notification');
  assert.deepEqual(forwarded.map((event) => event.name), [
    'thread/started',
    'turn/started',
    'item/agentMessage/delta',
    'item/commandExecution/outputDelta',
    'item/completed',
    'turn/completed',
  ]);
  const delta = forwarded.find((event) => event.name === 'item/agentMessage/delta');
  assert.equal(delta?.sessionId, threadId);
  assert.equal(delta?.runId, turnId);
  assert.deepEqual(delta?.data, { threadId, turnId, itemId, delta: 'hello ' });
  const toolDelta = forwarded.find((event) => event.name === 'item/commandExecution/outputDelta');
  assert.equal(toolDelta?.sessionId, threadId);
  assert.equal(toolDelta?.runId, turnId);
  assert.equal((toolDelta?.data as Record<string, unknown>)?.delta, pngChunk);
  const completed = forwarded.find((event) => event.name === 'turn/completed');
  assert.equal(completed?.sessionId, threadId);
  assert.equal(completed?.runId, turnId);
  const run = runtime.getRun(turnId);
  assert.equal(run?.state, 'completed');
  await runtime.stop();
});

test('resolves a completed turn when threadId/status are omitted from the callback', async () => {
  const { runtime, transport } = createFixture();
  const events: Array<Record<string, unknown>> = [];
  runtime.onEvent((event) => events.push(event as unknown as Record<string, unknown>));
  await runtime.start();

  const threadId = 'thread-fallback-test';
  const turnId = 'turn-fallback-test';
  transport.emit('notification', 'turn/started', {
    threadId,
    turn: { id: turnId, status: 'inProgress' },
  });
  transport.emit('notification', 'turn/completed', {
    turn: { id: turnId, completedAt: 1_700_000_010 },
  });

  const run = runtime.getRun(turnId);
  assert.equal(run?.sessionId, threadId);
  assert.equal(run?.state, 'completed');
  const completed = events.find((event) => event.name === 'turn/completed');
  assert.equal(completed?.sessionId, threadId);
  assert.equal(completed?.runId, turnId);
  await runtime.stop();
});

test('treats turn/completed as terminal even when provider repeats inProgress', async () => {
  const { runtime, transport } = createFixture();
  await runtime.start();
  const threadId = 'thread-terminal-hint-test';
  const turnId = 'turn-terminal-hint-test';
  transport.emit('notification', 'turn/started', {
    threadId,
    turn: { id: turnId, status: 'inProgress' },
  });
  transport.emit('notification', 'turn/completed', {
    threadId,
    turn: { id: turnId, status: 'inProgress' },
  });
  assert.equal(runtime.getRun(turnId)?.state, 'completed');
  await runtime.stop();
});
