// M13 Agent 自助申请接口：让外部系统（如 M05 CRM）无需指定对接人，即可自助提交接入申请。
// 端点（挂在 /poms/v1/agent-applications）：
//   POST  /poms/v1/agent-applications           提交申请（开放，限流 + Idempotency-Key 幂等）
//   GET   /poms/v1/agent-applications/{id}      查询申请状态（开放，按随机 id 定位）；审核通过后返回凭据/开通结果
//   PATCH /poms/v1/agent-applications/{id}      审核（需 M13_AGENT_CHAT_API_KEY，供 M13 管理面）
//   GET   /poms/v1/agent-applications           申请台账（需 M13_AGENT_CHAT_API_KEY，供 M13 管理面）
// 申请落 data/m13-agent-applications.json，状态流转 submitted → reviewing → approved / rejected。
// 审核通过时签发每申请独立的 API Key（credential），并在 GET /{id} 中返回凭据与开通结果。
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from './atomic-file.ts';
import { dataDir } from './conversations.ts';
import type { EvidenceInput } from './evidence.ts';

export const M13_AGENT_APPLICATION_PATH_PREFIX = '/poms/v1/agent-applications';

export type M13ApplicationStatus = 'submitted' | 'reviewing' | 'approved' | 'rejected';

export interface M13AgentApplication {
  id: string;
  sourceSystem: string;
  applicant: string;
  contact: string;
  requestType: string;
  purpose: string;
  agentIds: string[];
  notes: string;
  status: M13ApplicationStatus;
  idempotencyKey: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewerNote: string | null;
  credentialApiKey: string | null;
  credentialIssuedAt: string | null;
  activation: Record<string, unknown> | null;
}

interface M13ApplicationStore {
  applications: M13AgentApplication[];
}

const MAX_PURPOSE_CHARS = 2000;
const MAX_NOTES_CHARS = 2000;
const MAX_APPLICATIONS = 500;
const DEFAULT_SUBMIT_RATE_PER_MINUTE = 20;

export type M13ApplicationRequest = {
  method?: string;
  pathname: string;
  authorization?: string;
  apiKey?: string;
  body?: Record<string, unknown>;
  bodyParseFailed?: boolean;
  clientAddress?: string;
};

export type M13ApplicationResponse = { status: number; body: Record<string, unknown> } | null;

export interface M13AgentApplicationApiOptions {
  apiKey: string;
  appendEvidence: (input: EvidenceInput) => unknown;
  storeFile?: string;
  submitRatePerMinute?: number;
}

const OBJECT_REF = 'hub://m13/agent-applications';

export class M13AgentApplicationApi {
  private readonly apiKey: string;
  private readonly appendEvidence: (input: EvidenceInput) => unknown;
  private readonly storeFile: string;
  private readonly submitRatePerMinute: number;
  private readonly submitBuckets = new Map<string, { windowStart: number; count: number }>();

  constructor(options: M13AgentApplicationApiOptions) {
    this.apiKey = options.apiKey.trim();
    this.appendEvidence = options.appendEvidence;
    this.storeFile = options.storeFile ?? join(dataDir, 'm13-agent-applications.json');
    this.submitRatePerMinute = options.submitRatePerMinute && Number.isFinite(options.submitRatePerMinute) && options.submitRatePerMinute > 0
      ? options.submitRatePerMinute
      : DEFAULT_SUBMIT_RATE_PER_MINUTE;
  }

  async handle(request: M13ApplicationRequest): Promise<M13ApplicationResponse> {
    const pathname = request.pathname ?? '';
    if (!pathname.startsWith(M13_AGENT_APPLICATION_PATH_PREFIX)) return null;

    const method = request.method ?? 'GET';
    const relative = pathname.slice(M13_AGENT_APPLICATION_PATH_PREFIX.length);

    // 提交与按 id 查询是「首次接触」，不要求预配密钥；台账列表与审核属于 M13 管理面，要求密钥。
    if (relative === '' || relative === '/') {
      if (method === 'POST') return this.submit(request);
      if (method === 'GET') return this.list(request);
      return { status: 405, body: { code: 405, message: 'method not allowed' } };
    }
    const idMatch = relative.match(/^\/([^/]+)$/);
    if (idMatch) {
      if (method === 'GET') return this.get(decodeURIComponent(idMatch[1] ?? ''));
      if (method === 'PATCH') return this.review(decodeURIComponent(idMatch[1] ?? ''), request);
    }
    return { status: 404, body: { code: 404, message: 'endpoint not found' } };
  }

