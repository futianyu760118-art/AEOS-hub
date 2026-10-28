// 写操作审批服务：提交 → 人工审批 → 派单 → 回执。写能力只能由本服务在审批后派单。
// 边界：一期只允许提供方声明的写能力；每次写都必须人工审批；不绕过权限表与租户。
import type { CallerContext } from './caller-context.ts';
import type { EvidenceInput } from './evidence.ts';
import type { ExecutionAgentCapability, ExecutionAgentRecord, ExecutionPlaneRegistry } from './execution-plane.ts';
import { authorizeCapability, type ExecutionAgentPermissions } from './execution-agent-permissions.ts';
import { validateAgainstSchema } from './schema-validation.ts';
import type { WriteRequestRecord, WriteRequestStatus, WriteRequestStore } from './write-request-store.ts';

export class WriteRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | null;

  constructor(code: string, status: number, message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'WriteRequestError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type WritePlane = Pick<ExecutionPlaneRegistry, 'list' | 'dispatch' | 'getRun'>;

export interface WriteActor {
  id: string;
  roles: string[];
  tenantId: string;
  name?: string | null;
}

export interface WriteRequestServiceDeps {
  store: WriteRequestStore;
  plane: WritePlane;
  loadPermissions: () => ExecutionAgentPermissions;
  tenantIdOf: (systemId: string | null) => string | null;
  appendEvidence: (input: EvidenceInput) => unknown;
  now?: () => Date;
}

export interface CreateWriteRequestInput {
  tenantId: string;
  capability: string;
  systemId?: string | null;
  input: unknown;
  reason: string;
  requestedBy: { kind: 'user' | 'system'; id: string; name?: string | null };
  caller?: CallerContext | null;
  idempotencyKey?: string | null;
}

export interface WriteCapabilityDescriptor {
  systemId: string;
  systemName: string;
  agentId: string;
  agentName: string;
  capability: string;
  operations: string[];
  riskLevel: string | null;
  approvalRequired: boolean;
}

const APPROVER_ROLES = new Set(['manager', 'supervisor']);
const MAX_REASON = 500;

function text(value: unknown, max = 160): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameInput(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export class WriteRequestService {
  private readonly store: WriteRequestStore;
  private readonly plane: WritePlane;
  private readonly loadPermissions: () => ExecutionAgentPermissions;
  private readonly tenantIdOf: (systemId: string | null) => string | null;
  private readonly appendEvidence: (input: EvidenceInput) => unknown;
  private readonly now: () => Date;

  constructor(deps: WriteRequestServiceDeps) {
    this.store = deps.store;
    this.plane = deps.plane;
    this.loadPermissions = deps.loadPermissions;
    this.tenantIdOf = deps.tenantIdOf;
    this.appendEvidence = deps.appendEvidence;
    this.now = deps.now ?? (() => new Date());
  }

  /** 当前租户可用的写能力（供页面选择）；只返回在线 Agent 声明的写能力。 */
  listCapabilities(tenantId: string): WriteCapabilityDescriptor[] {
    const result: WriteCapabilityDescriptor[] = [];
    for (const agent of this.plane.list().agents) {
      if (agent.connectionStatus !== 'online' || agent.deregisteredAt) continue;
      const systemId = agent.systemId ?? agent.sourceSystem;
      if (this.tenantIdOf(systemId) !== tenantId) continue;
      for (const capability of agent.capabilities) {
        if (capability.constraints?.readOnly !== false) continue;
        result.push({
          systemId,
          systemName: agent.sourceSystemName ?? systemId,
          agentId: agent.agentId,
          agentName: agent.name,
          capability: capability.name,
          operations: this.operationsOf(capability),
          riskLevel: capability.constraints?.riskLevel ?? null,
          approvalRequired: capability.constraints?.approvalRequired !== false,
        });
      }
    }
    return result;
  }

  list(input: { tenantId: string; status?: WriteRequestStatus | null; limit?: number }): WriteRequestRecord[] {
    return this.store.list(input);
  }

  get(id: string, tenantId: string): WriteRequestRecord {
    const record = this.store.get(id);
    if (!record || record.tenantId !== tenantId) throw new WriteRequestError('NOT_FOUND', 404, '写操作请求不存在');
    return record;
  }

  create(input: CreateWriteRequestInput): { record: WriteRequestRecord; idempotent: boolean } {
    const tenantId = text(input.tenantId, 160);
    if (!tenantId) throw new WriteRequestError('INVALID_ARGUMENT', 400, '缺少租户');
    const capabilityName = text(input.capability, 100);
    if (!capabilityName) throw new WriteRequestError('INVALID_ARGUMENT', 400, '缺少能力名');
    const reason = text(input.reason, MAX_REASON);
    if (!reason) throw new WriteRequestError('INVALID_ARGUMENT', 400, '写操作必须填写原因');
    if (!isRecord(input.input)) throw new WriteRequestError('INVALID_ARGUMENT', 400, '写操作 input 必须是对象');

    const target = this.resolveTarget(tenantId, capabilityName, input.systemId ?? null);
    const { agent, capability, systemId } = target;

    const authorization = authorizeCapability(this.loadPermissions(), {
      systemId,
      agentId: agent.agentId,
      capability: capabilityName,
      tenantId,
    });
    if (authorization.enforcement === 'enforce' && !authorization.allowed) {
      throw new WriteRequestError('PERMISSION_DENIED', 403, '该写能力未授权', { reason: authorization.reason });
    }
    if (capability.inputSchema) {
      const validationError = validateAgainstSchema(input.input, capability.inputSchema);
      if (validationError) throw new WriteRequestError('INVALID_ARGUMENT', 400, validationError);
    }
    const operation = text(input.input.operation, 100);
    if (!operation) throw new WriteRequestError('INVALID_ARGUMENT', 400, '写操作缺少 operation');
    const allowedOperations = this.operationsOf(capability);
    if (allowedOperations.length && !allowedOperations.includes(operation)) {
      throw new WriteRequestError('INVALID_ARGUMENT', 400, `不支持的写操作：${operation}`, { allowed: allowedOperations });
    }
    const idempotencyKey = text(input.idempotencyKey ?? input.input.idempotencyKey, 120) || `write-${this.now().getTime()}`;
    const existing = this.store.findByIdempotency(tenantId, idempotencyKey);
    if (existing) {
      if (existing.capability === capabilityName && existing.operation === operation && sameInput(existing.input, input.input)) {
        return { record: existing, idempotent: true };
      }
      throw new WriteRequestError('IDEMPOTENCY_CONFLICT', 409, '同一 idempotencyKey 已用于不同的写操作', { requestId: existing.id });
    }

    const record = this.store.create({
      tenantId,
      systemId,
      agentId: agent.agentId,
      capability: capabilityName,
      operation,
      input: input.input,
      reason,
      idempotencyKey,
      requestedBy: {
        kind: input.requestedBy.kind,
        id: text(input.requestedBy.id, 200) || 'unknown',
        name: text(input.requestedBy.name, 200) || null,
      },
      caller: input.caller ?? null,
    });
    this.audit(record, 'created', { requestedBy: record.requestedBy.id });
    return { record, idempotent: false };
  }

  approve(id: string, actor: WriteActor, note?: string | null): WriteRequestRecord {
    const record = this.get(id, actor.tenantId);
    this.requireApprover(actor);
    if (record.status !== 'pending_approval') {
      throw new WriteRequestError('INVALID_STATE', 409, `当前状态不能审批：${record.status}`);
    }
    const approvedAt = this.now().toISOString();
    let runId: string;
    try {
      const dispatched = this.plane.dispatch(record.agentId, record.capability, record.input, {
        traceId: `write-${record.id}`,
        requestId: record.id,
        writeApproved: true,
        caller: record.caller ?? { systemId: 'aeos-hub', agentId: null, userId: actor.id, taskId: null, traceId: null },
      });
      runId = dispatched.runId;
    } catch (error) {
      throw new WriteRequestError('DISPATCH_FAILED', 502, `派单失败：${(error as Error).message}`);
    }
    const updated = this.store.update(record.id, {
      status: 'dispatched',
      runId,
      approval: { by: actor.id, at: approvedAt, note: text(note, MAX_REASON) || null },
    });
    this.audit(updated, 'approved', { approvedBy: actor.id, runId });
    return updated;
  }

  reject(id: string, actor: WriteActor, reason?: string | null): WriteRequestRecord {
    const record = this.get(id, actor.tenantId);
    this.requireApprover(actor);
    if (record.status !== 'pending_approval') {
      throw new WriteRequestError('INVALID_STATE', 409, `当前状态不能拒绝：${record.status}`);
    }
    const rejectionReason = text(reason, MAX_REASON) || '未填写原因';
    const updated = this.store.update(record.id, {
      status: 'rejected',
      rejection: { by: actor.id, at: this.now().toISOString(), reason: rejectionReason },
    });
    this.audit(updated, 'rejected', { rejectedBy: actor.id, reason: rejectionReason });
    return updated;
  }

  /** 执行面 run 完成/失败时回填写操作结果；未知 runId 直接忽略。 */
  onRunFinished(runId: string, outcome: { state: 'completed' | 'failed'; result?: unknown; error?: { code: string; message: string } | null }): void {
    const record = this.store.load().find((item) => item.runId === runId);
    if (!record || (record.status !== 'dispatched')) return;
    if (outcome.state === 'completed') {
      this.store.update(record.id, { status: 'completed', result: outcome.result ?? null });
      this.audit(record, 'completed', { runId });
      return;
    }
    this.store.update(record.id, {
      status: 'failed',
      error: outcome.error ?? { code: 'WRITE_FAILED', message: '写操作执行失败' },
    });
    this.audit(record, 'failed', { runId, code: outcome.error?.code ?? 'WRITE_FAILED' });
  }

  private resolveTarget(tenantId: string, capabilityName: string, requestedSystemId: string | null): {
    agent: ExecutionAgentRecord;
    capability: ExecutionAgentCapability;
    systemId: string;
  } {
    const candidates = this.plane.list().agents.filter((agent) => {
      if (agent.connectionStatus !== 'online' || agent.deregisteredAt) return false;
      const systemId = agent.systemId ?? agent.sourceSystem;
      if (requestedSystemId && systemId !== requestedSystemId) return false;
      if (this.tenantIdOf(systemId) !== tenantId) return false;
      return agent.capabilities.some((capability) => capability.name === capabilityName);
    });
    const agent = candidates.find((item) => item.agentKind === 'system-gateway') ?? candidates[0];
    if (!agent) throw new WriteRequestError('NO_PROVIDER', 409, `没有在线的写能力提供方：${capabilityName}`);
    const capability = agent.capabilities.find((item) => item.name === capabilityName)!;
    if (capability.constraints?.readOnly !== false) {
      throw new WriteRequestError('NOT_WRITE_CAPABILITY', 400, `能力 ${capabilityName} 不是写能力`);
    }
    return { agent, capability, systemId: agent.systemId ?? agent.sourceSystem };
  }

  private operationsOf(capability: ExecutionAgentCapability): string[] {
    const enumValues = capability.inputSchema?.properties?.operation?.enum;
    return Array.isArray(enumValues) ? enumValues.filter((value): value is string => typeof value === 'string') : [];
  }

  private requireApprover(actor: WriteActor): void {
    if (!actor.roles.some((role) => APPROVER_ROLES.has(role))) {
      throw new WriteRequestError('FORBIDDEN', 403, '只有 manager / supervisor 可以审批写操作');
    }
  }

  private audit(record: WriteRequestRecord, action: string, extra: Record<string, unknown>): void {
    try {
      this.appendEvidence({
        kind: 'app_event',
        actor_id: `write-plane:${record.requestedBy.id}`,
        actor_type: record.requestedBy.kind === 'system' ? 'system' : 'human',
        object_ref: `hub://write-request/${record.id}`,
        source_system: record.systemId,
        correlation_id: `write-request-${action}`,
        summary: `write request ${action}`,
        payload: {
          requestId: record.id,
          capability: record.capability,
          operation: record.operation,
          systemId: record.systemId,
          agentId: record.agentId,
          status: record.status,
          ...extra,
        },
      });
    } catch {
      // 审计失败不改变审批/派单结果。
    }
  }
}
