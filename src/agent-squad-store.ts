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
  squadId: text(160, 1).nullable().default(null),
  harborAgentId: text(160, 1).nullable().default(null),
  status: z.enum(['standby', 'working']), createdAt: timestamp, updatedAt: timestamp,
}).strict();
const BusinessSquadSchema = z.object({
  id: text(160, 1), name: text(80, 1), description: text(300, 1),
  createdAt: timestamp, updatedAt: timestamp,
}).strict();
const BusinessSquadMemorySchema = z.object({
  id: text(160, 1), squadId: text(160, 1), content: text(2_000, 1), createdAt: timestamp,
}).strict();
const BusinessSquadActivitySchema = z.object({
  id: text(160, 1), squadId: text(160, 1), title: text(160, 1), detail: text(1_000, 1), createdAt: timestamp,
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
  subSquads: z.array(BusinessSquadSchema).max(30).default([]),
  squadMemories: z.array(BusinessSquadMemorySchema).max(5_000).default([]),
  squadActivities: z.array(BusinessSquadActivitySchema).max(10_000).default([]),
  members: z.array(SquadMemberSchema).max(100), memories: z.array(SquadMemorySchema).max(5_000),
  activities: z.array(SquadActivitySchema).max(10_000), messages: z.array(SquadMessageSchema).max(10_000),
}).strict().superRefine((snapshot, ctx) => {
  const ids = new Set<string>([snapshot.lead.id]);
  snapshot.members.forEach((member, index) => {
    if (ids.has(member.id)) ctx.addIssue({ code: 'custom', path: ['members', index, 'id'], message: 'Agent id 不能重复' });
    ids.add(member.id);
  });
  const subSquadIds = new Set<string>();
  snapshot.subSquads.forEach((subSquad, index) => {
    if (subSquadIds.has(subSquad.id)) ctx.addIssue({ code: 'custom', path: ['subSquads', index, 'id'], message: '业务 Agent 小队 id 不能重复' });
    subSquadIds.add(subSquad.id);
  });
  [...snapshot.squadMemories, ...snapshot.squadActivities].forEach((item) => {
    if (!subSquadIds.has(item.squadId)) ctx.addIssue({ code: 'custom', path: ['subSquads'], message: '业务小队记录引用了不存在的小队' });
  });
  snapshot.members.forEach((member, index) => {
    if (member.squadId && !subSquadIds.has(member.squadId)) {
      ctx.addIssue({ code: 'custom', path: ['members', index, 'squadId'], message: '成员归属的业务 Agent 小队不存在' });
    }
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
export type AgentBusinessSquad = z.infer<typeof BusinessSquadSchema>;
export type AgentBusinessSquadMemory = z.infer<typeof BusinessSquadMemorySchema>;
export type AgentBusinessSquadActivity = z.infer<typeof BusinessSquadActivitySchema>;
export type AgentSquadMemory = z.infer<typeof SquadMemorySchema>;
export type AgentSquadActivity = z.infer<typeof SquadActivitySchema>;
export type AgentSquadMessage = z.infer<typeof SquadMessageSchema>;

function required(input: Record<string, unknown>, key: string, max: number): string {
  const raw = input[key];
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`${key} 不能为空`);
  return raw.trim().slice(0, max);
}

function parse(value: unknown, source: string): AgentSquadSnapshot {
  const result = AgentSquadSnapshotSchema.safeParse(value);
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
    const migrated = this.migrateBusinessSquads(snapshot);
    if (migrated.changed) this.write(migrated.snapshot);
    return structuredClone(migrated.snapshot);
  }

  createMember(input: Record<string, unknown>): AgentSquadMember {
    return this.mutate((snapshot, now) => {
      const requestedSquadId = typeof input.squadId === 'string' && input.squadId.trim() ? input.squadId.trim().slice(0, 160) : snapshot.subSquads[0]?.id ?? null;
      if (requestedSquadId && !snapshot.subSquads.some((item) => item.id === requestedSquadId)) throw new Error('归属的业务 Agent 小队不存在');
      const member = SquadMemberSchema.parse({
        id: `squad-agent-${this.idFactory()}`,
        name: required(input, 'name', 80), role: required(input, 'role', 120),
        model: typeof input.model === 'string' && input.model.trim() ? input.model.trim().slice(0, 120) : 'deepseek-chat',
        squadId: requestedSquadId,
        harborAgentId: typeof input.harborAgentId === 'string' && input.harborAgentId.trim() ? input.harborAgentId.trim().slice(0, 160) : null,
        status: 'standby', createdAt: now, updatedAt: now,
      });
      if (member.harborAgentId && snapshot.members.some((item) => item.harborAgentId === member.harborAgentId)) {
        throw new Error('该 AI 港湾 Agent 已加入当前小队');
      }
      snapshot.members.push(member);
      const subSquad = member.squadId ? snapshot.subSquads.find((item) => item.id === member.squadId) : null;
      snapshot.activities.push({ id: `activity-${this.idFactory()}`, agentId: member.id, title: '已加入 Agent 小队', detail: `${subSquad ? `已归入${subSquad.name}；` : ''}${member.harborAgentId ? '已绑定 AI 港湾 Agent，并建立独立记忆空间。' : '已建立独立记忆空间，等待主 Agent 指派协作任务。'}`, createdAt: now });
      if (subSquad) snapshot.squadActivities.push({ id: `squad-activity-${this.idFactory()}`, squadId: subSquad.id, title: '已纳入下辖 Agent', detail: `${member.name} 已归入本业务 Agent 小队。`, createdAt: now });
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
        throw new Error('该 AI 港湾 Agent 已加入当前小队');
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

  addBusinessSquadMemory(input: Record<string, unknown>): AgentBusinessSquadMemory {
    return this.mutate((snapshot, now) => {
      const squadId = required(input, 'squadId', 160);
      this.assertKnownBusinessSquad(snapshot, squadId);
      const memory = BusinessSquadMemorySchema.parse({ id: `squad-memory-${this.idFactory()}`, squadId, content: required(input, 'content', 2_000), createdAt: now });
      snapshot.squadMemories.push(memory);
      snapshot.squadActivities.push({ id: `squad-activity-${this.idFactory()}`, squadId, title: '写入小队记忆', detail: memory.content.slice(0, 180), createdAt: now });
      return memory;
    });
  }

  addBusinessSquadActivity(input: Record<string, unknown>): AgentBusinessSquadActivity {
    return this.mutate((snapshot, now) => {
      const squadId = required(input, 'squadId', 160);
      this.assertKnownBusinessSquad(snapshot, squadId);
      const activity = BusinessSquadActivitySchema.parse({
        id: `squad-activity-${this.idFactory()}`, squadId,
        title: required(input, 'title', 160), detail: required(input, 'detail', 1_000), createdAt: now,
      });
      snapshot.squadActivities.push(activity);
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
    if (agentId !== snapshot.lead.id && !snapshot.members.some((member) => member.id === agentId)) throw new Error('Agent 不存在于当前小队');
  }

  private assertKnownBusinessSquad(snapshot: AgentSquadSnapshot, squadId: string): void {
    if (!snapshot.subSquads.some((item) => item.id === squadId)) throw new Error('业务 Agent 小队不存在');
  }

  private migrateBusinessSquads(snapshot: AgentSquadSnapshot): { snapshot: AgentSquadSnapshot; changed: boolean } {
    const orderSquadId = 'business-squad-orders';
    const kittingSquadId = 'business-squad-material-kitting';
    const qualitySquadId = 'business-squad-quality';
    const productionSquadId = 'business-squad-production';
    const hasOrderSquad = snapshot.subSquads.some((item) => item.id === orderSquadId);
    const hasKittingSquad = snapshot.subSquads.some((item) => item.id === kittingSquadId);
    const hasQualitySquad = snapshot.subSquads.some((item) => item.id === qualitySquadId);
    const hasProductionSquad = snapshot.subSquads.some((item) => item.id === productionSquadId);
    const shouldAssignLegacyMembers = !hasOrderSquad && snapshot.members.some((member) => member.squadId === null);
    if (hasOrderSquad && hasKittingSquad && hasQualitySquad && hasProductionSquad && !shouldAssignLegacyMembers) return { snapshot, changed: false };
    const migrated = structuredClone(snapshot);
    const now = migrated.updatedAt;
    if (!hasOrderSquad) {
      migrated.subSquads.push({
        id: orderSquadId,
        name: '订单 Agent 小队',
        description: '负责订单交付风险、供应保障与证据核查的业务 Agent 协作单元。',
        createdAt: now,
        updatedAt: now,
      });
      migrated.squadMemories.push({
        id: `squad-memory-${this.idFactory()}`, squadId: orderSquadId,
        content: '订单 Agent 小队已建立；仅沉淀订单领域的协作上下文、共识与升级结论。', createdAt: now,
      });
      migrated.squadActivities.push({
        id: `squad-activity-${this.idFactory()}`, squadId: orderSquadId,
        title: '已建立订单 Agent 小队', detail: '中枢 Agent 已建立订单领域的业务协作单元。', createdAt: now,
      });
    }
    if (shouldAssignLegacyMembers) {
      migrated.members = migrated.members.map((member) => member.squadId === null ? { ...member, squadId: orderSquadId, updatedAt: now } : member);
      migrated.activities.push({
        id: `activity-${this.idFactory()}`,
        agentId: migrated.lead.id,
        title: '已建立订单 Agent 小队',
        detail: '已将原有子 Agent 迁移至订单 Agent 小队；中枢 Agent 保持顶层协调。',
        createdAt: now,
      });
    }
    if (!hasKittingSquad) {
      const kittingMembers = [
        ['squad-agent-kitting-analysis', '齐套研判 Agent', '物料齐套状态与受影响需求研判'],
        ['squad-agent-shortage-resolution', '缺料处置 Agent', '缺料明细、可用库存与处置路径核查'],
        ['squad-agent-supply-availability', '供给核查 Agent', '在途供给、供应商交期与预计齐套日期核查'],
        ['squad-agent-kitting-evidence', '齐套证据 Agent', 'Evidence 完整性、数据时效与置信度审阅'],
      ].map(([id, name, role]) => ({
        id, name, role, model: 'deepseek-chat', squadId: kittingSquadId, harborAgentId: null,
        status: 'standby' as const, createdAt: now, updatedAt: now,
      }));
      migrated.subSquads.push({
        id: kittingSquadId,
        name: '物料齐套 Agent 小队',
        description: '负责物料齐套研判、缺料处置、供给核查与证据审阅的业务 Agent 协作单元。',
        createdAt: now,
        updatedAt: now,
      });
      migrated.squadMemories.push({
        id: `squad-memory-${this.idFactory()}`,
        squadId: kittingSquadId,
        content: '物料齐套 Agent 小队已建立；仅沉淀齐套、缺料、库存供给与升级结论的协作上下文。',
        createdAt: now,
      });
      migrated.squadActivities.push({
        id: `squad-activity-${this.idFactory()}`,
        squadId: kittingSquadId,
        title: '已建立物料齐套 Agent 小队',
        detail: '中枢 Agent 已建立物料齐套领域的业务协作单元，并配置 4 个独立 Agent。',
        createdAt: now,
      });
      migrated.members.push(...kittingMembers);
      migrated.memories.push(...kittingMembers.map((member) => ({
        id: `memory-${member.id}`,
        agentId: member.id,
        content: '独立记忆空间已建立；仅保存该子 Agent 的物料齐套任务上下文与协作沉淀。',
        createdAt: now,
      })));
      migrated.activities.push(...kittingMembers.map((member) => ({
        id: `activity-${member.id}`,
        agentId: member.id,
        title: '等待主 Agent 指派',
        detail: '尚未接入独立 Runtime；仅在物料齐套业务边界内提供只读分析建议。',
        createdAt: now,
      })));
    }
    if (!hasQualitySquad) {
      const qualityMembers = [
        ['squad-agent-quality-analysis', '质量异常研判 Agent', '质量异常状态、影响对象与处置优先级研判'],
        ['squad-agent-quality-trace', '质量追溯 Agent', '质量异常、订单行与 BOM 关联追溯'],
        ['squad-agent-quality-coordination', '质量协同 Agent', '责任部门、处置路径与人工确认事项核查'],
        ['squad-agent-quality-evidence', '质量证据 Agent', '质量 Evidence 完整性、数据时效与置信度审阅'],
      ].map(([id, name, role]) => ({
        id, name, role, model: 'deepseek-chat', squadId: qualitySquadId, harborAgentId: null,
        status: 'standby' as const, createdAt: now, updatedAt: now,
      }));
      migrated.subSquads.push({
        id: qualitySquadId,
        name: '异常与质量 Agent 小队',
        description: '负责质量异常研判、跨对象追溯、责任协同与证据审阅的业务 Agent 协作单元。',
        createdAt: now,
        updatedAt: now,
      });
      migrated.squadMemories.push({
        id: `squad-memory-${this.idFactory()}`,
        squadId: qualitySquadId,
        content: '异常与质量 Agent 小队已建立；仅沉淀质量异常、追溯、责任协同与升级结论的协作上下文。',
        createdAt: now,
      });
      migrated.squadActivities.push({
        id: `squad-activity-${this.idFactory()}`,
        squadId: qualitySquadId,
        title: '已建立异常与质量 Agent 小队',
        detail: '中枢 Agent 已建立异常与质量领域的业务协作单元，并配置 4 个独立 Agent。',
        createdAt: now,
      });
      migrated.members.push(...qualityMembers);
      migrated.memories.push(...qualityMembers.map((member) => ({
        id: `memory-${member.id}`,
        agentId: member.id,
        content: '独立记忆空间已建立；仅保存该子 Agent 的异常与质量任务上下文与协作沉淀。',
        createdAt: now,
      })));
      migrated.activities.push(...qualityMembers.map((member) => ({
        id: `activity-${member.id}`,
        agentId: member.id,
        title: '等待主 Agent 指派',
        detail: '尚未接入独立 Runtime；仅在异常与质量业务边界内提供只读分析建议。',
        createdAt: now,
      })));
    }
    if (!hasProductionSquad) {
      const productionMembers = [
        ['squad-agent-production-progress', '生产进度 Agent', '生产工单与工序进度只读研判'],
        ['squad-agent-production-linkage', '生产关联 Agent', '工单、订单与工序关联核查'],
        ['squad-agent-production-reporting', '报工产能 Agent', '生产报工与产能状态核查'],
        ['squad-agent-production-evidence', '生产证据 Agent', '生产 Evidence、时效与置信度审阅'],
      ].map(([id, name, role]) => ({
        id, name, role, model: 'deepseek-chat', squadId: productionSquadId, harborAgentId: null,
        status: 'standby' as const, createdAt: now, updatedAt: now,
      }));
      migrated.subSquads.push({
        id: productionSquadId,
        name: '生产协同 Agent 小队',
        description: '负责生产工单、工序进度、订单关联、报工产能与证据审阅的业务 Agent 协作单元。',
        createdAt: now,
        updatedAt: now,
      });
      migrated.squadMemories.push({
        id: `squad-memory-${this.idFactory()}`,
        squadId: productionSquadId,
        content: '生产协同 Agent 小队已建立；仅沉淀工单、工序、订单关联、报工产能与升级结论的协作上下文。',
        createdAt: now,
      });
      migrated.squadActivities.push({
        id: `squad-activity-${this.idFactory()}`,
        squadId: productionSquadId,
        title: '已建立生产协同 Agent 小队',
        detail: '中枢 Agent 已建立生产协同领域的业务协作单元，并配置 4 个独立 Agent。',
        createdAt: now,
      });
      migrated.members.push(...productionMembers);
      migrated.memories.push(...productionMembers.map((member) => ({
        id: `memory-${member.id}`,
        agentId: member.id,
        content: '独立记忆空间已建立；仅保存该子 Agent 的生产协同任务上下文与协作沉淀。',
        createdAt: now,
      })));
      migrated.activities.push(...productionMembers.map((member) => ({
        id: `activity-${member.id}`,
        agentId: member.id,
        title: '等待主 Agent 指派',
        detail: '尚未接入独立 Runtime；仅在生产协同业务边界内提供只读分析建议。',
        createdAt: now,
      })));
    }
    migrated.revision += 1;
    return { snapshot: parse(migrated, '业务 Agent 小队迁移'), changed: true };
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
    const subSquads = [
      {
        id: 'business-squad-orders', name: '订单 Agent 小队',
        description: '负责订单交付风险、供应保障与证据核查的业务 Agent 协作单元。',
        createdAt: now, updatedAt: now,
      },
      {
        id: 'business-squad-material-kitting', name: '物料齐套 Agent 小队',
        description: '负责物料齐套研判、缺料处置、供给核查与证据审阅的业务 Agent 协作单元。',
        createdAt: now, updatedAt: now,
      },
      {
        id: 'business-squad-quality', name: '异常与质量 Agent 小队',
        description: '负责质量异常研判、跨对象追溯、责任协同与证据审阅的业务 Agent 协作单元。',
        createdAt: now, updatedAt: now,
      },
      {
        id: 'business-squad-production', name: '生产协同 Agent 小队',
        description: '负责生产工单、工序进度、订单关联、报工产能与证据审阅的业务 Agent 协作单元。',
        createdAt: now, updatedAt: now,
      },
    ];
    const members = [
      ['squad-agent-risk', '经营风险研判 Agent', '订单与经营风险扫描'],
      ['squad-agent-supply', '供应协同 Agent', '物料与供应缺口核查'],
      ['squad-agent-evidence', '证据治理 Agent', 'Evidence 完整性与数据置信度审阅'],
    ].map(([id, name, role]) => ({ id, name, role, model: 'deepseek-chat', squadId: 'business-squad-orders', harborAgentId: null, status: 'standby' as const, createdAt: now, updatedAt: now }));
    const kittingMembers = [
      ['squad-agent-kitting-analysis', '齐套研判 Agent', '物料齐套状态与受影响需求研判'],
      ['squad-agent-shortage-resolution', '缺料处置 Agent', '缺料明细、可用库存与处置路径核查'],
      ['squad-agent-supply-availability', '供给核查 Agent', '在途供给、供应商交期与预计齐套日期核查'],
      ['squad-agent-kitting-evidence', '齐套证据 Agent', 'Evidence 完整性、数据时效与置信度审阅'],
    ].map(([id, name, role]) => ({ id, name, role, model: 'deepseek-chat', squadId: 'business-squad-material-kitting', harborAgentId: null, status: 'standby' as const, createdAt: now, updatedAt: now }));
    const qualityMembers = [
      ['squad-agent-quality-analysis', '质量异常研判 Agent', '质量异常状态、影响对象与处置优先级研判'],
      ['squad-agent-quality-trace', '质量追溯 Agent', '质量异常、订单行与 BOM 关联追溯'],
      ['squad-agent-quality-coordination', '质量协同 Agent', '责任部门、处置路径与人工确认事项核查'],
      ['squad-agent-quality-evidence', '质量证据 Agent', '质量 Evidence 完整性、数据时效与置信度审阅'],
    ].map(([id, name, role]) => ({ id, name, role, model: 'deepseek-chat', squadId: 'business-squad-quality', harborAgentId: null, status: 'standby' as const, createdAt: now, updatedAt: now }));
    const productionMembers = [
      ['squad-agent-production-progress', '生产进度 Agent', '生产工单与工序进度只读研判'],
      ['squad-agent-production-linkage', '生产关联 Agent', '工单、订单与工序关联核查'],
      ['squad-agent-production-reporting', '报工产能 Agent', '生产报工与产能状态核查'],
      ['squad-agent-production-evidence', '生产证据 Agent', '生产 Evidence、时效与置信度审阅'],
    ].map(([id, name, role]) => ({ id, name, role, model: 'deepseek-chat', squadId: 'business-squad-production', harborAgentId: null, status: 'standby' as const, createdAt: now, updatedAt: now }));
    members.push(...kittingMembers, ...qualityMembers, ...productionMembers);
    return parse({
      version: 1, revision: 0, updatedAt: now,
      projectId: null,
      lead: { id: 'agent-aeos-hub', name: 'AEOS 中枢 Agent', role: '主 Agent · 经营编排', model: 'deepseek-chat', harborAgentId: null },
      subSquads,
      squadMemories: [
        { id: 'squad-memory-orders', squadId: 'business-squad-orders', content: '订单 Agent 小队已建立；仅沉淀订单领域的协作上下文、共识与升级结论。', createdAt: now },
        { id: 'squad-memory-material-kitting', squadId: 'business-squad-material-kitting', content: '物料齐套 Agent 小队已建立；仅沉淀齐套、缺料、库存供给与升级结论的协作上下文。', createdAt: now },
        { id: 'squad-memory-quality', squadId: 'business-squad-quality', content: '异常与质量 Agent 小队已建立；仅沉淀质量异常、追溯、责任协同与升级结论的协作上下文。', createdAt: now },
        { id: 'squad-memory-production', squadId: 'business-squad-production', content: '生产协同 Agent 小队已建立；仅沉淀工单、工序、订单关联、报工产能与升级结论的协作上下文。', createdAt: now },
      ],
      squadActivities: [
        { id: 'squad-activity-orders', squadId: 'business-squad-orders', title: '已建立订单 Agent 小队', detail: '中枢 Agent 已建立订单领域的业务协作单元。', createdAt: now },
        { id: 'squad-activity-material-kitting', squadId: 'business-squad-material-kitting', title: '已建立物料齐套 Agent 小队', detail: '中枢 Agent 已建立物料齐套领域的业务协作单元，并配置 4 个独立 Agent。', createdAt: now },
        { id: 'squad-activity-quality', squadId: 'business-squad-quality', title: '已建立异常与质量 Agent 小队', detail: '中枢 Agent 已建立异常与质量领域的业务协作单元，并配置 4 个独立 Agent。', createdAt: now },
        { id: 'squad-activity-production', squadId: 'business-squad-production', title: '已建立生产协同 Agent 小队', detail: '中枢 Agent 已建立生产协同领域的业务协作单元，并配置 4 个独立 Agent。', createdAt: now },
      ],
      members, memories: members.map((member) => ({ id: `memory-${member.id}`, agentId: member.id, content: '独立记忆空间已建立；仅保存该子 Agent 的任务上下文与协作沉淀。', createdAt: now })),
      activities: members.map((member) => ({ id: `activity-${member.id}`, agentId: member.id, title: '等待主 Agent 指派', detail: '尚未接入独立 Runtime；可记录记忆并接收队内协作消息。', createdAt: now })), messages: [],
    }, 'Agent 小队默认快照');
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
export const addAgentBusinessSquadMemory = (input: Record<string, unknown>) => defaultStore.addBusinessSquadMemory(input);
export const addAgentBusinessSquadActivity = (input: Record<string, unknown>) => defaultStore.addBusinessSquadActivity(input);
export const sendAgentSquadMessage = (input: Record<string, unknown>) => defaultStore.sendMessage(input);
