import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { ExecutionAgentCore } from '../src/agent-core.js';

test('中台网关端到端：注册带 kind，派单后回传 run_complete', { timeout: 5_000 }, async (t) => {
  const server = new WebSocketServer({ port: 0 });
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const received = [];

  const completed = new Promise((resolve, reject) => {
    server.on('connection', (ws) => {
      ws.on('message', (raw) => {
        let message;
        try {
          message = JSON.parse(String(raw));
        } catch {
          reject(new Error('收到非 JSON 消息'));
          return;
        }
        received.push(message);
        if (message.type === 'register') {
          try {
            assert.equal(message.agentId, 'gateway-control-platform');
            assert.equal(message.kind, 'system-gateway');
            assert.equal(message.gatewayVersion, '1.0.0');
            assert.deepEqual(message.capabilities.map((capability) => capability.name), ['query_x']);
          } catch (error) {
            reject(error);
            return;
          }
          ws.send(JSON.stringify({ type: 'registered', agentId: message.agentId, heartbeatIntervalMs: 1_000 }));
          ws.send(JSON.stringify({ type: 'dispatch', runId: 'run-1', capability: 'query_x', input: {}, timeoutMs: 1_000 }));
        } else if (message.type === 'run_complete') {
          resolve(message);
        }
      });
    });
  });

  const core = new ExecutionAgentCore({
    wsUrl: `ws://127.0.0.1:${port}`,
    systemId: 'control-platform',
    systemToken: 'test-system-token',
    agentId: 'gateway-control-platform',
    name: '公司中控平台网关',
    version: '1.0.0',
    protocolVersion: '1.0',
    sourceSystem: 'control-platform',
    agentKind: 'system-gateway',
    gatewayVersion: '1.0.0',
    capabilities: [{ name: 'query_x', description: '测试能力' }],
  }, {
    query_x: async () => ({ ok: true }),
  }, () => {});
  t.after(() => core.stop());

  core.start();
  const complete = await completed;
  assert.equal(complete.runId, 'run-1');
  assert.deepEqual(complete.result, { ok: true });
  assert.ok(received.some((message) => message.type === 'register'));
});
