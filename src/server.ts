// AEOS Hub Web 控制台服务端：静态页 + WebSocket（聊天流/审批/配置）
// 复用 src/codex-client.ts；codex 运行时仍为项目内固定版本 + 隔离 CODEX_HOME。
// 启动: npm run web   →   http://127.0.0.1:8787
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { loadConversations, saveConversations, upsertConversation, dataDir, convFile, type Conversation } from './conversations.ts';
import { codexHome, configFile, readConfig, saveModelConfig, listEnvKeys, setEnvKey, loadModelPresets, saveModelPresets, ensureConfigFile } from './hub-config.ts';
import { appendEvidence, evidenceFile } from './evidence.ts';
import {
  loadHarbor,
  createHarborAgent,
  createHarborRuntime,
  createHarborProject,
  recordHarborRuntimeVerification,
  HarborStoreNotFoundError,
  type HarborRuntimeVerificationStatus,
} from './harbor-store.ts';
import { CodexRuntimeAdapter, RuntimeSupervisor, type RuntimeApprovalRequest, type RuntimeEvent } from './runtime/index.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const binary = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex');
const PORT = Number(process.env.PORT ?? 8787);
const CODEX_RUNTIME_ID = 'runtime-codex-local';

if (!existsSync(binary)) {
  console.error(`[FAIL] 未找到项目内 codex CLI: ${binary}，请先 npm install`);
  process.exit(1);
}
// 首次运行自动生成隔离配置（含 demo-erp MCP 注册），克隆后零手工配置
ensureConfigFile();
if (!existsSync(join(codexHome, 'auth.json'))) {
  console.warn('[WARN] 隔离目录缺少凭证 auth.json：对话将无法调用模型。');
  console.warn('       可先执行: cp ~/.codex/auth.json 到 ' + join(codexHome, 'auth.json'));
}

// ---------- 监听地址与访问口令 ----------
// 默认仅本机；--lan 绑定 0.0.0.0 供局域网访问，并自动启用访问口令（分享链接带 token）。
// --no-auth（或 HUB_NO_AUTH=1）可关闭口令——仅在完全可信网络下使用。
const cliArgs = process.argv.slice(2);
const LAN_MODE = cliArgs.includes('--lan');
const NO_AUTH = cliArgs.includes('--no-auth') || process.env.HUB_NO_AUTH === '1';
const LISTEN_HOST = process.env.HOST || (LAN_MODE ? '0.0.0.0' : '127.0.0.1');

