// 跨系统借调 token API：系统用 P2 的每系统 HMAC 令牌发起/查询借调单。
// 作用域钉死在令牌声明的 systemId 上；鉴权失败与业务拒绝都写审计。
import { verifySystemToken } from './system-token.ts';
import type { EvidenceInput } from './evidence.ts';
import {
  BorrowOrderService,
  BorrowOrderServiceError,
  borrowOrderSummary,
  type CapabilityDirectoryEntry,
} from './borrow-order-service.ts';
import { BorrowOrderStoreError, BORROW_ORDER_STATUSES, type BorrowOrderStatus } from './borrow-order-store.ts';

export interface BorrowOrderApiRequest {
  method?: string;
  pathname: string;
  systemId: string;
  token: string;
  body?: Record<string, unknown>;
  bodyParseFailed?: boolean;
  query?: URLSearchParams;
}

export type BorrowOrderApiResponse = { status: number; body: Record<string, unknown> };

const PATH_PREFIX = '/api/system/borrow-orders';

export class BorrowOrderApi {
  private readonly rootSecret: string;
  private readonly service: BorrowOrderService;
  private readonly appendEvidence: (input: EvidenceInput) => unknown;

  constructor(dependencies: {
    rootSecret: string;
    service: BorrowOrderService;
    appendEvidence: (input: EvidenceInput) => unknown;
  }) {
    this.rootSecret = dependencies.rootSecret;
    this.service = dependencies.service;
    this.appendEvidence = dependencies.appendEvidence;
  }

  handle(request: BorrowOrderApiRequest): BorrowOrderApiResponse | null {
    if (!request.pathname.startsWith(PATH_PREFIX)) return null;

    if (!this.rootSecret) {
      return { status: 503, body: { error: 'borrow order plane is not configured', code: 'NOT_CONFIGURED' } };
    }
    const systemId = request.systemId.trim();
    if (!systemId || !request.token || !verifySystemToken(this.rootSecret, systemId, request.token)) {
      this.auditDenied(systemId, request);
      return { status: 401, body: { error: 'authentication required', code: 'AUTH_REQUIRED' } };
    }
    if (request.bodyParseFailed) {
      return { status: 400, body: { error: 'invalid borrow-order request', code: 'INVALID_ARGUMENT' } };
    }

    try {
      return this.authorized(request, systemId);
    } catch (error) {
      if (error instanceof BorrowOrderServiceError) {
        return { status: error.httpStatus, body: { error: error.message, code: error.code, ...(error.details ?? {}) } };
      }
      if (error instanceof BorrowOrderStoreError) {
        const status = error.code === 'BORROW_ORDER_NOT_FOUND' ? 404 : error.code === 'BORROW_ORDER_CAPACITY_EXCEEDED' ? 503 : 400;
        return { status, body: { error: error.message, code: error.code } };
      }
      return { status: 500, body: { error: (error as Error).message || '借调服务异常', code: 'INTERNAL_ERROR' } };
    }
  }

  private authorized(request: BorrowOrderApiRequest, systemId: string): BorrowOrderApiResponse {
    const { method = 'GET', pathname } = request;

    if (pathname === PATH_PREFIX) {
      if (method === 'GET') {
        const status = this.parseStatus(request.query?.get('status') ?? null);
        const directionRaw = request.query?.get('direction') ?? 'outgoing';
        const direction = directionRaw === 'incoming' || directionRaw === 'all' ? directionRaw : 'outgoing';
        const limit = this.parseLimit(request.query?.get('limit') ?? null);
        const result = this.service.listForSystem(systemId, { direction, status, limit });
        return {
          status: 200,
          body: {
            direction,
            outgoing: result.outgoing.map(borrowOrderSummary),
            incoming: result.incoming.map(borrowOrderSummary),
          },
        };
      }
      if (method === 'POST') {
        const result = this.service.create({ fromSystem: systemId, body: request.body ?? {} });
        return {
          status: result.idempotent ? 200 : 201,
          body: {
            order: result.order,
            ...(result.dispatch ? { dispatch: result.dispatch } : {}),
            idempotent: result.idempotent,
            committed: true,
            auditStatus: result.auditStatus,
          },
        };
      }
      return { status: 405, body: { error: 'method not allowed' } };
    }

    if (pathname === `${PATH_PREFIX}/capabilities`) {
      if (method !== 'GET') return { status: 405, body: { error: 'method not allowed' } };
      const capabilities: CapabilityDirectoryEntry[] = this.service.capabilityDirectory(systemId);
      return { status: 200, body: { capabilities } };
    }

    const detailMatch = pathname.match(/^\/api\/system\/borrow-orders\/([^/]+)$/);
    if (detailMatch) {
      if (method !== 'GET') return { status: 405, body: { error: 'method not allowed' } };
      const orderId = decodeURIComponent(detailMatch[1] ?? '').trim();
      if (!orderId) return { status: 400, body: { error: 'orderId 无效', code: 'INVALID_ARGUMENT' } };
      return { status: 200, body: { order: this.service.getForSystem(systemId, orderId) } };
    }

    return { status: 404, body: { error: 'borrow-order endpoint not found' } };
  }

  private parseStatus(raw: string | null): BorrowOrderStatus | undefined {
    if (!raw) return undefined;
    if (!(BORROW_ORDER_STATUSES as readonly string[]).includes(raw)) {
      throw new BorrowOrderServiceError('INVALID_ARGUMENT', 400, `status 无效：${raw}`);
    }
    return raw as BorrowOrderStatus;
  }

  private parseLimit(raw: string | null): number {
    if (!raw) return 100;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new BorrowOrderServiceError('INVALID_ARGUMENT', 400, 'limit 必须是正整数');
    }
    return Math.min(Math.trunc(value), 1_000);
  }

  private auditDenied(systemId: string, request: BorrowOrderApiRequest): void {
    try {
      this.appendEvidence({
        kind: 'app_event',
        actor_id: `execution-token:system:${systemId || 'unknown'}`,
        actor_type: 'system',
        object_ref: 'hub://system/borrow-order',
        source_system: systemId || 'unknown',
        correlation_id: 'borrow-order-denied',
        summary: 'borrow order denied',
        payload: { method: request.method ?? null, pathname: request.pathname, reason: 'auth_required' },
      });
    } catch {
      // 审计失败不阻断鉴权拒绝。
    }
  }
}
