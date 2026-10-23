import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedExecutionAgentIds, isExecutionAgentAllowed } from '../src/execution-agent-policy.ts';

test('只允许已登记的查询/推理/中台网关/PLM 执行面 Agent', () => {
  assert.equal(isExecutionAgentAllowed('control-platform', 'runtime-control-platform-query'), true);
  assert.equal(isExecutionAgentAllowed('control-platform', 'runtime-control-platform-reasoning'), true);
  assert.equal(isExecutionAgentAllowed('control-platform', 'gateway-control-platform'), true);
  assert.equal(isExecutionAgentAllowed('hengjian-plm', 'runtime-execution-query'), true);
});

test('额外或写能力 Agent 被拒绝', () => {
  assert.equal(isExecutionAgentAllowed('control-platform', 'runtime-control-platform-order'), false);
  assert.equal(isExecutionAgentAllowed('control-platform', 'runtime-control-platform-agent'), false);
  assert.equal(isExecutionAgentAllowed('hengjian-plm', 'runtime-control-platform-query'), false);
});

test('未登记系统或空参数一律拒绝', () => {
  assert.equal(isExecutionAgentAllowed(null, 'runtime-execution-query'), false);
  assert.equal(isExecutionAgentAllowed('unknown-system', 'runtime-execution-query'), false);
  assert.equal(isExecutionAgentAllowed('control-platform', '  '), false);
  assert.deepEqual(allowedExecutionAgentIds('unknown-system'), []);
});