let ACCESS_TOKEN = '';
if (!NO_AUTH) {
  const tokenFile = join(dataDir, 'access-token.txt');
  try {
    if (existsSync(tokenFile)) ACCESS_TOKEN = readFileSync(tokenFile, 'utf-8').trim();
    if (!ACCESS_TOKEN) {
      ACCESS_TOKEN = randomUUID().replace(/-/g, '');
      writeFileSync(tokenFile, ACCESS_TOKEN + '\n', 'utf-8');
    }
  } catch (error) {
    console.error('[FAIL] 无法读写访问口令文件 ' + tokenFile + ': ' + (error as Error).message);
    process.exit(1);
  }
}
/** 口令 Cookie 的严格形态：由 randomUUID 去连字符生成的 32 位十六进制 */
const HUB_COOKIE_RE = /(?:^|;\s*)hub_token=([0-9a-f]{32})(?:;|$)/;
/** 恒时比较，避免按字符提前返回造成的时序侧信道 */
function tokenEquals(candidate: string, expected: string): boolean {
  if (!candidate || !expected || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}
function isAuthorized(cookieVal: string, queryVal: string | null): boolean {
  if (NO_AUTH) return true;
  return tokenEquals(cookieVal, ACCESS_TOKEN) || tokenEquals(queryVal ?? '', ACCESS_TOKEN);
}
const UNAUTHORIZED_HTML = '<!doctype html><meta charset="utf-8"><title>AEOS Hub · 需要访问口令</title>'
  + '<body style="font-family:system-ui,-apple-system,\'Microsoft YaHei\',sans-serif;padding:48px;color:#1c2333">'
  + '<h2>需要访问口令</h2>'
  + '<p>本服务已启用访问口令保护。请使用管理员提供的<b>分享链接</b>打开（链接形如 <code>http://主机IP:端口/?token=…</code>），'
  + '打开一次后会记住，无需重复输入。</p>'
  + '<p style="color:#6b7688;font-size:13px">若你是管理员：口令保存在 hub/data/access-token.txt，启动日志中会打印可分享的完整链接。</p>'
  + '</body>';

const runtimeSupervisor = new RuntimeSupervisor().register(new CodexRuntimeAdapter({
  runtimeInstanceId: CODEX_RUNTIME_ID,
  startOptions: { cwd: root, codexHome, binary, clientName: 'aeos_hub_web' },
}));

// ---------- 状态 ----------
const convCache = new Map<string, Conversation>(); // convId -> conv
const convByThread = new Map<string, string>(); // codex threadId -> convId
const activeTurn = new Map<string, { convId: string; turnId: string | null }>(); // threadId -> 进行中的 turn
// Last accepted run per provider session.  This survives activeTurn cleanup so
// late notifications from an older run cannot be routed into a later turn.
const latestRunBySession = new Map<string, string>();
// Serializes turn setup for one local conversation (including thread/resume
// RPCs), preventing double-clicks from creating overlapping provider turns.
const turnStartLocks = new Map<string, Promise<void>>();
// 真实模型一轮（含工具调用与推理）通常需要 30s~3min；12s 会必然触发离线兜底。
// 120s 仍保留"模型通道等待超时→本地降级回复"的设计，但给真实 Agent 足够执行时间。
const RUNTIME_WAIT_MS = 120_000;
const viewOf = new Map<WebSocket, string | null>(); // ws -> 正在查看的 convId
const pendingGuard = new Map<string, { timer: ReturnType<typeof setTimeout> }>();
const pendingApprovals = new Map<string, RuntimeApprovalRequest>();
const allSockets = new Set<WebSocket>();

// ---------- 会话加载 ----------
for (const c of loadConversations()) convCache.set(c.id, c);
for (const c of convCache.values()) {
  if (c.threadId) convByThread.set(c.threadId, c.id);
}

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function socketsFor(convId: string | null): WebSocket[] {
  if (convId) {
    const list = [];
    for (const [ws, v] of viewOf) if (v === convId) list.push(ws);
    return list;
  }
  return [...allSockets];
}
function pushConv(convId: string, obj: unknown): void {
  for (const ws of socketsFor(convId)) send(ws, obj);
}
function broadcast(obj: unknown): void {
  for (const ws of allSockets) send(ws, obj);
}

/**
 * Resolve identifiers from both the runtime-neutral envelope and the raw
 * Codex notification.  Codex's turn lifecycle notifications put the turn id
 * under `turn.id`, while item notifications expose `turnId` directly.
 */
function runtimeEventSessionId(event: RuntimeEvent): string | undefined {
  if (event.sessionId) return event.sessionId;
  const data = isRecord(event.data) ? event.data : undefined;
  const nestedThread = isRecord(data?.thread) ? data.thread : undefined;
  const nestedTurn = isRecord(data?.turn) ? data.turn : undefined;
  const nestedItem = isRecord(data?.item) ? data.item : undefined;
  for (const value of [
    data?.sessionId,
    data?.session_id,
    data?.threadId,
    data?.thread_id,
    nestedThread?.id,
    nestedTurn?.threadId,
    nestedItem?.threadId,
  ]) {
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function runtimeEventRunId(event: RuntimeEvent): string | undefined {
  if (event.runId) return event.runId;
  const data = isRecord(event.data) ? event.data : undefined;
  const nestedTurn = isRecord(data?.turn) ? data.turn : undefined;
  const nestedItem = isRecord(data?.item) ? data.item : undefined;
  for (const value of [
    data?.runId,
    data?.run_id,
    data?.turnId,
    data?.turn_id,
    nestedTurn?.id,
    nestedItem?.turnId,
  ]) {
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function runtimeEventConversationId(event: RuntimeEvent, sessionId?: string, runId?: string): string | null {
  const sid = sessionId ?? runtimeEventSessionId(event);
  const rid = runId ?? runtimeEventRunId(event);

  // If a late notification from an older turn arrives after a new turn has
  // started on the same session, do not let it bleed into the new turn.
  if (sid && rid) {
    const active = activeTurn.get(sid);
    if (active?.turnId && active.turnId !== rid) return null;
    const latest = latestRunBySession.get(sid);
    if (!active?.turnId && latest && latest !== rid) return null;
  }

  if (sid) return convByThread.get(sid) ?? null;
  if (rid) {
    for (const active of activeTurn.values()) {
      if (active.turnId === rid) return active.convId;
    }
  }
  return null;
}

function runtimeEventEnvelope(
  event: RuntimeEvent,
  convId: string | null,
  sessionId?: string,
  runId?: string,
): Record<string, unknown> {
  return {
    type: 'evt',
    method: event.name,
    // Preserve the provider payload verbatim.  Consumers can use the outer
    // ids for filtering without having to reinterpret provider-specific data.
    params: event.data ?? null,
    convId,
    runtimeInstanceId: event.runtimeInstanceId,
    sessionId: sessionId ?? null,
    runId: runId ?? null,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
  };
}

function getConv(convId: string): Conversation | null {
  return convCache.get(convId) ?? null;
}

function conversationTurnBlockMessage(convId: string, includeStartLock = true): string | null {
  if (includeStartLock && turnStartLocks.has(convId)) return '该对话正在启动中，请稍候';
  const conv = getConv(convId);
  if (conv?.threadId && activeTurn.has(conv.threadId)) return '该对话正在执行中，请等待完成或先停止';
  return null;
}

/** 对话页可切换的模型选项：openai 账号默认 + 各自定义提供商的模型清单 */
function buildModelOptions(): Array<{ provider: string; model: string; label: string }> {
  const cfg = readConfig();
  const presets = loadModelPresets();
  const opts = [{ provider: 'openai', model: '', label: 'openai · 账号默认' }];
  for (const p of cfg.providers) {
    if (!p.id) continue;
    const models = presets[p.id]?.length ? presets[p.id] : [p.id];
    for (const m of models) opts.push({ provider: p.id, model: m, label: `${p.id} · ${m}` });
  }
  return opts;
}

function normChoice(x: { provider?: string; model?: string } | null | undefined): { provider: string; model: string } {
  return { provider: x?.provider || 'openai', model: x?.model || '' };
}
function sameChoice(a: { provider?: string; model?: string } | null | undefined, b: { provider?: string; model?: string }): boolean {
  const A = normChoice(a); const B = normChoice(b);
  return A.provider === B.provider && A.model === B.model;
}

/** 模型和提供商属于运行版本的一部分，已有 Session 不做原地变更。 */
function ensureThreadModel(_conv: Conversation, _chosen: { provider: string; model: string }): never {
  throw new Error('当前对话的运行模型已固定；请新建对话后选择其他模型，以保留可追溯的运行版本');
}

function touch(conv: Conversation): void {
  conv.updatedAt = new Date().toISOString();
  upsertConversation(conv);
}

// ---------- codex app-server 引擎 ----------
const NOTIFY_ALLOW = new Set([
  'item/agentMessage/delta',
  'item/started',
  'item/completed',
  'item/reasoning/summaryTextDelta',
  // Newer app-server builds expose the reasoning stream under textDelta;
  // keep both spellings so the control plane does not silently drop it.
  'item/reasoning/textDelta',
  'item/reasoning/summaryPartAdded',
  'item/plan/delta',
  // Tool/process output is kept on its own event channel.  In particular,
  // screenshot commands arrive as PNG/base64 chunks on this notification.
  'item/commandExecution/outputDelta',
  'item/commandExecution/terminalInteraction',
  'command/exec/outputDelta',
  'process/outputDelta',
  'process/exited',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'item/mcpToolCall/progress',
  'mcpServer/event/stream/notification',
  'turn/started',
  'turn/completed',
  'turn/plan/updated',
  'thread/started',
  'mcpServer/startupStatus/updated',
  'error',
  'warning',
  'configWarning',
]);

async function resolveRuntimeApproval(
  request: RuntimeApprovalRequest,
  outcome: 'approved' | 'denied',
  reason: string,
): Promise<void> {
  await runtimeSupervisor.resolveApproval(CODEX_RUNTIME_ID, request.requestId, { outcome, reason });
  appendEvidence({
    kind: 'guard_decision',
    method: request.method,
    thread_id: request.sessionId,
    turn_id: request.runId,
    summary: `${outcome} by ${reason}`,
    payload: { requestId: request.requestId, outcome, reason, actor: 'web:workspace-manager' },
  });
}

function handleRuntimeEvent(event: RuntimeEvent): void {
  if (event.kind === 'notification') {
    if (!NOTIFY_ALLOW.has(event.name)) return;
    const sessionId = runtimeEventSessionId(event);
    const runId = runtimeEventRunId(event);

    // Turn lifecycle is the authoritative run boundary.  Record it before
    // routing so a completed run remains identifiable after activeTurn is
    // cleared, while a newly-started run immediately supersedes old events.
    if (sessionId && runId && event.name === 'turn/started') {
      latestRunBySession.set(sessionId, runId);
      const active = activeTurn.get(sessionId);
      if (active && active.turnId === null) active.turnId = runId;
    } else if (sessionId && runId && event.name === 'turn/completed' && !latestRunBySession.has(sessionId)) {
      latestRunBySession.set(sessionId, runId);
    }

    const convId = runtimeEventConversationId(event, sessionId, runId);
    const obj = runtimeEventEnvelope(event, convId, sessionId, runId);
    if (convId) pushConv(convId, obj);
    else if (!sessionId && !runId) broadcast(obj);
    return;
  }

  if (event.kind === 'approval' && event.name === 'approval/requested') {
    const request = (event.data as { request?: RuntimeApprovalRequest } | undefined)?.request;
    if (!request) return;
    appendEvidence({
      kind: 'guard_request',
      method: request.method,
      thread_id: request.sessionId,
      turn_id: request.runId,
      payload: request.payload,
    });
    const convId = request.sessionId ? convByThread.get(request.sessionId) ?? null : null;
    const candidates = convId ? socketsFor(convId) : [];
    if (!candidates.length) {
      console.log(`[Guard] 无对应会话的前端监听，自动拒绝 ${request.method}`);
      void resolveRuntimeApproval(request, 'denied', 'no-active-reviewer').catch((error) => console.error('[Guard]', error));
      return;
    }
    const timer = setTimeout(() => {
      pendingGuard.delete(request.requestId);
      pendingApprovals.delete(request.requestId);
      console.log(`[Guard] 超时未决，自动拒绝 ${request.method}`);
      void resolveRuntimeApproval(request, 'denied', 'approval-timeout').catch((error) => console.error('[Guard]', error));
    }, 300_000);
    pendingGuard.set(request.requestId, { timer });
    pendingApprovals.set(request.requestId, request);
    for (const ws of candidates) {
      send(ws, { type: 'guard', id: Number(request.requestId), method: request.method, params: request.payload });
    }
    return;
  }

  if (event.kind === 'lifecycle' && event.name === 'runtime/exited') {
    console.log('[engine] Codex Runtime 已退出');
  }
}

runtimeSupervisor.onEvent(handleRuntimeEvent, CODEX_RUNTIME_ID);

async function restartEngine(): Promise<void> {
  await runtimeSupervisor.stop(CODEX_RUNTIME_ID);
  await new Promise((r) => setTimeout(r, 600));
  await runtimeSupervisor.ensureStarted(CODEX_RUNTIME_ID);
}

async function startTurnUnsafe(convId: string, text: string, choice?: { provider?: string; model?: string }): Promise<void> {
  const chosen = { provider: choice?.provider || 'openai', model: choice?.model || '' };
  let conv = getConv(convId);
  if (!conv) {
    conv = { id: convId, threadId: null, title: '新对话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), turnCount: 0 };
    convCache.set(convId, conv);
    upsertConversation(conv);
  }
  // The wrapper already owns this conversation's start lock; only inspect an
  // existing active provider turn here.
  const blocked = conversationTurnBlockMessage(convId, false);
  if (blocked) throw new Error(blocked);

  // 1) Session 由 Runtime Adapter 创建或恢复，不向控制面泄漏 Codex RPC。
  let tid = conv.threadId;
  const isCustom = chosen.provider && chosen.provider !== 'openai';
  if (!tid) {
    const sessionRequest: { workingDirectory: string; model?: string; modelProvider?: string } = { workingDirectory: root };
    if (isCustom && chosen.model) {
      sessionRequest.model = chosen.model;
      sessionRequest.modelProvider = chosen.provider;
    } else if (chosen.model) {
      sessionRequest.model = chosen.model;
      sessionRequest.modelProvider = 'openai';
    }
    const session = await runtimeSupervisor.createSession(CODEX_RUNTIME_ID, sessionRequest);
    tid = session.id;
    conv.threadId = tid;
    convByThread.set(tid, convId);
    conv.title = text.replace(/\s+/g, ' ').slice(0, 24) || '新对话';
    conv.lastChoice = chosen;
    upsertConversation(conv);
  } else {
    convByThread.set(tid, convId);
    if (!sameChoice(conv.lastChoice, chosen)) {
      ensureThreadModel(conv, chosen);
    }
    await runtimeSupervisor.resumeSession(CODEX_RUNTIME_ID, tid, { workingDirectory: root });
  }

  // 2) Run 与 Session 分离；Supervisor 负责启动锁和完成事件竞态。
  activeTurn.set(tid, { convId, turnId: null });
  let startedRunId: string | null = null;
  try {
    const run = await runtimeSupervisor.startRun(CODEX_RUNTIME_ID, tid, {
      input: text,
      clientRequestId: `web_${randomUUID()}`,
      metadata: { conversationId: convId, agentId: 'agent-aeos-hub' },
    });
    startedRunId = run.id;
    activeTurn.set(tid, { convId, turnId: run.id });
    conv.turnCount += 1;
    touch(conv);
    const outcome = await Promise.race([
      runtimeSupervisor.waitForRun(CODEX_RUNTIME_ID, run.id, 600_000),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('模型通道等待超时，已切换到本地回复')), RUNTIME_WAIT_MS)),
    ]);
    if (outcome.state !== 'completed') throw new Error(outcome.failure?.message || `运行状态：${outcome.state}`);
    pushConv(convId, {
      type: 'turn_end',
      convId,
      sessionId: tid,
      runId: outcome.id,
      runtimeInstanceId: CODEX_RUNTIME_ID,
      occurredAt: new Date().toISOString(),
      status: 'completed',
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (startedRunId && msg.includes('模型通道等待超时')) {
      void runtimeSupervisor.interruptRun(CODEX_RUNTIME_ID, startedRunId).catch(() => undefined);
      const fallbackItemId = `offline-${randomUUID()}`;
      const fallbackText = `我已收到你的消息：\n\n“${text}”\n\n当前模型网络通道正在重连，我先保持对话可用。网络恢复后，新消息会自动交给真实 Agent 继续处理。`;
      pushConv(convId, {
        type: 'evt',
        method: 'item/agentMessage/delta',
        convId,
        sessionId: tid,
        runId: startedRunId,
        params: { threadId: tid, turnId: startedRunId, itemId: fallbackItemId, delta: fallbackText },
      });
      pushConv(convId, {
        type: 'evt',
        method: 'item/completed',
        convId,
        sessionId: tid,
        runId: startedRunId,
        params: { threadId: tid, turnId: startedRunId, item: { id: fallbackItemId, type: 'agentMessage', text: fallbackText, phase: 'final_answer' } },
      });
      pushConv(convId, {
        type: 'turn_end',
        convId,
        sessionId: tid,
        runId: startedRunId,
        runtimeInstanceId: CODEX_RUNTIME_ID,
        occurredAt: new Date().toISOString(),
        status: 'completed',
        fallback: true,
      });
      return;
    }
    pushConv(convId, {
      type: 'turn_end',
      convId,
      sessionId: tid,
      runId: startedRunId ?? activeTurn.get(tid)?.turnId ?? null,
      runtimeInstanceId: CODEX_RUNTIME_ID,
      occurredAt: new Date().toISOString(),
      status: 'failed',
      error: msg,
    });
    throw new Error(msg);
  } finally {
    const current = activeTurn.get(tid);
    // Do not clear a marker belonging to a newer run if a provider callback
    // raced with this turn's cleanup.
    if (current?.convId === convId && (startedRunId === null || current.turnId === startedRunId || current.turnId === null)) {
      activeTurn.delete(tid);
    }
    touch(conv);
  }
}

/** Serialize the complete setup/start lifecycle for one conversation. */
async function startTurn(convId: string, text: string, choice?: { provider?: string; model?: string }): Promise<void> {
  if (turnStartLocks.has(convId)) {
    throw new Error('该对话正在启动中，请稍候');
  }
  let release!: () => void;
  const lock = new Promise<void>((resolve) => { release = resolve; });
  turnStartLocks.set(convId, lock);
  try {
    await startTurnUnsafe(convId, text, choice);
  } finally {
    if (turnStartLocks.get(convId) === lock) turnStartLocks.delete(convId);
    release();
  }
}

// ---------- HTTP ----------
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

function verificationStatus(status: string): HarborRuntimeVerificationStatus {
  if (status === 'healthy' || status === 'degraded' || status === 'unhealthy' || status === 'stopped' || status === 'starting') {
    return status;
  }
  return 'unverified';
}

function verificationHttpStatus(status: HarborRuntimeVerificationStatus): number {
  return status === 'healthy' || status === 'degraded' ? 200 : 503;
}

function parseRuntimeVerifyOptions(input: Record<string, unknown>): {
  startIfStopped?: boolean;
  timeoutMs?: number;
  probeMethod?: string;
  probeParams?: unknown;
} {
  const allowed = new Set(['startIfStopped', 'timeoutMs', 'probeMethod', 'probeParams']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`verify 参数不支持: ${key}`);
  }
  let startIfStopped: boolean | undefined;
  if (input.startIfStopped !== undefined) {
    if (typeof input.startIfStopped !== 'boolean') throw new Error('startIfStopped 必须是布尔值');
    startIfStopped = input.startIfStopped;
  }
  let timeoutMs: number | undefined;
  if (input.timeoutMs !== undefined) {
    if (typeof input.timeoutMs !== 'number' || !Number.isFinite(input.timeoutMs) || input.timeoutMs < 0 || input.timeoutMs > 120_000) {
      throw new Error('timeoutMs 必须是 0 到 120000 之间的有限数值');
    }
    timeoutMs = input.timeoutMs;
  }
  let probeMethod: string | undefined;
  if (input.probeMethod !== undefined) {
    if (typeof input.probeMethod !== 'string' || !input.probeMethod.trim() || input.probeMethod.length > 120) {
      throw new Error('probeMethod 必须是非空字符串且不超过 120 个字符');
    }
    probeMethod = input.probeMethod.trim();
  }
  return { startIfStopped, timeoutMs, probeMethod, ...(input.probeParams !== undefined ? { probeParams: input.probeParams } : {}) };
}

async function readOptionalJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentLength = Number(req.headers['content-length'] ?? 0);
  const contentType = String(req.headers['content-type'] ?? '').trim();
  if (!contentLength && !contentType) return {};
  return readJsonBody(req);
}

async function verifyHarborRuntime(
  runtimeId: string,
  options: ReturnType<typeof parseRuntimeVerifyOptions>,
): Promise<{ runtime: ReturnType<typeof loadHarbor>['runtimes'][number]; health: Record<string, unknown>; statusCode: number }> {
  const snapshot = loadHarbor();
  const harborRuntime = snapshot.runtimes.find((runtime) => runtime.id === runtimeId);
  if (!harborRuntime) throw new HarborStoreNotFoundError(`Runtime 不存在: ${runtimeId}`);

  const checkedAt = new Date().toISOString();
  let health: Record<string, unknown>;
  if (!runtimeSupervisor.has(runtimeId)) {
    health = {
      runtimeInstanceId: runtimeId,
      status: 'unverified',
      checkedAt,
      message: 'Runtime 已登记，但当前进程没有对应的 Runtime Adapter；未执行网络探测',
      details: { adapterRegistered: false, runtimeKind: harborRuntime.kind },
    };
  } else {
    try {
      const result = await runtimeSupervisor.verifyHealth(runtimeId, {
        ...options,
        // 点击“验证”应主动尝试唤起本机 Runtime；调用方仍可显式传 false。
        startIfStopped: options.startIfStopped ?? true,
      });
      health = { ...result, status: verificationStatus(result.status) };
    } catch (error) {
      health = {
        runtimeInstanceId: runtimeId,
        status: 'unhealthy',
        checkedAt,
        message: (error as Error).message,
        code: errorCode(error),
      };
    }
  }

  const persisted = recordHarborRuntimeVerification(runtimeId, {
    status: verificationStatus(String(health.status ?? 'unverified')),
    checkedAt: typeof health.checkedAt === 'string' ? health.checkedAt : checkedAt,
    message: typeof health.message === 'string' ? health.message : 'Runtime 验证已完成',
    code: typeof health.code === 'string' ? health.code : null,
  });
  appendEvidence({
    kind: 'runtime_verification',
    summary: `${runtimeId}: ${String(health.status)}`,
    payload: { runtimeId, health, persistedStatus: persisted.status },
  });
  return { runtime: persisted, health, statusCode: verificationHttpStatus(verificationStatus(String(health.status))) };
}

async function readJsonBody(req: IncomingMessage, maxBytes = 256 * 1024): Promise<Record<string, unknown>> {
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.includes('application/json')) throw new Error('请求 Content-Type 必须为 application/json');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) {
        failed = true;
        reject(new Error(`请求体不能超过 ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        const value = raw ? JSON.parse(raw) : {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON 请求体必须是对象');
        resolve(value as Record<string, unknown>);
      } catch (error) {
        reject(new Error(`无效 JSON：${(error as Error).message}`));
      }
    });
    req.on('error', reject);
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const RUNTIME_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
const runtimeImageRoots = [root, codexHome, tmpdir()].map((value) => normalize(value).replace(/[\\/]+$/, '').toLowerCase());

function isAllowedRuntimeImagePath(filePath: string): boolean {
  const normalized = normalize(filePath).toLowerCase();
  return runtimeImageRoots.some((allowedRoot) => normalized === allowedRoot || normalized.startsWith(`${allowedRoot}${sep}`));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  // 访问口令网关：分享链接（?token=…）通过后写入 cookie，后续请求与 WebSocket 自动携带
  const queryToken = url.searchParams.get('token');
  const cookieHit = HUB_COOKIE_RE.exec(req.headers.cookie ?? '');
  const cookieToken = cookieHit ? cookieHit[1] : '';
  if (!isAuthorized(cookieToken, queryToken)) {
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
    res.end(UNAUTHORIZED_HTML);
    return;
  }
  if (!NO_AUTH && queryToken === ACCESS_TOKEN && cookieToken !== ACCESS_TOKEN) {
    res.setHeader('set-cookie', `hub_token=${ACCESS_TOKEN}; Path=/; SameSite=Lax; Max-Age=2592000`);
  }
  if (url.pathname === '/api/harbor') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      sendJson(res, 200, loadHarbor());
    } catch (error) {
      sendJson(res, 500, { error: (error as Error).message });
    }
    return;
  }
  const runtimeVerifyMatch = url.pathname.match(/^\/api\/harbor\/runtimes\/([^/]+)\/verify$/);
  if (runtimeVerifyMatch) {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const runtimeId = decodeURIComponent(runtimeVerifyMatch[1]).trim();
      if (!runtimeId || runtimeId.length > 160) throw new Error('Runtime id 无效');
      const options = parseRuntimeVerifyOptions(await readOptionalJsonBody(req));
      const result = await verifyHarborRuntime(runtimeId, options);
      sendJson(res, result.statusCode, { runtime: result.runtime, health: result.health });
    } catch (error) {
      const status = error instanceof HarborStoreNotFoundError ? 404 : 400;
      sendJson(res, status, { error: (error as Error).message, code: errorCode(error) });
    }
    return;
  }
  const harborCreators: Record<string, (input: Record<string, unknown>) => unknown> = {
    '/api/harbor/agents': createHarborAgent,
    '/api/harbor/runtimes': createHarborRuntime,
    '/api/harbor/projects': createHarborProject,
  };
  if (url.pathname.startsWith('/api/harbor/')) {
    const creator = harborCreators[url.pathname];
    if (!creator) { sendJson(res, 404, { error: 'harbor endpoint not found' }); return; }
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const input = await readJsonBody(req);
      const item = creator(input);
      sendJson(res, 201, { item });
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/evidence') {
    try {
      const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') ?? 100)));
      const all = existsSync(evidenceFile) ? readFileSync(evidenceFile, 'utf-8').trim().split('\n').filter(Boolean) : [];
      const rows = all.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      sendJson(res, 200, { total: all.length, rows });
      return;
    } catch (e) {
      sendJson(res, 500, { error: (e as Error).message });
      return;
    }
  }
  if (url.pathname === '/api/runtime-image') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const requestedPath = url.searchParams.get('path')?.trim() ?? '';
    const filePath = normalize(requestedPath.replace(/^file:\/\//i, ''));
    const extension = extname(filePath).toLowerCase();
    if (!requestedPath || requestedPath.length > 4096 || !isAllowedRuntimeImagePath(filePath) || !MIME[extension]?.startsWith('image/')) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    try {
      const stats = statSync(filePath);
      if (!stats.isFile() || stats.size > RUNTIME_IMAGE_MAX_BYTES) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, {
        'content-type': MIME[extension],
        'cache-control': 'private, max-age=60',
        'x-content-type-options': 'nosniff',
      });
      res.end(readFileSync(filePath));
    } catch {
      res.writeHead(404); res.end('not found');
    }
    return;
  }
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  let fp = normalize(join(publicDir, rel));
  if (!fp.startsWith(normalize(publicDir) + sep) && fp !== normalize(join(publicDir, 'index.html'))) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (!existsSync(fp) || statIsDir(fp)) fp = join(publicDir, 'index.html');
  try {
    res.writeHead(200, { 'content-type': MIME[extname(fp)] ?? 'application/octet-stream' });
    res.end(readFileSync(fp));
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

function statIsDir(fp: string): boolean {
  try { return statSync(fp).isDirectory(); } catch { return false; }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info: { req: IncomingMessage }) => {
    try {
      const wsUrl = new URL(info.req.url ?? '/ws', 'http://127.0.0.1');
      const wsCookieHit = HUB_COOKIE_RE.exec(info.req.headers.cookie ?? '');
      return isAuthorized(wsCookieHit ? wsCookieHit[1] : '', wsUrl.searchParams.get('token'));
    } catch {
      return false;
    }
  },
});
wss.on('connection', (ws) => {
  allSockets.add(ws);
  viewOf.set(ws, null);
  send(ws, { type: 'hello', conversations: [...convCache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), modelOptions: buildModelOptions(), dataDir, evidenceFile });

  ws.on('message', async (raw) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    const type = msg.type as string;
    try {
      if (type === 'view') viewOf.set(ws, (msg.conversationId as string) ?? null);
      else if (type === 'new') {
        const conv: Conversation = { id: randomUUID(), threadId: null, title: '新对话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), turnCount: 0 };
        convCache.set(conv.id, conv);
        upsertConversation(conv);
        broadcast({ type: 'conversations_updated', conversations: [...convCache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
        send(ws, { type: 'conversation_created', conversation: conv });
      } else if (type === 'chat') {
        const convId = String(msg.conversationId ?? '');
        const text = String(msg.text ?? '').trim();
        if (!text) { send(ws, { type: 'error', convId, message: '消息不能为空' }); return; }
        const blocked = conversationTurnBlockMessage(convId);
        if (blocked) { send(ws, { type: 'error', convId, message: blocked }); return; }
        const choice = (msg.choice ?? {}) as { provider?: string; model?: string };
        pushConv(convId, { type: 'user_message', convId, text });
        await startTurn(convId, text, choice);
      } else if (type === 'interrupt') {
        const convId = String(msg.conversationId ?? '');
        const conv = getConv(convId);
        if (conv?.threadId && activeTurn.has(conv.threadId)) {
          const { turnId } = activeTurn.get(conv.threadId)!;
          if (turnId) {
            try { await runtimeSupervisor.interruptRun(CODEX_RUNTIME_ID, turnId); } catch { /* 已结束 */ }
          }
          pushConv(convId, { type: 'info', convId, text: '已发送停止请求' });
        }
      } else if (type === 'decision') {
        const reqId = String(msg.reqId ?? '');
        const outcome = msg.decision === 'accept' ? 'approved' : 'denied';
        const p = pendingGuard.get(reqId);
        if (p) { clearTimeout(p.timer); pendingGuard.delete(reqId); }
        const request = pendingApprovals.get(reqId);
        pendingApprovals.delete(reqId);
        if (request) {
          const expectedConvId = request.sessionId ? convByThread.get(request.sessionId) ?? null : null;
          if (!expectedConvId || viewOf.get(ws) !== expectedConvId) throw new Error('当前会话无权处理这条审批请求');
          await resolveRuntimeApproval(request, outcome, 'workspace-manager');
        }
      } else if (type === 'conversation:archive') {
        const convId = String(msg.conversationId ?? '');
        const conv = getConv(convId);
        if (!conv) throw new Error('会话不存在');
        if (conv.threadId && activeTurn.has(conv.threadId)) throw new Error('会话正在执行，请先停止再归档');
        const archived = msg.archived === true;
        conv.archived = archived || undefined;
        touch(conv);
        appendEvidence({ kind: 'app_event', summary: archived ? 'conversation archived' : 'conversation unarchived', thread_id: conv.threadId ?? undefined, payload: { conversationId: convId, archived } });
        // 同步归档 codex 线程（best-effort：协议失败不阻断本地状态，记录证据即可）
        if (conv.threadId) {
          try {
            if (archived) await runtimeSupervisor.closeSession(CODEX_RUNTIME_ID, conv.threadId);
            else await runtimeSupervisor.resumeSession(CODEX_RUNTIME_ID, conv.threadId, { workingDirectory: root });
          } catch (error) {
            appendEvidence({ kind: 'app_event', summary: `thread ${archived ? 'archive' : 'unarchive'} rpc failed`, thread_id: conv.threadId, payload: { message: (error as Error).message } });
          }
        }
        broadcast({ type: 'conversations_updated', conversations: [...convCache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
        send(ws, { type: 'conversation_archived', conversationId: convId, archived });
      } else if (type === 'conversation:delete') {
        const convId = String(msg.conversationId ?? '');
        const conv = getConv(convId);
        if (!conv) throw new Error('会话不存在');
        if (conv.threadId && activeTurn.has(conv.threadId)) throw new Error('会话正在执行，请先停止再删除');
        const hadThread = conv.threadId;
        convCache.delete(convId);
        if (hadThread) convByThread.delete(hadThread);
        saveConversations([...convCache.values()]);
        appendEvidence({ kind: 'app_event', summary: 'conversation deleted', thread_id: hadThread ?? undefined, payload: { conversationId: convId, title: conv.title } });
        // 同步删除 codex 线程（best-effort，失败仅记录）
        if (hadThread) {
          try {
            await runtimeSupervisor.deleteSession(CODEX_RUNTIME_ID, hadThread);
          } catch (error) {
            appendEvidence({ kind: 'app_event', summary: 'thread delete rpc failed', thread_id: hadThread, payload: { message: (error as Error).message } });
          }
        }
        broadcast({ type: 'conversations_updated', conversations: [...convCache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
        send(ws, { type: 'conversation_deleted', conversationId: convId });
      } else if (type === 'config:get') {
        const cfg = readConfig();
        send(ws, { type: 'config:data', payload: { ...cfg, presets: loadModelPresets(), modelOptions: buildModelOptions(), envKeys: listEnvKeys(), configFile, codexHome } });
      } else if (type === 'config:save') {
        const p = (msg.payload ?? {}) as { model?: string; modelProvider?: string; providers?: Array<{ id: string; base_url?: string; env_key?: string; wire_api?: string }>; presets?: Record<string, string[]>; secrets?: Record<string, string | null> };
        if (activeTurn.size > 0) { send(ws, { type: 'error', convId: null, message: '有对话正在执行，请先停止再保存配置' }); return; }
        saveModelConfig({ model: p.model ?? '', modelProvider: p.modelProvider ?? '', providers: p.providers ?? [] });
        for (const [k, v] of Object.entries(p.secrets ?? {})) setEnvKey(k, v);
        if (p.presets) saveModelPresets(p.presets);
        await restartEngine();
        send(ws, { type: 'config_saved', message: '配置已保存，codex 运行时已用新配置重启' });
        broadcast({ type: 'model_options', modelOptions: buildModelOptions() });
        broadcast({ type: 'info', convId: null, text: '模型配置已更新' });
      }
    } catch (e) {
      const convId = (msg.conversationId as string) ?? null;
      send(ws, { type: 'error', convId, message: (e as Error).message });
    }
  });
  ws.on('close', () => {
    allSockets.delete(ws);
    viewOf.delete(ws);
  });
});

// ---------- 启动 ----------
function lanAddresses(): string[] {
  const list: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) list.push(info.address);
    }
  }
  return [...new Set(list)];
}

server.listen(PORT, LISTEN_HOST, () => {
  const scope = LAN_MODE || LISTEN_HOST === '0.0.0.0' ? '局域网可访问' : '仅本机可访问';
  console.log('==============================================');
  console.log(` AEOS Hub 中枢控制台已启动（${scope}）`);
  console.log(`   本机地址: http://127.0.0.1:${PORT}${NO_AUTH ? '' : '/?token=' + ACCESS_TOKEN}`);
  if (LAN_MODE || LISTEN_HOST === '0.0.0.0') {
    const suffix = NO_AUTH ? '' : '/?token=' + ACCESS_TOKEN;
    for (const ip of lanAddresses()) {
      console.log(`   分享链接: http://${ip}:${PORT}${suffix}`);
    }
    console.log('   提示: 首次从其他设备访问若不通，请在 Windows 防火墙放行该端口');
    console.log(`         (管理员 PowerShell: netsh advfirewall firewall add rule name="AEOS Hub ${PORT}" dir=in action=allow protocol=TCP localport=${PORT})`);
  }
  console.log(NO_AUTH ? '   访问口令: 已关闭(--no-auth)' : `   访问口令: 已启用（保存在 data/access-token.txt，删除后重启可更换）`);
  console.log(`   隔离 CODEX_HOME: ${codexHome}`);
  console.log('   按 Ctrl+C 退出');
  console.log('==============================================');
});
process.on('SIGINT', () => {
  void runtimeSupervisor.stopAll().finally(() => process.exit(0));
});
