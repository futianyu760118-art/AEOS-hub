// 中台助手观测上报 API：系统用 P2 的 HMAC 令牌把自家助手链路的事件摘要发给 Hub。
// 与 run_event 的区别：这里没有 Hub 派单、没有 runId，归属由令牌的 systemId 决定。
import { verifySystemToken } from './system-token.ts';
import type { EvidenceInput } from './evidence.ts';
import type { UsageEventAppendInput } from './usage-ledger-store.ts';
import { AssistantEventStore, type AssistantEvent, type AssistantUsage } from './assistant-event-store.ts';
import { loadModelProfiles } from './model-profile-store.ts';
import { estimateUsageCostCny } from './model-pricing.ts';

export interface AssistantEventApiRequest {
  method?: string;
  pathname: string;
  systemId: string;
  token: string;
  body?: Record<string, unknown>;
  bodyParseFailed?: boolean;
  query?: URLSearchParams;
}

export type AssistantEventApiResponse = { status: number; body: Record<string, unknown> };

const PATH_PREFIX = '/api/system/assistant-events';
const ALLOWED_FIELDS = new Set(['eventId', 'traceId', 'taskId', 'stepId', 'tool', 'confirmationId', 'event', 'name', 'status', 'summary', 'detail', 'startedAt', 'endedAt', 'durationMs', 'usage']);

export class AssistantEventApi {
  private readonly rootSecret: string;
  private readonly store: AssistantEventStore;
  private readonly appendEvidence: (input: EvidenceInput) => unknown;
  private readonly recordUsage: (event: UsageEventAppendInput) => void;

  constructor(dependencies: {
    rootSecret: string;
    store: AssistantEventStore;
    appendEvidence: (input: EvidenceInput) => unknown;
    recordUsage: (event: UsageEventAppendInput) => void;
  }) {
    this.rootSecret = dependencies.rootSecret;
    this.store = dependencies.store;
    this.appendEvidence = dependencies.appendEvidence;
    this.recordUsage = dependencies.recordUsage;
  }

  handle(request: AssistantEventApiRequest): AssistantEventApiResponse | null {
    if (!request.pathname.startsWith(PATH_PREFIX)) return null;
    if (!this.rootSecret) {
      return { status: 503, body: { error: 'assistant event plane is not configured', code: 'NOT_CONFIGURED' } };
    }
    const systemId = request.systemId.trim();
    if (!systemId || !request.token || !verifySystemToken(this.rootSecret, systemId, request.token)) {
      this.auditDenied(systemId, request);
      return { status: 401, body: { error: 'authentication required', code: 'AUTH_REQUIRED' } };
    }
    if (request.bodyParseFailed) {
      return { status: 400, body: { error: 'invalid assistant-event request', code: 'INVALID_ARGUMENT' } };
    }

    if (request.pathname !== PATH_PREFIX) {
      return { status: 404, body: { error: 'assistant-event endpoint not found' } };
    }
    const method = request.method ?? 'GET';
    if (method === 'POST') return this.create(request, systemId);
    if (method === 'GET') return this.list(request, systemId);
    return { status: 405, body: { error: 'method not allowed' } };
  }

  private create(request: AssistantEventApiRequest, systemId: string): AssistantEventApiResponse {
    const body = request.body ?? {};
    const unknownFields = Object.keys(body).filter((key) => !ALLOWED_FIELDS.has(key));
    if (unknownFields.length) {
      return { status: 400, body: { error: `不支持的字段：${unknownFields.join(', ')}`, code: 'INVALID_ARGUMENT' } };
    }
    const result = this.store.record(body, systemId);
    if ('reason' in result) {
      const status = result.reason.includes('LIMIT') ? 429 : 400;
      return { status, body: { error: result.reason, code: 'INVALID_EVENT' } };
    }
    if (!result.duplicate && result.event) this.recordUsageForEvent(result.event);
    return {
      status: result.duplicate ? 200 : 201,
      body: { accepted: true, duplicate: result.duplicate, eventId: result.event?.eventId ?? body.eventId ?? null, committed: true },
    };
  }

  private list(request: AssistantEventApiRequest, systemId: string): AssistantEventApiResponse {
    const traceId = request.query?.get('traceId')?.trim() || undefined;
    const limit = this.parseLimit(request.query?.get('limit') ?? null);
    return {
      status: 200,
      body: {
        events: this.store.listEvents({ systemId, traceId, limit }),
        traces: this.store.listTraces({ systemId, limit }),
        count: this.store.countEvents({ systemId, traceId }),
      },
    };
  }

  private parseLimit(raw: string | null): number {
    if (!raw) return 200;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return 200;
    return Math.min(Math.trunc(value), 1_000);
  }

  private recordUsageForEvent(event: AssistantEvent): void {
    const usage = event.usage;
    if (!usage) return;
    if (usage.tokensIn <= 0 && usage.tokensOut <= 0) return;
    const profile = usage.modelId
      ? loadModelProfiles().profiles.find((item) => !item.followsDefault && (item.id === usage.modelId || item.modelName === usage.modelId))
      : undefined;
    const at = new Date(event.endedAt || event.startedAt || event.receivedAt);
    const cost = usage.cost ?? (profile
      ? estimateUsageCostCny(profile, {
        inputTokens: usage.tokensIn,
        cachedInputTokens: usage.cachedTokens,
        outputTokens: usage.tokensOut,
      }, Number.isNaN(at.getTime()) ? new Date() : at)
      : 0);
    try {
      this.recordUsage({
        // 系统级助手用量桶：assistant-events 只有 systemId/traceId，不对应真实 Agent。
        agentId: 'control-platform-assistant',
        systemId: event.systemId,
        modelId: usage.modelId,
        runId: null,
        tokensIn: usage.tokensIn,
        cachedTokens: usage.cachedTokens,
        tokensOut: usage.tokensOut,
        cost,
        metering: 'reported',
        startedAt: event.startedAt ?? event.receivedAt,
        endedAt: event.endedAt ?? event.receivedAt,
      });
    } catch {
      // 记账失败不影响事件留痕。
    }
  }

  private auditDenied(systemId: string, request: AssistantEventApiRequest): void {
    try {
      this.appendEvidence({
        kind: 'app_event',
        actor_id: `execution-token:system:${systemId || 'unknown'}`,
        actor_type: 'system',
        object_ref: 'hub://system/assistant-events',
        source_system: systemId || 'unknown',
        correlation_id: 'assistant-event-denied',
        summary: 'assistant event denied',
        payload: { method: request.method ?? null, pathname: request.pathname, reason: 'auth_required' },
      });
    } catch {
      // 审计失败不阻断拒绝。
    }
  }
}

export type { AssistantUsage };
