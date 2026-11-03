import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WriteRequestService, WriteRequestError } from '../src/write-request-service.ts';
import { WriteRequestStore } from '../src/write-request-store.ts';
import type { ExecutionAgentRecord, ExecutionRunRecord } from '../src/execution-plane.ts';
import type { ExecutionAgentPermissions } from '../src/execution-agent-permissions.ts';
import type { EvidenceInput } from '../src/evidence.ts';

const NOW = '2026-10-28T04:00:00.000Z';
const TENANT = 'tenant-demo';

const WRITE_AGENT: ExecutionAgentRecord = {
  agentId: 'gateway-control-platform',
  name: '公司中台系统网关',
  version: '1.0.0',
  connectionStatus: 'online',
  runtimeStatus: 'idle',
  lastSeenAt: NOW,
  currentRunId: null,
  registeredAt: NOW,
  local: false,
  systemId: 'control-platform',
  sourceSystem: 'control-platform',
  sourceSystemName: '公司中控平台',
  authMode: 'system-token',
  simulated: false,
  agentKind: 'system-gateway',
  deregisteredAt: null,
  capabilities: [
    {
      name: 'write_control_platform',
      description: '中台写操作',
      inputSchema: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['order.update_note', 'order.update_status'] },
          orderNo: { type: 'string' },
          changes: { type: 'object' },
          idempotencyKey: { type: 'string' },
        },
        required: ['operation', 'orderNo', 'changes'],
      },
      constraints: { readOnly: false, approvalRequired: true, riskLevel: 'low', idempotent: true },
    },
  ],
};

function permissions(allowed = true): ExecutionAgentPermissions {
  return {
    version: 1,
    revision: 1,
    updatedAt: NOW,
    enforcement: 'enforce',
    defaultPolicy: 'deny',
    grants: allowed
      ? [{ systemId: 'control-platform', agentId: 'gateway-control-platform', tenantId: TENANT, capabilities: ['write_control_platform'] }]
      : [],
  } as ExecutionAgentPermissions;
}

function fixture(options: { allowed?: boolean; agent?: ExecutionAgentRecord | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-writes-'));
  const store = new WriteRequestStore({ file: join(dir, 'writes.json'), now: () => new Date(NOW), idFactory: () => 'id-1' });
  const dispatched: Array<{ agentId: string; capability: string; input: unknown; options: unknown }> = [];
  const agents = options.agent === null ? [] : [options.agent ?? WRITE_AGENT];
  const plane = {
    list: () => ({ agents, runs: [] as ExecutionRunRecord[] }),
    dispatch: (agentId: string, capability: string, input: unknown, dispatchOptions: unknown) => {
      dispatched.push({ agentId, capability, input, options: dispatchOptions });
      return { runId: 'exec-run-write-1', state: 'dispatched' as const };
    },
    getRun: () => undefined,
  };
  const audits: EvidenceInput[] = [];
  const service = new WriteRequestService({
    store,
    plane,
    loadPermissions: () => permissions(options.allowed ?? true),
    tenantIdOf: (systemId) => systemId === 'control-platform' ? TENANT : null,
    appendEvidence: (entry) => { audits.push(entry); },
    now: () => new Date(NOW),
  });
  return { service, store, dispatched, audits, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const input = { operation: 'order.update_note', orderNo: 'HJ-1', changes: { remark: '客户要求改期' } };

test('提交写操作后进入待审批，不直接派单', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const { record, idempotent } = f.service.create({
    tenantId: TENANT,
    capability: 'write_control_platform',
    input,
    reason: '客户要求改期',
    requestedBy: { kind: 'user', id: 'u1' },
    idempotencyKey: 'key-1',
  });
  assert.equal(idempotent, false);
  assert.equal(record.status, 'pending_approval');
  assert.equal(record.operation, 'order.update_note');
  assert.equal(f.dispatched.length, 0);
});

test('对话内发起时记录来源会话，便于重启后恢复待确认按钮', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const { record } = f.service.create({
    tenantId: TENANT,
    capability: 'write_control_platform',
    input,
    reason: '原因',
    requestedBy: { kind: 'user', id: 'u1' },
    conversationId: 'conv-1',
    idempotencyKey: 'key-conv',
  });
  assert.equal(record.conversationId, 'conv-1');
  assert.equal(f.store.get(record.id)?.conversationId, 'conv-1');
});

test('审批通过后以 writeApproved 派单并记录审批人', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const { record } = f.service.create({ tenantId: TENANT, capability: 'write_control_platform', input, reason: '原因', requestedBy: { kind: 'user', id: 'u1' }, idempotencyKey: 'key-1' });
  const approved = f.service.approve(record.id, { id: 'm1', roles: ['manager'], tenantId: TENANT });
  assert.equal(approved.status, 'dispatched');
  assert.equal(approved.runId, 'exec-run-write-1');
  assert.equal(approved.approval?.by, 'm1');
  assert.equal(f.dispatched.length, 1);
  assert.deepEqual(f.dispatched[0]?.options, {
    traceId: `write-${record.id}`,
    requestId: record.id,
    writeApproved: true,
    caller: { systemId: 'aeos-hub', agentId: null, userId: 'm1', taskId: null, traceId: null },
  });
});

