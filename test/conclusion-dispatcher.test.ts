import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ConclusionDispatcher,
  formatConclusionDispatchReport,
  loadConclusionDispatchPolicy,
  type ConclusionDispatchPolicy,
} from '../src/conclusion-dispatcher.ts';
import type { ExecutionAgentRecord, ExecutionRunRecord } from '../src/execution-plane.ts';
import type { EvidenceInput } from '../src/evidence.ts';

const NOW = new Date('2026-10-28T00:00:00.000Z');

function agent(overrides: Record<string, unknown> = {}): ExecutionAgentRecord {
  return {
    agentId: 'gateway-control-platform',
    name: '中台分析通道（网关）',
    version: '1.0.0',
    capabilities: [{ name: 'reason_control_platform', description: '', constraints: { readOnly: true } }],
    connectionStatus: 'online',
    runtimeStatus: 'idle',
    lastSeenAt: NOW.toISOString(),
    currentRunId: null,
    registeredAt: NOW.toISOString(),
    local: false,
    systemId: 'control-platform',
    sourceSystem: 'control-platform',
    sourceSystemName: '公司中控平台',
    authMode: 'system-token',
    simulated: false,
    agentKind: 'system-gateway',
    deregisteredAt: null,
    ...overrides,
  } as ExecutionAgentRecord;
}

function policy(overrides: Partial<ConclusionDispatchPolicy> = {}): ConclusionDispatchPolicy {
  return {
    version: 1,
    revision: 1,
    updatedAt: NOW.toISOString(),
    enabled: true,
    maxItemsPerAnalysis: 2,
    perItemTimeoutMs: 500,
    dedupeHours: 24,
    dispatchDomains: ['kitting', 'quality'],
    targets: {
      kitting: { systemId: 'control-platform', capability: 'reason_control_platform', taskType: 'material_kitting_analysis' },
      quality: { systemId: 'control-platform', capability: 'reason_control_platform', taskType: 'quality_analysis' },
    },
    ...overrides,
  };
}

type Mode = 'complete' | 'fail' | 'hang';

function planeFixture(options: { agents?: ExecutionAgentRecord[]; mode?: Mode } = {}) {
  const runs = new Map<string, ExecutionRunRecord>();
  const dispatched: Array<{ agentId: string; capability: string; input: unknown; options: unknown }> = [];
  const recalled: string[] = [];
  const mode = options.mode ?? 'complete';
  let sequence = 0;
  const agents = options.agents ?? [agent()];
  const plane = {
    list: () => ({ agents, runs: [] }),
    dispatch: (agentId: string, capability: string, input: unknown, dispatchOptions: unknown) => {
      const runId = `run-${++sequence}`;
      dispatched.push({ agentId, capability, input, options: dispatchOptions });
      const run: ExecutionRunRecord = {
        runId,
        agentId,
        capability,
        input,
        state: 'dispatched',
        startedAt: NOW.toISOString(),
        endedAt: null,
      };
      runs.set(runId, run);
      if (mode !== 'hang') {
        setTimeout(() => {
          if (mode === 'fail') {
            run.state = 'failed';
            run.error = { code: 'UPSTREAM_UNAVAILABLE', message: '上游不可用' };
          } else {
            run.state = 'completed';
            run.result = {
              conclusions: [{ matter: '结论一' }, { matter: '结论二' }],
              handled_by: { agentId: 'spc-internal-1', name: '齐套研判', role: 'kitting' },
            };
          }
        }, 0);
      }
      return { runId, state: 'dispatched' as const };
    },
    getRun: (runId: string) => runs.get(runId),
    recall: (agentId: string) => {
      recalled.push(agentId);
      return { recalled: true, runId: null };
    },
  };
  return { plane, dispatched, recalled };
}

function sandbox(policyOverride?: Partial<ConclusionDispatchPolicy>) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-dispatch-'));
  const policyFile = join(dir, 'policy.json');
  const storeFile = join(dir, 'store.json');
  writeFileSync(policyFile, JSON.stringify(policy(policyOverride)), 'utf8');
  return { dir, policyFile, storeFile };
}

function buildDispatcher(plane: ReturnType<typeof planeFixture>['plane'], files: { policyFile: string; storeFile: string }, audits: EvidenceInput[] = []) {
  return new ConclusionDispatcher(plane, {
    policyFile: files.policyFile,
    storeFile: files.storeFile,
    now: () => NOW,
    idFactory: () => 'test',
    pollIntervalMs: 1,
    appendEvidence: (entry) => { audits.push(entry); },
  });
}

test('策略文件缺失或损坏时默认不自动分发', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-dispatch-'));
  const policyFile = join(dir, 'missing.json');
  assert.equal(loadConclusionDispatchPolicy(policyFile).enabled, false);
  writeFileSync(policyFile, '{not json', 'utf8');
  assert.equal(loadConclusionDispatchPolicy(policyFile).enabled, false);
});

