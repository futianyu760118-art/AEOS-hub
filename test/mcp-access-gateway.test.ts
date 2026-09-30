import assert from 'node:assert/strict';
import test from 'node:test';
import { McpAccessGateway, McpAccessGatewayError } from '../src/mcp-access-gateway.ts';
import { loadMcpRegistry } from '../src/mcp-registry.ts';

const readonlyInventory = {
  data: [{ name: 'company-control', tools: {
    get_system_health: { name: 'get_system_health', annotations: { readOnlyHint: true } },
  } }],
};
const ignoreEvidence = () => ({ event_id: 'test', occurred_at: '2026-01-01T00:00:00Z', kind: 'test' });

test('only invokes a registered tool confirmed read-only by the runtime', async () => {
  const calls: unknown[] = [];
  const gateway = new McpAccessGateway({
    async callMcpTool(...args) { calls.push(args); return { ok: true }; },
  }, loadMcpRegistry(), undefined, ignoreEvidence);
  const result = await gateway.callReadOnly({
    sessionId: 'thread-1', server: 'company-control', tool: 'get_system_health',
    purpose: 'test', runtimeInventory: readonlyInventory,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
});

test('fails closed for a tool absent from the read-only live inventory', async () => {
  const gateway = new McpAccessGateway({ async callMcpTool() { throw new Error('must not run'); } }, loadMcpRegistry(), undefined, ignoreEvidence);
  await assert.rejects(
    gateway.callReadOnly({
      sessionId: 'thread-1', server: 'company-control', tool: 'get_system_health', purpose: 'test',
      runtimeInventory: { data: [{ name: 'company-control', tools: { get_system_health: { name: 'get_system_health', annotations: {} } } }] },
    }),
    (error: unknown) => error instanceof McpAccessGatewayError && error.code === 'MCP_NOT_READ_ONLY',
  );
});

test('rejects a tool that is not in the registered allowlist', async () => {
  const gateway = new McpAccessGateway({ async callMcpTool() { throw new Error('must not run'); } }, loadMcpRegistry(), undefined, ignoreEvidence);
  await assert.rejects(
    gateway.callReadOnly({
      sessionId: 'thread-1', server: 'company-control', tool: 'delete_everything', purpose: 'test', runtimeInventory: readonlyInventory,
    }),
    (error: unknown) => error instanceof McpAccessGatewayError && error.code === 'MCP_TOOL_NOT_ALLOWED',
  );
});
