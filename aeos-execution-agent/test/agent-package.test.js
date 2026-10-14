import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerCapability, capabilityHandlers, capabilityDefinitions } from '../src/capabilities.js';
import { loadConfig } from '../src/config.js';
import { createQueryAdapter } from '../src/adapters/query-adapter.js';
import { createReasoningAdapter } from '../src/adapters/reasoning-adapter.js';

test('能力插件化注册并返回处理器与定义', () => {
  registerCapability({ name: 'query_x', description: '查询 X', handler: async () => ({}) });
  const handlers = capabilityHandlers();
  assert.equal(typeof handlers.query_x, 'function');
  const definitions = capabilityDefinitions();
  assert.ok(definitions.some((c) => c.name === 'query_x' && c.description === '查询 X'));
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
});

test('查询适配器拒绝白名单外 path 与缺 path', async () => {
  const query = createQueryAdapter({ baseUrl: 'https://x/api/v1', appKey: 'k', appSecret: 's' });
  await assert.rejects(() => query({ path: '', params: {} }, undefined), /缺少 path/);
  await assert.rejects(() => query({ path: '/external/orders/delete', params: {} }, undefined), /白名单/);
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
