// M13 Agent Workforce 会话接口（供 M05 CRM 等外部系统调用）。
// 契约依据：IMA 笔记《M13 智能体（Agent Workforce）会话接口对接申请》（M05 → M13）。
// 端点：
//   GET  /poms/v1/agents
//   POST /poms/v1/agents/{agent_id}/chat
//   GET  /poms/v1/agents/{agent_id}/sessions/{session_id}/messages
//   GET  /poms/v1/agents/health
// 鉴权：X-API-Key 或 Authorization: Bearer，密钥来自 M13_AGENT_CHAT_API_KEY（未配置时返回 503）。
// 会话/消息持久化到 data/m13-agent-chat-sessions.json；Agent 回答走 Hub 的 codex 运行时。
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from './atomic-file.ts';
import { dataDir } from './conversations.ts';
import type { EvidenceInput } from './evidence.ts';
import type {
  CreateRuntimeSessionRequest,
  ResumeRuntimeSessionRequest,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeRun,
  RuntimeSession,
  StartRuntimeRunRequest,
} from './runtime/types.ts';

export type M13AgentId = 'agent-main' | 'agent-quality' | 'agent-sales';

export interface M13AgentDefinition {
  id: M13AgentId;
  name: string;
  role: string;
  developerInstructions: string;
}

// M13 对外暴露的「Agent Workforce」三个入口。它们共用 Hub 的 codex 运行时与 MCP 工具面，
// 仅通过 developerInstructions 约束各自职责边界（与试点只读、引用 evidence_refs 一致）。
export const M13_AGENTS: readonly M13AgentDefinition[] = [
  {
    id: 'agent-main',
    name: '岗位主 Agent',
    role: '任务拆解与对象查询',
    developerInstructions: [
      '你是 AEOS M13 的「岗位主 Agent」。',
      '职责：把用户的问题拆解为可核查的子任务，定位并引用相关业务对象（订单、物料、BOM、供应商、齐套、质量、生产等），综合多域信息给出建议。',
      '硬约束：只调用已注册的只读 MCP 工具（company-control）；不执行写操作、命令或文件扫描；结论必须引用返回的 evidence_refs；数据缺失或过旧时明确标注「数据置信度不足」，不得编造。',
      '输出：结构化中文结论（事项/依据/风险与缺口/建议动作/置信度），并给出 TOP 需人关注事项。',
    ].join('\n'),
  },
  {
    id: 'agent-quality',
    name: '品质检验 Agent',
    role: '检验相关记录汇总',
    developerInstructions: [
      '你是 AEOS M13 的「品质检验 Agent」。',
      '职责：汇总与追溯质量异常、检验记录，关联订单/批次/物料/责任部门，形成质量视角的结论。',
      '硬约束：只调用已注册的只读 MCP 工具（company-control 的 quality_issues_list / quality_trace 等）；不执行写操作；结论必须引用 evidence_refs；数据缺失或过旧时明确标注「数据置信度不足」。',
      '输出：结构化中文结论（事项/依据/风险与缺口/建议动作/置信度）。',
    ].join('\n'),
  },
  {
    id: 'agent-sales',
    name: '销售开发 Agent',
    role: '线索与客户跟进建议',
    developerInstructions: [
      '你是 AEOS M13 的「销售开发 Agent」。',
      '职责：结合订单、交期、库存、齐套与质量信息，为线索与客户跟进提供建议，识别风险与机会。',
      '硬约束：只调用已注册的只读 MCP 工具；不执行写操作；结论必须引用 evidence_refs；数据缺失或过旧时明确标注「数据置信度不足」。',
      '输出：结构化中文结论（事项/依据/风险与缺口/建议动作/置信度）。',
    ].join('\n'),
  },
] as const;

export const M13_AGENT_CHAT_PATH_PREFIX = '/poms/v1/agents';

