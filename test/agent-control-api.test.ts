import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentControlApi } from '../src/agent-control-api.ts';
import { ExecutionPlaneRegistry } from '../src/execution-plane.ts';
import { deriveSystemToken } from '../src/system-token.ts';
import type { EvidenceInput } from '../src/evidence.ts';

const ROOT = 'test-root-secret';
const CAPS = [{ name: 'query-orders', description: '查订单' }];

function makeHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-control-'));
  const registry = new ExecutionPlaneRegistry({ file: join(dir, 'execution-plane.json') });
  const auditCalls: EvidenceInput[] = [];
  const api = new AgentControlApi({
    rootSecret: ROOT,
    executionPlane: registry,
    appendEvidence: (input) => { auditCalls.push(input); return {}; },
  });
  const erpToken = deriveSystemToken(ROOT, 'erp');
  const mesToken = deriveSystemToken(ROOT, 'mes');
  const handle = (method: string, pathname: string, systemId = 'erp', token = erpToken, body?: Record<string, unknown>) =>
    api.handle({ method, pathname, systemId, token, body });
  return { dir, registry, auditCalls, handle, erpToken, mesToken };
}

test('缺令牌 → 401 且落 denied 审计', () => {
  const { handle, registry, auditCalls } = makeHarness();
  const res = handle('POST', '/api/system/agents', 'erp', '');
  assert.equal(res?.status, 401);
  assert.equal(registry.list().agents.length, 0);
  assert.ok(auditCalls.some((e) => e.correlation_id === 'agent-control-denied' && e.actor_type === 'system'));
});

test('错令牌（他系统令牌）→ 401', () => {
  const { handle, mesToken } = makeHarness();
  const res = handle('POST', '/api/system/agents', 'erp', mesToken, { agentId: 'a1', name: 'X', capabilities: CAPS });
  assert.equal(res?.status, 401);
});

test('根密钥为空 → 503 fail-closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-control-'));
  const registry = new ExecutionPlaneRegistry({ file: join(dir, 'execution-plane.json') });
  const api = new AgentControlApi({ rootSecret: '', executionPlane: registry, appendEvidence: () => ({}) });
  const res = api.handle({ method: 'GET', pathname: '/api/system/agents', systemId: 'erp', token: 'whatever' });
  assert.equal(res?.status, 503);
});

test('声明 → 201，写入本系统，审计 declared', () => {
  const { handle, registry, auditCalls } = makeHarness();
  const res = handle('POST', '/api/system/agents', 'erp', undefined, { agentId: 'agent-erp-1', name: 'ERP 查询', capabilities: CAPS });
  assert.equal(res?.status, 201);
  const record = registry.list().agents.find((a) => a.agentId === 'agent-erp-1');
  assert.ok(record);
  assert.equal(record!.sourceSystem, 'erp');
  assert.equal(record!.connectionStatus, 'offline');
  assert.ok(auditCalls.some((e) => e.correlation_id === 'agent-control-declared' && e.source_system === 'erp'));
});

test('列出本系统 → 只见自己系统的 Agent', () => {
  const { handle, registry, mesToken } = makeHarness();
  handle('POST', '/api/system/agents', 'erp', undefined, { agentId: 'agent-erp-1', name: 'ERP', capabilities: CAPS });
  handle('POST', '/api/system/agents', 'mes', mesToken, { agentId: 'agent-mes-1', name: 'MES', capabilities: CAPS });
  const res = handle('GET', '/api/system/agents', 'erp');
  assert.equal(res?.status, 200);
  const agents = (res!.body.agents as Array<{ agentId: string }>);
  assert.equal(agents.length, 1);
  assert.equal(agents[0]!.agentId, 'agent-erp-1');
  assert.equal(registry.list().agents.length, 2);
});

test('注销自有 Agent → 200，软删除（deregisteredAt 落库、记录仍在）', () => {
  const { handle, registry } = makeHarness();
  handle('POST', '/api/system/agents', 'erp', undefined, { agentId: 'agent-erp-1', name: 'ERP', capabilities: CAPS });
  const res = handle('DELETE', '/api/system/agents/agent-erp-1', 'erp');
  assert.equal(res?.status, 200);
  const record = registry.list().agents.find((a) => a.agentId === 'agent-erp-1');
  assert.ok(record);
  assert.ok(record!.deregisteredAt);
  assert.equal(record!.connectionStatus, 'offline');
  assert.equal(record!.currentRunId, null);
  // 软删除保留画像：仍能从 listForSystem 取回。
  assert.equal(registry.listForSystem('erp').length, 1);
});

test('注销他系统 Agent → 403 AGENT_OWNED_BY_OTHER', () => {
  const { handle, mesToken } = makeHarness();
  handle('POST', '/api/system/agents', 'erp', undefined, { agentId: 'agent-erp-1', name: 'ERP', capabilities: CAPS });
  const res = handle('DELETE', '/api/system/agents/agent-erp-1', 'mes', mesToken);
  assert.equal(res?.status, 403);
  assert.equal(res?.body.code, 'AGENT_OWNED_BY_OTHER');
});

test('覆盖他系统 Agent → 403 AGENT_OWNED_BY_OTHER', () => {
  const { handle, mesToken } = makeHarness();
  handle('POST', '/api/system/agents', 'erp', undefined, { agentId: 'agent-erp-1', name: 'ERP', capabilities: CAPS });
  const res = handle('POST', '/api/system/agents', 'mes', mesToken, { agentId: 'agent-erp-1', name: 'MES 抢占', capabilities: CAPS });
  assert.equal(res?.status, 403);
  assert.equal(res?.body.code, 'AGENT_OWNED_BY_OTHER');
});

test('审计不泄漏令牌', () => {
  const { handle, auditCalls } = makeHarness();
  handle('POST', '/api/system/agents', 'erp', undefined, { agentId: 'a1', name: 'X', capabilities: CAPS });
  for (const entry of auditCalls) {
    assert.equal(JSON.stringify(entry).includes(ROOT), false);
  }
});
