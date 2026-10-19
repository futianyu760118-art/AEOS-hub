import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AlertCenter, type AlertChannel, type AlertEvent } from '../src/alert-center.ts';
import {
  OpsMonitor,
  evaluateAgents,
  evaluateBackup,
  evaluateBorrow,
  evaluateDisk,
  evaluateMemory,
  evaluateModel,
} from '../src/ops-monitor.ts';
import type { ExecutionAgentRecord } from '../src/execution-plane.ts';
import type { BorrowOrderRecord } from '../src/borrow-order-store.ts';
import { resetModelObservability, type ModelHealth } from '../src/model-observability.ts';

class CaptureChannel implements AlertChannel {
  readonly name = 'capture';
  enabled(): boolean { return true; }
  async send(_event: AlertEvent, _phase: 'active' | 'recovered'): Promise<void> {}
}

function agent(overrides: Partial<ExecutionAgentRecord> = {}): ExecutionAgentRecord {
  return {
    agentId: 'agent-1',
    name: '中台查询智能体',
    version: '1.0.0',
    capabilities: [{ name: 'query_control_platform', description: '', constraints: { readOnly: true } }],
    connectionStatus: 'online',
    runtimeStatus: 'idle',
    lastSeenAt: '2026-10-19T08:00:00.000Z',
    currentRunId: null,
    registeredAt: '2026-10-01T00:00:00.000Z',
    local: false,
    sourceSystem: '公司中控平台',
    deregisteredAt: null,
    ...overrides,
  };
}

function borrowOrder(overrides: Partial<BorrowOrderRecord> = {}): BorrowOrderRecord {
  return {
    orderId: 'borrow-1', tenantId: 'pilot-default', requestId: 'req-1', requestHash: 'a'.repeat(64),
    fromSystem: 'erp', fromAgentId: null, capability: 'query_control_platform', input: {},
    toSystem: null, toAgent: null, providerSystem: '中控', providerAgentId: 'agent-1', runId: 'run-1',
    status: 'completed', error: null, result: null, resultBytes: 0, resultTruncated: false,
    createdAt: '2026-10-19T08:00:00.000Z', updatedAt: '2026-10-19T08:00:00.000Z',
    dispatchedAt: '2026-10-19T08:00:00.000Z', startedAt: '2026-10-19T08:00:00.000Z', endedAt: '2026-10-19T08:01:00.000Z',
    ...overrides,
  };
}

const NOW = new Date('2026-10-19T09:00:00.000Z');

test('磁盘阈值：正常 / 警告 / 严重', () => {
  assert.equal(evaluateDisk('G:\\', 100).ok, true);
  assert.equal(evaluateDisk('G:\\', 5).severity, 'warn');
  assert.equal(evaluateDisk('G:\\', 1).severity, 'critical');
});

test('备份检查：缺失 / 成功 / 过期 / 失败', () => {
  assert.equal(evaluateBackup(null, NOW).severity, 'warn');
  assert.equal(evaluateBackup(`${NOW.toISOString()} OK zip=x\n`, NOW).ok, true);
  const old = new Date(NOW.getTime() - 30 * 3_600_000).toISOString();
  assert.equal(evaluateBackup(`${old} OK zip=x\n`, NOW).severity, 'warn');
  assert.equal(evaluateBackup(`${NOW.toISOString()} FAILED boom\n`, NOW).severity, 'critical');
});

test('借调失败率：健康 / 警告 / 严重', () => {
  const healthy = [borrowOrder(), borrowOrder({ orderId: 'b2', requestId: 'r2', status: 'failed' }), borrowOrder({ orderId: 'b3', requestId: 'r3' }), borrowOrder({ orderId: 'b4', requestId: 'r4' })];
  assert.equal(evaluateBorrow(healthy, NOW).ok, true);
  const warn = [1, 2, 3, 4].map((index) => borrowOrder({ orderId: `w${index}`, requestId: `w${index}`, status: index <= 2 ? 'failed' : 'completed' }));
  assert.equal(evaluateBorrow(warn, NOW).severity, 'warn');
  const critical = [1, 2, 3, 4, 5].map((index) => borrowOrder({ orderId: `c${index}`, requestId: `c${index}`, status: index <= 4 ? 'failed' : 'completed' }));
  assert.equal(evaluateBorrow(critical, NOW).severity, 'critical');
});

