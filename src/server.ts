// AEOS Hub Web 控制台服务端：静态页 + WebSocket（聊天流/审批/配置）
// 复用 src/codex-client.ts；codex 运行时仍为项目内固定版本 + 隔离 CODEX_HOME。
// 启动: npm run web   →   http://127.0.0.1:8787
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { ZodError } from 'zod';
import { loadConversations, saveConversations, upsertConversation, dataDir, convFile, type Conversation, type ConversationMessage } from './conversations.ts';
import { codexHome, configFile, readConfig, saveModelConfig, listEnvKeys, setEnvKey, loadModelPresets, saveModelPresets, ensureConfigFile } from './hub-config.ts';
import { appendEvidence, evidenceFile, readRecentEvidence, evidenceHealth } from './evidence.ts';
import { collectMcpPages, payloadOf } from './mcp-pagination.ts';
import { serveRuntimeImage, validOrigin, boundedLimit } from './http-security.ts';
import {
  DailyQuestionConflictError,
  hasDailyGeneratedBatch,
  loadDailyQuestionConfig,
  replaceDailyGeneratedQuestions,
  saveDailyQuestionConfig,
  type DailyQuestionConfig,
} from './daily-questions.ts';
import { generateDailyQuestionsWithRuntime } from './daily-question-generator.ts';
import { buildCapabilityRegistry } from './capability-registry.ts';
import { buildDashboardSnapshot, type DashboardSnapshot } from './dashboard.ts';
import { AttentionSearchRequestSchema, searchLiveDashboard } from './attention-search.ts';
import { operatingCenter } from './operating-center.ts';
import { McpAccessGateway } from './mcp-access-gateway.ts';
import { loadMcpRegistry } from './mcp-registry.ts';
import {
  loadHarbor,
  createHarborAgent,
  deleteHarborAgent,
  createHarborRuntime,
  createHarborProject,
  recordHarborRuntimeVerification,
  HarborStoreNotFoundError,
  type HarborRuntimeVerificationStatus,
} from './harbor-store.ts';
import {
  addAgentSquadActivity,
  addAgentSquadMemory,
  addAgentBusinessSquadActivity,
  addAgentBusinessSquadMemory,
  bindAgentSquadMember,
  createAgentSquadMember,
  deleteAgentSquadMember,
  loadAgentSquad,
  sendAgentSquadMessage,
  setAgentSquadProject,
} from './agent-squad-store.ts';
import { CodexRuntimeAdapter, RuntimeSupervisor, type RuntimeApprovalRequest, type RuntimeEvent } from './runtime/index.ts';
import { BrowserSessionAuth, LOGIN_USERNAME, passwordFromEnvironment } from './web-auth.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const binary = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex');
const PORT = Number(process.env.PORT ?? 8787);
const CODEX_RUNTIME_ID = 'runtime-codex-local';

if (!existsSync(binary)) {
  console.error(`[FAIL] 未找到项目内 codex CLI: ${binary}，请先 npm install`);
  process.exit(1);
}
// 首次运行自动生成隔离配置；真实 company-control 启用后，demo-erp 默认禁用。
ensureConfigFile();
if (!existsSync(join(codexHome, 'auth.json'))) {
  console.warn('[WARN] 隔离目录缺少凭证 auth.json：对话将无法调用模型。');
  console.warn('       可先执行: cp ~/.codex/auth.json 到 ' + join(codexHome, 'auth.json'));
}

