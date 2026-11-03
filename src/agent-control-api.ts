// 系统自助增删本系统 Agent 控制面（token 鉴权 + 只能动自己系统 + 审计 + 软删除保留用量）。
// 每系统令牌由 system-token.ts 派生；本模块把请求作用域钉死在令牌声明的 systemId 上。
import { verifySystemToken } from './system-token.ts';
import type { EvidenceInput } from './evidence.ts';
import { ExecutionPlaneError, type ExecutionPlaneRegistry } from './execution-plane.ts';

type AgentControlPlane = Pick<ExecutionPlaneRegistry, 'declareAgent' | 'deregister' | 'listForSystem'>;

export type AgentControlRequest = {
  method?: string;
  pathname: string;
  systemId: string;
  token: string;
  body?: Record<string, unknown>;
  bodyParseFailed?: boolean;
};

export type AgentControlResponse = { status: number; body: Record<string, unknown> };

const OBJECT_REF = 'hub://system/agent-control';
const PATH_PREFIX = '/api/system/agents';

export class AgentControlApi {
  private readonly dependencies: { rootSecret: string; executionPlane: AgentControlPlane; appendEvidence: (input: EvidenceInput) => unknown };

  constructor(dependencies: { rootSecret: string; executionPlane: AgentControlPlane; appendEvidence: (input: EvidenceInput) => unknown }) {
    this.dependencies = dependencies;
  }

  handle(request: AgentControlRequest): AgentControlResponse | null {
    if (!request.pathname.startsWith(PATH_PREFIX)) return null;

    if (!this.dependencies.rootSecret) {
      return { status: 503, body: { error: 'agent control plane is not configured', code: 'NOT_CONFIGURED' } };
    }
    const systemId = request.systemId.trim();
    if (!systemId || !request.token || !verifySystemToken(this.dependencies.rootSecret, systemId, request.token)) {
      this.audit(systemId, 'denied', { method: request.method, pathname: request.pathname });
      return { status: 401, body: { error: 'authentication required', code: 'AUTH_REQUIRED' } };
    }
    if (request.bodyParseFailed) return { status: 400, body: { error: 'invalid agent-control request' } };

    try {
      return this.authorized(request, systemId);
    } catch (error) {
      if (error instanceof ExecutionPlaneError) {
        const status = error.code === 'AGENT_NOT_FOUND' ? 404 : error.code === 'AGENT_OWNED_BY_OTHER' ? 403 : 400;
        this.audit(systemId, 'denied', { method: request.method, pathname: request.pathname, code: error.code });
        return { status, body: { error: error.message, code: error.code } };
      }
      return { status: 400, body: { error: (error as Error).message || 'invalid agent-control request' } };
    }
  }

  private authorized(request: AgentControlRequest, systemId: string): AgentControlResponse {
    const { method, pathname, body = {} } = request;
    if (pathname === PATH_PREFIX) {
      if (method === 'GET') {
        return this.accepted(systemId, 'listed', { agents: this.dependencies.executionPlane.listForSystem(systemId) });
      }
      if (method === 'POST') {
        return this.accepted(systemId, 'declared', { agent: this.dependencies.executionPlane.declareAgent(body, systemId) });
      }
      return { status: 405, body: { error: 'method not allowed' } };
    }
    const agentDelete = pathname.match(/^\/api\/system\/agents\/([^/]+)$/);
    if (agentDelete && method === 'DELETE') {
      const agentId = decodeURIComponent(agentDelete[1] ?? '').trim();
      if (!agentId) throw new Error('agentId 无效');
      const agent = this.dependencies.executionPlane.deregister(agentId, systemId);
      return this.accepted(systemId, 'deregistered', { deregistered: true, agentId: agent.agentId });
    }
    return { status: 404, body: { error: 'agent-control endpoint not found' } };
  }

  private accepted(systemId: string, action: string, body: Record<string, unknown>): AgentControlResponse {
    const auditStatus = this.audit(systemId, action);
    return { status: action === 'declared' ? 201 : 200, body: { ...body, committed: true, auditStatus } };
  }

  private audit(systemId: string, action: string, extra?: Record<string, unknown>): 'recorded' | 'failed' {
    const safeSystemId = systemId.trim() || 'unknown';
    try {
      this.dependencies.appendEvidence({
        kind: 'app_event',
        actor_id: `execution-token:system:${safeSystemId}`,
        actor_type: 'system',
        object_ref: OBJECT_REF,
        source_system: safeSystemId,
        correlation_id: `agent-control-${action}`,
        summary: `agent control ${action}`,
        payload: { action, systemId: safeSystemId, ...(extra ?? {}) },
      });
      return 'recorded';
    } catch {
      return 'failed';
    }
  }
}