const MAX_MESSAGE_CHARS = 2000;
const MAX_SESSION_MESSAGES = 200;
const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 120;

interface M13ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

interface M13ChatSession {
  sessionId: string;
  agentId: M13AgentId;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: M13ChatMessage[];
}

interface M13ChatStore {
  sessions: Record<string, M13ChatSession>;
}

// 运行时窄接口：便于单测注入假运行时，也避免把 supervisor 的完整实现耦合进来。
export interface M13ChatRuntimePort {
  createSession(request: CreateRuntimeSessionRequest): Promise<RuntimeSession>;
  resumeSession(sessionId: string, request: ResumeRuntimeSessionRequest): Promise<RuntimeSession>;
  startRun(sessionId: string, request: StartRuntimeRunRequest): Promise<RuntimeRun>;
  waitForRun(runId: string, timeoutMs?: number): Promise<RuntimeRun>;
  onEvent(listener: RuntimeEventListener): () => void;
}

export type M13ChatRequest = {
  method?: string;
  pathname: string;
  authorization?: string;
  apiKey?: string;
  body?: Record<string, unknown>;
  bodyParseFailed?: boolean;
  query?: URLSearchParams;
};

export type M13ChatResponse = { status: number; body: Record<string, unknown> } | null;

export interface M13ChatApiOptions {
  apiKey: string;
  runtime: M13ChatRuntimePort;
  appendEvidence: (input: EvidenceInput) => unknown;
  enabled?: boolean;
  storeFile?: string;
  runTimeoutMs?: number;
  rateLimitPerMinute?: number;
  /** 额外的密钥校验（如已签发的每申请密钥）。返回 true 视为通过。 */
  verifyKey?: (key: string) => boolean;
}

const OBJECT_REF = 'hub://m13/agent-workforce';

export class M13AgentChatApi {
  private readonly apiKey: string;
  private readonly runtime: M13ChatRuntimePort;
  private readonly appendEvidence: (input: EvidenceInput) => unknown;
  private readonly verifyKeyCallback: ((key: string) => boolean) | undefined;
  private readonly enabled: boolean;
  private readonly storeFile: string;
  private readonly runTimeoutMs: number;
  private readonly rateLimitPerMinute: number;
  private readonly sessionLocks = new Map<string, Promise<unknown>>();
  private readonly rateBuckets = new Map<string, { windowStart: number; count: number }>();

  constructor(options: M13ChatApiOptions) {
    this.apiKey = options.apiKey.trim();
    this.runtime = options.runtime;
    this.appendEvidence = options.appendEvidence;
    this.verifyKeyCallback = options.verifyKey;
    this.enabled = options.enabled !== false;
    this.storeFile = options.storeFile ?? join(dataDir, 'm13-agent-chat-sessions.json');
    this.runTimeoutMs = options.runTimeoutMs && Number.isFinite(options.runTimeoutMs) && options.runTimeoutMs > 0
      ? options.runTimeoutMs
      : DEFAULT_RUN_TIMEOUT_MS;
    this.rateLimitPerMinute = options.rateLimitPerMinute && Number.isFinite(options.rateLimitPerMinute) && options.rateLimitPerMinute > 0
      ? options.rateLimitPerMinute
      : DEFAULT_RATE_LIMIT_PER_MINUTE;
  }

