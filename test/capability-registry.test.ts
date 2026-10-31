import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCapabilityRegistry } from '../src/capability-registry.ts';

test('builds systems and capabilities from the live MCP inventory', () => {
  const snapshot = buildCapabilityRegistry(['demo-erp', 'company-control'], {
    data: [
      { name: 'codex_apps', runtimeStatus: 'connected', tools: { remote_tool: { name: 'remote_tool', inputSchema: {} } } },
      {
        name: 'company-control',
        runtimeStatus: 'connected',
        serverInfo: { version: '0.1.0', description: '公司中控平台' },
        tools: {
          get_system_health: {
            name: 'get_system_health',
            title: '连接自检',
            description: '检查中控连接',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true },
          },
          metric_query: {
            name: 'metric_query',
            inputSchema: { type: 'object', properties: { metric_code: {}, date_from: {}, date_to: {} } },
            annotations: { readOnlyHint: true },
          },
        },
      },
    ],
  });

  assert.equal(snapshot.systems.length, 5);
  assert.equal(snapshot.systems.find((item) => item.id === 'mcp:company-control')?.status, '已连接');
  assert.equal(snapshot.systems.find((item) => item.id === 'mcp:demo-erp')?.status, '已注册');
  assert.deepEqual(snapshot.capabilities.map((item) => item.id), [
    'company-control/get_system_health',
    'company-control/metric_query',
  ]);
  assert.deepEqual(snapshot.capabilities[1]?.inputs, ['metric_code', 'date_from', 'date_to']);
  assert.equal(snapshot.capabilities[1]?.readOnly, true);
});

test('keeps configured MCP servers visible when the runtime inventory fails', () => {
  const snapshot = buildCapabilityRegistry(['demo-erp', 'company-control'], null, 'runtime unavailable');
  assert.equal(snapshot.warning, 'runtime unavailable');
  assert.deepEqual(
    snapshot.systems.filter((item) => item.kind === 'mcp').map((item) => item.name),
    ['company-control', 'demo-erp'],
  );
  assert.equal(snapshot.capabilities.length, 0);
});
