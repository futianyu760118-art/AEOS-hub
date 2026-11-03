import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerCapability, capabilityHandlers, capabilityDefinitions } from '../src/capabilities.js';
import { loadConfig, loadGatewayConfig } from '../src/config.js';
import { registerControlPlatformCapabilities } from '../src/control-platform-capabilities.js';
import { buildConnectionHeaders, ExecutionAgentCore } from '../src/agent-core.js';
import { createHttpQueryAdapter } from '../src/adapters/query-adapter.js';
import { createCompanyControlQueryAdapter, COMPANY_CONTROL_PATHS, COMPANY_CONTROL_QUERY_INTENT } from '../src/adapters/company-control-query.js';
import { createReasoningAdapter } from '../src/adapters/reasoning-adapter.js';

test('能力插件化注册并返回处理器与自描述定义', () => {
  registerCapability({ name: 'query_x', description: '查询 X', inputSchema: { type: 'object' }, constraints: { readOnly: true }, handler: async () => ({}) });
  const handlers = capabilityHandlers();
  assert.equal(typeof handlers.query_x, 'function');
  const definitions = capabilityDefinitions();
  assert.ok(definitions.some((c) => c.name === 'query_x' && c.description === '查询 X' && c.inputSchema?.type === 'object' && c.constraints?.readOnly === true));
});

test('能力注册缺 handler 抛错', () => {
  assert.throws(() => registerCapability({ name: 'bad' }), /handler/);
});

test('配置从环境变量读取，缺少必填项抛错', () => {
  assert.throws(() => loadConfig({}), /EXECUTION_WS_URL/);
  const config = loadConfig({
    EXECUTION_WS_URL: 'wss://h/execution-agent',
    EXECUTION_PLANE_TOKEN: 'tok',
    EXECUTION_AGENT_ID: 'agent-1',
    EXECUTION_SOURCE_SYSTEM: '系统A',
    TARGET_QUERY_BASE_URL: 'https://x/api/v1',
    TARGET_QUERY_APP_KEY: 'k',
    TARGET_QUERY_APP_SECRET: 's',
  });
  assert.equal(config.agentId, 'agent-1');
  assert.equal(config.protocolVersion, '1.0');
  assert.equal(config.authMode, 'legacy-root');
});

test('配置支持每系统令牌，且优先于 legacy 根令牌', () => {
  const config = loadConfig({
    EXECUTION_WS_URL: 'wss://h/execution-agent',
    EXECUTION_SYSTEM_ID: 'control-platform',
    EXECUTION_SYSTEM_TOKEN: 'system-token',
    EXECUTION_PLANE_TOKEN: 'legacy-token',
    EXECUTION_AGENT_ID: 'agent-1',
    EXECUTION_SOURCE_SYSTEM: '公司中控平台',
    TARGET_QUERY_BASE_URL: 'https://x/api/v1',
    TARGET_QUERY_APP_KEY: 'k',
    TARGET_QUERY_APP_SECRET: 's',
  });
  assert.equal(config.authMode, 'system-token');
  assert.deepEqual(buildConnectionHeaders(config), {
    'x-aeos-system-id': 'control-platform',
    'x-aeos-system-token': 'system-token',
  });
});

test('系统令牌只提供一半时拒绝启动', () => {
  const base = {
    EXECUTION_WS_URL: 'wss://h/execution-agent',
    EXECUTION_AGENT_ID: 'agent-1',
    EXECUTION_SOURCE_SYSTEM: '系统A',
    TARGET_QUERY_BASE_URL: 'https://x/api/v1',
    TARGET_QUERY_APP_KEY: 'k',
    TARGET_QUERY_APP_SECRET: 's',
  };
  assert.throws(() => loadConfig({ ...base, EXECUTION_SYSTEM_ID: 'control-platform' }), /必须同时提供/);
  assert.throws(() => loadConfig({ ...base, EXECUTION_SYSTEM_TOKEN: 'token' }), /必须同时提供/);
});

test('未配置系统令牌时保留 legacy 连接头', () => {
  assert.deepEqual(buildConnectionHeaders({ token: 'legacy-token' }), {
    'x-aeos-execution-token': 'legacy-token',
  });
});

test('网关配置默认身份、角色和版本，并要求系统令牌', () => {
  const config = loadGatewayConfig({
    EXECUTION_WS_URL: 'wss://h/execution-agent',
    EXECUTION_SYSTEM_ID: 'control-platform',
    EXECUTION_SYSTEM_TOKEN: 'system-token',
    TARGET_QUERY_BASE_URL: 'https://x/api/v1',
    TARGET_QUERY_APP_KEY: 'k',
    TARGET_QUERY_APP_SECRET: 's',
  });
  assert.equal(config.agentId, 'gateway-control-platform');
  assert.equal(config.agentName, '公司中控平台网关');
  assert.equal(config.sourceSystem, 'control-platform');
  assert.equal(config.agentKind, 'system-gateway');
  assert.equal(config.gatewayVersion, '1.0.0');
});