test('关闭开关时不派单', async () => {
  const { plane, dispatched } = planeFixture();
  const files = sandbox({ enabled: false });
  const report = await buildDispatcher(plane, files).dispatchForObject({ businessObjectRef: 'business://order/O-1', orderNo: 'O-1' });
  assert.equal(report.status, 'disabled');
  assert.equal(dispatched.length, 0);
});

test('按策略分发两个域：能力、task_type、traceId 与 caller 正确', async () => {
  const { plane, dispatched } = planeFixture();
  const files = sandbox();
  const audits: EvidenceInput[] = [];
  const report = await buildDispatcher(plane, files, audits).dispatchForObject(
    { businessObjectRef: 'business://order/O-1', orderNo: 'O-1' },
    { traceId: 'orch-1', caller: { systemId: 'aeos-hub', agentId: 'AG-1', userId: 'U-1', taskId: null, traceId: 't-1' } },
  );

  assert.equal(report.status, 'completed');
  assert.deepEqual(report.counts, { dispatched: 2, completed: 2, failed: 0, skipped: 0 });
  assert.equal(dispatched.length, 2);
  const [kitting, quality] = dispatched;
  assert.equal(kitting?.agentId, 'gateway-control-platform');
  assert.equal(kitting?.capability, 'reason_control_platform');
  assert.equal((kitting?.input as Record<string, unknown>).task_type, 'material_kitting_analysis');
  assert.deepEqual((kitting?.input as Record<string, unknown>).context, { businessObjectRef: 'business://order/O-1' });
  assert.equal((quality?.input as Record<string, unknown>).task_type, 'quality_analysis');
  assert.deepEqual(kitting?.options, { traceId: 'orch-1', caller: { systemId: 'aeos-hub', agentId: 'AG-1', userId: 'U-1', taskId: null, traceId: 't-1' } });
  assert.deepEqual(report.items[0]?.handledBy, { agentId: 'spc-internal-1', name: '齐套研判', role: 'kitting' });
  assert.equal(report.items[0]?.conclusions, 2);
  assert.equal(audits.length, 1);
  assert.equal((audits[0]?.payload as Record<string, unknown>).status, 'completed');
});

test('同一对象同一能力在去重窗口内不重复派发', async () => {
  const { plane, dispatched } = planeFixture();
  const files = sandbox({ dispatchDomains: ['kitting'] });
  const dispatcher = buildDispatcher(plane, files);
  const first = await dispatcher.dispatchForObject({ businessObjectRef: 'business://order/O-1' });
  assert.equal(first.counts.completed, 1);
  const second = await dispatcher.dispatchForObject({ businessObjectRef: 'business://order/O-1' });
  assert.equal(second.counts.dispatched, 0);
  assert.equal(second.counts.skipped, 1);
  assert.equal(second.items[0]?.reason, 'DUPLICATE');
  assert.equal(dispatched.length, 1);
});

test('失败或超时的记录不阻断下次重试', async () => {
  const files = sandbox({ dispatchDomains: ['kitting'] });
  const failing = planeFixture({ mode: 'fail' });
  const first = await buildDispatcher(failing.plane, files).dispatchForObject({ businessObjectRef: 'business://order/O-2' });
  assert.equal(first.items[0]?.status, 'failed');
  assert.equal(first.items[0]?.reason, 'RUN_FAILED');

  const succeeding = planeFixture({ mode: 'complete' });
  const second = await buildDispatcher(succeeding.plane, files).dispatchForObject({ businessObjectRef: 'business://order/O-2' });
  assert.equal(second.items[0]?.status, 'completed');
  assert.equal(succeeding.dispatched.length, 1);
});

test('没有可用提供方时跳过而不是报错', async () => {
  const { plane, dispatched } = planeFixture({ agents: [] });
  const files = sandbox();
  const report = await buildDispatcher(plane, files).dispatchForObject({ businessObjectRef: 'business://order/O-3' });
  assert.equal(report.status, 'skipped');
  assert.equal(report.counts.skipped, 2);
  assert.deepEqual(report.items.map((item) => item.reason), ['NO_PROVIDER', 'NO_PROVIDER']);
  assert.equal(dispatched.length, 0);
});

test('离线或未声明的能力不算提供方', async () => {
  const offline = agent({ agentId: 'offline', connectionStatus: 'offline' });
  const wrongCapability = agent({ agentId: 'no-reason', capabilities: [{ name: 'query_control_platform', description: '' }] });
  const files = sandbox({ dispatchDomains: ['kitting'] });
  const { plane } = planeFixture({ agents: [offline, wrongCapability] });
  const report = await buildDispatcher(plane, files).dispatchForObject({ businessObjectRef: 'business://order/O-4' });
  assert.equal(report.items[0]?.reason, 'NO_PROVIDER');
});