  async handle(request: M13ChatRequest): Promise<M13ChatResponse> {
    const pathname = request.pathname ?? '';
    if (!pathname.startsWith(M13_AGENT_CHAT_PATH_PREFIX)) return null;
    if (!this.enabled) {
      return { status: 503, body: { code: 503, message: 'M13 Agent 会话接口未启用', extra: { enabled: false } } };
    }
    if (!this.apiKey) {
      return { status: 503, body: { code: 503, message: 'M13 Agent 会话接口未配置密钥', extra: { configured: false } } };
    }
    if (!this.verifyKey(request)) {
      this.audit('denied', { method: request.method, pathname, code: 'INVALID_CREDENTIAL' });
      return { status: 401, body: { code: 401, message: '凭据无效' } };
    }
    if (!this.allowRate(request)) {
      this.audit('rate_limited', { method: request.method, pathname });
      return { status: 429, body: { code: 429, message: '触发限流', extra: { retry_after: 1 } } };
    }

    const relative = pathname.slice(M13_AGENT_CHAT_PATH_PREFIX.length);
    try {
      return await this.route(request, relative);
    } catch (error) {
      const message = (error as Error).message || 'internal error';
      this.audit('error', { method: request.method, pathname, error: message });
      return { status: 500, body: { code: 500, message: 'M13 内部错误', extra: { detail: message } } };
    }
  }

  private async route(request: M13ChatRequest, relative: string): Promise<M13ChatResponse> {
    const method = request.method ?? 'GET';

    if (relative === '' || relative === '/') {
      if (method !== 'GET') return { status: 405, body: { code: 405, message: 'method not allowed' } };
      return this.catalog();
    }

    if (relative === '/health') {
      if (method !== 'GET') return { status: 405, body: { code: 405, message: 'method not allowed' } };
      return this.health();
    }

    const chatMatch = relative.match(/^\/([^/]+)\/chat$/);
    if (chatMatch) {
      if (method !== 'POST') return { status: 405, body: { code: 405, message: 'method not allowed' } };
      return this.chat(decodeURIComponent(chatMatch[1] ?? ''), request);
    }

    const messagesMatch = relative.match(/^\/([^/]+)\/sessions\/([^/]+)\/messages$/);
    if (messagesMatch) {
      if (method !== 'GET') return { status: 405, body: { code: 405, message: 'method not allowed' } };
      return this.history(decodeURIComponent(messagesMatch[1] ?? ''), decodeURIComponent(messagesMatch[2] ?? ''), request);
    }

    return { status: 404, body: { code: 404, message: 'endpoint not found' } };
  }

