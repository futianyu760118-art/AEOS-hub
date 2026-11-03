import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { buildConnectivitySummary } from '../src/connectivity-summary.ts';
import type { ExecutionAgentRecord } from '../src/execution-plane.ts';

const NOW = '2026-10-28T05:00:00.000Z';

function agent(overrides: Record<string, unknown>): ExecutionAgentRecord {
  return {
    agentId: 'agent',
    name: 'agent',
    version: '1.0.0',
    capabilities: [],
    connectionStatus: 'online',
    runtimeStatus: 'idle',
    lastSeenAt: NOW,
    currentRunId: null,
    registeredAt: NOW,
    local: false,
    systemId: 'control-platform',
    sourceSystem: 'control-platform',
    sourceSystemName: '公司中控平台',
    authMode: 'system-token',
    simulated: false,
    deregisteredAt: null,
    ...overrides,
  } as ExecutionAgentRecord;
}

test('按系统聚合在线数，排除模拟与软删除', () => {
  const summary = buildConnectivitySummary([
    agent({ agentId: 'gw', agentKind: 'system-gateway' }),
    agent({ agentId: 'plm', systemId: 'hengjian-plm', sourceSystem: 'hengjian-plm', sourceSystemName: '恒剑 PLM', connectionStatus: 'offline' }),
    agent({ agentId: 'sim', simulated: true, systemId: 'demo' }),
    agent({ agentId: 'gone', deregisteredAt: NOW }),
  ]);
  assert.equal(summary.systems.length, 2);
  assert.deepEqual(summary.summary, { online: 1, total: 2, status: 'partial' });
  const plm = summary.systems.find((system) => system.systemId === 'hengjian-plm');
  assert.equal(plm?.online, 0);
  assert.equal(plm?.name, '恒剑 PLM');
});

test('全部在线 / 全部离线 / 无系统', () => {
  assert.equal(buildConnectivitySummary([agent({})]).summary.status, 'ok');
  assert.equal(buildConnectivitySummary([agent({ connectionStatus: 'offline' })]).summary.status, 'down');
  assert.deepEqual(buildConnectivitySummary([]).summary, { online: 0, total: 0, status: 'empty' });
});

test('智能助手页头显示分析通道，不再显示 Codex 运行时', () => {
  const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8');
  const app = readFileSync(join(process.cwd(), 'public', 'app.js'), 'utf8');
  assert.match(html, /id="assistant-connectivity-chip"/);
  assert.doesNotMatch(html, /Codex Runtime 已连接/);
  assert.match(app, /\/api\/connectivity/);
  assert.match(app, /function loadConnectivity/);
  assert.match(app, /function syncConnectivityRefresh/);
});
