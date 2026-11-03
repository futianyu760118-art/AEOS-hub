import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const agentSquadFile = join(root, 'data', 'agent-squad.json');
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const timestamp = z.string().datetime({ offset: true });
const text = (max: number, min = 0) => z.string().trim().min(min).max(max);

const SquadMemberSchema = z.object({
  id: text(160, 1), name: text(80, 1), role: text(120, 1), model: text(120, 1),
  harborAgentId: text(160, 1).nullable().default(null),
  status: z.enum(['standby', 'working']), createdAt: timestamp, updatedAt: timestamp,
}).strict();
const SquadMemorySchema = z.object({
  id: text(160, 1), agentId: text(160, 1), content: text(2000, 1), createdAt: timestamp,
}).strict();
const SquadActivitySchema = z.object({
  id: text(160, 1), agentId: text(160, 1), title: text(160, 1), detail: text(1000, 1),
  createdAt: timestamp,
}).strict();
const SquadMessageSchema = z.object({
  id: text(160, 1), fromAgentId: text(160, 1), toAgentId: text(160, 1), content: text(2000, 1),
  createdAt: timestamp,
}).strict();

export const AgentSquadSnapshotSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative(), updatedAt: timestamp,
  projectId: text(160, 1).nullable().default(null),
  lead: z.object({
    id: z.literal('agent-aeos-hub'), name: text(80, 1), role: text(120, 1), model: text(120, 1),
    harborAgentId: text(160, 1).nullable().default(null),
  }).strict(),
  members: z.array(SquadMemberSchema).max(100), memories: z.array(SquadMemorySchema).max(5_000),
  activities: z.array(SquadActivitySchema).max(10_000), messages: z.array(SquadMessageSchema).max(10_000),
}).strict().superRefine((snapshot, ctx) => {
  const ids = new Set<string>([snapshot.lead.id]);
  snapshot.members.forEach((member, index) => {
    if (ids.has(member.id)) ctx.addIssue({ code: 'custom', path: ['members', index, 'id'], message: 'Agent id 不能重复' });
    ids.add(member.id);
  });
  [...snapshot.memories, ...snapshot.activities].forEach((item) => {
    if (!ids.has(item.agentId)) ctx.addIssue({ code: 'custom', path: ['agentId'], message: '引用了不存在的 Agent' });
  });
  snapshot.messages.forEach((message) => {
    if (!ids.has(message.fromAgentId) || !ids.has(message.toAgentId)) {
      ctx.addIssue({ code: 'custom', path: ['messages'], message: '消息引用了不存在的 Agent' });
    }
  });
});

export type AgentSquadSnapshot = z.infer<typeof AgentSquadSnapshotSchema>;
export type AgentSquadMember = z.infer<typeof SquadMemberSchema>;
export type AgentSquadMemory = z.infer<typeof SquadMemorySchema>;
export type AgentSquadActivity = z.infer<typeof SquadActivitySchema>;
export type AgentSquadMessage = z.infer<typeof SquadMessageSchema>;

function required(input: Record<string, unknown>, key: string, max: number): string {
  const raw = input[key];
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`${key} 不能为空`);
  return raw.trim().slice(0, max);
}

/** 读取旧版含业务小队的快照时，剥离已退役字段；不再自愈补种。 */
function normalizedLegacySnapshot(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const snapshot = value as Record<string, unknown>;
  const { subSquads: _subSquads, squadMemories: _squadMemories, squadActivities: _squadActivities, ...rest } = snapshot;
  if (Array.isArray(rest.members)) {
    rest.members = rest.members.map((member) => {
      if (member === null || typeof member !== 'object' || Array.isArray(member)) return member;
      const { squadId: _squadId, ...memberRest } = member as Record<string, unknown>;
      return memberRest;
    });
  }
  return rest;
}

function parse(value: unknown, source: string): AgentSquadSnapshot {
  const result = AgentSquadSnapshotSchema.safeParse(normalizedLegacySnapshot(value));
  if (!result.success) throw new Error(`${source} 数据无效：${result.error.issues.slice(0, 3).map((issue) => issue.message).join('；')}`);
  return result.data;
}

