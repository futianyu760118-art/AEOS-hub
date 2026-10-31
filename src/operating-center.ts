import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { atomicWrite } from './atomic-file.ts';
import type { DashboardRisk } from './dashboard.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const operatingCenterFile = join(root, 'data', 'operating-center.json');
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const timestamp = z.string().datetime({ offset: true });
const text = (max: number, min = 0) => z.string().trim().min(min).max(max);

const sourceSchema = z.enum(['order', 'kitting', 'quality', 'production']);
const statusSchema = z.enum(['open', 'in_review', 'awaiting_approval', 'closed']);
const inboxStateSchema = z.enum(['unread', 'read', 'archived']);

export const OperatingCaseSchema = z.object({
  id: text(100, 1), key: text(220, 1), source: sourceSchema, entityId: text(180, 1), title: text(300, 1),
  riskLevel: text(80), summary: text(1_500), evidenceRefs: z.array(text(500, 1)).min(1).max(20),
  status: statusSchema, ownerRole: text(120, 1), dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requiresHumanApproval: z.literal(true), createdBy: z.enum(['dashboard', 'autopilot', 'manual']),
  createdAt: timestamp, updatedAt: timestamp, closedAt: timestamp.nullable(),
}).strict();
export type OperatingCase = z.infer<typeof OperatingCaseSchema>;

export const DecisionSchema = z.object({
  id: text(100, 1), caseId: text(100, 1), action: z.enum(['acknowledge', 'request_evidence', 'approve_analysis', 'close']),
  note: text(2_000, 1), actor: text(120, 1), createdAt: timestamp,
}).strict();
export type OperatingDecision = z.infer<typeof DecisionSchema>;

export const InboxItemSchema = z.object({
  id: text(100, 1), kind: z.enum(['new_case', 'decision_required', 'autopilot_result']), caseId: text(100, 1).nullable(),
  title: text(300, 1), detail: text(1_500), state: inboxStateSchema, createdAt: timestamp, updatedAt: timestamp,
}).strict();
export type InboxItem = z.infer<typeof InboxItemSchema>;

const SnapshotSchema = z.object({
  version: z.literal(2), revision: z.number().int().nonnegative(), updatedAt: timestamp,
  cases: z.array(OperatingCaseSchema).max(5_000), decisions: z.array(DecisionSchema).max(20_000),
  // Retain legacy autopilot_result Inbox items for data compatibility, but no
  // new item of that kind is created and the UI no longer renders them.
  inbox: z.array(InboxItemSchema).max(20_000),
}).strict();
export type OperatingCenterSnapshot = z.infer<typeof SnapshotSchema>;

function now(clock: () => Date): string { return clock().toISOString(); }
function dateKey(clock: () => Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(clock());
}
function defaultSnapshot(clock: () => Date): OperatingCenterSnapshot {
  const createdAt = now(clock);
  return {
    version: 2, revision: 0, updatedAt: createdAt, cases: [], decisions: [], inbox: [],
  };
}
function parse(value: unknown, source: string): OperatingCenterSnapshot {
  // Version 1 carried the removed scheduler configuration and run history.
  // Keep the business records, but do not revive the scheduler from a legacy
  // snapshot. The converted version is persisted on the next normal mutation.
  const candidate = value && typeof value === 'object' && !Array.isArray(value) && (value as { version?: unknown }).version === 1
    ? (() => { const { autopilot: _autopilot, runs: _runs, ...rest } = value as Record<string, unknown>; return { ...rest, version: 2 }; })()
    : value;
  const parsed = SnapshotSchema.safeParse(candidate);
  if (!parsed.success) throw new Error(`${source} 数据无效：${parsed.error.issues.slice(0, 3).map((issue) => issue.message).join('；')}`);
  return parsed.data;
}
function safeRead(file: string): OperatingCenterSnapshot | null {
  if (!existsSync(file)) return null;
  if (statSync(file).size > MAX_FILE_BYTES) throw new Error('经营事项中心数据超过大小上限');
  return parse(JSON.parse(readFileSync(file, 'utf8')), '经营事项中心');
}

function riskEntityId(risk: DashboardRisk): string {
  if (risk.source === 'quality') return risk.issueNo || risk.orderNo;
  return risk.source === 'kitting' && risk.demandLineNo ? `${risk.orderNo}:${risk.demandLineNo}` : risk.orderNo;
}
function ownerFor(source: OperatingCase['source']): string {
  return source === 'quality' ? '质量负责人（待确认）' : source === 'kitting' ? '供应链负责人（待确认）' : source === 'production' ? '生产负责人（待确认）' : '订单交付负责人（待确认）';
}
function dueDateFor(risk: DashboardRisk, clock: () => Date): string {
  const raw = risk.source === 'quality' ? risk.occurredAt : risk.dueDate;
  return /^\d{4}-\d{2}-\d{2}/.test(raw || '') ? String(raw).slice(0, 10) : dateKey(clock);
}
function riskKey(risk: DashboardRisk): string {
  return createHash('sha256').update(`${risk.source}\u0000${riskEntityId(risk)}\u0000${risk.evidenceRef}`).digest('hex').slice(0, 40);
}

export class OperatingCenterStore {
  private readonly file: string;
  private readonly clock: () => Date;

  constructor(file = operatingCenterFile, clock: () => Date = () => new Date()) {
    this.file = file;
    this.clock = clock;
  }