// ---------- 监听地址与浏览器登录 ----------
const cliArgs = process.argv.slice(2);
const LAN_MODE = cliArgs.includes('--lan');
const LISTEN_HOST = process.env.HOST || (LAN_MODE ? '0.0.0.0' : '127.0.0.1');
const webAuth = new BrowserSessionAuth(passwordFromEnvironment());
const SESSION_COOKIE_RE = /(?:^|;\s*)aeos_session=([0-9a-f-]{36})(?:;|$)/;
function addCookie(res: ServerResponse, value: string): void {
  const current = res.getHeader('set-cookie');
  const cookies = Array.isArray(current) ? [...current.map(String)] : current ? [String(current)] : [];
  cookies.push(value);
  res.setHeader('set-cookie', cookies);
}
function clearAuthenticationCookies(res: ServerResponse): void {
  const expiry = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
  addCookie(res, webAuth.expiredCookie());
  // Clear the old share-token cookie during migration from the former scheme.
  addCookie(res, `hub_token=; ${expiry}`);
  addCookie(res, `aeos_session=; ${expiry}`);
}
function sessionActorFromRequest(req: IncomingMessage, res: ServerResponse): string {
  const match = SESSION_COOKIE_RE.exec(req.headers.cookie ?? '');
  if (match?.[1]) return `web-session:${match[1]}`;
  const sessionId = randomUUID();
  addCookie(res, `aeos_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
  return `web-session:${sessionId}`;
}
function sessionActorFromSocket(req: IncomingMessage): string {
  const match = SESSION_COOKIE_RE.exec(req.headers.cookie ?? '');
  return `web-session:${match?.[1] || randomUUID()}`;
}
function isLoginPublicAsset(url: URL, method: string | undefined): boolean {
  if (method !== 'GET') return false;
  return url.pathname === '/' || url.pathname === '/index.html'
    || url.pathname === '/style.css' || url.pathname === '/app.js'
    || url.pathname === '/daily-questions.js'
    || url.pathname === '/vendor/lucide.min.js' || url.pathname.startsWith('/brand/');
}

const codexRuntime = new CodexRuntimeAdapter({
  runtimeInstanceId: CODEX_RUNTIME_ID,
  startOptions: { cwd: root, codexHome, binary, clientName: 'aeos_hub_web' },
});
const runtimeSupervisor = new RuntimeSupervisor().register(codexRuntime);
// Hub-initiated calls (dashboard and future scheduled jobs) must not bypass
// this policy boundary.  Chat-agent calls are constrained by the same registry
// through generated enabled_tools in Codex config.
const mcpAccessGateway = new McpAccessGateway(codexRuntime, loadMcpRegistry());

// ---------- 状态 ----------
const convCache = new Map<string, Conversation>(); // convId -> conv
const convByThread = new Map<string, string>(); // codex threadId -> convId
const activeTurn = new Map<string, { convId: string; turnId: string | null }>(); // threadId -> 进行中的 turn
const dailyQuestionGenerationLocks = new Map<string, Promise<DailyQuestionConfig>>();
let dashboardLoadPromise: Promise<DashboardSnapshot> | null = null;
let decisionDataRefreshPromise: Promise<DashboardSnapshot> | null = null;
let latestDecisionData: DashboardSnapshot | null = null;
let latestDecisionDataAt: string | null = null;
// Last accepted run per provider session.  This survives activeTurn cleanup so
// late notifications from an older run cannot be routed into a later turn.
const latestRunBySession = new Map<string, string>();
// Serializes turn setup for one local conversation (including thread/resume
// RPCs), preventing double-clicks from creating overlapping provider turns.
const turnStartLocks = new Map<string, Promise<void>>();
// A user cancellation is a normal terminal state. Keep it separate from a
// provider-side interruption so only a requested stop is presented as such.
const requestedInterruptConversations = new Set<string>();
// 真实模型一轮（含工具调用与推理）通常需要 30s~3min；12s 会必然触发离线兜底。
// 120s 仍保留"模型通道等待超时→本地降级回复"的设计，但给真实 Agent 足够执行时间。
const RUNTIME_WAIT_MS = 120_000;
const DECISION_DATA_REFRESH_MS = 5 * 60_000;
const viewOf = new Map<WebSocket, string | null>(); // ws -> 正在查看的 convId
const actorOf = new Map<WebSocket, string>(); // ws -> 服务端生成的审计 actor
const pendingGuard = new Map<string, { timer: ReturnType<typeof setTimeout> }>();
const pendingApprovals = new Map<string, RuntimeApprovalRequest>();
const allSockets = new Set<WebSocket>();
type AgentDispatchContext = { agentId: string; orderNo: string; evidenceRef: string; taskType: 'order' | 'kitting' | 'quality' | 'production' };
type AgentRunCapture = AgentDispatchContext & { text: string; persisted: boolean };
const agentRunCaptures = new Map<string, AgentRunCapture>();
// Agent message deltas are transient; retain only a bounded final transcript
// so switching conversations can restore what the user actually saw.
const agentTranscriptBuffers = new Map<string, string>();
const MAX_CONVERSATION_MESSAGES = 200;
const MAX_CONVERSATION_MESSAGE_CHARS = 16_000;

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

/** 对话页可切换的模型选项：各自定义提供商的模型清单。 */
function buildModelOptions(): Array<{ provider: string; model: string; label: string }> {
  const cfg = readConfig();
  const presets = loadModelPresets();
  const opts: Array<{ provider: string; model: string; label: string }> = [];
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

function appendConversationMessage(
  convId: string,
  input: Omit<ConversationMessage, 'createdAt'> & { createdAt?: string },
): void {
  const conv = getConv(convId);
  if (!conv) return;
  const text = input.text.trim().slice(0, MAX_CONVERSATION_MESSAGE_CHARS);
  if (!text) return;
  const messages = Array.isArray(conv.messages) ? conv.messages : [];
  const item: ConversationMessage = {
    id: input.id,
    role: input.role,
    text,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.itemId ? { itemId: input.itemId } : {}),
    ...(input.phase ? { phase: input.phase } : {}),
  };
  const existing = input.itemId ? messages.findIndex((message) => message.itemId === input.itemId) : -1;
  if (existing >= 0) messages[existing] = item;
  else messages.push(item);
  conv.messages = messages.slice(-MAX_CONVERSATION_MESSAGES);
  touch(conv);
}

/** Extract the displayable text-only parts from an app-server user message. */
function historyUserText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Conversations created before local transcript persistence only have a
 * provider thread id. Read its bounded history once, then cache it locally.
 * A failed provider read is deliberately non-fatal: the conversation remains
 * usable and newly sent messages are still persisted locally.
 */
async function hydrateConversationTranscript(conv: Conversation): Promise<ConversationMessage[]> {
  if (conv.messages?.length || !conv.threadId) return conv.messages ?? [];
  try {
    const response = await codexRuntime.readSessionHistory(conv.threadId);
    const thread = isRecord(response) && isRecord(response.thread) ? response.thread : null;
    const turns = Array.isArray(thread?.turns) ? thread.turns : [];
    const restored: ConversationMessage[] = [];
    for (const turn of turns) {
      if (!isRecord(turn) || !Array.isArray(turn.items)) continue;
      const createdAt = typeof turn.completedAt === 'number'
        ? new Date(turn.completedAt * 1000).toISOString()
        : typeof turn.startedAt === 'number' ? new Date(turn.startedAt * 1000).toISOString() : new Date().toISOString();
      for (const item of turn.items) {
        if (!isRecord(item) || typeof item.id !== 'string') continue;
        if (item.type === 'userMessage') {
          const text = historyUserText(item.content);
          if (text) restored.push({ id: `history-user-${item.id}`, itemId: `history-${item.id}`, role: 'user', text, createdAt });
        } else if (item.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) {
          restored.push({
            id: `history-assistant-${item.id}`,
            itemId: `history-${item.id}`,
            role: 'assistant',
            text: item.text.slice(0, MAX_CONVERSATION_MESSAGE_CHARS),
            createdAt,
            ...(typeof item.phase === 'string' ? { phase: item.phase } : {}),
          });
        }
      }
    }
    if (restored.length) {
      conv.messages = restored.slice(-MAX_CONVERSATION_MESSAGES);
      touch(conv);
    }
  } catch (error) {
    console.warn(`[conversation] 无法恢复会话 ${conv.id} 的历史记录: ${(error as Error).message}`);
  }
  return conv.messages ?? [];
}

function runtimeAgentItem(event: RuntimeEvent): { id: string; text: string; phase: string } | null {
  const data = isRecord(event.data) ? event.data : {};
  const item = isRecord(data.item) ? data.item : {};
  const itemId = typeof item.id === 'string' ? item.id : typeof data.itemId === 'string' ? data.itemId : '';
  const type = typeof item.type === 'string' ? item.type : 'agentMessage';
  if (type !== 'agentMessage') return null;
  const text = typeof item.text === 'string' ? item.text : typeof data.delta === 'string' ? data.delta : '';
  const phase = typeof item.phase === 'string' ? item.phase : typeof data.phase === 'string' ? data.phase : '';
  return { id: itemId || 'agent-message', text, phase };
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
  actor = 'system:guard',
): Promise<void> {
  await runtimeSupervisor.resolveApproval(CODEX_RUNTIME_ID, request.requestId, { outcome, reason });
  appendEvidence({
    kind: 'guard_decision',
    method: request.method,
    thread_id: request.sessionId,
    turn_id: request.runId,
    summary: `${outcome} by ${reason}`,
    payload: { requestId: request.requestId, outcome, reason, actor },
  });
}

function agentMessageText(event: RuntimeEvent): string {
  const data = isRecord(event.data) ? event.data : {};
  const item = isRecord(data.item) ? data.item : {};
  if (typeof item.text === 'string') return item.text;
  return typeof data.delta === 'string' ? data.delta : '';
}

async function persistAgentDispatchResult(runId: string, fallbackText = ''): Promise<void> {
  const capture = agentRunCaptures.get(runId);
  if (!capture || capture.persisted) return;
  capture.persisted = true;
  const result = (fallbackText || capture.text).trim();
  const evidence = capture.evidenceRef ? `\n依据：${capture.evidenceRef}` : '\n依据：本次运行中返回的 evidence_refs。';
  const subject = capture.taskType === 'kitting' ? '需求对象' : capture.taskType === 'quality' ? '质量异常' : capture.taskType === 'production' ? '生产对象' : '订单';
  const taskLabel = capture.taskType === 'kitting' ? '物料齐套分析' : capture.taskType === 'quality' ? '异常与质量分析' : capture.taskType === 'production' ? '生产协同分析' : '订单风险分析';
  const content = result
    ? `${subject} ${capture.orderNo} ${taskLabel}结果（自动沉淀）${evidence}\n\n${result.slice(0, 1_650)}`
    : `${subject} ${capture.orderNo} 的${taskLabel}运行已完成，但未捕获到可沉淀的文本结论；请在会话中核对结果。${evidence}`;
  try {
    addAgentSquadActivity({
      agentId: capture.agentId,
      title: `${taskLabel}已完成`,
      detail: `${subject} ${capture.orderNo} 的分析已完成；结果已写入该 Agent 的独立记忆。`,
    });
    addAgentSquadMemory({ agentId: capture.agentId, content });
  } catch (error) {
    console.error('[agent-dispatch] 无法沉淀专业分析结果:', (error as Error).message);
  } finally {
    agentRunCaptures.delete(runId);
  }
}

function handleRuntimeEvent(event: RuntimeEvent): void {
  if (event.kind === 'notification') {
    if (!NOTIFY_ALLOW.has(event.name)) return;
    const sessionId = runtimeEventSessionId(event);
    const runId = runtimeEventRunId(event);
    if (runId && agentRunCaptures.has(runId) && (event.name === 'item/agentMessage/delta' || event.name === 'item/completed')) {
      const capture = agentRunCaptures.get(runId)!;
      const text = agentMessageText(event);
      if (text) {
        capture.text = event.name === 'item/agentMessage/delta'
          ? `${capture.text}${text}`.slice(-8_000)
          : text.slice(-8_000);
      }
    }

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
    const agentItem = runtimeAgentItem(event);
    if (convId && agentItem) {
      const bufferKey = `${convId}:${runId ?? 'no-run'}:${agentItem.id}`;
      if (event.name === 'item/agentMessage/delta' && agentItem.text) {
        agentTranscriptBuffers.set(bufferKey, `${agentTranscriptBuffers.get(bufferKey) ?? ''}${agentItem.text}`.slice(-MAX_CONVERSATION_MESSAGE_CHARS));
      }
      if (event.name === 'item/completed') {
        const text = agentItem.text || agentTranscriptBuffers.get(bufferKey) || '';
        appendConversationMessage(convId, {
          id: `assistant-${runId ?? 'run'}-${agentItem.id}`,
          itemId: bufferKey,
          role: 'assistant',
          text,
          phase: agentItem.phase,
          createdAt: event.occurredAt,
        });
        agentTranscriptBuffers.delete(bufferKey);
      }
    }
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

async function startTurnUnsafe(convId: string, text: string, choice?: { provider?: string; model?: string }, dispatch?: AgentDispatchContext): Promise<void> {
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
      metadata: { conversationId: convId, agentId: dispatch?.agentId || 'agent-aeos-hub' },
    });
    startedRunId = run.id;
    if (dispatch) agentRunCaptures.set(run.id, { ...dispatch, text: '', persisted: false });
    activeTurn.set(tid, { convId, turnId: run.id });
    if (requestedInterruptConversations.has(convId)) {
      void runtimeSupervisor.interruptRun(CODEX_RUNTIME_ID, run.id).catch(() => undefined);
    }
    conv.turnCount += 1;
    touch(conv);
    const outcome = await Promise.race([
      runtimeSupervisor.waitForRun(CODEX_RUNTIME_ID, run.id, 600_000),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('模型通道等待超时，已切换到本地回复')), RUNTIME_WAIT_MS)),
    ]);
    if (outcome.state === 'interrupted' && requestedInterruptConversations.has(convId)) {
      pushConv(convId, {
        type: 'turn_end', convId, sessionId: tid, runId: outcome.id,
        runtimeInstanceId: CODEX_RUNTIME_ID, occurredAt: new Date().toISOString(),
        status: 'interrupted', message: '已停止本轮分析',
      });
      return;
    }
    if (outcome.state !== 'completed') throw new Error(outcome.failure?.message || `运行状态：${outcome.state}`);
    if (dispatch) await persistAgentDispatchResult(outcome.id);
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
      // The timeout is a failed/degraded run, never a source of Agent memory.
      // Drop the capture before any late provider callback can persist it.
      agentRunCaptures.delete(startedRunId);
      const fallbackItemId = `offline-${randomUUID()}`;
      const fallbackText = `我已收到你的消息：\n\n“${text}”\n\n当前模型网络通道正在重连，我先保持对话可用。网络恢复后，新消息会自动交给真实 Agent 继续处理。`;
      appendConversationMessage(convId, {
        id: `assistant-${startedRunId}-${fallbackItemId}`,
        itemId: `${convId}:${startedRunId}:${fallbackItemId}`,
        role: 'assistant', text: fallbackText, phase: 'degraded',
      });
      pushConv(convId, {
        type: 'evt',
        method: 'item/agentMessage/delta',
        convId,
        sessionId: tid,
        runId: startedRunId,
        params: { threadId: tid, turnId: startedRunId, itemId: fallbackItemId, delta: fallbackText },
      });
      pushConv(convId, {
        type: 'turn_end',
        convId,
        sessionId: tid,
        runId: startedRunId,
        runtimeInstanceId: CODEX_RUNTIME_ID,
        occurredAt: new Date().toISOString(),
        status: 'failed',
        error: '模型通道等待超时，已切换到降级提示；未形成有效分析结论',
        degraded: true,
      });
      return;
    }
    if (dispatch && startedRunId && agentRunCaptures.has(startedRunId)) {
      try {
        addAgentSquadActivity({
          agentId: dispatch.agentId,
          title: '订单风险分析运行失败',
          detail: `订单 ${dispatch.orderNo} 的分析未完成：${msg.slice(0, 600)}`,
        });
      } catch (activityError) {
        console.error('[agent-dispatch] 无法记录订单风险分析失败:', (activityError as Error).message);
      }
      agentRunCaptures.delete(startedRunId);
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
    requestedInterruptConversations.delete(convId);
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
async function startTurn(convId: string, text: string, choice?: { provider?: string; model?: string }, dispatch?: AgentDispatchContext): Promise<void> {
  if (turnStartLocks.has(convId)) {
    throw new Error('该对话正在启动中，请稍候');
  }
  let release!: () => void;
  const lock = new Promise<void>((resolve) => { release = resolve; });
  turnStartLocks.set(convId, lock);
  try {
    await startTurnUnsafe(convId, text, choice, dispatch);
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

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDailyQuestionGenerationInput(input: Record<string, unknown>): { dateKey: string; role: string } {
  const allowed = new Set(['dateKey', 'role']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`生成参数不支持: ${key}`);
  }
  const dateKey = typeof input.dateKey === 'string' ? input.dateKey.trim() : '';
  const role = typeof input.role === 'string' ? input.role.trim() : '';
  const parsedDate = new Date(`${dateKey}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateKey) {
    throw new Error('dateKey 必须是有效的 YYYY-MM-DD 日期');
  }
  if (dateKey !== localDateKey()) throw new Error('只能生成当天的经营问题');
  if (!role || role.length > 40) throw new Error('role 必须是 1 到 40 个字符');
  return { dateKey, role };
}