export class AgentSquadStore {
  private readonly file: string;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(file = agentSquadFile, clock: () => Date = () => new Date(), idFactory: () => string = randomUUID) {
    this.file = file;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  load(): AgentSquadSnapshot {
    if (!existsSync(this.file)) {
      const initial = this.defaultSnapshot();
      this.write(initial);
      return structuredClone(initial);
    }
    if (statSync(this.file).size > MAX_FILE_BYTES) throw new Error('Agent 小队数据超过大小上限');
    const snapshot = parse(JSON.parse(readFileSync(this.file, 'utf8')), 'Agent 小队');
    return structuredClone(snapshot);
  }

  createMember(input: Record<string, unknown>): AgentSquadMember {
    return this.mutate((snapshot, now) => {
      const member = SquadMemberSchema.parse({
        id: `squad-agent-${this.idFactory()}`,
        name: required(input, 'name', 80), role: required(input, 'role', 120),
        model: typeof input.model === 'string' && input.model.trim() ? input.model.trim().slice(0, 120) : 'deepseek-chat',
        harborAgentId: typeof input.harborAgentId === 'string' && input.harborAgentId.trim() ? input.harborAgentId.trim().slice(0, 160) : null,
        status: 'standby', createdAt: now, updatedAt: now,
      });
      if (member.harborAgentId && snapshot.members.some((item) => item.harborAgentId === member.harborAgentId)) {
        throw new Error('该 AI 港湾 Agent 已加入当前协作成员');
      }
      snapshot.members.push(member);
      snapshot.activities.push({ id: `activity-${this.idFactory()}`, agentId: member.id, title: '已加入协作成员', detail: member.harborAgentId ? '已绑定 AI 港湾 Agent，并建立独立记忆空间。' : '已建立独立记忆空间，等待主 Agent 指派协作任务。', createdAt: now });
      return member;
    });
  }

  bindMember(input: Record<string, unknown>): AgentSquadMember {
    return this.mutate((snapshot, now) => {
      const agentId = required(input, 'agentId', 160);
      const harborAgentId = required(input, 'harborAgentId', 160);
      const member = snapshot.members.find((item) => item.id === agentId);
      if (!member) throw new Error('小队成员不存在');
      if (snapshot.members.some((item) => item.id !== agentId && item.harborAgentId === harborAgentId)) {
        throw new Error('该 AI 港湾 Agent 已加入当前协作成员');
      }
      member.harborAgentId = harborAgentId;
      if (typeof input.name === 'string' && input.name.trim()) member.name = input.name.trim().slice(0, 80);
      if (typeof input.role === 'string' && input.role.trim()) member.role = input.role.trim().slice(0, 120);
      if (typeof input.model === 'string' && input.model.trim()) member.model = input.model.trim().slice(0, 120);
      member.updatedAt = now;
      snapshot.activities.push({ id: `activity-${this.idFactory()}`, agentId, title: '已绑定 AI 港湾 Agent', detail: `关联 ${member.name}；Runtime 与能力以 AI 港湾配置为准。`, createdAt: now });
      return member;
    });
  }

  deleteMember(input: Record<string, unknown>): { member: AgentSquadMember; removedMemoryCount: number; removedMessageCount: number } {
    return this.mutate((snapshot, now) => {
      const agentId = required(input, 'agentId', 160);
      const member = snapshot.members.find((item) => item.id === agentId);
      if (!member) throw new Error('小队成员不存在');
      const removedMemoryCount = snapshot.memories.filter((item) => item.agentId === agentId).length;
      const removedMessageCount = snapshot.messages.filter((item) => item.fromAgentId === agentId || item.toAgentId === agentId).length;
      snapshot.members = snapshot.members.filter((item) => item.id !== agentId);
      snapshot.memories = snapshot.memories.filter((item) => item.agentId !== agentId);
      snapshot.messages = snapshot.messages.filter((item) => item.fromAgentId !== agentId && item.toAgentId !== agentId);
      snapshot.activities = snapshot.activities.filter((item) => item.agentId !== agentId);
      snapshot.activities.push({
        id: `activity-${this.idFactory()}`,
        agentId: snapshot.lead.id,
        title: '已移出 Agent 小队',
        detail: `${member.name} 已移出；清理 ${removedMemoryCount} 条独立记忆和 ${removedMessageCount} 条队内消息。AI 港湾 Agent 未删除。`,
        createdAt: now,
      });
      return { member, removedMemoryCount, removedMessageCount };
    });
  }

  setProject(input: Record<string, unknown>): AgentSquadSnapshot {
    return this.mutate((snapshot, now) => {
      const rawProjectId = input.projectId;
      const projectId = typeof rawProjectId === 'string' && rawProjectId.trim() ? rawProjectId.trim().slice(0, 160) : null;
      snapshot.projectId = projectId;
      if (typeof input.leadHarborAgentId === 'string' && input.leadHarborAgentId.trim()) {
        snapshot.lead.harborAgentId = input.leadHarborAgentId.trim().slice(0, 160);
      }
      snapshot.activities.push({
        id: `activity-${this.idFactory()}`,
        agentId: snapshot.lead.id,
        title: projectId ? '已关联 AI 港湾项目' : '已解除 AI 港湾项目关联',
        detail: projectId ? `小队协作上下文已关联项目 ${projectId}。` : '小队不再关联特定项目。',
        createdAt: now,
      });
      return structuredClone(snapshot);
    });
  }

  addMemory(input: Record<string, unknown>): AgentSquadMemory {
    return this.mutate((snapshot, now) => {
      const agentId = required(input, 'agentId', 160);
      this.assertKnownAgent(snapshot, agentId);
      const memory = SquadMemorySchema.parse({ id: `memory-${this.idFactory()}`, agentId, content: required(input, 'content', 2_000), createdAt: now });
      snapshot.memories.push(memory);
      snapshot.activities.push({ id: `activity-${this.idFactory()}`, agentId, title: '写入独立记忆', detail: memory.content.slice(0, 180), createdAt: now });
      return memory;
    });
  }

  addActivity(input: Record<string, unknown>): AgentSquadActivity {
    return this.mutate((snapshot, now) => {
      const agentId = required(input, 'agentId', 160);
      this.assertKnownAgent(snapshot, agentId);
      const activity = SquadActivitySchema.parse({
        id: `activity-${this.idFactory()}`,
        agentId,
        title: required(input, 'title', 160),
        detail: required(input, 'detail', 1_000),
        createdAt: now,
      });
      snapshot.activities.push(activity);
      return activity;
    });
  }

  sendMessage(input: Record<string, unknown>): AgentSquadMessage {
    return this.mutate((snapshot, now) => {
      const fromAgentId = required(input, 'fromAgentId', 160);
      const toAgentId = required(input, 'toAgentId', 160);
      if (fromAgentId === toAgentId) throw new Error('不能向同一个 Agent 发送协作消息');
      this.assertKnownAgent(snapshot, fromAgentId);
      this.assertKnownAgent(snapshot, toAgentId);
      const message = SquadMessageSchema.parse({ id: `message-${this.idFactory()}`, fromAgentId, toAgentId, content: required(input, 'content', 2_000), createdAt: now });
      snapshot.messages.push(message);
      snapshot.activities.push(
        { id: `activity-${this.idFactory()}`, agentId: fromAgentId, title: '发送协作消息', detail: message.content.slice(0, 180), createdAt: now },
        { id: `activity-${this.idFactory()}`, agentId: toAgentId, title: '收到协作消息', detail: message.content.slice(0, 180), createdAt: now },
      );
      return message;
    });
  }

  private mutate<T>(operation: (snapshot: AgentSquadSnapshot, now: string) => T): T {
    const snapshot = this.load();
    const now = this.clock().toISOString();
    const result = operation(snapshot, now);
    snapshot.revision += 1;
    snapshot.updatedAt = now;
    snapshot.activities = snapshot.activities.slice(-10_000);
    snapshot.memories = snapshot.memories.slice(-5_000);
    snapshot.messages = snapshot.messages.slice(-10_000);
    this.write(snapshot);
    return result;
  }

  private assertKnownAgent(snapshot: AgentSquadSnapshot, agentId: string): void {
    if (agentId !== snapshot.lead.id && !snapshot.members.some((member) => member.id === agentId)) throw new Error('Agent 不存在于当前协作成员');
  }

  private write(snapshot: AgentSquadSnapshot): void {
    const validated = parse(snapshot, '待保存的 Agent 小队');
    const payload = `${JSON.stringify(validated, null, 2)}\n`;
    if (Buffer.byteLength(payload, 'utf8') > MAX_FILE_BYTES) throw new Error('Agent 小队数据超过大小上限');
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, payload, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, this.file);
  }

