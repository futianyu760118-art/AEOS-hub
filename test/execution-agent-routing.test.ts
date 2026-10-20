import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isQueryOnly,
  isReasoningOnly,
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