  private submit(request: M13ApplicationRequest): M13ApplicationResponse {
    if (request.bodyParseFailed) return { status: 400, body: { code: 400, message: '请求体非法' } };
    if (!this.allowSubmit(request)) {
      return { status: 429, body: { code: 429, message: '提交过于频繁，请稍后再试', extra: { retry_after: 60 } } };
    }

    const body = request.body ?? {};
    const sourceSystem = readString(body.source_system, 80);
    const applicant = readString(body.applicant, 120);
    const purpose = readString(body.purpose, MAX_PURPOSE_CHARS);
    if (!sourceSystem || !applicant || !purpose) {
      return { status: 400, body: { code: 400, message: 'source_system、applicant、purpose 为必填' } };
    }

    const contact = readString(body.contact, 200);
    const requestType = readString(body.request_type, 80) || 'agent_access';
    const notes = readString(body.notes, MAX_NOTES_CHARS);
    const agentIds = readAgentIds(body.agent_ids);
    const idempotencyKey = readString(body.idempotency_key, 200) || null;

    const store = this.loadStore();
    if (idempotencyKey) {
      const existing = store.applications.find(
        (item) => item.idempotencyKey === idempotencyKey && item.sourceSystem === sourceSystem,
      );
      if (existing) {
        return { status: 200, body: this.publicView(existing, true) };
      }
    }

    const now = new Date().toISOString();
    const application: M13AgentApplication = {
      id: `app_${Date.now()}_${randomUUID().slice(0, 8)}`,
      sourceSystem,
      applicant,
      contact,
      requestType,
      purpose,
      agentIds,
      notes,
      status: 'submitted',
      idempotencyKey,
      submittedAt: now,
      reviewedAt: null,
      reviewerNote: null,
      credentialApiKey: null,
      credentialIssuedAt: null,
      activation: null,
    };

    store.applications.unshift(application);
    if (store.applications.length > MAX_APPLICATIONS) {
      store.applications = store.applications.slice(0, MAX_APPLICATIONS);
    }
    this.saveStore(store);

    this.audit('submitted', { id: application.id, sourceSystem, requestType });

    return { status: 201, body: this.publicView(application, true) };
  }

  private get(id: string): M13ApplicationResponse {
    const store = this.loadStore();
    const application = store.applications.find((item) => item.id === id);
    if (!application) return { status: 404, body: { code: 404, message: '申请不存在' } };
    return { status: 200, body: this.publicView(application, true) };
  }

  private list(request: M13ApplicationRequest): M13ApplicationResponse {
    if (!this.apiKey || !this.verifyKey(request)) {
      return { status: 401, body: { code: 401, message: '凭据无效' } };
    }
    const store = this.loadStore();
    return { status: 200, body: { applications: store.applications.map((item) => this.publicView(item, true)) } };
  }

  /** 审核：仅 M13 管理面（共享密钥）。approved 时签发每申请独立的 API Key 并记录开通结果。 */
  private review(id: string, request: M13ApplicationRequest): M13ApplicationResponse {
    if (request.bodyParseFailed) return { status: 400, body: { code: 400, message: '请求体非法' } };
    if (!this.apiKey || !this.verifyKey(request)) {
      return { status: 401, body: { code: 401, message: '凭据无效' } };
    }

    const store = this.loadStore();
    const application = store.applications.find((item) => item.id === id);
    if (!application) return { status: 404, body: { code: 404, message: '申请不存在' } };
    if (application.status === 'approved' || application.status === 'rejected') {
      return { status: 409, body: { code: 409, message: '该申请已审核，不可重复审核' } };
    }

    const body = request.body ?? {};
    const decision = readString(body.status, 20);
    if (decision !== 'approved' && decision !== 'rejected') {
      return { status: 400, body: { code: 400, message: 'status 必须为 approved 或 rejected' } };
    }
    const reviewerNote = readString(body.reviewer_note, 2000);
    const now = new Date().toISOString();

    application.status = decision;
    application.reviewedAt = now;
    application.reviewerNote = reviewerNote || null;
    if (decision === 'approved') {
      application.credentialApiKey = `m13_${randomUUID().replace(/-/g, '')}`;
      application.credentialIssuedAt = now;
      application.activation = {
        granted: true,
        agents: application.agentIds,
        chat_path: `/poms/v1/agents/{agent_id}/chat`,
        auth: 'X-API-Key 或 Authorization: Bearer',
      };
    }
    this.saveStore(store);
    this.audit(decision, { id: application.id, sourceSystem: application.sourceSystem, reviewerNote });

    return { status: 200, body: this.publicView(application, true) };
  }