  private catalog(): M13ChatResponse {
    const agents = M13_AGENTS.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: 'active',
      hub_connected: true,
    }));
    return { status: 200, body: { agents } };
  }

  private async health(): Promise<M13ChatResponse> {
    return { status: 200, body: { chat_available: true, agents: M13_AGENTS.map((agent) => agent.id) } };
  }

  private history(agentId: string, sessionId: string, request: M13ChatRequest): M13ChatResponse {
    const agent = findAgent(agentId);
    if (!agent) return { status: 404, body: { code: 404, message: 'Agent 不存在' } };
    const session = this.loadStore().sessions[sessionId];
    if (!session || session.agentId !== agent.id) {
      return { status: 404, body: { code: 404, message: '会话不存在或已失效' } };
    }
    const limit = parseLimit(request.query?.get('limit'));
    const messages = session.messages.slice(-limit);
    return { status: 200, body: { session_id: session.sessionId, agent_id: session.agentId, messages } };
  }

  private async chat(agentId: string, request: M13ChatRequest): Promise<M13ChatResponse> {
    const agent = findAgent(agentId);
    if (!agent) return { status: 404, body: { code: 404, message: 'Agent 不存在' } };
    if (request.bodyParseFailed) return { status: 400, body: { code: 400, message: '请求体非法' } };

    const body = request.body ?? {};
    const message = typeof body.message === 'string' ? body.message : '';
    if (!message.trim() || message.length > MAX_MESSAGE_CHARS) {
      return { status: 400, body: { code: 400, message: `message 长度须为 1–${MAX_MESSAGE_CHARS} 字符` } };
    }
    const requestedSessionId = typeof body.session_id === 'string' && body.session_id.trim()
      ? body.session_id.trim()
      : null;
    const context = isRecord(body.context) ? body.context : undefined;

    return this.withSessionLock(requestedSessionId, () => this.runChat(agent, message, requestedSessionId, context));
  }

  private async runChat(
    agent: M13AgentDefinition,
    message: string,
    requestedSessionId: string | null,
    context: Record<string, unknown> | undefined,
  ): Promise<M13ChatResponse> {
    const store = this.loadStore();
    let session: M13ChatSession | undefined = requestedSessionId ? store.sessions[requestedSessionId] : undefined;
    if (requestedSessionId && !session) {
      return { status: 404, body: { code: 404, message: '会话不存在或已失效' } };
    }
    if (session && session.agentId !== agent.id) {
      return { status: 404, body: { code: 404, message: '会话不存在或已失效' } };
    }

    const now = new Date().toISOString();
    if (!session) {
      session = {
        sessionId: `sess_${Date.now()}_${randomUUID().slice(0, 8)}`,
        agentId: agent.id,
        threadId: null,
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
    }

    const runtimeSession = session.threadId
      ? await this.runtime.resumeSession(session.threadId, { developerInstructions: agent.developerInstructions })
      : await this.runtime.createSession({ developerInstructions: agent.developerInstructions });
    session.threadId = runtimeSession.id;

    const captured = { text: '', tokens: 0 };
    const off = this.runtime.onEvent((event) => this.captureEvent(event, runtimeSession.id, captured));

    let run: RuntimeRun;
    try {
      run = await this.runtime.startRun(runtimeSession.id, {
        input: [{ type: 'text', text: message }],
        clientRequestId: `m13_${randomUUID()}`,
        metadata: { agentId: agent.id, source: context?.source, sessionId: session!.sessionId },
      });
    } catch (error) {
      off();
      return { status: 500, body: { code: 500, message: 'M13 内部错误', extra: { detail: (error as Error).message } } };
    }

    let outcome: RuntimeRun;
    try {
      outcome = await this.runtime.waitForRun(run.id, this.runTimeoutMs);
    } catch (error) {
      off();
      return { status: 504, body: { code: 504, message: 'Agent 推理超时', extra: { timeout_ms: this.runTimeoutMs } } };
    } finally {
      // 等待结束后再取消订阅，确保最终的 item/completed 已进入捕获。
    }
    off();

    if (outcome.state !== 'completed') {
      const detail = outcome.failure?.message ?? outcome.state;
      return { status: 502, body: { code: 502, message: 'Agent 运行未完成', extra: { detail } } };
    }

    const reply = captured.text.trim();
    if (!reply) {
      return { status: 502, body: { code: 502, message: 'Agent 未产出回复', extra: { finish_reason: 'empty' } } };
    }

    session.messages.push(
      { id: `user-${randomUUID()}`, role: 'user', text: message, createdAt: now },
      { id: `assistant-${randomUUID()}`, role: 'assistant', text: reply, createdAt: new Date().toISOString() },
    );
    if (session.messages.length > MAX_SESSION_MESSAGES) {
      session.messages = session.messages.slice(-MAX_SESSION_MESSAGES);
    }
    session.updatedAt = new Date().toISOString();
    this.saveStore(store, session);

    this.audit('chat_completed', { method: 'POST', pathname: `/poms/v1/agents/${agent.id}/chat`, sessionId: session.sessionId, agentId: agent.id });

    return {
      status: 200,
      body: {
        session_id: session.sessionId,
        reply,
        agent_id: agent.id,
        finish_reason: 'stop',
        usage: { tokens: captured.tokens },
      },
    };
  }

  private captureEvent(
    event: RuntimeEvent,
    threadId: string,
    state: { text: string; tokens: number },
  ): void {
    if (event.kind !== 'notification') return;
    if (event.sessionId !== threadId) return;

    if (event.name === 'thread/tokenUsage/updated') {
      const params = isRecord(event.data) ? event.data : {};
      const total = isRecord(params.tokenUsage) ? isRecord(params.tokenUsage.total) ? params.tokenUsage.total : {} : {};
      const outputTokens = typeof total.outputTokens === 'number' ? Math.trunc(total.outputTokens) : 0;
      // 只更新用量，绝不覆盖已捕获的回复文本。
      if (outputTokens > 0) state.tokens = outputTokens;
      return;
    }
    if (event.name === 'item/agentMessage/delta') {
      const delta = isRecord(event.data) ? event.data.delta : undefined;
      if (typeof delta === 'string' && delta) state.text = `${state.text}${delta}`.slice(-20000);
      return;
    }
    if (event.name === 'item/completed') {
      const data = isRecord(event.data) ? event.data : {};
      const item = isRecord(data.item) ? data.item : {};
      if (item.type === 'agentMessage' && typeof item.text === 'string') state.text = item.text;
    }
  }

  private async withSessionLock<T>(sessionId: string | null, task: () => Promise<T>): Promise<T> {
    const key = sessionId ?? `new:${randomUUID()}`;
    const previous = this.sessionLocks.get(key);
    const current = (async () => {
      if (previous) await previous.catch(() => undefined);
      return task();
    })();
    this.sessionLocks.set(key, current);
    try {
      return await current;
    } finally {
      if (this.sessionLocks.get(key) === current) this.sessionLocks.delete(key);
    }
  }

  private verifyKey(request: M13ChatRequest): boolean {
    const header = request.apiKey?.trim() || extractBearer(request.authorization) || '';
    if (!header) return false;
    if (this.apiKey) {
      const expected = Buffer.from(this.apiKey);
      const actual = Buffer.from(header);
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) return true;
    }
    if (this.verifyKeyCallback) {
      try {
        if (this.verifyKeyCallback(header)) return true;
      } catch {
        // 回调异常按未通过处理。
      }
    }
    return false;
  }

  private allowRate(request: M13ChatRequest): boolean {
    const identity = request.apiKey?.trim() || extractBearer(request.authorization) || 'anonymous';
    const now = Date.now();
    const bucket = this.rateBuckets.get(identity);
    if (!bucket || now - bucket.windowStart >= 60_000) {
      this.rateBuckets.set(identity, { windowStart: now, count: 1 });
      return true;
    }
    bucket.count += 1;
    if (bucket.count > this.rateLimitPerMinute) return false;
    return true;
  }

  private loadStore(): M13ChatStore {
    try {
      if (!existsSync(this.storeFile)) return { sessions: {} };
      const raw = JSON.parse(readFileSync(this.storeFile, 'utf-8'));
      const sessions = isRecord(raw) && isRecord(raw.sessions) ? raw.sessions : {};
      return { sessions: sessions as M13ChatStore['sessions'] };
    } catch {
      return { sessions: {} };
    }
  }

  private saveStore(store: M13ChatStore, session: M13ChatSession): void {
    store.sessions[session.sessionId] = session;
    mkdirSync(join(this.storeFile, '..'), { recursive: true });
    atomicWrite(this.storeFile, JSON.stringify(store, null, 2));
  }

  private audit(action: string, extra: Record<string, unknown>): void {
    try {
      this.appendEvidence({
        kind: 'app_event',
        actor_id: 'm13:agent-workforce',
        actor_type: 'system',
        object_ref: OBJECT_REF,
        source_system: 'm13-hub',
        correlation_id: `m13-agent-chat-${action}`,
        summary: `m13 agent chat ${action}`,
        payload: { action, ...extra },
      });
    } catch {
      // 审计失败不应阻断接口。
    }
  }
}

function findAgent(agentId: string): M13AgentDefinition | undefined {
  return M13_AGENTS.find((agent) => agent.id === agentId);
}

function extractBearer(authorization: string | undefined): string {
  if (!authorization) return '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() ?? '';
}

function parseLimit(value: string | null | undefined): number {
  const n = value ? Number.parseInt(value, 10) : 50;
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, n));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
