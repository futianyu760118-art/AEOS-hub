import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ConclusionDispatcher,
  formatConclusionDispatchReport,
  loadConclusionDispatchPolicy,
  saveConclusionDispatchPolicy,
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
              summary: '齐套分析完成：3 行齐套、2 行缺料',
              conclusions: [
                { matter: '结论一：基础 BOM 行缺料', risk: '影响交付', recommendation: '请物控确认', confidence: 'high' },
                { matter: '结论二：存在替代料' },
              ],
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
  assert.deepEqual(kitting?.options, { traceId: 'orch-1', requestId: 'orch-1:material_kitting_analysis', caller: { systemId: 'aeos-hub', agentId: 'AG-1', userId: 'U-1', taskId: null, traceId: 't-1' } });
  assert.deepEqual(report.items[0]?.handledBy, { agentId: 'spc-internal-1', name: '齐套研判', role: 'kitting' });
  assert.equal(report.items[0]?.conclusions, 2);
  assert.equal(report.items[0]?.summary, '齐套分析完成：3 行齐套、2 行缺料');
  assert.deepEqual(report.items[0]?.conclusionHighlights, [
    { matter: '结论一：基础 BOM 行缺料', risk: '影响交付', recommendation: '请物控确认', confidence: 'high' },
    { matter: '结论二：存在替代料' },
  ]);
  assert.equal(report.items[0]?.systemName, 'control-platform');
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

test('分发结果文案：合并成一份可读报告', () => {
  const report = {
    dispatchId: 'dispatch-1',
    traceId: 'orch-1',
    status: 'completed' as const,
    counts: { dispatched: 1, completed: 1, failed: 0, skipped: 1 },
    startedAt: NOW.toISOString(),
    endedAt: NOW.toISOString(),
    items: [
      {
        domain: 'kitting' as const,
        businessObjectRef: 'business://order/O-1',
        status: 'completed' as const,
        systemId: 'control-platform',
        systemName: '公司中控平台',
        conclusions: 3,
        summary: '3 行齐套、2 行缺料',
        conclusionHighlights: [
          { matter: '基础 BOM 行缺料', risk: '影响交付', recommendation: '请物控确认', confidence: 'high' },
        ],
      },
      { domain: 'quality' as const, businessObjectRef: 'business://order/O-1', status: 'skipped' as const, reason: 'NO_PROVIDER' },
    ],
  };
  const text = formatConclusionDispatchReport(report);
  assert.match(text, /已自动分发给其他系统 Agent（1 项）/);
  assert.match(text, /【物料齐套 · 公司中控平台】3 条结论/);
  assert.match(text, /摘要：3 行齐套、2 行缺料/);
  assert.match(text, /1\. 基础 BOM 行缺料（风险：影响交付；建议：请物控确认；置信度：high）/);
  assert.match(text, /其余 2 条见「处理记录」/);
  assert.match(text, /暂无提供方：质量异常/);
  assert.match(text, /完整依据与执行步骤见「处理记录」/);
});

test('分发结果文案：没有结论时明确说明，不编造', () => {
  const text = formatConclusionDispatchReport({
    dispatchId: 'dispatch-3',
    traceId: null,
    status: 'completed',
    counts: { dispatched: 1, completed: 1, failed: 0, skipped: 0 },
    startedAt: NOW.toISOString(),
    endedAt: NOW.toISOString(),
    items: [
      { domain: 'quality' as const, businessObjectRef: 'business://order/O-1', status: 'completed' as const, systemId: 'control-platform', conclusions: 0 },
    ],
  });
  assert.match(text, /未返回明确结论，需人工复核/);
});

