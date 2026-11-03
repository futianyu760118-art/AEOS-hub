import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPersonLifecycleService } from '../src/person-lifecycle.ts';

function event({ id = 'evt-offboard-1', type = 'person.offboarded', revision = 1 } = {}) {
  return {
    event_id: id,
    event_type: type,
    tenant_id: 'tenant-hengjian',
    object_id: 'person-1',
    revision,
    idempotency_key: `tenant-hengjian:Person:person-1:${revision}:${type}`,
    person: { person_id: 'person-1', emp_code: 'E001' },
  } as const;
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-hub-person-lifecycle-'));
  const service = createPersonLifecycleService(join(dir, 'state.json'));
  const agents = [
    { id: 'agent-1', status: 'idle', owner_person_id: 'person-1', execution_identity_person_id: 'person-1', m01Registration: { state: 'active' } },
    { id: 'agent-2', status: 'idle', owner_person_id: 'person-2', execution_identity_person_id: 'person-2', m01Registration: { state: 'active' } },
  ];
  return { service, agents, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('离职撤销 Agent 负责人和执行身份，保留智能体历史', () => {
  const { service, agents, cleanup } = fixture();
  try {
    const result = service.apply(event(), { agents });
    assert.deepEqual(result.revoked_agent_ids, ['agent-1']);
    assert.deepEqual(result.closed_items, ['agent_owner', 'execution_identity']);
    assert.equal(service.snapshot().people['person-1'].access, 'revoked');
    assert.equal(service.snapshot().checklists.length, 2);
  } finally { cleanup(); }
});

test('复职只恢复基础访问，Agent 关系仍需管理员确认', () => {
  const { service, agents, cleanup } = fixture();
  try {
    service.apply(event(), { agents });
    const result = service.apply(event({ id: 'evt-reinstate-1', type: 'person.reinstated', revision: 2 }), { agents });
    assert.equal(result.status, 'pending_confirmation');
    assert.deepEqual(result.pending_confirmation, { permissions: true, agents: true });
    assert.equal(service.snapshot().people['person-1'].access, 'basic_pending_confirmation');
    assert.equal(service.snapshot().people['person-1'].agent_ids.length, 1);
  } finally { cleanup(); }
});

test('重复事件幂等，不会重复写入历史', () => {
  const { service, agents, cleanup } = fixture();
  try {
    service.apply(event(), { agents });
    const replay = service.apply(event(), { agents });
    assert.equal(replay.duplicate, true);
    assert.equal(service.snapshot().events.length, 1);
    assert.equal(service.snapshot().checklists.length, 2);
  } finally { cleanup(); }
});