async function ensureDailyQuestionsGenerated(dateKey: string, role: string): Promise<{ config: DailyQuestionConfig; cached: boolean }> {
  const current = loadDailyQuestionConfig();
  if (hasDailyGeneratedBatch(current, dateKey, role)) return { config: current, cached: true };

  const key = `${dateKey}\u0000${role}`;
  let operation = dailyQuestionGenerationLocks.get(key);
  const joined = Boolean(operation);
  if (!operation) {
    operation = (async () => {
      const latest = loadDailyQuestionConfig();
      if (hasDailyGeneratedBatch(latest, dateKey, role)) return latest;
      let capabilitySummary = '';
      try {
        const inventory = await codexRuntime.listMcpServerStatus();
        const registry = buildCapabilityRegistry(readConfig().mcpServers, inventory);
        capabilitySummary = registry.capabilities
          .filter((capability) => capability.readOnly)
          .map((capability) => `${capability.server}/${capability.name}`)
          .join('；');
      } catch {
        // Generation remains available in conservative mode when runtime inventory is unavailable.
      }
      const drafts = await generateDailyQuestionsWithRuntime({
        supervisor: runtimeSupervisor,
        runtimeInstanceId: CODEX_RUNTIME_ID,
        workingDirectory: root,
        dateKey,
        role,
        config: latest,
        capabilitySummary,
      });
      const saved = replaceDailyGeneratedQuestions(dateKey, role, drafts);
      appendEvidence({
        kind: 'app_event',
        summary: 'daily operating questions generated',
        payload: { dateKey, role, count: drafts.length, revision: saved.revision },
      });
      return saved;
    })();
    dailyQuestionGenerationLocks.set(key, operation);
    void operation.finally(() => {
      if (dailyQuestionGenerationLocks.get(key) === operation) dailyQuestionGenerationLocks.delete(key);
    }).catch(() => undefined);
  }
  return { config: await operation, cached: joined };
}