test('网关 register 消息带 kind 与 gatewayVersion，直连模式不带', () => {
  const sent = [];
  const gateway = new ExecutionAgentCore({
    agentId: 'gateway-control-platform',
    name: '公司中控平台网关',
    version: '1.0.0',
    protocolVersion: '1.0',
    sourceSystem: 'control-platform',
    agentKind: 'system-gateway',
    gatewayVersion: '1.0.0',
    capabilities: [],
  }, {}, () => {});
  gateway.send = (message) => sent.push(message);
  gateway.register();
  assert.equal(sent[0].kind, 'system-gateway');
  assert.equal(sent[0].gatewayVersion, '1.0.0');

  const direct = new ExecutionAgentCore({
    agentId: 'runtime-control-platform-query',
    name: '直连执行体',
    version: '1.0.0',
    protocolVersion: '1.0',
    sourceSystem: 'control-platform',
    capabilities: [],
  }, {}, () => {});
  direct.send = (message) => sent.push(message);
  direct.register();
  assert.equal(sent[1].kind, undefined);
  assert.equal(sent[1].gatewayVersion, undefined);
});

test('中台网关注册查询与推理两条能力', () => {
  registerControlPlatformCapabilities({
    targetQueryBaseUrl: 'https://x/api/v1',
    targetQueryAppKey: 'k',
    targetQueryAppSecret: 's',
    targetReasoningUrl: '',
    targetReasoningAgentId: '',
    targetReasoningToken: '',
  });
  const names = capabilityDefinitions().map((capability) => capability.name);
  assert.ok(names.includes('query_control_platform'));
  assert.ok(names.includes('reason_control_platform'));
  const reason = capabilityDefinitions().find((capability) => capability.name === 'reason_control_platform');
  assert.deepEqual(reason.inputSchema.required, ['prompt', 'task_type', 'context']);
  assert.deepEqual(reason.inputSchema.properties.context.required, ['businessObjectRef']);
});

test('中台查询适配器拒绝白名单外 path 与缺 path', async () => {
  const query = createCompanyControlQueryAdapter({ baseUrl: 'https://x/api/v1', appKey: 'k', appSecret: 's' });
  await assert.rejects(() => query({ path: '', params: {} }, undefined), /缺少 path/);
  await assert.rejects(() => query({ path: '/external/orders/delete', params: {} }, undefined), /白名单/);
});

test('通用查询适配器按配置的端点白名单拒绝（可插拔）', async () => {
  const query = createHttpQueryAdapter({ baseUrl: 'https://x', endpoints: { '/allowed': true }, auth: { type: 'bearer', token: 't' } });
  await assert.rejects(() => query({ path: '/not-allowed', params: {} }, undefined), /白名单/);
});

test('中台端点表包含 18 个只读端点', () => {
  assert.equal(COMPANY_CONTROL_PATHS.length, 18);
});

test('中台查询语义 intent 覆盖 8 类自然语言查询', () => {
  assert.equal(COMPANY_CONTROL_QUERY_INTENT.paths.length, 8);
  assert.ok(COMPANY_CONTROL_QUERY_INTENT.paths.every((p) => typeof p.path === 'string' && typeof p.label === 'string'));
});

test('推理适配器返回结构正确且明确未接通（不伪造）', async () => {
  const reason = createReasoningAdapter({});
  const result = await reason({ prompt: '分析订单', task_type: 'order_delivery_analysis', constraints: { read_only: true, require_evidence: true } });
  assert.equal(typeof result.summary, 'string');
  assert.match(result.summary, /未接通/);
  assert.equal(result.data_confidence, 'low');
  assert.ok(Array.isArray(result.conclusions) && result.conclusions.length > 0);
  assert.ok(Array.isArray(result.conclusions[0].evidence_refs) && result.conclusions[0].evidence_refs.length > 0);
});

test('心跳携带当前 runId，空闲时显式清空', () => {
  const sent = [];
  const core = new ExecutionAgentCore({}, {}, () => {});
  core.send = (message) => sent.push(message);
  core.activeRun = { runId: 'run-1', ctx: { aborted: false } };
  core.heartbeat();
  assert.deepEqual(sent[0], { type: 'heartbeat', status: 'working', currentRunId: 'run-1' });
  core.activeRun = null;
  core.heartbeat();
  assert.deepEqual(sent[1], { type: 'heartbeat', status: 'idle', currentRunId: null });
});

