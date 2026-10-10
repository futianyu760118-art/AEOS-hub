import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgentRegistrationPayload,
  eligibleParentAgents,
  normalizeAllowedRuntimeCapabilities,
} from '../public/agent-registration.js';

const agents = [
  { id: 'agent-hub', registration: { type: 'hub' } },
  { id: 'agent-erp-master', registration: { type: 'master' } },
  { id: 'agent-erp-orders', registration: { type: 'specialist' } },
];

test('normalizes the Agent capability allowlist before it is submitted', () => {
  assert.deepEqual(
    normalizeAllowedRuntimeCapabilities(' mcp, MCP, tool-calling , , mcp '),
    ['mcp', 'tool-calling'],
  );
});

test('only offers the correct parent type and rejects invalid registration payloads', () => {
  assert.deepEqual(eligibleParentAgents(agents, 'master').map((agent) => agent.id), ['agent-hub']);
  assert.deepEqual(eligibleParentAgents(agents, 'specialist').map((agent) => agent.id), ['agent-erp-master']);
  assert.deepEqual(eligibleParentAgents(agents, 'tool').map((agent) => agent.id), ['agent-erp-orders']);

  const payload = buildAgentRegistrationPayload({
    code: 'ERP-QUALITY', type: 'specialist', parentAgentId: 'agent-erp-master',
    allowedRuntimeCapabilities: 'mcp, mcp',
  }, agents);
  assert.equal(payload.code, 'ERP-QUALITY');
  assert.equal(payload.hierarchyLevel, 'L2');
  assert.deepEqual(payload.allowedRuntimeCapabilities, ['mcp']);
  assert.throws(() => buildAgentRegistrationPayload({
    code: 'erp-invalid', type: 'specialist', parentAgentId: 'agent-hub',
  }, agents), /上级 Agent 不符合 specialist 的层级规则/);
});
