import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentSquadStore, AgentSquadSnapshotSchema } from '../src/agent-squad-store.ts';

function fixture(t: { after: (fn: () => void) => void }, stamp = '2026-10-20T10:00:00.000Z') {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-squad-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let id = 0;
  const store = new AgentSquadStore(join(directory, 'agent-squad.json'), () => new Date(stamp), () => `test-${++id}`);
  return { directory, store };
}

test('协作成员默认快照不再补种业务小队', (t) => {
  const { store } = fixture(t);
  const initial = store.load();
  assert.equal(initial.members.length, 0);
  assert.equal((initial as unknown as Record<string, unknown>).subSquads, undefined);
  assert.equal((initial as unknown as Record<string, unknown>).squadMemories, undefined);
  assert.equal((initial as unknown as Record<string, unknown>).squadActivities, undefined);
  assert.doesNotThrow(() => AgentSquadSnapshotSchema.parse(initial));
});

test('keeps child memory separate and records both sides of an exchange', (t) => {
  const { store } = fixture(t, '2026-09-21T10:00:00.000Z');
  const risk = store.createMember({ name: '经营风险研判 Agent', role: '订单与经营风险扫描' });
  const supply = store.createMember({ name: '供应协同 Agent', role: '物料与供应缺口核查' });
  store.addActivity({ agentId: risk.id, title: '已接收订单风险分析任务', detail: '订单 SO-01 已从管理者首页派发。' });
  store.addMemory({ agentId: risk.id, content: '订单 SO-01 需要等待证据刷新。' });
  store.sendMessage({ fromAgentId: risk.id, toAgentId: supply.id, content: '请核查关键物料的缺口。' });
  const snapshot = store.load();
  assert.equal(snapshot.members.length, 2);
  assert.equal(snapshot.memories.filter((memory) => memory.agentId === risk.id).length, 1);
  assert.equal(snapshot.memories.filter((memory) => memory.agentId === supply.id).length, 0);
  assert.equal(snapshot.messages.length, 1);
  assert.ok(snapshot.activities.some((activity) => activity.agentId === risk.id && activity.title === '已接收订单风险分析任务'));
  assert.equal(snapshot.activities.filter((activity) => activity.agentId === risk.id).at(-1)?.title, '发送协作消息');
  assert.equal(snapshot.activities.filter((activity) => activity.agentId === supply.id).at(-1)?.title, '收到协作消息');
  assert.doesNotThrow(() => AgentSquadSnapshotSchema.parse(snapshot));
});

test('records explicit harbor and project links', (t) => {
  const { store } = fixture(t, '2026-09-22T02:00:00.000Z');
  const risk = store.createMember({ name: '经营风险研判 Agent', role: '订单与经营风险扫描' });
  const supply = store.createMember({ name: '供应协同 Agent', role: '物料与供应缺口核查' });
  assert.equal(store.load().projectId, null);
  assert.equal(risk.harborAgentId, null);

  const linked = store.bindMember({ agentId: risk.id, harborAgentId: 'agent-delivery-risk', name: '交付风险 Agent', model: 'gpt-5.6' });
  assert.equal(linked.harborAgentId, 'agent-delivery-risk');
  assert.equal(linked.name, '交付风险 Agent');
  assert.throws(() => store.bindMember({ agentId: supply.id, harborAgentId: 'agent-delivery-risk' }), /已加入当前协作成员/);

  const squad = store.setProject({ projectId: 'project-delivery', leadHarborAgentId: 'agent-aeos-hub' });
  assert.equal(squad.projectId, 'project-delivery');
  assert.equal(squad.lead.harborAgentId, 'agent-aeos-hub');
  assert.equal(squad.activities.at(-1)?.title, '已关联 AI 港湾项目');
  assert.doesNotThrow(() => AgentSquadSnapshotSchema.parse(store.load()));
});

test('removes a member with only their collaboration records', (t) => {
  const { store } = fixture(t, '2026-09-22T03:00:00.000Z');
  const risk = store.createMember({ name: '经营风险研判 Agent', role: '订单与经营风险扫描' });
  const supply = store.createMember({ name: '供应协同 Agent', role: '物料与供应缺口核查' });
  store.addMemory({ agentId: risk.id, content: '仅属于风险 Agent 的测试上下文。' });
  store.sendMessage({ fromAgentId: risk.id, toAgentId: supply.id, content: '请协同核查。' });

  const deleted = store.deleteMember({ agentId: risk.id });
  const snapshot = store.load();
  assert.equal(deleted.member.id, risk.id);
  assert.equal(deleted.removedMemoryCount, 1);
  assert.equal(deleted.removedMessageCount, 1);
  assert.ok(!snapshot.members.some((member) => member.id === risk.id));
  assert.ok(snapshot.memories.every((memory) => memory.agentId !== risk.id));
  assert.ok(snapshot.messages.every((message) => message.fromAgentId !== risk.id && message.toAgentId !== risk.id));
  assert.equal(snapshot.activities.at(-1)?.title, '已移出 Agent 小队');
  assert.doesNotThrow(() => AgentSquadSnapshotSchema.parse(snapshot));
});

test('读取旧版业务小队快照时剥离退役字段且不再补种', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-squad-legacy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'agent-squad.json');
  const now = '2026-09-22T04:00:00.000Z';
  writeFileSync(file, JSON.stringify({
    version: 1, revision: 4, updatedAt: now, projectId: null,
    lead: { id: 'agent-aeos-hub', name: 'AEOS 中枢 Agent', role: '主 Agent', model: 'deepseek-chat', harborAgentId: null },
    subSquads: [{ id: 'business-squad-orders', name: '订单 Agent 小队', description: '旧外壳', createdAt: now, updatedAt: now }],
    squadMemories: [{ id: 'm1', squadId: 'business-squad-orders', content: '旧记忆', createdAt: now }],
    squadActivities: [{ id: 'a1', squadId: 'business-squad-orders', title: '旧动作', detail: '旧动作', createdAt: now }],
    members: [{ id: 'squad-agent-risk', name: '风险交付 Agent', role: '订单交付风险', model: 'deepseek-chat', squadId: 'business-squad-orders', harborAgentId: 'agent-risk', status: 'standby', createdAt: now, updatedAt: now }],
    memories: [], activities: [], messages: [],
  }), 'utf8');
  const store = new AgentSquadStore(file, () => new Date(now), () => 'legacy');

  const snapshot = store.load();
  assert.equal(snapshot.revision, 4);
  assert.equal(snapshot.members.length, 1);
  assert.equal((snapshot.members[0] as unknown as Record<string, unknown> | undefined)?.squadId, undefined);
  assert.equal((snapshot as unknown as Record<string, unknown>).subSquads, undefined);
  assert.equal((snapshot as unknown as Record<string, unknown>).squadMemories, undefined);
  assert.equal((snapshot as unknown as Record<string, unknown>).squadActivities, undefined);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).subSquads.length, 1);
  assert.doesNotThrow(() => AgentSquadSnapshotSchema.parse(snapshot));
});
