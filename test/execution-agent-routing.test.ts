import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachBusinessObjectRef,
  inferBusinessObjectRef,
  isQueryOnly,
  isReasoningOnly,
  requiresBusinessObjectRef,
  selectExecutionCapabilities,
} from '../public/execution-agent-routing.js';

test('推理-only Agent 只返回推理能力，不硬编码查询能力', () => {
  const selection = selectExecutionCapabilities([
    { name: 'reason_control_platform', constraints: { readOnly: true } },
  ]);
  assert.deepEqual(selection, { query: null, reasoning: 'reason_control_platform' });
  assert.equal(isReasoningOnly(selection), true);
  assert.equal(isQueryOnly(selection), false);
});

test('查询-only Agent 只返回查询能力', () => {
  const selection = selectExecutionCapabilities([
    { name: 'query_control_platform', constraints: { readOnly: true } },
  ]);
  assert.deepEqual(selection, { query: 'query_control_platform', reasoning: null });
  assert.equal(isQueryOnly(selection), true);
});

test('带 intent 的查询能力优先于名称前缀', () => {
  const selection = selectExecutionCapabilities([
    { name: 'query_control_platform' },
    { name: 'custom_lookup', intent: { paths: [] } },
  ]);
  assert.equal(selection.query, 'custom_lookup');
});

test('同时具备查询与推理时两项都返回；无能力时均为 null', () => {
  const both = selectExecutionCapabilities([
    { name: 'query_control_platform' },
    { name: 'reason_control_platform' },
  ]);
  assert.deepEqual(both, { query: 'query_control_platform', reasoning: 'reason_control_platform' });
  assert.deepEqual(selectExecutionCapabilities([]), { query: null, reasoning: null });
  assert.deepEqual(selectExecutionCapabilities(undefined), { query: null, reasoning: null });
});

test('从问题提取订单/产品/批次业务锚点', () => {
  assert.equal(inferBusinessObjectRef('分析订单 HJY20260903-261 的交付风险'), 'business://order/HJY20260903-261');
  assert.equal(inferBusinessObjectRef('订单 SO-2609-001 是否需要催交'), 'business://order/SO-2609-001');
  assert.equal(inferBusinessObjectRef('看看产品 SKU-ABC-01 的质量'), 'business://product/SKU-ABC-01');
  assert.equal(inferBusinessObjectRef('批次 LOT-2026-01 追溯'), 'business://batch/LOT-2026-01');
  assert.equal(inferBusinessObjectRef('引用 business://order/SO-1 分析'), 'business://order/SO-1');
  assert.equal(inferBusinessObjectRef('分析今日风险最高的订单'), null);
});

test('推理 schema 要求 businessObjectRef 时能识别，并用锚点补齐 context', () => {
  const capability = {
    name: 'reason_control_platform',
    inputSchema: { type: 'object', properties: { context: { type: 'object', required: ['businessObjectRef'] } } },
  };
  assert.equal(requiresBusinessObjectRef(capability), true);
  assert.equal(requiresBusinessObjectRef({ name: 'reason_x', inputSchema: { properties: {} } }), false);
  const request = { prompt: '分析订单 SO-2609-001 的交付风险', task_type: 'order_delivery_analysis', context: {} };
  assert.deepEqual(attachBusinessObjectRef(request, request.prompt).context, { businessObjectRef: 'business://order/SO-2609-001' });
  assert.deepEqual(attachBusinessObjectRef(request, '分析今日风险最高的订单').context, {});
});