test('执行回执完成后写回结果', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const { record } = f.service.create({ tenantId: TENANT, capability: 'write_control_platform', input, reason: '原因', requestedBy: { kind: 'user', id: 'u1' }, idempotencyKey: 'key-1' });
  f.service.approve(record.id, { id: 'm1', roles: ['supervisor'], tenantId: TENANT });
  f.service.onRunFinished('exec-run-write-1', { state: 'completed', result: { ok: true, before: { remark: '' }, after: { remark: '客户要求改期' } } });
  const updated = f.store.get(record.id);
  assert.equal(updated?.status, 'completed');
  assert.deepEqual(updated?.result, { ok: true, before: { remark: '' }, after: { remark: '客户要求改期' } });
  const completedAudit = f.audits.filter((entry) => entry.correlation_id === 'write-request-completed').pop();
  assert.equal((completedAudit?.payload as { status?: string } | undefined)?.status, 'completed');
});

test('拒绝后不派单', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const { record } = f.service.create({ tenantId: TENANT, capability: 'write_control_platform', input, reason: '原因', requestedBy: { kind: 'user', id: 'u1' }, idempotencyKey: 'key-1' });
  const rejected = f.service.reject(record.id, { id: 'm1', roles: ['manager'], tenantId: TENANT }, '金额不符');
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.rejection?.reason, '金额不符');
  assert.equal(f.dispatched.length, 0);
});

test('重复 idempotencyKey 返回同一请求；内容不同则冲突', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const first = f.service.create({ tenantId: TENANT, capability: 'write_control_platform', input, reason: '原因', requestedBy: { kind: 'user', id: 'u1' }, idempotencyKey: 'same-key' });
  const second = f.service.create({ tenantId: TENANT, capability: 'write_control_platform', input, reason: '原因', requestedBy: { kind: 'user', id: 'u1' }, idempotencyKey: 'same-key' });
  assert.equal(second.idempotent, true);
  assert.equal(second.record.id, first.record.id);
  assert.throws(
    () => f.service.create({ tenantId: TENANT, capability: 'write_control_platform', input: { ...input, changes: { remark: '另一个' } }, reason: '原因', requestedBy: { kind: 'user', id: 'u1' }, idempotencyKey: 'same-key' }),
    (error: unknown) => error instanceof WriteRequestError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('只读能力不能被当成写能力', (t) => {
  const readOnlyAgent = { ...WRITE_AGENT, capabilities: [{ ...WRITE_AGENT.capabilities[0]!, constraints: { readOnly: true } }] } as ExecutionAgentRecord;
  const f = fixture({ agent: readOnlyAgent });
  t.after(f.cleanup);
  assert.throws(
    () => f.service.create({ tenantId: TENANT, capability: 'write_control_platform', input, reason: '原因', requestedBy: { kind: 'user', id: 'u1' } }),
    (error: unknown) => error instanceof WriteRequestError && error.code === 'NOT_WRITE_CAPABILITY',
  );
});

test('未授权的写能力被拒绝', (t) => {
  const f = fixture({ allowed: false });
  t.after(f.cleanup);
  assert.throws(
    () => f.service.create({ tenantId: TENANT, capability: 'write_control_platform', input, reason: '原因', requestedBy: { kind: 'user', id: 'u1' } }),
    (error: unknown) => error instanceof WriteRequestError && error.code === 'PERMISSION_DENIED',
  );
});

test('非 manager/supervisor 不能审批', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const { record } = f.service.create({ tenantId: TENANT, capability: 'write_control_platform', input, reason: '原因', requestedBy: { kind: 'user', id: 'u1' }, idempotencyKey: 'key-1' });
  assert.throws(
    () => f.service.approve(record.id, { id: 'u2', roles: ['operator'], tenantId: TENANT }),
    (error: unknown) => error instanceof WriteRequestError && error.code === 'FORBIDDEN',
  );
});

test('不支持的操作被拒绝', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  assert.throws(
    () => f.service.create({ tenantId: TENANT, capability: 'write_control_platform', input: { ...input, operation: 'order.delete' }, reason: '原因', requestedBy: { kind: 'user', id: 'u1' } }),
    (error: unknown) => error instanceof WriteRequestError && error.code === 'INVALID_ARGUMENT',
  );
});

test('租户隔离：列表只返回本租户请求', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  f.service.create({ tenantId: TENANT, capability: 'write_control_platform', input, reason: '原因', requestedBy: { kind: 'user', id: 'u1' }, idempotencyKey: 'key-1' });
  assert.equal(f.service.list({ tenantId: TENANT }).length, 1);
  assert.equal(f.service.list({ tenantId: 'other' }).length, 0);
});
