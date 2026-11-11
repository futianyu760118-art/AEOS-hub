import { existsSync, readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { atomicWrite } from './atomic-file.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const g0DecisionRegisterFile = join(root, 'data', 'g0-decision-register.json');
const MAX_FILE_BYTES = 1024 * 1024;
const timestamp = z.string().datetime({ offset: true });
const text = (max: number, min = 0) => z.string().trim().min(min).max(max);
const actorId = text(160, 1);

export const G0DecisionActorSchema = z.object({
  actorId,
  tenantId: text(160, 1),
}).strict();
export type G0DecisionActor = z.infer<typeof G0DecisionActorSchema>;

function decisionRecordSchema<T extends z.ZodType>(value: T) {
  return z.object({
    value,
    decidedAt: timestamp,
    actorId,
    tenantId: text(160, 1),
    note: text(2_000, 1),
  }).strict();
}

export const G0_FIRST_SCENARIOS = ['order_delivery_risk', 'material_kitting_shortage'] as const;
export type G0FirstScenario = (typeof G0_FIRST_SCENARIOS)[number];
const FirstScenarioDecisionSchema = decisionRecordSchema(z.enum(G0_FIRST_SCENARIOS));
const ActorDecisionSchema = decisionRecordSchema(z.object({ actorId }).strict());
const ScopeDecisionSchema = decisionRecordSchema(z.object({
  demoTenantId: text(160, 1),
  organizationScope: text(300, 1),
}).strict());
const ThreeAccountAuthorizationDecisionSchema = decisionRecordSchema(z.object({
  managerActorId: actorId,
  operatorActorId: actorId,
  ownerActorId: actorId,
  decision: z.literal('approved_for_g1'),
}).strict());
const M02ResponsibilityDecisionSchema = decisionRecordSchema(z.object({
  ownerActorId: actorId,
  status: z.literal('assigned'),
}).strict());
const TaskStoreDecisionSchema = decisionRecordSchema(z.literal('reuse_existing_task_center'));
const G4AdmissionDecisionSchema = decisionRecordSchema(z.literal('blocked_until_g1'));

export const G0DecisionSetSchema = z.object({
  firstScenario: FirstScenarioDecisionSchema.nullable(),
  businessOwnerActor: ActorDecisionSchema.nullable(),
  verifyActor: ActorDecisionSchema.nullable(),
  scope: ScopeDecisionSchema.nullable(),
  threeAccountAuthorization: ThreeAccountAuthorizationDecisionSchema.nullable(),
  m02Responsibility: M02ResponsibilityDecisionSchema.nullable(),
  taskStoreDecision: TaskStoreDecisionSchema.nullable(),
  g4Admission: G4AdmissionDecisionSchema.nullable(),
}).strict();
export type G0DecisionSet = z.infer<typeof G0DecisionSetSchema>;

export const G0DecisionHistoryEntrySchema = z.object({
  eventId: text(160, 1),
  revision: z.number().int().positive(),
  field: z.enum([
    'firstScenario', 'businessOwnerActor', 'verifyActor', 'scope',
    'threeAccountAuthorization', 'm02Responsibility', 'taskStoreDecision', 'g4Admission',
  ]),
  value: z.unknown(),
  decidedAt: timestamp,
  actorId,
  tenantId: text(160, 1),
  note: text(2_000, 1),
}).strict();
export type G0DecisionHistoryEntry = z.infer<typeof G0DecisionHistoryEntrySchema>;

export const G0DecisionSnapshotSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  updatedAt: timestamp,
  readyForG1: z.boolean(),
  decisions: G0DecisionSetSchema,
  history: z.array(G0DecisionHistoryEntrySchema).max(10_000),
}).strict();
export type G0DecisionSnapshot = z.infer<typeof G0DecisionSnapshotSchema>;

