// 执行面查询智能体模拟桩：验证「管理面 ↔ 执行面」反向连接通道。
// 职责：连 /ws/agent → register → 周期 heartbeat → 收到 dispatch 时真查 company-control（复用 Python upstream_client）→ 回报结果 → 收到 recall 时中止查询。
// 真实执行面按 docs/execution-plane-agent-contract.md 实现；本脚本仅用于 Hub 侧端到端验证。
import WebSocket from 'ws';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COMPANY_CONTROL_QUERY_INTENT } from '../aeos-execution-agent/src/adapters/company-control-query.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const mcpCompanyControlDir = join(root, 'mcp-company-control');
const queryHelper = join(__dirname, 'company-control-query.py');
const pythonExe = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');

const token = process.env.EXECUTION_PLANE_TOKEN ?? '';
const wsUrl = process.env.EXECUTION_WS_URL ?? 'ws://127.0.0.1:8788/execution-agent';
const agentId = process.env.EXECUTION_AGENT_ID ?? 'runtime-control-platform-agent';
const sourceSystem = process.env.EXECUTION_SOURCE_SYSTEM ?? '公司中控平台（本机演示）';

if (!token) {
  console.error('[simulator] 缺少 EXECUTION_PLANE_TOKEN 环境变量（需与管理面一致）');
  process.exit(1);
}
if (!existsSync(pythonExe)) {
  console.error(`[simulator] 未找到 Python 解释器: ${pythonExe}`);
  process.exit(1);
}

const QUERY_PATHS = [
  '/common/ping',
  '/external/orders/list',
  '/external/order-details/list',
  '/external/boms/tree',
  '/external/materials/list',
  '/external/suppliers/list',
  '/external/material-kitting/results',
  '/external/material-kitting/shortages',
  '/external/material-kitting/demands',
  '/external/inventory/availability',
  '/external/material-supplies/list',
  '/external/quality-issues/list',
  '/external/quality-trace/list',
  '/external/production/work-orders/list',
  '/external/production/operations/list',
  '/external/production/order-links/list',
  '/external/production/reports/list',
  '/external/production/capacity/list',
];

const capabilities = [
  {
    name: 'query_control_platform',
    description: '精确查询中台只读业务数据',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', enum: QUERY_PATHS }, params: { type: 'object' } },
      required: ['path'],
    },
    constraints: { readOnly: true },
    intent: COMPANY_CONTROL_QUERY_INTENT,
  },
  {
    name: 'reason_control_platform',
    description: '调用中台自有大模型或推理智能体完成只读分析',
    inputSchema: {
      type: 'object',
      properties: { prompt: { type: 'string', maxLength: 2000 }, task_type: { type: 'string' } },
      required: ['prompt', 'task_type'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        conclusions: {
          type: 'array',
          items: { type: 'object', properties: { evidence_refs: { type: 'array', minItems: 1 } }, required: ['evidence_refs'] },
        },
      },
    },
    constraints: { readOnly: true, requireEvidence: true },
  },
];

let ws = null;
let heartbeatTimer = null;
let currentChild = null;
let recalled = false;
// 模拟慢查询（毫秒）：用于端到端验证「派单中召回」。默认 0 = 立即执行。
const simulateDelayMs = Number(process.env.EXECUTION_SIMULATE_DELAY_MS ?? 0);

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// 执行步骤回执：模拟真实中台在上报任务时逐步发送（方法 2 的参考实现）。
const runSeq = new Map();
function sendRunEvent(runId, event, name, status, summary, detail = null, timings = {}) {
  const seq = (runSeq.get(runId) ?? 0) + 1;
  runSeq.set(runId, seq);
  send({
    type: 'run_event',
    runId,
    eventId: `evt-${runId}-${seq}`,
    seq,
    event,
    name,
    status,
    summary,
    detail,
    startedAt: timings.startedAt ?? null,
    endedAt: timings.endedAt ?? null,
    durationMs: timings.durationMs ?? null,
  });
}

function summarizeRows(data) {
  if (Array.isArray(data?.items)) return data.items.length;
  if (Array.isArray(data)) return data.length;
  return null;
}

function startHeartbeat(intervalMs) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    send({ type: 'heartbeat', status: currentChild ? 'working' : 'idle' });
  }, intervalMs);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// 推理能力占位：中台大模型/推理智能体接口尚未接通，返回明确的「未接通」结果，绝不伪造真实推理。
async function handleReasoningDispatch(msg) {
  const runId = msg.runId;
  const input = msg.input && typeof msg.input === 'object' ? msg.input : {};
  const runStartedAt = new Date().toISOString();
  console.log(`[simulator] 收到推理派单 ${runId}: prompt=${String(input.prompt || '').slice(0, 80)}`);
  sendRunEvent(runId, 'run_received', '收到推理任务', 'info', `prompt=${String(input.prompt || '').slice(0, 120)}`, { prompt: input.prompt ?? null }, { startedAt: runStartedAt });
  send({ type: 'run_update', runId, state: 'running' });
  if (simulateDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, simulateDelayMs));
  if (recalled) {
    sendRunEvent(runId, 'run_summary', '任务已召回', 'info', '任务在推理前被召回', null, { startedAt: runStartedAt, endedAt: new Date().toISOString() });
    console.log(`[simulator] 推理派单 ${runId} 已被召回，跳过执行`);
    return;
  }
  const stepStartedAt = new Date().toISOString();
  sendRunEvent(runId, 'step_started', '调用中台推理能力', 'started', '准备调用推理接口', null, { startedAt: stepStartedAt });
  const endedAt = new Date().toISOString();
  sendRunEvent(runId, 'step_completed', '调用中台推理能力', 'completed', '推理接口尚未接通（模拟占位）', null, {
    startedAt: stepStartedAt,
    endedAt,
    durationMs: Math.max(0, new Date(endedAt).getTime() - new Date(stepStartedAt).getTime()),
  });
  sendRunEvent(runId, 'run_summary', '任务完成', 'completed', '推理能力尚未接通中台大模型（模拟占位）', { data_confidence: 'low' }, { startedAt: runStartedAt, endedAt });
  send({
    type: 'run_complete',
    runId,
    result: {
      summary: '推理能力尚未接通中台大模型（模拟占位）。',
      conclusions: [{
        matter: '中台推理接口未接通',
        evidence_refs: ['control-platform://reasoning/not-connected'],
        risk: '无法给出真实分析结论',
        recommendation: '请向中台确认推理接口契约并接入后重试',
        confidence: 'low',
      }],
      data_as_of: new Date().toISOString(),
      data_confidence: 'low',
    },
  });
}

