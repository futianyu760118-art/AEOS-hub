import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('gateway --check 输出身份与能力，不连接 Hub', { timeout: 5_000 }, () => {
  const result = spawnSync(process.execPath, ['src/gateway-main.js', '--check'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      EXECUTION_WS_URL: 'ws://127.0.0.1:1/execution-agent',
      EXECUTION_SYSTEM_ID: 'control-platform',
      EXECUTION_SYSTEM_TOKEN: 'test-system-token',
      EXECUTION_AGENT_ID: '',
      EXECUTION_AGENT_NAME: '',
      EXECUTION_SOURCE_SYSTEM: '',
      EXECUTION_GATEWAY_VERSION: '',
      TARGET_QUERY_BASE_URL: 'https://example.invalid/api/v1',
      TARGET_QUERY_APP_KEY: 'test-key',
      TARGET_QUERY_APP_SECRET: 'test-secret',
      TARGET_REASONING_URL: '',
      TARGET_REASONING_AGENT_ID: '',
      TARGET_REASONING_TOKEN: '',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.agentId, 'gateway-control-platform');
  assert.equal(output.agentName, '公司中控平台网关');
  assert.equal(output.sourceSystem, 'control-platform');
  assert.equal(output.agentKind, 'system-gateway');
  assert.equal(output.gatewayVersion, '1.0.0');
  assert.deepEqual(output.capabilities, ['query_control_platform', 'reason_control_platform']);
});