export const G0DecisionPatchSchema = z.object({
  firstScenario: z.enum(G0_FIRST_SCENARIOS).optional(),
  businessOwnerActorId: actorId.optional(),
  verifyActorId: actorId.optional(),
  scope: z.object({ demoTenantId: text(160, 1), organizationScope: text(300, 1) }).strict().optional(),
  threeAccountAuthorization: z.object({
    managerActorId: actorId,
    operatorActorId: actorId,
    ownerActorId: actorId,
    decision: z.literal('approved_for_g1'),
  }).strict().optional(),
  m02Responsibility: z.object({ ownerActorId: actorId, status: z.literal('assigned') }).strict().optional(),
  taskStoreDecision: z.literal('reuse_existing_task_center').optional(),
  g4Admission: z.literal('blocked_until_g1').optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, '至少需要记录一项 G0 决策');
export type G0DecisionPatch = z.infer<typeof G0DecisionPatchSchema>;

export const G0DecisionRecordInputSchema = z.object({
  actor: G0DecisionActorSchema,
  patch: G0DecisionPatchSchema,
  note: text(2_000, 1),
}).strict();
export type G0DecisionRecordInput = z.infer<typeof G0DecisionRecordInputSchema>;

function now(clock: () => Date): string { return clock().toISOString(); }

function defaultDecisionSet(): G0DecisionSet {
  return {
    firstScenario: null,
    businessOwnerActor: null,
    verifyActor: null,
    scope: null,
    threeAccountAuthorization: null,
    m02Responsibility: null,
    taskStoreDecision: null,
    g4Admission: null,
  };
}

function defaultSnapshot(clock: () => Date): G0DecisionSnapshot {
  return {
    version: 1,
    revision: 0,
    updatedAt: now(clock),
    readyForG1: false,
    decisions: defaultDecisionSet(),
    history: [],
  };
}

function isReadyForG1(decisions: G0DecisionSet): boolean {
  const owner = decisions.businessOwnerActor?.value.actorId;
  const verifier = decisions.verifyActor?.value.actorId;
  const authorization = decisions.threeAccountAuthorization?.value;
  if (!decisions.firstScenario || !owner || !verifier || !decisions.scope || !authorization
    || !decisions.m02Responsibility || !decisions.taskStoreDecision || !decisions.g4Admission) return false;
  return owner !== verifier
    && authorization.managerActorId !== authorization.operatorActorId
    && authorization.managerActorId !== authorization.ownerActorId
    && authorization.operatorActorId !== authorization.ownerActorId
    && authorization.ownerActorId === owner
    && decisions.m02Responsibility.value.ownerActorId === owner;
}

function parse(value: unknown, source: string): G0DecisionSnapshot {
  const parsed = G0DecisionSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${source} 数据无效：${parsed.error.issues.slice(0, 3).map((issue) => issue.message).join('；')}`);
  }
  const snapshot = parsed.data;
  if (snapshot.readyForG1 !== isReadyForG1(snapshot.decisions)) {
    throw new Error(`${source} 就绪状态与已登记决策不一致`);
  }
  return snapshot;
}

function safeRead(file: string): G0DecisionSnapshot | null {
  if (!existsSync(file)) return null;
  if (statSync(file).size > MAX_FILE_BYTES) throw new Error('G0 决策登记数据超过大小上限');
  return parse(JSON.parse(readFileSync(file, 'utf8')), 'G0 决策登记');
}

function assertOwnerVerifierAreDistinct(decisions: G0DecisionSet): void {
  const owner = decisions.businessOwnerActor?.value.actorId;
  const verifier = decisions.verifyActor?.value.actorId;
  if (decisions.firstScenario && owner && verifier && owner === verifier) {
    throw new Error('首个闭环场景的 Owner 与 Verify 必须为不同的 actorId');
  }
}

export class G0DecisionRegisterStore {
  private readonly file: string;
  private readonly clock: () => Date;

  constructor(file = g0DecisionRegisterFile, clock: () => Date = () => new Date()) {
    this.file = file;
    this.clock = clock;
  }

  load(): G0DecisionSnapshot {
    try {
      return structuredClone(safeRead(this.file) ?? defaultSnapshot(this.clock));
    } catch (primary) {
      try {
        const backup = safeRead(`${this.file}.bak`);
        if (!backup) throw primary;
        return structuredClone(backup);
      } catch {
        throw primary;
      }
    }
  }

  record(input: G0DecisionRecordInput): G0DecisionSnapshot {
    const parsed = G0DecisionRecordInputSchema.parse(input);
    const snapshot = this.load();
    const decidedAt = now(this.clock);
    const nextRevision = snapshot.revision + 1;
    const record = <T>(field: G0DecisionHistoryEntry['field'], value: T): void => {
      const choice = { value, decidedAt, actorId: parsed.actor.actorId, tenantId: parsed.actor.tenantId, note: parsed.note };
      switch (field) {
        case 'firstScenario': snapshot.decisions.firstScenario = FirstScenarioDecisionSchema.parse(choice); break;
        case 'businessOwnerActor': snapshot.decisions.businessOwnerActor = ActorDecisionSchema.parse(choice); break;
        case 'verifyActor': snapshot.decisions.verifyActor = ActorDecisionSchema.parse(choice); break;
        case 'scope': snapshot.decisions.scope = ScopeDecisionSchema.parse(choice); break;
        case 'threeAccountAuthorization': snapshot.decisions.threeAccountAuthorization = ThreeAccountAuthorizationDecisionSchema.parse(choice); break;
        case 'm02Responsibility': snapshot.decisions.m02Responsibility = M02ResponsibilityDecisionSchema.parse(choice); break;
        case 'taskStoreDecision': snapshot.decisions.taskStoreDecision = TaskStoreDecisionSchema.parse(choice); break;
        case 'g4Admission': snapshot.decisions.g4Admission = G4AdmissionDecisionSchema.parse(choice); break;
      }
      snapshot.history.push(G0DecisionHistoryEntrySchema.parse({
        eventId: `g0-decision-${randomUUID()}`,
        revision: nextRevision,
        field,
        value,
        decidedAt,
        actorId: parsed.actor.actorId,
        tenantId: parsed.actor.tenantId,
        note: parsed.note,
      }));
    };

    const patch = parsed.patch;
    if (patch.firstScenario) record('firstScenario', patch.firstScenario);
    if (patch.businessOwnerActorId) record('businessOwnerActor', { actorId: patch.businessOwnerActorId });
    if (patch.verifyActorId) record('verifyActor', { actorId: patch.verifyActorId });
    if (patch.scope) record('scope', patch.scope);
    if (patch.threeAccountAuthorization) record('threeAccountAuthorization', patch.threeAccountAuthorization);
    if (patch.m02Responsibility) record('m02Responsibility', patch.m02Responsibility);
    if (patch.taskStoreDecision) record('taskStoreDecision', patch.taskStoreDecision);
    if (patch.g4Admission) record('g4Admission', patch.g4Admission);

    assertOwnerVerifierAreDistinct(snapshot.decisions);
    snapshot.revision = nextRevision;
    snapshot.updatedAt = decidedAt;
    snapshot.readyForG1 = isReadyForG1(snapshot.decisions);
    G0DecisionSnapshotSchema.parse(snapshot);
    const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) {
      throw new Error('G0 决策登记数据超过大小上限，拒绝写入以保留可恢复快照');
    }
    atomicWrite(this.file, serialized);
    return structuredClone(snapshot);
  }
}