async function loadDashboardSnapshot(force = false): Promise<DashboardSnapshot> {
  // The dashboard is a live operational view. Keep only the in-flight lock so
  // concurrent browser requests share one read, but never serve a completed
  // snapshot from a server-side TTL cache.
  if (dashboardLoadPromise) return dashboardLoadPromise;

  dashboardLoadPromise = (async () => {
    const warnings: string[] = [];
    const registeredServers = readConfig().mcpServers;
    let runtimeInventory: unknown = null;
    try {
      runtimeInventory = await codexRuntime.listMcpServerStatus();
    } catch (error) {
      warnings.push(`Capability 清单读取失败：${(error as Error).message}`);
    }
    const registry = buildCapabilityRegistry(registeredServers, runtimeInventory, warnings[0]);

    let orderRiskResponse: unknown;
    let shortageResponse: unknown;
    let kittingResponse: unknown;
    let qualityResponse: unknown;
    let productionResponses: { workOrders?: unknown; operations?: unknown; orderLinks?: unknown; reports?: unknown; capacity?: unknown } = {};
    const useCompanyControl = registeredServers.includes('company-control');
    const businessSource = useCompanyControl ? 'company-control' : 'demo-erp';
    let sessionId: string | null = null;
    try {
      const session = await runtimeSupervisor.createSession(CODEX_RUNTIME_ID, {
        workingDirectory: root,
        metadata: { purpose: 'manager-dashboard-readonly' },
      });
      sessionId = session.id;
      if (useCompanyControl) {
        const today = new Date();
        const from = new Date(today);
        const to = new Date(today);
        from.setUTCDate(from.getUTCDate() - 30);
        to.setUTCDate(to.getUTCDate() + 60);
        const [orders, shortages, kitting, quality, workOrders, capacity] = await Promise.allSettled([
          collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({
            sessionId: session.id,
            server: 'company-control',
            tool: 'detail_orders_list',
            args: pageArgs,
            purpose: 'manager-dashboard-order-risk',
            runtimeInventory,
          }), { date_from: from.toISOString().slice(0, 10), date_to: to.toISOString().slice(0, 10) }),
          collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({
            sessionId: session.id,
            server: 'company-control',
            tool: 'material_shortages_list',
            args: pageArgs,
            purpose: 'manager-dashboard-material-shortage',
            runtimeInventory,
          }), {}),
          collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({
            sessionId: session.id,
            server: 'company-control',
            tool: 'material_kitting_results_list',
            args: pageArgs,
            purpose: 'manager-dashboard-material-kitting',
            runtimeInventory,
          }), { required_date_start: from.toISOString().slice(0, 10), required_date_end: to.toISOString().slice(0, 10) }),
          collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({
            sessionId: session.id,
            server: 'company-control',
            tool: 'quality_issues_list',
            args: pageArgs,
            purpose: 'manager-dashboard-quality-issues',
            runtimeInventory,
          // Attention 同时需要拿到质量事项的终态，才能将此前已进入队列的
          // 事项以中台证据归入“已闭环”；前端仍只把非终态计入待关注指标。
          }), { status: 'open,in_progress,closed,resolved,completed,cancelled,canceled' }),
          collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({
            sessionId: session.id, server: 'company-control', tool: 'production_work_orders_list',
            args: pageArgs, purpose: 'manager-dashboard-production-work-orders', runtimeInventory,
          }), {}),
          collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({
            sessionId: session.id, server: 'company-control', tool: 'production_capacity_list',
            args: pageArgs, purpose: 'manager-dashboard-production-capacity', runtimeInventory,
          }), { date_from: from.toISOString().slice(0, 10), date_to: to.toISOString().slice(0, 10) }),
        ]);
        if (orders.status === 'fulfilled') orderRiskResponse = orders.value;
        else warnings.push(`中控平台订单数据读取失败：${orders.reason instanceof Error ? orders.reason.message : String(orders.reason)}`);
        if (shortages.status === 'fulfilled') shortageResponse = shortages.value;
        else warnings.push(`中控平台缺料数据读取失败：${shortages.reason instanceof Error ? shortages.reason.message : String(shortages.reason)}`);
        if (kitting.status === 'fulfilled') kittingResponse = kitting.value;
        else warnings.push(`中控平台齐套数据读取失败：${kitting.reason instanceof Error ? kitting.reason.message : String(kitting.reason)}`);
        if (quality.status === 'fulfilled') qualityResponse = quality.value;
        else warnings.push(`中控平台质量异常数据读取失败：${quality.reason instanceof Error ? quality.reason.message : String(quality.reason)}`);
        if (workOrders.status === 'fulfilled') productionResponses.workOrders = workOrders.value;
        else warnings.push(`中控平台生产工单读取失败：${workOrders.reason instanceof Error ? workOrders.reason.message : String(workOrders.reason)}`);
        if (capacity.status === 'fulfilled') productionResponses.capacity = capacity.value;
        else warnings.push(`中控平台产能读取失败：${capacity.reason instanceof Error ? capacity.reason.message : String(capacity.reason)}`);
        if (workOrders.status === 'fulfilled') {
          const workOrderPayload = payloadOf(workOrders.value) as Record<string, unknown>;
          const firstWorkOrder = Array.isArray(workOrderPayload.data) && workOrderPayload.data[0] && typeof workOrderPayload.data[0] === 'object'
            ? workOrderPayload.data[0] as Record<string, unknown> : {};
          const orderNo = typeof firstWorkOrder.order_no === 'string' ? firstWorkOrder.order_no : '';
          const workOrderNo = typeof firstWorkOrder.work_order_no === 'string' ? firstWorkOrder.work_order_no : typeof firstWorkOrder.work_order_id === 'string' ? firstWorkOrder.work_order_id : '';
          if (orderNo || workOrderNo) {
            const [operations, links, reports] = await Promise.allSettled([
              orderNo ? collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({ sessionId: session.id, server: 'company-control', tool: 'production_operations_list', args: pageArgs, purpose: 'manager-dashboard-production-operations', runtimeInventory }), { order_no: orderNo }) : Promise.resolve(undefined),
              collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({ sessionId: session.id, server: 'company-control', tool: 'production_order_links_list', args: pageArgs, purpose: 'manager-dashboard-production-links', runtimeInventory }), { ...(orderNo ? { order_no: orderNo } : {}), ...(workOrderNo ? { work_order_no: workOrderNo } : {}) }),
              workOrderNo ? collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({ sessionId: session.id, server: 'company-control', tool: 'production_reports_list', args: pageArgs, purpose: 'manager-dashboard-production-reports', runtimeInventory }), { work_order_no: workOrderNo }) : Promise.resolve(undefined),
            ]);
            if (operations.status === 'fulfilled' && operations.value) productionResponses.operations = operations.value;
            if (links.status === 'fulfilled') productionResponses.orderLinks = links.value;
            if (reports.status === 'fulfilled' && reports.value) productionResponses.reports = reports.value;
          }
        }
      } else {
        const [orders, shortages] = await Promise.allSettled([
          mcpAccessGateway.callReadOnly({
            sessionId: session.id, server: 'demo-erp', tool: 'list_order_risks',
            args: { window_days: 60, min_probability: 0.4 }, purpose: 'manager-dashboard-order-risk', runtimeInventory,
          }),
          mcpAccessGateway.callReadOnly({
            sessionId: session.id, server: 'demo-erp', tool: 'check_material_shortages',
            args: {}, purpose: 'manager-dashboard-material-shortage', runtimeInventory,
          }),
        ]);
        if (orders.status === 'fulfilled') orderRiskResponse = orders.value;
        else warnings.push(`订单风险读取失败：${orders.reason instanceof Error ? orders.reason.message : String(orders.reason)}`);
        if (shortages.status === 'fulfilled') shortageResponse = shortages.value;
        else warnings.push(`物料缺口读取失败：${shortages.reason instanceof Error ? shortages.reason.message : String(shortages.reason)}`);
      }
    } catch (error) {
      warnings.push(`经营数据读取失败：${(error as Error).message}`);
    } finally {
      if (sessionId) await runtimeSupervisor.deleteSession(CODEX_RUNTIME_ID, sessionId).catch(() => undefined);
    }

    const snapshot = buildDashboardSnapshot({ registry, orderRiskResponse, shortageResponse, kittingResponse, qualityResponse, productionResponses, source: businessSource, warnings, now: Date.now() });
    return snapshot;
  })();
  try {
    return await dashboardLoadPromise;
  } finally {
    dashboardLoadPromise = null;
  }
}

