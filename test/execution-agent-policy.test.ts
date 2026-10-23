import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_EXECUTION_AGENT_ALLOWLIST,
  ExecutionAgentAllowlistSchema,
  allowedExecutionAgentIds,
  isExecutionAgentAllowed,
  loadExecutionAgentAllowlist,
} from '../src/execution-agent-policy.ts';

test('默认允许查询/推理/中台网关/PLM 执行面 Agent', () => {
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

test('配置覆盖：新增系统/Agent 无需改代码', () => {
  const policy = ExecutionAgentAllowlistSchema.parse({
    ...DEFAULT_EXECUTION_AGENT_ALLOWLIST,
    revision: 2,
    allowlist: { ...DEFAULT_EXECUTION_AGENT_ALLOWLIST.allowlist, 'new-system': ['agent-new'] },
  });
  assert.equal(isExecutionAgentAllowed('new-system', 'agent-new', policy), true);
  assert.equal(isExecutionAgentAllowed('new-system', 'agent-other', policy), false);
  assert.deepEqual(allowedExecutionAgentIds('new-system', policy), ['agent-new']);
});

test('loadExecutionAgentAllowlist 读取文件；损坏回落默认值', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'execution-agent-allowlist-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const validFile = join(dir, 'valid.json');
  const invalidFile = join(dir, 'invalid.json');
  writeFileSync(validFile, JSON.stringify({
    ...DEFAULT_EXECUTION_AGENT_ALLOWLIST,
    revision: 3,
    allowlist: { 'control-platform': ['gateway-control-platform'] },
  }), 'utf8');
  const loaded = loadExecutionAgentAllowlist(validFile);
  assert.equal(loaded.revision, 3);
  assert.equal(isExecutionAgentAllowed('control-platform', 'gateway-control-platform', loaded), true);
  assert.equal(isExecutionAgentAllowed('control-platform', 'runtime-control-platform-query', loaded), false);

  writeFileSync(invalidFile, '{ not json', 'utf8');
  assert.equal(loadExecutionAgentAllowlist(invalidFile), DEFAULT_EXECUTION_AGENT_ALLOWLIST);
});