test('handler 完成后发送 run_complete 并释放 activeRun', async () => {
  const sent = [];
  const core = new ExecutionAgentCore({}, { query_x: async () => ({ ok: true }) }, () => {});
  core.send = (message) => sent.push(message);
  core.handleMessage(JSON.stringify({ type: 'dispatch', runId: 'run-ok', capability: 'query_x', input: {}, timeoutMs: 100 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(core.activeRun, null);
  assert.deepEqual(sent.find((message) => message.type === 'run_complete'), {
    type: 'run_complete',
    runId: 'run-ok',
    result: { ok: true },
  });
  core.heartbeat();
  assert.deepEqual(sent[sent.length - 1], { type: 'heartbeat', status: 'idle', currentRunId: null });
});

test('handler 用 sendComplete 携带 usage 时，run_complete 带上用量且不重复发送', async () => {
  const sent = [];
  const core = new ExecutionAgentCore({}, {
    reason_x: async (_input, ctx) => {
      ctx.sendComplete({ summary: '已分析' }, { modelId: 'deepseek-flash', tokensIn: 10, cachedTokens: 2, tokensOut: 5, cost: 0 });
      return { summary: '迟到的返回' };
    },
  }, () => {});
  core.send = (message) => sent.push(message);
  core.handleMessage(JSON.stringify({ type: 'dispatch', runId: 'run-usage', capability: 'reason_x', input: {}, timeoutMs: 100 }));
  await new Promise((resolve) => setTimeout(resolve, 20));

  const completes = sent.filter((message) => message.type === 'run_complete');
  assert.equal(completes.length, 1);
  assert.deepEqual(completes[0], {
    type: 'run_complete',
    runId: 'run-usage',
    result: { summary: '已分析' },
    usage: { modelId: 'deepseek-flash', tokensIn: 10, cachedTokens: 2, tokensOut: 5, cost: 0 },
  });
  assert.equal(core.activeRun, null);
});

test('handler 超时发送 run_failed 并释放 activeRun', async () => {
  const sent = [];
  const core = new ExecutionAgentCore({}, { query_x: () => new Promise(() => {}) }, () => {});
  core.send = (message) => sent.push(message);
  core.handleMessage(JSON.stringify({ type: 'dispatch', runId: 'run-timeout', capability: 'query_x', input: {}, timeoutMs: 10 }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(core.activeRun, null);
  const failed = sent.find((message) => message.type === 'run_failed');
  assert.equal(failed.runId, 'run-timeout');
  assert.equal(failed.error.code, 'EXECUTION_TIMEOUT');
});

test('超时后 handler 迟到完成不得再发 run_complete', async () => {
  const sent = [];
  let resolveLate;
  const core = new ExecutionAgentCore({}, {
    query_x: () => new Promise((resolve) => { resolveLate = resolve; }),
  }, () => {});
  core.send = (message) => sent.push(message);
  core.handleMessage(JSON.stringify({ type: 'dispatch', runId: 'run-late', capability: 'query_x', input: {}, timeoutMs: 10 }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  resolveLate({ late: true });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sent.filter((message) => message.type === 'run_failed').length, 1);
  assert.equal(sent.filter((message) => message.type === 'run_complete').length, 0);
});

test('handler 抛错发送 run_failed 并释放 activeRun', async () => {
  const sent = [];
  const core = new ExecutionAgentCore({}, {
    query_x: async () => { throw new Error('boom'); },
  }, () => {});
  core.send = (message) => sent.push(message);
  core.handleMessage(JSON.stringify({ type: 'dispatch', runId: 'run-error', capability: 'query_x', input: {}, timeoutMs: 100 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(core.activeRun, null);
  const failed = sent.find((message) => message.type === 'run_failed');
  assert.equal(failed.error.code, 'EXECUTION_FAILED');
  assert.equal(failed.error.message, 'boom');
});

test('召回会取消超时计时器，不再发送 run_failed', async () => {
  const sent = [];
  const core = new ExecutionAgentCore({}, { query_x: () => new Promise(() => {}) }, () => {});
  core.send = (message) => sent.push(message);
  core.handleMessage(JSON.stringify({ type: 'dispatch', runId: 'run-recall', capability: 'query_x', input: {}, timeoutMs: 20 }));
  core.handleMessage(JSON.stringify({ type: 'recall', runId: 'run-recall' }));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(core.activeRun, null);
  assert.equal(sent.filter((message) => message.type === 'run_failed').length, 0);
});

test('召回会中止处理器收到的 AbortSignal', async () => {
  const sent = [];
  let signal;
  const core = new ExecutionAgentCore({}, {
    query_x: (_input, ctx) => {
      signal = ctx.signal;
      return new Promise((_resolve, reject) => {
        ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  }, () => {});
  core.send = (message) => sent.push(message);
  core.handleMessage(JSON.stringify({ type: 'dispatch', runId: 'run-abort', capability: 'query_x', input: {}, timeoutMs: 1_000 }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(signal.aborted, false);
  core.handleMessage(JSON.stringify({ type: 'recall', runId: 'run-abort' }));
  assert.equal(signal.aborted, true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sent.filter((message) => message.type === 'run_failed').length, 0);
});

test('handler 抛错带 code 时透传错误码', async () => {
  const sent = [];
  const core = new ExecutionAgentCore({}, {
    query_x: async () => {
      const error = new Error('upstream down');
      error.code = 'UPSTREAM_UNAVAILABLE';
      throw error;
    },
  }, () => {});
  core.send = (message) => sent.push(message);
  core.handleMessage(JSON.stringify({ type: 'dispatch', runId: 'run-code', capability: 'query_x', input: {}, timeoutMs: 100 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const failed = sent.find((message) => message.type === 'run_failed');
  assert.equal(failed.error.code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(failed.error.message, 'upstream down');
});