test('模型错误检查：401 / 429 / 5xx', () => {
  const base: ModelHealth = {
    callsInWindow: 5, errorsInWindow: 0, lastSuccessAt: NOW.toISOString(), lastAuthErrorAt: null,
    lastRateLimitAt: null, lastServerErrorAt: null, lastTimeoutAt: null,
  };
  assert.ok(evaluateModel(base, NOW).every((check) => check.ok));
  assert.equal(evaluateModel({ ...base, lastAuthErrorAt: NOW.toISOString() }, NOW).find((check) => check.key === 'model:auth')?.severity, 'critical');
  assert.equal(evaluateModel({ ...base, lastRateLimitAt: NOW.toISOString() }, NOW).find((check) => check.key === 'model:rate-limit')?.severity, 'warn');
  assert.equal(evaluateModel({ ...base, lastServerErrorAt: NOW.toISOString() }, NOW).find((check) => check.key === 'model:server')?.severity, 'warn');
  assert.equal(evaluateModel({ ...base, errorsInWindow: 3 }, NOW).find((check) => check.key === 'model:timeout')?.severity, 'warn');
});

test('执行面离线：之前在线现在离线才告警', () => {
  const online = evaluateAgents([agent()], new Set());
  assert.equal(online.online.size, 1);
  assert.equal(online.checks.length, 0);
  const offline = evaluateAgents([agent({ connectionStatus: 'offline' })], new Set(['agent-1']));
  assert.ok(offline.checks.some((check) => check.key === 'agent:offline:agent-1'));
  assert.ok(offline.checks.some((check) => check.key === 'agents:none-online'));
});

test('内存阈值', () => {
  assert.equal(evaluateMemory(1_700 * 1024 * 1024).severity, 'warn');
  assert.equal(evaluateMemory(300 * 1024 * 1024).ok, true);
});

test('runOnce 产生告警，恢复后自动标记 recovered', async (t) => {
  resetModelObservability();
  const dir = mkdtempSync(join(tmpdir(), 'aeos-ops-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { current: NOW };
  const center = new AlertCenter({
    file: join(dir, 'alerts.json'),
    logFile: join(dir, 'alerts.log'),
    channels: [new CaptureChannel()],
    clock: () => clock.current,
  });
  const backupLog = join(dir, 'backup.log');
  writeFileSync(backupLog, `${NOW.toISOString()} OK zip=x\n`, 'utf8');
  let mcpOk = false;
  let freeGb = 1;
  const currentAgent = agent();
  const monitor = new OpsMonitor({
    alertCenter: center,
    executionPlane: { list: () => ({ agents: [currentAgent], runs: [] }) },
    listBorrowOrders: () => [],
    checkKeycloak: async () => 'ok',
    checkMcp: async () => (mcpOk ? 'ok' : 'fail'),
    backupLogFile: backupLog,
    diskPaths: ['G:\\'],
    diskFreeGb: () => freeGb,
    clock: () => clock.current,
  });

  const first = await monitor.runOnce();
  assert.equal(first.metrics.agentsOnline, 1);
  assert.ok(first.checks.some((check) => check.key === 'mcp' && !check.ok));
  assert.ok(first.checks.some((check) => check.key === 'disk:G:\\' && !check.ok));
  const activeKeys = center.list().filter((alert) => alert.status === 'active').map((alert) => alert.key);
  assert.ok(activeKeys.includes('mcp'));
  assert.ok(activeKeys.includes('disk:G:\\'));

  mcpOk = true;
  freeGb = 100;
  clock.current = new Date(NOW.getTime() + 60_000);
  await monitor.runOnce();
  const recoveredKeys = center.list().filter((alert) => alert.status === 'recovered').map((alert) => alert.key);
  assert.ok(recoveredKeys.includes('mcp'));
  assert.ok(recoveredKeys.includes('disk:G:\\'));

  currentAgent.connectionStatus = 'offline';
  clock.current = new Date(NOW.getTime() + 120_000);
  const third = await monitor.runOnce();
  assert.equal(third.metrics.agentsOnline, 0);
  const offlineAlert = center.list().find((alert) => alert.key === 'agent:offline:agent-1');
  assert.equal(offlineAlert?.status, 'active');
});