async function handleDispatch(msg) {
  recalled = false;
  if (msg.capability === 'reason_control_platform') {
    await handleReasoningDispatch(msg);
    return;
  }
  const runId = msg.runId;
  const input = msg.input && typeof msg.input === 'object' ? msg.input : {};
  const path = typeof input.path === 'string' ? input.path : '';
  const params = input.params && typeof input.params === 'object' ? input.params : {};
  const runStartedAt = new Date().toISOString();
  console.log(`[simulator] 收到派单 ${runId}: path=${path} params=${JSON.stringify(params)}`);
  if (!path) {
    const endedAt = new Date().toISOString();
    sendRunEvent(runId, 'error', '参数校验', 'failed', 'input.path 不能为空', null, { startedAt: runStartedAt, endedAt });
    sendRunEvent(runId, 'run_summary', '任务失败', 'failed', 'input.path 不能为空', null, { startedAt: runStartedAt, endedAt });
    send({ type: 'run_failed', runId, error: { code: 'INVALID_ARGUMENT', message: 'input.path 不能为空' } });
    return;
  }
  sendRunEvent(runId, 'run_received', '收到查询任务', 'info', `path=${path}`, { path, params }, { startedAt: runStartedAt });
  send({ type: 'run_update', runId, state: 'running' });
  if (simulateDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, simulateDelayMs));
  if (recalled) {
    sendRunEvent(runId, 'run_summary', '任务已召回', 'info', '任务在执行前被召回', { path }, { startedAt: runStartedAt, endedAt: new Date().toISOString() });
    console.log(`[simulator] 派单 ${runId} 已被召回，跳过执行`);
    return;
  }
  const stepStartedAt = new Date().toISOString();
  sendRunEvent(runId, 'step_started', '查询中台接口', 'started', path, { path, params }, { startedAt: stepStartedAt });
  currentChild = execFile(
    pythonExe,
    [queryHelper, path, JSON.stringify(params)],
    { cwd: mcpCompanyControlDir, timeout: 30_000 },
    (err, stdout) => {
      currentChild = null;
      if (recalled) return;
      const endedAt = new Date().toISOString();
      const durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(stepStartedAt).getTime());
      const finishFailure = (code, message) => {
        sendRunEvent(runId, 'error', '查询中台接口', 'failed', message, { path, code }, { startedAt: stepStartedAt, endedAt, durationMs });
        sendRunEvent(runId, 'run_summary', '任务失败', 'failed', message, { path, code }, { startedAt: runStartedAt, endedAt });
        send({ type: 'run_failed', runId, error: { code, message } });
      };
      if (err) {
        finishFailure('EXECUTION_FAILED', String(err.message || err));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.ok) {
          const rows = summarizeRows(parsed.data);
          sendRunEvent(runId, 'step_completed', '查询中台接口', 'completed', `查询完成${rows !== null ? `，返回 ${rows} 条` : ''}`, { path, rows }, { startedAt: stepStartedAt, endedAt, durationMs });
          sendRunEvent(runId, 'run_summary', '任务完成', 'completed', `查询 ${path} 完成`, { path, rows }, { startedAt: runStartedAt, endedAt });
          send({ type: 'run_complete', runId, result: parsed.data });
        } else {
          finishFailure(parsed.code || 'EXECUTION_FAILED', parsed.message || '查询失败');
        }
      } catch {
        finishFailure('EXECUTION_FAILED', '查询结果解析失败');
      }
    },
  );
}

function connect() {
  ws = new WebSocket(wsUrl, { headers: { 'x-aeos-execution-token': token } });
  ws.on('open', () => {
    console.log('[simulator] 已连接管理面，发送 register');
    send({ type: 'register', agentId, name: '公司中台执行面智能体', version: '1.0.0', sourceSystem, capabilities });
  });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === 'registered') {
      console.log(`[simulator] 注册成功，心跳间隔 ${msg.heartbeatIntervalMs}ms`);
      startHeartbeat(typeof msg.heartbeatIntervalMs === 'number' ? msg.heartbeatIntervalMs : 5000);
    } else if (msg.type === 'dispatch') {
      handleDispatch(msg);
    } else if (msg.type === 'recall') {
      console.log(`[simulator] 收到召回${msg.runId ? ' ' + msg.runId : ''}`);
      recalled = true;
      if (currentChild) { currentChild.kill(); currentChild = null; }
      // 不回报结果：管理面已在 recall 时把 run 标记为 recalled。
    } else if (msg.type === 'error') {
      console.error('[simulator] 管理面错误:', msg.message);
    }
  });
  ws.on('close', () => {
    console.log('[simulator] 连接关闭');
    stopHeartbeat();
  });
  ws.on('error', (err) => {
    console.error('[simulator] 连接错误:', err.message);
  });
}

connect();
