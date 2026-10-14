// AEOS 执行面 Agent 核心：WebSocket 反向连接 + 注册 + 心跳 + 指数退避重连 + 派单路由 + 召回。
// 本层与具体业务系统无关，只依赖公开的「执行面通信协议」。
import WebSocket from 'ws';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export class ExecutionAgentCore {
  constructor(config, handlers, log = console.log) {
    this.config = config; // { wsUrl, token, agentId, name, version, protocolVersion, sourceSystem, capabilities }
    this.handlers = handlers; // { [capability]: (input, ctx) => void }
    this.log = log;
    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectAttempt = 0;
    this.shouldRun = false;
    this.activeRun = null;
  }

  start() {
    this.shouldRun = true;
    this.connect();
  }

  stop() {
    this.shouldRun = false;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  connect() {
    const ws = new WebSocket(this.config.wsUrl, { headers: { 'x-aeos-execution-token': this.config.token } });
    this.ws = ws;
    ws.on('open', () => {
      this.reconnectAttempt = 0;
      this.register();
    });
    ws.on('message', (raw) => this.handleMessage(String(raw)));
    ws.on('close', () => this.scheduleReconnect());
    ws.on('error', (err) => this.log(`[agent] 连接错误: ${err.message}`));
  }

  register() {
    this.send({
      type: 'register',
      agentId: this.config.agentId,
      name: this.config.name,
      version: this.config.version,
      protocolVersion: this.config.protocolVersion,
      sourceSystem: this.config.sourceSystem,
      capabilities: this.config.capabilities,
    });
    this.log(`[agent] 已发送 register：${this.config.agentId}（${this.config.capabilities.map((c) => c.name).join(', ')}）`);
  }

  handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'registered') {
      this.log(`[agent] 注册成功，心跳间隔 ${msg.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS}ms`);
      this.startHeartbeat(msg.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
    } else if (msg.type === 'dispatch') {
      this.handleDispatch(msg);
    } else if (msg.type === 'recall') {
      this.handleRecall(msg);
    } else if (msg.type === 'error') {
      this.log(`[agent] 管理面错误: ${msg.message}`);
    }
  }

  handleDispatch(msg) {
    const capability = msg.capability;
    const handler = this.handlers[capability];
    if (typeof handler !== 'function') {
      this.sendRunFailed(msg.runId, 'CAPABILITY_UNSUPPORTED', `不支持能力 ${capability}`);
      return;
    }
    const ctx = {
      runId: msg.runId,
      aborted: false,
      sendProgress: (detail) => this.send({ type: 'run_update', runId: msg.runId, state: 'running', detail }),
      sendComplete: (result) => this.send({ type: 'run_complete', runId: msg.runId, result }),
      sendFailed: (code, message) => this.sendRunFailed(msg.runId, code, message),
    };
    this.activeRun = { runId: msg.runId, ctx };
    this.log(`[agent] 收到派单 ${msg.runId}: ${capability}`);
    Promise.resolve()
      .then(() => handler(msg.input ?? {}, ctx))
      .catch((error) => ctx.sendFailed('EXECUTION_FAILED', error?.message || String(error)));
  }

  handleRecall(msg) {
    if (this.activeRun && (msg.runId === undefined || this.activeRun.runId === msg.runId)) {
      this.activeRun.ctx.aborted = true;
      this.activeRun = null;
      this.log(`[agent] 收到召回 ${msg.runId ?? ''}`);
    }
  }

  startHeartbeat(intervalMs) {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'heartbeat', status: this.activeRun ? 'working' : 'idle' });
    }, intervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  scheduleReconnect() {
    this.stopHeartbeat();
    this.activeRun = null;
    if (!this.shouldRun) return;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.log(`[agent] 连接断开，${delay}ms 后重连`);
    setTimeout(() => { if (this.shouldRun) this.connect(); }, delay);
  }

  sendRunFailed(runId, code, message) {
    this.send({ type: 'run_failed', runId, error: { code, message } });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }
}