  /** 会话接口鉴权：接受共享密钥或任一已签发（已批准）的每申请密钥。 */
  verifyCredential(key: string): boolean {
    const candidate = key?.trim() || '';
    if (!candidate) return false;
    if (this.apiKey) {
      const expected = Buffer.from(this.apiKey);
      const actual = Buffer.from(candidate);
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) return true;
    }
    for (const item of this.loadStore().applications) {
      if (item.status !== 'approved' || !item.credentialApiKey) continue;
      const expected = Buffer.from(item.credentialApiKey);
      const actual = Buffer.from(candidate);
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) return true;
    }
    return false;
  }

  private publicView(application: M13AgentApplication, _mask: boolean): Record<string, unknown> {
    const view: Record<string, unknown> = {
      application_id: application.id,
      source_system: application.sourceSystem,
      applicant: application.applicant,
      contact: application.contact,
      request_type: application.requestType,
      purpose: application.purpose,
      agent_ids: application.agentIds,
      status: application.status,
      submitted_at: application.submittedAt,
      reviewed_at: application.reviewedAt,
      reviewer_note: application.reviewerNote,
    };
    // 审核通过后，凭据/开通结果对查询方可见（供申请人取走密钥完成对接）。
    if (application.status === 'approved') {
      view.credential = application.credentialApiKey
        ? { api_key: application.credentialApiKey, issued_at: application.credentialIssuedAt }
        : null;
      view.activation = application.activation;
    }
    return view;
  }

  private verifyKey(request: M13ApplicationRequest): boolean {
    const header = request.apiKey?.trim() || extractBearer(request.authorization) || '';
    if (!header || !this.apiKey) return false;
    const expected = Buffer.from(this.apiKey);
    const actual = Buffer.from(header);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private allowSubmit(request: M13ApplicationRequest): boolean {
    const identity = request.clientAddress || 'unknown';
    const now = Date.now();
    const bucket = this.submitBuckets.get(identity);
    if (!bucket || now - bucket.windowStart >= 60_000) {
      this.submitBuckets.set(identity, { windowStart: now, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= this.submitRatePerMinute;
  }

  private loadStore(): M13ApplicationStore {
    try {
      if (!existsSync(this.storeFile)) return { applications: [] };
      const raw = JSON.parse(readFileSync(this.storeFile, 'utf-8'));
      const applications = Array.isArray((raw as { applications?: unknown })?.applications)
        ? (raw as { applications: M13AgentApplication[] }).applications
        : [];
      return { applications };
    } catch {
      return { applications: [] };
    }
  }

  private saveStore(store: M13ApplicationStore): void {
    mkdirSync(join(this.storeFile, '..'), { recursive: true });
    atomicWrite(this.storeFile, JSON.stringify(store, null, 2));
  }

  private audit(action: string, extra: Record<string, unknown>): void {
    try {
      this.appendEvidence({
        kind: 'app_event',
        actor_id: 'm13:agent-applications',
        actor_type: 'system',
        object_ref: OBJECT_REF,
        source_system: 'm13-hub',
        correlation_id: `m13-agent-application-${action}`,
        summary: `m13 agent application ${action}`,
        payload: { action, ...extra },
      });
    } catch {
      // 审计失败不阻断提交。
    }
  }
}

function readString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function readAgentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function extractBearer(authorization: string | undefined): string {
  if (!authorization) return '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() ?? '';
}