/**
 * AEOS keeps a warm, read-only decision snapshot even while no browser is
 * open. This is intentionally separate from the removed Autopilot: it does
 * not create cases, send notifications, or call any non-read-only tool.
 */
async function refreshDecisionData(): Promise<DashboardSnapshot> {
  if (decisionDataRefreshPromise) return decisionDataRefreshPromise;
  decisionDataRefreshPromise = (async () => {
    const snapshot = await loadDashboardSnapshot(true);
    latestDecisionData = structuredClone(snapshot);
    latestDecisionDataAt = new Date().toISOString();
    return snapshot;
  })();
  try {
    return await decisionDataRefreshPromise;
  } finally {
    decisionDataRefreshPromise = null;
  }
}

async function decisionDataForRequest(force = false): Promise<DashboardSnapshot & { refreshedAt?: string }> {
  const snapshot = force || !latestDecisionData ? await refreshDecisionData() : structuredClone(latestDecisionData);
  return { ...snapshot, ...(latestDecisionDataAt ? { refreshedAt: latestDecisionDataAt } : {}) };
}

function dashboardEntityId(risk: DashboardSnapshot['attentionRisks'][number]): string {
  if (risk.source === 'quality') return risk.issueNo || risk.orderNo;
  return risk.source === 'kitting' && risk.demandLineNo ? `${risk.orderNo}:${risk.demandLineNo}` : risk.orderNo;
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

const runtimeImageRoots = [join(dataDir, 'artifacts'), join(codexHome, 'generated_images')];

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('content-security-policy', "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:");
  if (url.pathname.startsWith('/api/')) res.setHeader('cache-control', 'no-store');
  if (url.pathname === '/healthz' && req.method === 'GET') {
    sendJson(res, evidenceHealth() ? 503 : 200, { status: evidenceHealth() ? 'degraded' : 'ok' }); return;
  }
  if (!validOrigin(req.headers.origin, req.headers.host)) { sendJson(res, 403, { error: 'origin denied' }); return; }
  if (url.pathname === '/api/auth/login') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const input = await readJsonBody(req, 4 * 1024);
      const account = typeof input.account === 'string' ? input.account.trim() : '';
      const password = typeof input.password === 'string' ? input.password : '';
      if (!account || !password || account.length > 128 || password.length > 1024) {
        sendJson(res, 401, { error: '账号或密码错误' }); return;
      }
      const sessionId = webAuth.login(account, password);
      if (!sessionId) { sendJson(res, 401, { error: '账号或密码错误' }); return; }
      addCookie(res, webAuth.sessionCookie(sessionId));
      sendJson(res, 200, { ok: true, account: LOGIN_USERNAME });
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  const publicAsset = isLoginPublicAsset(url, req.method);
  if (!publicAsset && !webAuth.isAuthorized(req.headers.cookie)) {
    sendJson(res, 401, { error: 'authentication required' });
    return;
  }
  if (url.pathname === '/api/auth/logout') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    webAuth.revoke(req.headers.cookie);
    clearAuthenticationCookies(res);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (url.pathname === '/api/auth/session') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    sendJson(res, 200, { authenticated: true, account: LOGIN_USERNAME });
    return;
  }
  const requestActor = publicAsset ? 'anonymous' : sessionActorFromRequest(req, res);
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname).replace(/^[/\\]+/, '');
  } catch {
    res.writeHead(400); res.end('bad request'); return;
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
  if (url.pathname === '/api/agent-squad') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      sendJson(res, 200, loadAgentSquad());
    } catch (error) {
      sendJson(res, 500, { error: (error as Error).message });
    }
    return;
  }
  const squadMemberDeleteMatch = url.pathname.match(/^\/api\/agent-squad\/members\/([^/]+)$/);
  if (squadMemberDeleteMatch) {
    if (req.method !== 'DELETE') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const agentId = decodeURIComponent(squadMemberDeleteMatch[1] ?? '').trim();
      if (!agentId) throw new Error('小队成员标识无效');
      const item = deleteAgentSquadMember({ agentId });
      sendJson(res, 200, { item, squad: loadAgentSquad() });
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  const squadCreators: Record<string, (input: Record<string, unknown>) => unknown> = {
    '/api/agent-squad/activities': addAgentSquadActivity,
    '/api/agent-squad/memories': addAgentSquadMemory,
    '/api/agent-squad/messages': sendAgentSquadMessage,
    '/api/agent-squad/business-squads/memories': addAgentBusinessSquadMemory,
    '/api/agent-squad/business-squads/activities': addAgentBusinessSquadActivity,
  };
  if (url.pathname.startsWith('/api/agent-squad/')) {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const input = await readJsonBody(req);
      const harbor = loadHarbor();
      const resolveHarborAgent = (value: unknown) => {
        if (typeof value !== 'string' || !value.trim()) throw new Error('请选择 AI 港湾 Agent');
        const agent = harbor.agents.find((item) => item.id === value.trim());
        if (!agent) throw new Error('关联的 AI 港湾 Agent 不存在');
        return agent;
      };
      let item: unknown;
      if (url.pathname === '/api/agent-squad/members') {
        const agent = resolveHarborAgent(input.harborAgentId);
        const current = loadAgentSquad();
        if (current.lead.harborAgentId === agent.id || current.lead.id === agent.id) throw new Error('主 Agent 不能重复加入为子 Agent');
        item = createAgentSquadMember({ harborAgentId: agent.id, name: agent.name, role: agent.role, model: agent.model, squadId: input.squadId });
      } else if (url.pathname === '/api/agent-squad/member-links') {
        const agent = resolveHarborAgent(input.harborAgentId);
        const current = loadAgentSquad();
        if (current.lead.harborAgentId === agent.id || current.lead.id === agent.id) throw new Error('主 Agent 不能重复作为子 Agent');
        item = bindAgentSquadMember({ agentId: input.agentId, harborAgentId: agent.id, name: agent.name, role: agent.role, model: agent.model });
      } else if (url.pathname === '/api/agent-squad/project-link') {
        const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
        if (!projectId) {
          item = setAgentSquadProject({ projectId: null });
        } else {
          const project = harbor.projects.find((candidate) => candidate.id === projectId);
          if (!project) throw new Error('关联的 AI 港湾项目不存在');
          item = setAgentSquadProject({
            projectId: project.id,
            ...(project.leadType === 'agent' ? { leadHarborAgentId: project.leadId } : {}),
          });
        }
      } else {
        const creator = squadCreators[url.pathname];
        if (!creator) { sendJson(res, 404, { error: 'agent squad endpoint not found' }); return; }
        item = creator(input);
      }
      sendJson(res, 201, { item, squad: loadAgentSquad() });
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/operating-center') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const snapshot = operatingCenter.load();
      sendJson(res, 200, { ...snapshot, unreadInboxCount: snapshot.inbox.filter((item) => item.state === 'unread').length });
    } catch (error) { sendJson(res, 500, { error: (error as Error).message }); }
    return;
  }
  if (url.pathname === '/api/operating-cases/from-dashboard') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const input = await readJsonBody(req);
      const source = typeof input.source === 'string' ? input.source : '';
      const entityId = typeof input.entityId === 'string' ? input.entityId : '';
      const evidenceRef = typeof input.evidenceRef === 'string' ? input.evidenceRef : '';
      if (!['order', 'kitting', 'quality', 'production'].includes(source) || !entityId || !evidenceRef) throw new Error('事项来源、对象和 evidence_ref 均为必填');
      const dashboard = await loadDashboardSnapshot();
      const risk = dashboard.attentionRisks.find((item) => item.source === source && dashboardEntityId(item) === entityId && item.evidenceRef === evidenceRef);
      if (!risk) throw new Error('未找到与当前中控数据一致的风险事项；请刷新看板后重试');
      const result = operatingCenter.upsertDashboardRisks([risk], 'dashboard', 1);
      appendEvidence({ kind: 'app_event', summary: 'operating case created from dashboard', payload: { source, entityId, evidenceRef, created: result.created.map((item) => item.id) } });
      sendJson(res, 201, { ...result, snapshot: operatingCenter.load() });
    } catch (error) { sendJson(res, 400, { error: (error as Error).message }); }
    return;
  }
  const caseDecisionMatch = url.pathname.match(/^\/api\/operating-cases\/([^/]+)\/decisions$/);
  if (caseDecisionMatch) {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const decision = operatingCenter.addDecision({ ...await readJsonBody(req), actor: requestActor, caseId: decodeURIComponent(caseDecisionMatch[1] ?? '') });
      appendEvidence({ kind: 'app_event', summary: 'operating case decision recorded', payload: decision });
      sendJson(res, 201, { decision, snapshot: operatingCenter.load() });
    } catch (error) { sendJson(res, 400, { error: (error as Error).message }); }
    return;
  }
  const caseMatch = url.pathname.match(/^\/api\/operating-cases\/([^/]+)$/);
  if (caseMatch) {
    if (req.method !== 'PATCH') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const item = operatingCenter.updateCase({ ...await readJsonBody(req), id: decodeURIComponent(caseMatch[1] ?? '') });
      appendEvidence({ kind: 'app_event', summary: 'operating case updated', payload: { id: item.id, status: item.status, ownerRole: item.ownerRole, dueAt: item.dueAt } });
      sendJson(res, 200, { item, snapshot: operatingCenter.load() });
    } catch (error) { sendJson(res, 400, { error: (error as Error).message }); }
    return;
  }
  const inboxMatch = url.pathname.match(/^\/api\/inbox\/([^/]+)$/);
  if (inboxMatch) {
    if (req.method !== 'PATCH') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const item = operatingCenter.updateInbox({ ...await readJsonBody(req), id: decodeURIComponent(inboxMatch[1] ?? '') });
      sendJson(res, 200, { item, snapshot: operatingCenter.load() });
    } catch (error) { sendJson(res, 400, { error: (error as Error).message }); }
    return;
  }
  if (url.pathname === '/api/inbox') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const snapshot = operatingCenter.load();
      sendJson(res, 200, { items: snapshot.inbox.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), unreadCount: snapshot.inbox.filter((item) => item.state === 'unread').length });
    } catch (error) { sendJson(res, 500, { error: (error as Error).message }); }
    return;
  }
  if (url.pathname === '/api/capability-registry') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const registeredServers = readConfig().mcpServers;
    let businessData: DashboardSnapshot['businessData'] | undefined;
    let riskAssessment: DashboardSnapshot['riskAssessment'] | undefined;
    try {
      const dashboard = await loadDashboardSnapshot();
      businessData = dashboard.businessData;
      riskAssessment = dashboard.riskAssessment;
    } catch (error) {
      businessData = {
        source: registeredServers.includes('company-control') ? 'company-control' : 'demo-erp',
        available: false,
        confidence: 'unknown',
        message: (error as Error).message,
      };
      riskAssessment = { available: false, message: '经营数据读取失败，无法评估订单风险' };
    }
    try {
      const runtimeInventory = await codexRuntime.listMcpServerStatus();
      sendJson(res, 200, { ...buildCapabilityRegistry(registeredServers, runtimeInventory), businessData, riskAssessment });
    } catch (error) {
      sendJson(res, 200, { ...buildCapabilityRegistry(registeredServers, null, (error as Error).message), businessData, riskAssessment });
    }
    return;
  }
  if (url.pathname === '/api/dashboard') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      sendJson(res, 200, await decisionDataForRequest(url.searchParams.get('refresh') === '1'));
    } catch (error) {
      sendJson(res, 503, { error: (error as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/attention/search') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const input = AttentionSearchRequestSchema.parse(await readJsonBody(req));
      // 此接口只在用户显式开启“实时核查中台”并按 Enter 后调用。快照加载
      // 通过既有 McpAccessGateway 的只读路径完成；不会写入业务系统或 Evidence。
      const snapshot = await loadDashboardSnapshot(true);
      sendJson(res, 200, { query: input.query, live: searchLiveDashboard(input.query, snapshot) });
    } catch (error) {
      const status = error instanceof ZodError ? 400 : 503;
      sendJson(res, status, { error: (error as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/daily-questions/generate') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    let input: Record<string, unknown>;
    try {
      input = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
      return;
    }
    try {
      const { dateKey, role } = parseDailyQuestionGenerationInput(input);
      const result = await ensureDailyQuestionsGenerated(dateKey, role);
      sendJson(res, 200, result);
    } catch (error) {
      const status = error instanceof ZodError || /^(生成参数|dateKey|只能生成当天|role)/.test((error as Error).message) ? 400 : 503;
      sendJson(res, status, { error: (error as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/daily-questions') {
    if (req.method === 'GET') {
      try {
        sendJson(res, 200, loadDailyQuestionConfig());
      } catch (error) {
        sendJson(res, 500, { error: (error as Error).message });
      }
      return;
    }
    if (req.method === 'PUT') {
      let input: Record<string, unknown>;
      try {
        input = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, { error: (error as Error).message });
        return;
      }
      try {
        const saved = saveDailyQuestionConfig(input);
        sendJson(res, 200, saved);
      } catch (error) {
        const status = error instanceof DailyQuestionConflictError ? 409 : error instanceof ZodError ? 400 : 500;
        sendJson(res, status, { error: (error as Error).message });
      }
      return;
    }
    sendJson(res, 405, { error: 'method not allowed' });
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
  const harborAgentDeleteMatch = url.pathname.match(/^\/api\/harbor\/agents\/([^/]+)$/);
  if (harborAgentDeleteMatch) {
    if (req.method !== 'DELETE') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const id = decodeURIComponent(harborAgentDeleteMatch[1] ?? '').trim();
      if (!id) throw new Error('Agent id 无效');
      const squad = loadAgentSquad();
      if (squad.lead.harborAgentId === id) throw new Error('该 Agent 是当前小队主 Agent，请先更换主 Agent 关联');
      if (squad.members.some((member) => member.harborAgentId === id)) throw new Error('该 Agent 仍在 Agent 小队中，请先将其移出小队');
      const item = deleteHarborAgent({ id });
      sendJson(res, 200, { item });
    } catch (error) {
      const status = error instanceof HarborStoreNotFoundError ? 404 : 400;
      sendJson(res, status, { error: (error as Error).message });
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
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const limit = boundedLimit(url.searchParams.get('limit'));
      sendJson(res, 200, await readRecentEvidence(limit));
      return;
    } catch (e) {
      sendJson(res, 400, { error: (e as Error).message });
      return;
    }
  }
  if (url.pathname === '/api/runtime-image') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    await serveRuntimeImage(url.searchParams.get('path')?.trim() ?? '', runtimeImageRoots, res);
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'api endpoint not found' });
    return;
  }
  let fp = normalize(join(publicDir, rel));
  if (!fp.startsWith(normalize(publicDir) + sep) && fp !== normalize(join(publicDir, 'index.html'))) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (!existsSync(fp) || statIsDir(fp)) fp = join(publicDir, 'index.html');
  try {
    // This is an operator console served from a mutable Docker image. Do not
    // let a browser keep an older app.js/style.css after the container updates.
    res.writeHead(200, {
      'content-type': MIME[extname(fp)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
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
  maxPayload: 1024 * 1024,
  verifyClient: (info: { req: IncomingMessage }) => {
    try {
      return validOrigin(info.req.headers.origin, info.req.headers.host) && webAuth.isAuthorized(info.req.headers.cookie);
    } catch {
      return false;
    }
  },
});
wss.on('connection', (ws, request) => {
  allSockets.add(ws);
  viewOf.set(ws, null);
  actorOf.set(ws, sessionActorFromSocket(request));
  send(ws, { type: 'hello', conversations: [...convCache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), modelOptions: buildModelOptions(), dataDir, evidenceFile });

  ws.on('message', async (raw) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    const type = msg.type as string;
    try {
      if (type === 'view') {
        const convId = typeof msg.conversationId === 'string' ? msg.conversationId : '';
        viewOf.set(ws, convId || null);
        const conv = convId ? getConv(convId) : null;
        if (conv) send(ws, { type: 'conversation_transcript', convId, messages: await hydrateConversationTranscript(conv) });
      }
      else if (type === 'new') {
        const requestedScope = msg.scope === 'agent' ? 'agent' : 'hub';
        const requestedAgentId = typeof msg.agentId === 'string' ? msg.agentId.trim() : '';
        const requestedSquadId = typeof msg.squadId === 'string' ? msg.squadId.trim() : '';
        if (requestedScope === 'agent' && (!requestedAgentId || requestedAgentId.length > 160 || requestedSquadId.length > 160)) {
          throw new Error('子 Agent 会话必须指定有效的 Agent 与小队归属');
        }
        const conv: Conversation = {
          id: randomUUID(), threadId: null, title: '新对话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), turnCount: 0,
          scope: requestedScope,
          ...(requestedScope === 'agent' ? { agentId: requestedAgentId, squadId: requestedSquadId } : {}),
        };
        convCache.set(conv.id, conv);
        upsertConversation(conv);
        broadcast({ type: 'conversations_updated', conversations: [...convCache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
        send(ws, { type: 'conversation_created', conversation: conv });
      } else if (type === 'chat') {
        const convId = String(msg.conversationId ?? '');
        const text = String(msg.text ?? '').trim();
        if (!text) { send(ws, { type: 'error', convId, message: '消息不能为空' }); return; }
        // A chat request implicitly subscribes its sender. This keeps direct
        // integrations and reconnecting clients observable even when they did
        // not send a separate view message first.
        viewOf.set(ws, convId || null);
        const blocked = conversationTurnBlockMessage(convId);
        if (blocked) { send(ws, { type: 'error', convId, message: blocked }); return; }
        let dispatch: AgentDispatchContext | undefined;
        if (typeof msg.agentId === 'string' && msg.agentId.trim()) {
          const task = isRecord(msg.dispatch) ? msg.dispatch : null;
          const orderNo = typeof task?.orderNo === 'string' ? task.orderNo.trim() : '';
          const evidenceRef = typeof task?.evidenceRef === 'string' ? task.evidenceRef.trim() : '';
          const taskType = task?.taskType === 'kitting' ? 'kitting' : task?.taskType === 'quality' ? 'quality' : task?.taskType === 'production' ? 'production' : 'order';
          if (!task || !orderNo || orderNo.length > 160 || !evidenceRef || evidenceRef.length > 500) {
            send(ws, { type: 'error', convId, message: '专业 Agent 派发参数无效' });
            return;
          }
          const evidenceSource = taskType === 'kitting' ? 'kitting' : taskType === 'quality' ? 'quality' : taskType === 'production' ? 'production' : 'order';
          const dashboard = await loadDashboardSnapshot(true);
          const matchedRisk = dashboard.attentionRisks.find((risk) => risk.source === evidenceSource
            && risk.evidenceRef === evidenceRef
            && (dashboardEntityId(risk) === orderNo || risk.orderNo === orderNo || risk.issueNo === orderNo));
          // Production rows are a dedicated read-only assessment and are not
          // included in attentionRisks. Validate their work-order key and
          // evidence against the same freshly loaded snapshot instead of
          // routing a specialist task through the central Agent.
          const productionRow = taskType === 'production'
            ? dashboard.productionAssessment.workOrders.find((row) => {
              const workOrderNo = typeof row.work_order_no === 'string' ? row.work_order_no : typeof row.work_order_id === 'string' ? row.work_order_id : '';
              const rowEvidence = typeof row.evidence_ref === 'string' ? row.evidence_ref : '';
              return workOrderNo === orderNo && (rowEvidence === evidenceRef || dashboard.productionAssessment.evidenceRefs.includes(evidenceRef));
            })
            : undefined;
          if (!matchedRisk && !productionRow) {
            send(ws, { type: 'error', convId, message: '专业 Agent 派发依据未通过当前中控风险校验，请刷新看板后重试' });
            return;
          }
          const agentId = msg.agentId.trim();
          const harborAgent = loadHarbor().agents.find((item) => item.id === agentId);
          const member = loadAgentSquad().members.find((item) => item.harborAgentId === agentId);
          const isAllowed = taskType === 'order'
            ? /订单交付风险/.test(harborAgent?.role || '') && member?.squadId === 'business-squad-orders'
            : taskType === 'kitting'
              ? /物料齐套|缺料|供给/.test(harborAgent?.role || '') && member?.squadId === 'business-squad-material-kitting'
              : taskType === 'production'
                ? /生产进度|生产关联|报工产能|生产证据/.test(harborAgent?.role || '') && member?.squadId === 'business-squad-production'
                : /质量异常|质量追溯|质量证据|责任部门|质量协同/.test(harborAgent?.role || '') && member?.squadId === 'business-squad-quality';
          if (!harborAgent || !member || !isAllowed) {
            const message = taskType === 'kitting'
              ? '只能向已绑定物料齐套 Agent 小队的专业 Agent 派发该任务'
              : taskType === 'production'
                ? '只能向已绑定生产协同 Agent 小队的专业 Agent 派发该任务'
                : taskType === 'quality'
                ? '只能向已绑定异常与质量 Agent 小队的专业 Agent 派发该任务'
                : '只能向已加入订单 Agent 小队的风险交付 Agent 派发该任务';
            send(ws, { type: 'error', convId, message });
            return;
          }
          dispatch = { agentId: member.id, orderNo, evidenceRef, taskType };
          // A specialist dispatch is never a central conversation. Persist its
          // ownership defensively even if an older client created it as hub.
          const dispatchedConversation = getConv(convId);
          if (dispatchedConversation && (dispatchedConversation.scope !== 'agent' || dispatchedConversation.agentId !== member.id)) {
            dispatchedConversation.scope = 'agent';
            dispatchedConversation.agentId = member.id;
            dispatchedConversation.squadId = member.squadId ?? undefined;
            touch(dispatchedConversation);
            broadcast({ type: 'conversations_updated', conversations: [...convCache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
          }
          const summary = taskType === 'kitting' ? 'material kitting task dispatched to specialist agent'
            : taskType === 'quality' ? 'quality issue task dispatched to specialist agent'
              : taskType === 'production' ? 'production coordination task dispatched to specialist agent'
              : 'order risk dispatched to risk delivery agent';
          appendEvidence({ kind: 'app_event', summary, payload: { orderNo, evidenceRef, taskType, harborAgentId: agentId, squadAgentId: member.id } });
        }
        const requestedChoice = (msg.choice ?? {}) as { provider?: string; model?: string };
        const existingConversation = getConv(convId);
        // A provider session is model-bound. Reconnects may briefly send the UI
        // default before the bound choice is restored, so an existing thread's
        // recorded choice is authoritative for every subsequent request.
        const choice = existingConversation?.threadId
          ? normChoice(existingConversation.lastChoice)
          : requestedChoice;
        appendConversationMessage(convId, { id: `user-${randomUUID()}`, role: 'user', text });
        pushConv(convId, { type: 'user_message', convId, text });
        await startTurn(convId, text, choice, dispatch);
      } else if (type === 'interrupt') {
        const convId = String(msg.conversationId ?? '');
        const conv = getConv(convId);
        if (conv && (turnStartLocks.has(convId) || (conv.threadId && activeTurn.has(conv.threadId)))) {
          requestedInterruptConversations.add(convId);
          const { turnId } = conv.threadId ? activeTurn.get(conv.threadId) ?? { turnId: null } : { turnId: null };
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
          await resolveRuntimeApproval(request, outcome, 'workspace-manager', actorOf.get(ws) || 'system:guard');
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
        const rawPayload = msg.payload;
        if (!isRecord(rawPayload) || typeof rawPayload.model !== 'string' || typeof rawPayload.modelProvider !== 'string' || !Array.isArray(rawPayload.providers)) {
          throw new Error('配置保存请求不完整：model、modelProvider、providers 均为必填字段');
        }
        const p = rawPayload as { model: string; modelProvider: string; providers: Array<{ id: string; base_url?: string; env_key?: string; wire_api?: string }>; presets?: Record<string, string[]>; secrets?: Record<string, string | null> };
        if (p.providers.some((provider) => !isRecord(provider) || typeof provider.id !== 'string')) {
          throw new Error('配置提供商必须为包含 id 的对象数组');
        }
        if (activeTurn.size > 0) { send(ws, { type: 'error', convId: null, message: '有对话正在执行，请先停止再保存配置' }); return; }
        saveModelConfig({ model: p.model ?? '', modelProvider: p.modelProvider ?? '', providers: p.providers ?? [] });
        for (const [k, v] of Object.entries(p.secrets ?? {})) setEnvKey(k, v);
        if (p.presets) saveModelPresets(p.presets);
        await restartEngine();
        send(ws, { type: 'config_saved', message: '配置已保存，codex 运行时已用新配置重启' });
        broadcast({ type: 'model_options', modelOptions: buildModelOptions() });
        broadcast({ type: 'info', convId: null, text: '模型配置已更新' });
      } else {
        send(ws, { type: 'error', convId: null, message: `不支持的 WebSocket 消息类型：${type || '缺失 type'}` });
      }
    } catch (e) {
      const convId = (msg.conversationId as string) ?? null;
      send(ws, { type: 'error', convId, message: (e as Error).message });
    }
  });
  ws.on('close', () => {
    allSockets.delete(ws);
    viewOf.delete(ws);
    actorOf.delete(ws);
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

const decisionDataRefreshTimer = setInterval(() => {
  void refreshDecisionData().catch((error) => console.error('[decision-data-refresh]', (error as Error).message));
}, DECISION_DATA_REFRESH_MS);
decisionDataRefreshTimer.unref();

server.listen(PORT, LISTEN_HOST, () => {
  const scope = LAN_MODE || LISTEN_HOST === '0.0.0.0' ? '局域网可访问' : '仅本机可访问';
  console.log('==============================================');
  console.log(` AEOS Hub 中枢控制台已启动（${scope}）`);
  console.log(`   本机地址: http://127.0.0.1:${PORT}`);
  if (LAN_MODE || LISTEN_HOST === '0.0.0.0') {
    for (const ip of lanAddresses()) {
      console.log(`   局域网地址: http://${ip}:${PORT}`);
    }
    console.log('   提示: 首次从其他设备访问若不通，请在 Windows 防火墙放行该端口');
    console.log(`         (管理员 PowerShell: netsh advfirewall firewall add rule name="AEOS Hub ${PORT}" dir=in action=allow protocol=TCP localport=${PORT})`);
  }
  console.log(`   登录保护: 已启用（账号: ${LOGIN_USERNAME}；密码来自 AEOS_LOGIN_PASSWORD）`);
  console.log(`   隔离 CODEX_HOME: ${codexHome}`);
  console.log('   按 Ctrl+C 退出');
  console.log('==============================================');
  void refreshDecisionData().catch((error) => console.error('[decision-data-refresh]', (error as Error).message));
});
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(decisionDataRefreshTimer);
  const deadline = setTimeout(() => process.exit(1), 20_000);
  deadline.unref();
  server.close();
  for (const guard of pendingGuard.values()) clearTimeout(guard.timer);
  for (const ws of allSockets) ws.close(1001, 'server shutting down');
  try { await runtimeSupervisor.stopAll(); process.exitCode = 0; }
  catch { process.exitCode = 1; }
  for (const ws of allSockets) ws.terminate();
  server.closeAllConnections();
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
