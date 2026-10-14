import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentRunInstructions, mapRunOutcome, startAgentTaskRun } from '../src/agent-task-runner.ts';

const agent = {
  name: '订单交付分析 Agent',
  role: '订单交付风险分析',
  registration: {
    allowedRuntimeCapabilities: ['company-control.orders_list', 'company-control.order_details_list'],
    taskServiceProfile: { dataFreshnessMinutes: 30 },
  },
};

const task = {
  title: '订单交付风险核查',
  businessObjectRef: 'order://SO-2609-001',
  evidenceRefs: ['control-platform://orders/SO-2609-001@2026-10-10'],
};

test('buildAgentRunInstructions injects the read-only duty, tool scope, freshness, and structured output', () => {
  const instructions = buildAgentRunInstructions(agent, task);
  assert.match(instructions, /只读/);
  assert.match(instructions, /company-control\.orders_list/);
  assert.match(instructions, /company-control\.order_details_list/);
  assert.match(instructions, /30 分钟/);
  assert.match(instructions, /evidence_refs/);
  assert.match(instructions, /不得自行 Verify/);
  assert.match(instructions, /不得关闭任务/);
  assert.match(instructions, /订单交付风险核查/);
  assert.match(instructions, /SO-2609-001/);
});

test('buildAgentRunInstructions falls back when no capabilities or evidence are declared', () => {
  const sparse = buildAgentRunInstructions(
    { ...agent, registration: { allowedRuntimeCapabilities: [], taskServiceProfile: { dataFreshnessMinutes: 0 } } },
    { title: '任务', businessObjectRef: 'obj://x', evidenceRefs: [] },
  );
  assert.match(sparse, /数据置信度不足/);
});

test('mapRunOutcome distinguishes completed, failed, and human-decision outcomes', () => {
  assert.deepEqual(mapRunOutcome({ state: 'completed' }), { state: 'completed' });
  assert.deepEqual(mapRunOutcome({ state: 'failed', failure: { message: '运行超时' } }), { state: 'failed', reason: '运行超时' });
  assert.deepEqual(mapRunOutcome({ state: 'failed', failure: { message: '上游依赖不可用' } }), { state: 'awaiting_decision', reason: '上游依赖不可用' });
  assert.deepEqual(mapRunOutcome({ state: 'failed', failure: { message: '数据不足' } }), { state: 'awaiting_decision', reason: '数据不足' });
  assert.deepEqual(mapRunOutcome({ state: 'interrupted' }), { state: 'awaiting_decision', reason: '运行被中断，等待人工决策' });
});

test('startAgentTaskRun resolves instructions and identity server-side and returns a governed run', async () => {
  const calls: string[] = [];
  const run = await startAgentTaskRun(
    { taskId: 'task-1', correlationId: 'corr-1', title: '订单交付风险核查', businessObjectRef: 'order://SO-1', evidenceRefs: [] },
    { ...agent, id: 'agent-1' },
    {
      now: () => new Date('2026-10-10T01:00:00.000Z'),
      runtime: {
        createSession: async (request) => { calls.push('createSession'); assert.match(request.developerInstructions ?? '', /不得自行 Verify/); return { id: 'session-1' }; },
        startRun: async (sessionId, request) => { calls.push(`startRun:${sessionId}`); assert.equal(request.input, '订单交付风险核查'); return { id: 'run-1' }; },
        waitForRun: async () => { calls.push('waitForRun'); return { state: 'completed' }; },
      },
    },
  );
  assert.deepEqual(calls, ['createSession', 'startRun:session-1', 'waitForRun']);
  assert.equal(run.taskId, 'task-1');
  assert.equal(run.agentId, 'agent-1');
  assert.equal(run.correlationId, 'corr-1');
  assert.deepEqual(run.outcome, { state: 'completed' });
});

test('startAgentTaskRun passes runtimeInput as the run input when provided', async () => {
  let receivedInput: string | undefined;
  const run = await startAgentTaskRun(
    { taskId: 'task-2', correlationId: 'corr-2', title: '物料齐套核查', businessObjectRef: 'business://kitting/HJY1%3A18', evidenceRefs: [], runtimeInput: '{"path":"/external/material-kitting/results","params":{"demand_no":"HJY1"}}' },
    { ...agent, id: 'agent-2' },
    {
      runtime: {
        createSession: async () => ({ id: 'session-2' }),
        startRun: async (_sessionId, request) => { receivedInput = request.input; return { id: 'run-2' }; },
        waitForRun: async () => ({ state: 'completed' }),
      },
    },
  );
  assert.equal(receivedInput, '{"path":"/external/material-kitting/results","params":{"demand_no":"HJY1"}}');
  assert.deepEqual(run.outcome, { state: 'completed' });
});
