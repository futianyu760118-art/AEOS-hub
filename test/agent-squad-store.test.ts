import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AgentSquadStore, AgentSquadSnapshotSchema } from '../src/agent-squad-store.ts';

test('keeps child memory separate and records both sides of a squad exchange', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-squad-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let id = 0;
  const store = new AgentSquadStore(join(directory, 'agent-squad.json'), () => new Date('2026-09-21T10:00:00.000Z'), () => `test-${++id}`);
  const initial = store.load();
  const risk = initial.members[0]!;
  const supply = initial.members[1]!;
  store.addActivity({ agentId: risk.id, title: '已接收订单风险分析任务', detail: '订单 SO-01 已从管理者首页派发。' });
  store.addMemory({ agentId: risk.id, content: '订单 SO-01 需要等待证据刷新。' });
  store.sendMessage({ fromAgentId: risk.id, toAgentId: supply.id, content: '请核查关键物料的缺口。' });
  const snapshot = store.load();
  assert.equal(snapshot.memories.filter((memory) => memory.agentId === risk.id).length, 2);
  assert.equal(snapshot.memories.filter((memory) => memory.agentId === supply.id).length, 1);
  assert.equal(snapshot.messages.length, 1);
  assert.ok(snapshot.activities.some((activity) => activity.agentId === risk.id && activity.title === '已接收订单风险分析任务'));
  assert.equal(snapshot.activities.filter((activity) => activity.agentId === risk.id).at(-1)?.title, '发送协作消息');
  assert.equal(snapshot.activities.filter((activity) => activity.agentId === supply.id).at(-1)?.title, '收到协作消息');
  assert.doesNotThrow(() => AgentSquadSnapshotSchema.parse(snapshot));
});

test('keeps legacy members unbound and records explicit harbor and project links', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-squad-links-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let id = 0;
  const store = new AgentSquadStore(join(directory, 'agent-squad.json'), () => new Date('2026-09-22T02:00:00.000Z'), () => `link-${++id}`);
  const initial = store.load();
  const risk = initial.members[0]!;
  assert.equal(initial.projectId, null);
  assert.equal(initial.lead.harborAgentId, null);
  assert.equal(risk.harborAgentId, null);

  const linked = store.bindMember({ agentId: risk.id, harborAgentId: 'agent-delivery-risk', name: '交付风险 Agent', model: 'gpt-5.6' });
  assert.equal(linked.harborAgentId, 'agent-delivery-risk');
  assert.equal(linked.name, '交付风险 Agent');
  assert.throws(() => store.bindMember({ agentId: initial.members[1]!.id, harborAgentId: 'agent-delivery-risk' }), /已加入当前小队/);

  const squad = store.setProject({ projectId: 'project-delivery', leadHarborAgentId: 'agent-aeos-hub' });
  assert.equal(squad.projectId, 'project-delivery');
  assert.equal(squad.lead.harborAgentId, 'agent-aeos-hub');
  assert.equal(squad.activities.at(-1)?.title, '已关联 AI 港湾项目');
  assert.doesNotThrow(() => AgentSquadSnapshotSchema.parse(store.load()));
});

test('removes a squad member with only their collaboration records', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-squad-delete-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let id = 0;
  const store = new AgentSquadStore(join(directory, 'agent-squad.json'), () => new Date('2026-09-22T03:00:00.000Z'), () => `delete-${++id}`);
  const initial = store.load();
  const risk = initial.members[0]!;
  const supply = initial.members[1]!;
  store.addMemory({ agentId: risk.id, content: '仅属于风险 Agent 的测试上下文。' });
  store.sendMessage({ fromAgentId: risk.id, toAgentId: supply.id, content: '请协同核查。' });

  const deleted = store.deleteMember({ agentId: risk.id });
  const snapshot = store.load();
  assert.equal(deleted.member.id, risk.id);
  assert.equal(deleted.removedMemoryCount, 2);
  assert.equal(deleted.removedMessageCount, 1);
  assert.ok(!snapshot.members.some((member) => member.id === risk.id));
  assert.ok(snapshot.memories.every((memory) => memory.agentId !== risk.id));
  assert.ok(snapshot.messages.every((message) => message.fromAgentId !== risk.id && message.toAgentId !== risk.id));
  assert.equal(snapshot.activities.at(-1)?.title, '已移出 Agent 小队');
  assert.doesNotThrow(() => AgentSquadSnapshotSchema.parse(snapshot));
});

