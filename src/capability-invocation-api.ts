// 能力调用系统 API：为中台/ERP/MES 等请求方暴露统一的 capability 自动派单入口。
// 鉴权复用每系统 HMAC 令牌；目标提供方由 Hub 的能力模板决定，调用方不能指定 URL。
import { verifySystemToken } from './system-token.ts';
import type { EvidenceInput } from './evidence.ts';
import { BorrowOrderServiceError } from './borrow-order-service.ts';
import {
  CapabilityInvocationService,
  CapabilityInvocationError,
} from './capability-invocation-service.ts';
import { CapabilityQueryTemplateError } from './capability-query-template.ts';

export interface CapabilityInvocationApiRequest {
  method?: string;
  pathname: string;
  systemId: string;
  token: string;
  body?: Record<string, unknown>;
  bodyParseFailed?: boolean;
}

export type CapabilityInvocationApiResponse = { status: number; body: Record<string, unknown> };

const PATH_PREFIX = '/api/system/capability-invocations';

export class CapabilityInvocationApi {
  private readonly rootSecret: string;
  private readonly service: CapabilityInvocationService;
  private readonly appendEvidence: (input: EvidenceInput) => unknown;

  constructor(dependencies: {
    rootSecret: string;
    service: CapabilityInvocationService;
    appendEvidence: (input: EvidenceInput) => unknown;
  }) {
    this.rootSecret = dependencies.rootSecret;
    this.service = dependencies.service;
    this.appendEvidence = dependencies.appendEvidence;
  }

  handle(request: CapabilityInvocationApiRequest): CapabilityInvocationApiResponse | null {
    if (!request.pathname.startsWith(PATH_PREFIX)) return null;

    if (!this.rootSecret) {
      return { status: 503, body: { error: 'capability invocation plane is not configured', code: 'NOT_CONFIGURED' } };
    }
    const systemId = request.systemId.trim();
    if (!systemId || !request.token || !verifySystemToken(this.rootSecret, systemId, request.token)) {
      this.auditDenied(systemId, request);
      return { status: 401, body: { error: 'authentication required', code: 'AUTH_REQUIRED' } };
    }
    if (request.bodyParseFailed) {
      return { status: 400, body: { error: 'invalid capability-invocation request', code: 'INVALID_ARGUMENT' } };
    }

    try {
      return this.authorized(request, systemId);
    } catch (error) {
      if (error instanceof CapabilityInvocationError) {
        return { status: error.httpStatus, body: { error: error.message, code: error.code, ...(error.details ?? {}) } };
      }
      if (error instanceof BorrowOrderServiceError) {
        return { status: error.httpStatus, body: { error: error.message, code: error.code, ...(error.details ?? {}) } };
      }
      if (error instanceof CapabilityQueryTemplateError) {
        const status = error.code === 'INVALID_ARGUMENT' ? 400 : 500;
        return { status, body: { error: error.message, code: error.code } };
      }
      return { status: 500, body: { error: (error as Error).message || 'capability invocation failed', code: 'INTERNAL_ERROR' } };
    }
  }

  private authorized(request: CapabilityInvocationApiRequest, systemId: string): CapabilityInvocationApiResponse {
    const { method = 'GET', pathname } = request;

    if (pathname === PATH_PREFIX) {
      if (method === 'POST') {
        const result = this.service.invoke({ fromSystem: systemId, body: request.body ?? {} });
        const terminal = result.order.status === 'completed' || result.order.status === 'failed';
        return {
          status: result.idempotent || terminal ? 200 : 202,
          body: {
            invocation: {
              capability: result.capability,
              templateVersion: result.templateVersion,
              borrowOrderId: result.order.orderId,
              runId: result.order.runId,
              status: result.order.status,
            },
            order: result.order,
            idempotent: result.idempotent,
          },
        };
      }
      if (method === 'GET') {
        return { status: 200, body: { templates: this.service.listTemplates() } };
      }
      return { status: 405, body: { error: 'method not allowed' } };
    }

    const templateMatch = pathname.match(/^\/api\/system\/capability-invocations\/templates\/([^/]+)$/);
    if (templateMatch) {
      if (method !== 'GET') return { status: 405, body: { error: 'method not allowed' } };
      const capability = decodeURIComponent(templateMatch[1] ?? '').trim();
      const template = this.service.getTemplate(capability);
      if (!template) return { status: 404, body: { error: `能力模板不存在：${capability}`, code: 'CAPABILITY_NOT_FOUND' } };
      return { status: 200, body: { template } };
    }

    return { status: 404, body: { error: 'capability-invocation endpoint not found' } };
  }

  private auditDenied(systemId: string, request: CapabilityInvocationApiRequest): void {
    try {
      this.appendEvidence({
        kind: 'app_event',
        actor_id: `execution-token:system:${systemId || 'unknown'}`,
        actor_type: 'system',
        object_ref: 'hub://system/capability-invocation',
        source_system: systemId || 'unknown',
        correlation_id: 'capability-invocation-denied',
        summary: 'capability invocation denied',
        payload: { method: request.method ?? null, pathname: request.pathname, reason: 'auth_required' },
      });
    } catch {
      // 审计失败不阻断鉴权拒绝。
    }
  }
}