  load(): OperatingCenterSnapshot {
    try {
      return structuredClone(safeRead(this.file) ?? defaultSnapshot(this.clock));
    } catch (primary) {
      try {
        const backup = safeRead(`${this.file}.bak`);
        if (!backup) throw primary;
        return structuredClone(backup);
      } catch { throw primary; }
    }
  }

  private mutate<T>(operation: (snapshot: OperatingCenterSnapshot, timestamp: string) => T): T {
    const snapshot = this.load();
    const timestamp = now(this.clock);
    const result = operation(snapshot, timestamp);
    snapshot.revision += 1;
    snapshot.updatedAt = timestamp;
    snapshot.inbox = snapshot.inbox.slice(-20_000);
    snapshot.decisions = snapshot.decisions.slice(-20_000);
    atomicWrite(this.file, `${JSON.stringify(snapshot, null, 2)}\n`);
    return structuredClone(result);
  }

  upsertDashboardRisks(risks: DashboardRisk[], createdBy: 'dashboard' | 'autopilot', maxCases = 20): { created: OperatingCase[]; existing: number } {
    return this.mutate((snapshot, timestamp) => {
      const created: OperatingCase[] = [];
      let existing = 0;
      for (const risk of risks) {
        if (created.length >= maxCases || !risk.evidenceRef || !riskEntityId(risk)) continue;
        const key = riskKey(risk);
        const previous = snapshot.cases.find((item) => item.key === key && item.status !== 'closed');
        if (previous) { existing += 1; continue; }
        const item = OperatingCaseSchema.parse({
          id: `case-${randomUUID()}`, key, source: risk.source, entityId: riskEntityId(risk), title: risk.summary || '待人工确认的经营风险',
          riskLevel: risk.riskLevel || '待确认', summary: risk.prompt || risk.summary, evidenceRefs: [risk.evidenceRef],
          status: 'open', ownerRole: ownerFor(risk.source), dueAt: dueDateFor(risk, this.clock), requiresHumanApproval: true,
          createdBy, createdAt: timestamp, updatedAt: timestamp, closedAt: null,
        });
        snapshot.cases.push(item);
        snapshot.inbox.push(InboxItemSchema.parse({
          id: `inbox-${randomUUID()}`, kind: 'decision_required', caseId: item.id,
          title: `需人工确认：${item.title}`, detail: `${item.source === 'quality' ? '异常与质量' : item.source === 'kitting' ? '物料齐套' : item.source === 'production' ? '生产协同' : '订单交付'}事项已建档；任何业务处置仅能在人工确认后执行。`,
          state: 'unread', createdAt: timestamp, updatedAt: timestamp,
        }));
        created.push(item);
      }
      return { created, existing };
    });
  }

  updateCase(input: Record<string, unknown>): OperatingCase {
    return this.mutate((snapshot, timestamp) => {
      const id = typeof input.id === 'string' ? input.id.trim() : '';
      const item = snapshot.cases.find((candidate) => candidate.id === id);
      if (!item) throw new Error('经营事项不存在');
      if (typeof input.ownerRole === 'string' && input.ownerRole.trim()) item.ownerRole = input.ownerRole.trim().slice(0, 120);
      if (typeof input.dueAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dueAt)) item.dueAt = input.dueAt;
      if (typeof input.status === 'string' && ['open', 'in_review', 'awaiting_approval', 'closed'].includes(input.status)) {
        item.status = input.status as OperatingCase['status']; item.closedAt = item.status === 'closed' ? timestamp : null;
      }
      item.updatedAt = timestamp;
      return item;
    });
  }

  addDecision(input: Record<string, unknown>): OperatingDecision {
    return this.mutate((snapshot, timestamp) => {
      const caseId = typeof input.caseId === 'string' ? input.caseId.trim() : '';
      const action = input.action;
      const note = typeof input.note === 'string' ? input.note.trim() : '';
      const actor = typeof input.actor === 'string' && input.actor.trim() ? input.actor.trim().slice(0, 120) : '经营负责人';
      const item = snapshot.cases.find((candidate) => candidate.id === caseId);
      if (!item) throw new Error('经营事项不存在');
      const decision = DecisionSchema.parse({ id: `decision-${randomUUID()}`, caseId, action, note, actor, createdAt: timestamp });
      snapshot.decisions.push(decision);
      if (decision.action === 'approve_analysis') item.status = 'in_review';
      if (decision.action === 'request_evidence') item.status = 'awaiting_approval';
      if (decision.action === 'close') { item.status = 'closed'; item.closedAt = timestamp; }
      item.updatedAt = timestamp;
      snapshot.inbox.push(InboxItemSchema.parse({
        id: `inbox-${randomUUID()}`, kind: 'new_case', caseId,
        title: `决策已留痕：${item.title}`, detail: `${actor} 已记录“${decision.action}”。该记录只表示人工决策，不会自动执行任何业务操作。`,
        state: 'unread', createdAt: timestamp, updatedAt: timestamp,
      }));
      return decision;
    });
  }

  updateInbox(input: Record<string, unknown>): InboxItem {
    return this.mutate((snapshot, timestamp) => {
      const id = typeof input.id === 'string' ? input.id.trim() : '';
      const state = input.state;
      const item = snapshot.inbox.find((candidate) => candidate.id === id);
      if (!item) throw new Error('Inbox 事项不存在');
      if (!['unread', 'read', 'archived'].includes(String(state))) throw new Error('Inbox 状态无效');
      item.state = state as InboxItem['state']; item.updatedAt = timestamp;
      return item;
    });
  }

}

export const operatingCenter = new OperatingCenterStore();
