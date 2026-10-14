// 执行面查询智能体模拟桩：验证「管理面 ↔ 执行面」反向连接通道。
// 职责：连 /ws/agent → register → 周期 heartbeat → 收到 dispatch 时真查 company-control（复用 Python upstream_client）→ 回报结果 → 收到 recall 时中止查询。
// 真实执行面按 docs/execution-plane-agent-contract.md 实现；本脚本仅用于 Hub 侧端到端验证。
import WebSocket from 'ws';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const mcpCompanyControlDir = join(root, 'mcp-company-control');
const queryHelper = join(__dirname, 'company-control-query.py');
const pythonExe = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');

const token = process.env.EXECUTION_PLANE_TOKEN ?? '';
const wsUrl = process.env.EXECUTION_WS_URL ?? 'ws://127.0.0.1:8788/execution-agent';
const agentId = process.env.EXECUTION_AGENT_ID ?? 'execution-query-agent';

if (!token) {
  console.error('[simulator] 缺少 EXECUTION_PLANE_TOKEN 环境变量（需与管理面一致）');
  process.exit(1);
}
if (!existsSync(pythonExe)) {
  console.error(`[simulator] 未找到 Python 解释器: ${pythonExe}`);
  process.exit(1);
}

const capabilities = [
  { name: 'query_control_platform', description: '中台只读查询：path + params，HMAC 签名直查上游' },
];

let ws = null;
let heartbeatTimer = null;
let currentChild = null;

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
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

function handleDispatch(msg) {
  const runId = msg.runId;
  const input = msg.input && typeof msg.input === 'object' ? msg.input : {};
  const path = typeof input.path === 'string' ? input.path : '';
  const params = input.params && typeof input.params === 'object' ? input.params : {};
  console.log(`[simulator] 收到派单 ${runId}: path=${path} params=${JSON.stringify(params)}`);
  if (!path) {
    send({ type: 'run_failed', runId, error: { code: 'INVALID_ARGUMENT', message: 'input.path 不能为空' } });
    return;
  }
  send({ type: 'run_update', runId, state: 'running' });
  currentChild = execFile(
    pythonExe,
    [queryHelper, path, JSON.stringify(params)],
    { cwd: mcpCompanyControlDir, timeout: 30_000 },
    (err, stdout) => {
      currentChild = null;
      if (err) {
        send({ type: 'run_failed', runId, error: { code: 'EXECUTION_FAILED', message: String(err.message || err) } });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.ok) {
          send({ type: 'run_complete', runId, result: parsed.data });
        } else {
          send({ type: 'run_failed', runId, error: { code: parsed.code || 'EXECUTION_FAILED', message: parsed.message || '查询失败' } });
        }
      } catch {
        send({ type: 'run_failed', runId, error: { code: 'EXECUTION_FAILED', message: '查询结果解析失败' } });
      }
    },
  );
}

function connect() {
  ws = new WebSocket(wsUrl, { headers: { 'x-aeos-execution-token': token } });
  ws.on('open', () => {
    console.log('[simulator] 已连接管理面，发送 register');
    send({ type: 'register', agentId, name: '查询智能体', version: '1.0.0', capabilities });
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