test('分发结果文案：忙碌与上游错误翻译成可读原因', () => {
  const text = formatConclusionDispatchReport({
    dispatchId: 'dispatch-4',
    traceId: null,
    status: 'failed',
    counts: { dispatched: 1, completed: 0, failed: 1, skipped: 0 },
    startedAt: NOW.toISOString(),
    endedAt: NOW.toISOString(),
    items: [
      {
        domain: 'kitting' as const,
        businessObjectRef: 'business://order/O-1',
        status: 'failed' as const,
        reason: 'RUN_FAILED',
        systemId: 'control-platform',
        error: { code: 'INTERNAL_ERROR', message: 'agent busy' },
      },
    ],
  });
  assert.match(text, /目标系统忙碌，请稍后重试/);
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

test('报告使用系统显示名而不是技术 ID', async () => {
  const { plane } = planeFixture();
  const files = sandbox({ dispatchDomains: ['kitting'] });
  const dispatcher = new ConclusionDispatcher(plane, {
    policyFile: files.policyFile,
    storeFile: files.storeFile,
    now: () => NOW,
    idFactory: () => 'label-test',
    pollIntervalMs: 1,
    systemLabel: (systemId) => systemId === 'control-platform' ? '公司中控平台' : systemId,
  });
  const report = await dispatcher.dispatchForObject({ businessObjectRef: 'business://order/O-11' });
  assert.equal(report.items[0]?.systemName, '公司中控平台');
  assert.match(formatConclusionDispatchReport(report), /【物料齐套 · 公司中控平台 · 齐套研判】/);
});

test('分发过程推送进度事件', async () => {
  const { plane } = planeFixture();
  const files = sandbox();
  const events: Array<Record<string, unknown>> = [];
  await buildDispatcher(plane, files).dispatchForObject(
    { businessObjectRef: 'business://order/O-12' },
    { onProgress: (event) => { events.push(event as unknown as Record<string, unknown>); } },
  );
  assert.deepEqual(events[0], { phase: 'started', index: 0, total: 2 });
  assert.deepEqual(events[1], { phase: 'item_started', index: 1, total: 2, domain: 'kitting' });
  assert.equal(events[2]?.phase, 'item_completed');
  assert.equal(events[2]?.status, 'completed');
  assert.equal(events[2]?.conclusions, 2);
  assert.equal(events[3]?.domain, 'quality');
  assert.equal(events.length, 5);
});

test('显式重新分析时跳过去重', async () => {
  const { plane, dispatched } = planeFixture();
  const files = sandbox({ dispatchDomains: ['kitting'] });
  const dispatcher = buildDispatcher(plane, files);
  await dispatcher.dispatchForObject({ businessObjectRef: 'business://order/O-13' });
  const forced = await dispatcher.dispatchForObject({ businessObjectRef: 'business://order/O-13' }, { force: true });
  assert.equal(forced.counts.completed, 1);
  assert.equal(dispatched.length, 2);
});

test('重复分发时提示可以要求重新分析', () => {
  const text = formatConclusionDispatchReport({
    dispatchId: 'dispatch-5',
    traceId: null,
    status: 'skipped',
    counts: { dispatched: 0, completed: 0, failed: 0, skipped: 1 },
    startedAt: NOW.toISOString(),
    endedAt: NOW.toISOString(),
    items: [
      { domain: 'kitting' as const, businessObjectRef: 'business://order/O-1', status: 'skipped' as const, reason: 'DUPLICATE', systemId: 'control-platform' },
    ],
  });
  assert.match(text, /已分发过：物料齐套/);
  assert.match(text, /回复“重新分析”/);
});

test('近 24 小时分发过的业务对象可被列出，用于“下一条”排除', async () => {
  const { plane } = planeFixture();
  const files = sandbox({ dispatchDomains: ['kitting'] });
  const dispatcher = buildDispatcher(plane, files);
  await dispatcher.dispatchForObject({ businessObjectRef: 'business://order/O-14' });
  assert.deepEqual(dispatcher.recentBusinessObjectRefs(24), ['business://order/O-14']);
});

test('系统配置保存：只改开关、分发域与上限，目标系统保持不变', () => {
  const files = sandbox();
  const saved = saveConclusionDispatchPolicy({ enabled: true, dispatchDomains: ['order', 'bad', 'quality'], maxItemsPerAnalysis: 3 }, files.policyFile);
  assert.equal(saved.enabled, true);
  assert.deepEqual(saved.dispatchDomains, ['order', 'quality']);
  assert.equal(saved.maxItemsPerAnalysis, 3);
  assert.equal(saved.revision, 2);
  assert.ok(saved.targets.kitting);
  const reloaded = loadConclusionDispatchPolicy(files.policyFile);
  assert.deepEqual(reloaded.dispatchDomains, ['order', 'quality']);
});

test('系统配置保存：启用时必须选择分析域且上限至少为 1', () => {
  const files = sandbox();
  assert.throws(() => saveConclusionDispatchPolicy({ enabled: true, dispatchDomains: [], maxItemsPerAnalysis: 2 }, files.policyFile), /至少要选择一个分析域/);
  assert.throws(() => saveConclusionDispatchPolicy({ enabled: true, dispatchDomains: ['kitting'], maxItemsPerAnalysis: 0 }, files.policyFile), /至少为 1/);
});