test('超时会召回并标记 timeout', async () => {
  const { plane, recalled } = planeFixture({ mode: 'hang' });
  const files = sandbox({ dispatchDomains: ['kitting'], perItemTimeoutMs: 20 });
  const report = await buildDispatcher(plane, files).dispatchForObject({ businessObjectRef: 'business://order/O-5' });
  assert.equal(report.items[0]?.status, 'timeout');
  assert.equal(report.items[0]?.reason, 'TIMEOUT');
  assert.deepEqual(recalled, ['gateway-control-platform']);
});

test('超过 maxItemsPerAnalysis 的域不派发', async () => {
  const { plane, dispatched } = planeFixture();
  const files = sandbox({ maxItemsPerAnalysis: 1 });
  const report = await buildDispatcher(plane, files).dispatchForObject({ businessObjectRef: 'business://order/O-6' });
  assert.equal(dispatched.length, 1);
  assert.equal(report.items.length, 1);
});

test('没有配置目标的域直接跳过', async () => {
  const { plane } = planeFixture();
  const files = sandbox({ dispatchDomains: ['production'] });
  const report = await buildDispatcher(plane, files).dispatchForObject({ businessObjectRef: 'business://order/O-7' });
  assert.equal(report.items[0]?.reason, 'NO_TARGET');
});

test('目标忙碌时等待空闲后再派发', async () => {
  const busyAgent = agent({ currentRunId: 'busy-run', runtimeStatus: 'working' });
  const { plane, dispatched } = planeFixture({ agents: [busyAgent] });
  const files = sandbox({ dispatchDomains: ['kitting'] });
  setTimeout(() => {
    busyAgent.currentRunId = null;
    busyAgent.runtimeStatus = 'idle';
  }, 10);
  const report = await buildDispatcher(plane, files).dispatchForObject({ businessObjectRef: 'business://order/O-9' });
  assert.equal(report.items[0]?.status, 'completed');
  assert.equal(dispatched.length, 1);
});

test('目标持续忙碌时放弃并标记 AGENT_BUSY', async () => {
  const busyAgent = agent({ currentRunId: 'busy-run', runtimeStatus: 'working' });
  const { plane, dispatched } = planeFixture({ agents: [busyAgent] });
  const files = sandbox({ dispatchDomains: ['kitting'], perItemTimeoutMs: 30 });
  const report = await buildDispatcher(plane, files).dispatchForObject({ businessObjectRef: 'business://order/O-10' });
  assert.equal(report.items[0]?.status, 'failed');
  assert.equal(report.items[0]?.reason, 'AGENT_BUSY');
  assert.equal(dispatched.length, 0);
});

test('分发结果文案：完成、无提供方与重复都说明原因', () => {
  const report = {
    dispatchId: 'dispatch-1',
    traceId: 'orch-1',
    status: 'completed' as const,
    counts: { dispatched: 1, completed: 1, failed: 0, skipped: 1 },
    startedAt: NOW.toISOString(),
    endedAt: NOW.toISOString(),
    items: [
      { domain: 'kitting' as const, businessObjectRef: 'business://order/O-1', status: 'completed' as const, systemId: 'control-platform', conclusions: 2 },
      { domain: 'quality' as const, businessObjectRef: 'business://order/O-1', status: 'skipped' as const, reason: 'NO_PROVIDER' },
    ],
  };
  const text = formatConclusionDispatchReport(report);
  assert.match(text, /已自动分发给其他系统 Agent/);
  assert.match(text, /物料齐套 → control-platform（2 条结论）/);
  assert.match(text, /暂无提供方：质量异常/);
  assert.match(text, /处理记录/);
});

test('分发结果文案：关闭开关时不打扰用户', () => {
  const text = formatConclusionDispatchReport({
    dispatchId: 'dispatch-2',
    traceId: null,
    status: 'disabled',
    counts: { dispatched: 0, completed: 0, failed: 0, skipped: 0 },
    startedAt: NOW.toISOString(),
    endedAt: NOW.toISOString(),
    items: [],
  });
  assert.equal(text, '');
});

test('分发记录写入去重台账且不含令牌字段', async () => {
  const { plane } = planeFixture();
  const files = sandbox({ dispatchDomains: ['kitting'] });
  await buildDispatcher(plane, files).dispatchForObject({ businessObjectRef: 'business://order/O-8' });
  const store = JSON.parse(readFileSync(files.storeFile, 'utf8'));
  assert.equal(store.records.length, 1);
  assert.equal(store.records[0].key, 'control-platform|reason_control_platform|material_kitting_analysis|business://order/O-8');
  assert.equal(store.records[0].status, 'completed');
  assert.equal(JSON.stringify(store).includes('token'), false);
});