  private defaultSnapshot(): AgentSquadSnapshot {
    const now = this.clock().toISOString();
    return parse({
      version: 1, revision: 0, updatedAt: now,
      projectId: null,
      lead: { id: 'agent-aeos-hub', name: 'AEOS 中枢 Agent', role: '主 Agent · 经营编排', model: 'deepseek-chat', harborAgentId: null },
      members: [], memories: [], activities: [], messages: [],
    }, '协作成员默认快照');
  }
}

const defaultStore = new AgentSquadStore();
export const loadAgentSquad = () => defaultStore.load();
export const createAgentSquadMember = (input: Record<string, unknown>) => defaultStore.createMember(input);
export const bindAgentSquadMember = (input: Record<string, unknown>) => defaultStore.bindMember(input);
export const deleteAgentSquadMember = (input: Record<string, unknown>) => defaultStore.deleteMember(input);
export const setAgentSquadProject = (input: Record<string, unknown>) => defaultStore.setProject(input);
export const addAgentSquadMemory = (input: Record<string, unknown>) => defaultStore.addMemory(input);
export const addAgentSquadActivity = (input: Record<string, unknown>) => defaultStore.addActivity(input);
export const sendAgentSquadMessage = (input: Record<string, unknown>) => defaultStore.sendMessage(input);