test('keeps business squad records separate from each child Agent records', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-business-squad-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let id = 0;
  const store = new AgentSquadStore(join(directory, 'agent-squad.json'), () => new Date('2026-09-22T04:00:00.000Z'), () => `business-${++id}`);
  const initial = store.load();
  const orderSquad = initial.subSquads[0]!;
  const child = initial.members[0]!;
  const agentMemoryCount = initial.memories.length;
  const agentActivityCount = initial.activities.length;

  store.addBusinessSquadMemory({ squadId: orderSquad.id, content: '订单交期风险需由两个下辖 Agent 共同核验。' });
  store.addBusinessSquadActivity({ squadId: orderSquad.id, title: '已升级订单协作', detail: '将高金额订单风险提交中枢 Agent 汇总。' });
  const snapshot = store.load();

  assert.equal(snapshot.members.find((item) => item.id === child.id)?.squadId, orderSquad.id);
  assert.equal(snapshot.squadMemories.filter((item) => item.squadId === orderSquad.id).length, 2);
  assert.equal(snapshot.squadActivities.filter((item) => item.squadId === orderSquad.id).length, 3);
  assert.equal(snapshot.memories.length, agentMemoryCount);
  assert.equal(snapshot.activities.length, agentActivityCount);
  assert.doesNotThrow(() => AgentSquadSnapshotSchema.parse(snapshot));
});

test('migrates a legacy flat squad into the order business squad', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-business-squad-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'agent-squad.json');
  const now = '2026-09-22T04:00:00.000Z';
  writeFileSync(file, JSON.stringify({
    version: 1, revision: 4, updatedAt: now, projectId: null,
    lead: { id: 'agent-aeos-hub', name: 'AEOS 中枢 Agent', role: '主 Agent', model: 'deepseek-chat', harborAgentId: null },
    members: [{ id: 'squad-agent-risk', name: '风险交付 Agent', role: '订单交付风险', model: 'deepseek-chat', harborAgentId: 'agent-risk', status: 'standby', createdAt: now, updatedAt: now }],
    memories: [], activities: [], messages: [],
  }), 'utf8');
  const store = new AgentSquadStore(file, () => new Date(now), () => 'migration');
  const snapshot = store.load();
  assert.equal(snapshot.subSquads[0]?.name, '订单 Agent 小队');
  assert.equal(snapshot.members[0]?.squadId, 'business-squad-orders');
  assert.equal(snapshot.subSquads[1]?.name, '物料齐套 Agent 小队');
  assert.equal(snapshot.members.filter((item) => item.squadId === 'business-squad-material-kitting').length, 4);
  assert.equal(snapshot.squadMemories.some((item) => item.squadId === 'business-squad-material-kitting'), true);
  assert.equal(snapshot.subSquads[2]?.name, '异常与质量 Agent 小队');
  assert.equal(snapshot.members.filter((item) => item.squadId === 'business-squad-quality').length, 4);
  assert.equal(snapshot.squadMemories.some((item) => item.squadId === 'business-squad-quality'), true);
  assert.equal(snapshot.subSquads[3]?.name, '生产协同 Agent 小队');
  assert.equal(snapshot.members.filter((item) => item.squadId === 'business-squad-production').length, 4);
  assert.equal(snapshot.squadMemories.some((item) => item.squadId === 'business-squad-production'), true);
  assert.equal(snapshot.squadMemories.length, 4);
  assert.equal(snapshot.squadActivities.length, 4);
  assert.equal(snapshot.activities.some((item) => item.title === '已建立订单 Agent 小队'), true);
  assert.equal(snapshot.revision, 5);
  assert.doesNotThrow(() => AgentSquadSnapshotSchema.parse(snapshot));
});
