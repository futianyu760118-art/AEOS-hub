// AEOS 执行面 Agent 核心：WebSocket 反向连接 + 注册 + 心跳 + 指数退避重连 + 派单路由 + 召回。
// 本层与具体业务系统无关，只依赖公开的「执行面通信协议」。
import WebSocket from 'ws';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
const DEFAULT_REASONING_TIMEOUT_MS = 200_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

function handlerTimeoutMs(capability, override) {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) return override;
  return /(^|[_-])reason(ing)?([_-]|$)/i.test(capability)
    ? DEFAULT_REASONING_TIMEOUT_MS
    : DEFAULT_QUERY_TIMEOUT_MS;
}

/** 优先使用每系统令牌；未配置时保留 legacy 根令牌，便于滚动升级。 */
export function buildConnectionHeaders(config) {
  if (config.systemId && config.systemToken) {
    return {
      'x-aeos-system-id': config.systemId,
      'x-aeos-system-token': config.systemToken,
    };
  }
  return { 'x-aeos-execution-token': config.token };
}

export class ExecutionAgentCore {
  constructor(config, handlers, log = console.log) {
    this.config = config; // { wsUrl, token, systemId, systemToken, agentId, name, version, protocolVersion, sourceSystem, capabilities }
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
    const ws = new WebSocket(this.config.wsUrl, { headers: buildConnectionHeaders(this.config) });
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
    const message = {
      type: 'register',
      agentId: this.config.agentId,
      name: this.config.name,
      version: this.config.version,
      protocolVersion: this.config.protocolVersion,
      sourceSystem: this.config.sourceSystem,
      capabilities: this.config.capabilities,
    };
    // 网关模式附带角色与版本；直连模式不带，保持协议向后兼容。
    if (this.config.agentKind) message.kind = this.config.agentKind;
    if (this.config.gatewayVersion) message.gatewayVersion = this.config.gatewayVersion;
    this.send(message);
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
    const runId = msg.runId;
    const timeoutMs = handlerTimeoutMs(capability, msg.timeoutMs);
    let timer = null;
    const controller = new AbortController();
    const finish = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (this.activeRun?.runId === runId) this.activeRun = null;
    };
    const ctx = {
      runId,
      aborted: false,
      signal: controller.signal,
      sendProgress: (detail) => {
        if (!ctx.aborted) this.send({ type: 'run_update', runId, state: 'running', detail });
      },
      sendComplete: (result, usage) => {
        if (ctx.aborted) return;
        ctx.aborted = true;
        finish();
        this.send(usage ? { type: 'run_complete', runId, result, usage } : { type: 'run_complete', runId, result });
      },
      sendFailed: (code, message) => {
        if (ctx.aborted) return;
        ctx.aborted = true;
        finish();
        this.sendRunFailed(runId, code, message);
      },
    };
    this.activeRun = { runId, ctx, timer: null, controller };
    this.log(`[agent] 收到派单 ${runId}: ${capability}`);
    timer = setTimeout(() => {
      if (this.activeRun?.runId !== runId) return;
      ctx.aborted = true;
      controller.abort();
      this.activeRun = null;
      this.sendRunFailed(runId, 'EXECUTION_TIMEOUT', `执行超时（${timeoutMs}ms）`);
    }, timeoutMs);
    timer.unref?.();
    this.activeRun.timer = timer;
    Promise.resolve()
      .then(() => handler(msg.input ?? {}, ctx))
      .then((result) => {
        if (!ctx.aborted) ctx.sendComplete(result);
      })
      .catch((error) => {
        if (!ctx.aborted) ctx.sendFailed(error?.code || 'EXECUTION_FAILED', error?.message || String(error));
      });
  }

  handleRecall(msg) {
    if (this.activeRun && (msg.runId === undefined || this.activeRun.runId === msg.runId)) {
      const active = this.activeRun;
      active.ctx.aborted = true;
      active.controller?.abort();
      if (active.timer) clearTimeout(active.timer);
      this.activeRun = null;
      this.log(`[agent] 收到召回 ${msg.runId ?? ''}`);
    }
  }

  heartbeat() {
    this.send({
      type: 'heartbeat',
      status: this.activeRun ? 'working' : 'idle',
      currentRunId: this.activeRun?.runId ?? null,
    });
  }

  startHeartbeat(intervalMs) {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat();
    }, intervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  scheduleReconnect() {
    this.stopHeartbeat();
    if (this.activeRun?.timer) clearTimeout(this.activeRun.timer);
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
