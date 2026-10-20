import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  HarborSnapshotSchema,
  HarborStore,
  HarborStoreConflictError,
  HarborStoreCorruptError,
  isAgentTaskServiceProfileConfigured,
} from '../src/harbor-store.ts';

const FIXED_NOW = '2026-09-03T08:30:00.000Z';

function fixture(t: TestContext): { dir: string; file: string; store: HarborStore } {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-harbor-store-'));
  const file = join(dir, 'data', 'ai-harbor.json');
  let id = 0;
  const store = new HarborStore({
    file,
    workspaceRoot: dir,
    clock: () => new Date(FIXED_NOW),
    idFactory: () => `test-${++id}`,
    lockTimeoutMs: 50,
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file, store };
}

test('initializes a missing store with a validated, deterministic snapshot', (t) => {
  const { dir, file, store } = fixture(t);

  const snapshot = store.load();

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.revision, 0);
  assert.equal(snapshot.runtimes[0]?.workdir, dir);
  assert.equal(snapshot.agents[0]?.createdAt, FIXED_NOW);
  assert.ok(existsSync(file));
  assert.doesNotThrow(() => HarborSnapshotSchema.parse(JSON.parse(readFileSync(file, 'utf8'))));
});

test('loads a legacy version 1 snapshot without revision as revision zero', (t) => {
  const { file, store } = fixture(t);
  store.load();
  const legacy = JSON.parse(readFileSync(file, 'utf8'));
  delete legacy.revision;
  writeFileSync(file, JSON.stringify(legacy), 'utf8');

  assert.equal(store.load().revision, 0);
});

test('normalizes a legacy Agent into a governed registration without rewriting on read', (t) => {
  const { file, store } = fixture(t);
  store.load();
  const legacy = JSON.parse(readFileSync(file, 'utf8'));
  delete legacy.agents[0].parentAgentId;
  delete legacy.agents[0].hierarchyLevel;
  delete legacy.agents[0].registration;
  writeFileSync(file, JSON.stringify(legacy), 'utf8');

  const snapshot = store.load();

  assert.deepEqual(snapshot.agents[0]?.registration, {
    code: 'aeos-hub',
    type: 'hub',
    ownerOrg: 'AEOS Platform',
    domain: 'enterprise-operation',
    lifecycle: 'active',
    allowedRuntimeCapabilities: [],
    taskServiceProfile: {
      profileVersion: '0.0.0',
      businessOwner: 'unassigned',
      technicalOwner: 'unassigned',
      supportedTaskTypes: [],
      tenantIds: [],
      inputSchemaVersion: '0.0.0',
      outputSchemaVersion: '0.0.0',
      accessMode: 'read_only',
      dataFreshnessMinutes: 0,
    },
  });
  assert.equal(snapshot.agents[0]?.hierarchyLevel, 'L0');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).agents[0].registration, undefined);
});

test('governs Agent task service profiles while keeping unconfigured records non-routable', (t) => {
  const { store } = fixture(t);
  const root = store.load().agents[0]!;

  const agent = store.createAgent({
    name: '订单风险 Agent', role: '订单风险分析', provider: 'openai', runtimeId: root.runtimeId,
    parentAgentId: root.id, hierarchyLevel: 'L1',
    code: 'order-risk-master', type: 'master', ownerOrg: '运营中心', domain: 'order-risk',
    lifecycle: 'testing', allowedRuntimeCapabilities: ['mcp'],
    taskServiceProfile: {
      profileVersion: '1.0.0',
      businessOwner: '订单运营负责人',
      technicalOwner: '平台技术负责人',
      supportedTaskTypes: ['operating-case-analysis'],
      tenantIds: ['default'],
      inputSchemaVersion: '1.0.0',
      outputSchemaVersion: '1.0.0',
      accessMode: 'read_only',
      dataFreshnessMinutes: 30,
    },
  });

  assert.equal(agent.registration.lifecycle, 'testing');
  assert.deepEqual(agent.registration.taskServiceProfile, {
    profileVersion: '1.0.0',
    businessOwner: '订单运营负责人',
    technicalOwner: '平台技术负责人',
    supportedTaskTypes: ['operating-case-analysis'],
    tenantIds: ['default'],
    inputSchemaVersion: '1.0.0',
    outputSchemaVersion: '1.0.0',
    accessMode: 'read_only',
    dataFreshnessMinutes: 30,
  });

  const unconfigured = store.createAgent({
    name: '待配置 Agent', role: '待配置', provider: 'openai', runtimeId: root.runtimeId,
    parentAgentId: root.id, hierarchyLevel: 'L1',
    code: 'unconfigured-master', type: 'master', ownerOrg: '运营中心', domain: 'order-risk',
  });
  assert.deepEqual(unconfigured.registration.taskServiceProfile.supportedTaskTypes, []);
  assert.deepEqual(unconfigured.registration.taskServiceProfile.tenantIds, []);
  assert.equal(isAgentTaskServiceProfileConfigured(agent.registration.taskServiceProfile), true);
  assert.equal(isAgentTaskServiceProfileConfigured(unconfigured.registration.taskServiceProfile), false);

  assert.throws(() => store.createAgent({
    name: '越权读写 Agent', role: '测试', provider: 'openai', runtimeId: root.runtimeId,
    parentAgentId: root.id, hierarchyLevel: 'L1',
    code: 'write-capable-master', type: 'master', ownerOrg: '运营中心', domain: 'order-risk',
    taskServiceProfile: {
      profileVersion: '1.0.0', businessOwner: '业务 Owner', technicalOwner: '技术 Owner',
      supportedTaskTypes: ['operating-case-analysis'], tenantIds: ['default'],
      inputSchemaVersion: '1.0.0', outputSchemaVersion: '1.0.0',
      accessMode: 'read_write', dataFreshnessMinutes: 30,
    },
  }), /read_only/);
  assert.throws(() => store.createAgent({
    name: '重复任务类型 Agent', role: '测试', provider: 'openai', runtimeId: root.runtimeId,
    parentAgentId: root.id, hierarchyLevel: 'L1',
    code: 'duplicate-task-type-master', type: 'master', ownerOrg: '运营中心', domain: 'order-risk',
    taskServiceProfile: {
      profileVersion: '1.0.0', businessOwner: '业务 Owner', technicalOwner: '技术 Owner',
      supportedTaskTypes: ['operating-case-analysis', 'operating-case-analysis'], tenantIds: ['default'],
      inputSchemaVersion: '1.0.0', outputSchemaVersion: '1.0.0',
      accessMode: 'read_only', dataFreshnessMinutes: 30,
    },
  }), /任务类型不能重复/);
});

test('records attribution axes and normalizes service domains', (t) => {
  const { store } = fixture(t);
  const root = store.load().agents[0]!;

  const agent = store.createAgent({
    name: '订单风险 Agent', role: '订单风险分析', provider: 'openai', runtimeId: root.runtimeId,
    parentAgentId: root.id, code: 'order-risk-master', type: 'master', ownerOrg: '运营中心', domain: 'order-risk',
    systemId: 'control-platform', primaryDomainId: 'order', domainIds: ['kitting', 'order', 'unknown'],
  });

  assert.equal(agent.systemId, 'control-platform');
  assert.equal(agent.primaryDomainId, 'order');
  assert.deepEqual(agent.domainIds, ['order', 'kitting']);
  assert.equal(agent.externalAgentId, null);

  const defaulted = store.createAgent({
    name: '默认归属 Agent', role: '测试', provider: 'openai', runtimeId: root.runtimeId,
    parentAgentId: root.id, code: 'default-attribution-master', type: 'master', ownerOrg: '运营中心', domain: 'unclassified',
  });
  assert.equal(defaulted.systemId, 'aeos-hub');
  assert.equal(defaulted.primaryDomainId, 'cross-domain');
  assert.deepEqual(defaulted.domainIds, ['cross-domain']);

  assert.throws(() => store.createAgent({
    name: '非法归属 Agent', role: '测试', provider: 'openai', runtimeId: root.runtimeId,
    parentAgentId: root.id, code: 'invalid-domain-master', type: 'master', ownerOrg: '运营中心', domain: 'unclassified',
    primaryDomainId: 'unknown-domain',
  }), /primaryDomainId/);
});

test('creates related runtime, agent, project, and run in locked revisions', (t) => {
  const { store } = fixture(t);
  store.load();

  const runtime = store.createRuntime({
    name: 'Remote Responses',
    kind: 'openai-responses',
    owner: '   ',
    capabilities: ['chat', 'CHAT', ' tools '],
  });
  const agent = store.createAgent({
    name: '采购协同 Agent',
    role: '采购协同',
    provider: 'openai',
    model: '   ',
    runtimeId: runtime.id,
    parentAgentId: 'agent-aeos-hub',
    hierarchyLevel: 'L1',
    code: 'procurement-master',
    type: 'master',
    ownerOrg: '供应链中心',
    domain: 'procurement',
    lifecycle: 'draft',
    allowedRuntimeCapabilities: ['chat', 'tools'],
    skills: ['询价', '询价', '供应风险'],
    access: 'workspace',
  });
  const project = store.createProject({
    key: 'PROC-01',
    name: '采购风险协同',
    objective: '协调采购与供应风险分析。',
    leadId: agent.id,
    agentIds: [],
    startDate: '2026-09-03',
    targetDate: '2026-09-30',
  });
  const run = store.createRun({
    agentId: agent.id,
    projectId: project.id,
    workItem: '扫描本月关键物料风险',
  });

  const snapshot = store.load();
  assert.deepEqual(runtime.capabilities, ['chat', 'tools']);
  assert.equal(runtime.owner, 'workspace-owner');
  assert.deepEqual(agent.skills, ['询价', '供应风险']);
  assert.equal(agent.model, 'provider-default');
  assert.equal(agent.registration.type, 'master');
  assert.deepEqual(agent.registration.allowedRuntimeCapabilities, ['chat', 'tools']);
  assert.deepEqual(project.agentIds, [agent.id]);
  assert.equal(run.trigger, 'project');
  assert.equal(snapshot.revision, 4);
  assert.equal(snapshot.runs[0]?.id, run.id);
});

test('enforces a governed Agent tree, unique codes, and runtime capability allowlists', (t) => {
  const { store } = fixture(t);
  const root = store.load().agents[0]!;

  const master = store.createAgent({
    name: 'ERP 主 Agent', role: 'ERP 系统任务入口', provider: 'openai', runtimeId: root.runtimeId,
    parentAgentId: root.id, hierarchyLevel: 'L1',
    code: 'erp-master', type: 'master', ownerOrg: '信息中心', domain: 'erp',
    allowedRuntimeCapabilities: ['mcp'],
  });
  const specialist = store.createAgent({
    name: 'ERP 订单 Agent', role: '订单专业分析', provider: 'openai', runtimeId: root.runtimeId,
    parentAgentId: master.id, hierarchyLevel: 'L2',
    code: 'erp-orders', type: 'specialist', ownerOrg: '信息中心', domain: 'order',
    allowedRuntimeCapabilities: ['mcp'],
  });

  assert.equal(master.registration.code, 'erp-master');
  assert.equal(specialist.registration.type, 'specialist');
  assert.throws(() => store.createAgent({
    name: '重复编码 Agent', role: '测试', provider: 'openai', runtimeId: root.runtimeId,
    parentAgentId: root.id, hierarchyLevel: 'L1',
    code: 'ERP-MASTER', type: 'master', ownerOrg: '信息中心', domain: 'duplicate',
  }), /Agent code 不能重复/);
  assert.throws(() => store.createAgent({
    name: '越权能力 Agent', role: '测试', provider: 'openai', runtimeId: root.runtimeId,
    parentAgentId: root.id, hierarchyLevel: 'L1',
    code: 'erp-invalid-capability', type: 'master', ownerOrg: '信息中心', domain: 'erp',
    allowedRuntimeCapabilities: ['unregistered-capability'],
  }), /Runtime 未声明能力/);
  assert.throws(() => store.createAgent({
    name: '无运行环境能力 Agent', role: '测试', provider: 'openai',
    parentAgentId: root.id, hierarchyLevel: 'L1',
    code: 'erp-no-runtime', type: 'master', ownerOrg: '信息中心', domain: 'erp',
    allowedRuntimeCapabilities: ['mcp'],
  }), /未绑定 Runtime 的 Agent 不能声明能力白名单/);
  assert.throws(() => store.createAgent({
    name: '错误层级 Agent', role: '测试', provider: 'openai', runtimeId: root.runtimeId,
    parentAgentId: root.id, hierarchyLevel: 'L3',
    code: 'erp-wrong-level', type: 'master', ownerOrg: '信息中心', domain: 'erp',
  }), /master 必须使用 L1 层级/);
  assert.throws(() => store.createAgent({
    name: '错误上级 Agent', role: '测试', provider: 'openai', runtimeId: root.runtimeId,
    parentAgentId: root.id, hierarchyLevel: 'L2',
    code: 'erp-wrong-parent', type: 'specialist', ownerOrg: '信息中心', domain: 'erp',
  }), /specialist 的上级必须是 master/);

  const invalid = store.load();
  invalid.agents.find((agent) => agent.id === master.id)!.parentAgentId = specialist.id;
  const parsed = HarborSnapshotSchema.safeParse(invalid);
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.ok(parsed.error.issues.some((issue) => issue.message === 'Agent 上下级关系存在循环'));
  }
});

test('rejects a stale snapshot instead of overwriting a newer revision', (t) => {
  const { store } = fixture(t);
  const first = store.load();
  const stale = store.load();

  first.projects[0]!.progress = 41;
  const saved = store.save(first);
  stale.projects[0]!.progress = 99;

  assert.equal(saved.revision, 1);
  assert.throws(() => store.save(stale), HarborStoreConflictError);
  assert.equal(store.load().projects[0]?.progress, 41);
});

test('recovers the previous valid revision and quarantines a corrupt primary', (t) => {
  const { file, store } = fixture(t);
  const snapshot = store.load();
  snapshot.projects[0]!.progress = 42;
  store.save(snapshot);
  assert.ok(existsSync(store.backupFile));

  writeFileSync(file, '{broken-json', 'utf8');
  const recovered = store.load();

  assert.equal(recovered.revision, 0);
  assert.equal(recovered.projects[0]?.progress, 38);
  assert.ok(readdirSync(dirname(file)).some((name) => name.includes('.corrupt-')));
  assert.doesNotThrow(() => HarborSnapshotSchema.parse(JSON.parse(readFileSync(file, 'utf8'))));
});

test('fails loudly when corrupt data has no valid backup', (t) => {
  const { file, store } = fixture(t);
  store.load();
  writeFileSync(file, JSON.stringify({ version: 1, agents: [{}], runtimes: [], projects: [], runs: [] }), 'utf8');

  assert.throws(() => store.load(), HarborStoreCorruptError);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).agents, [{}]);
  assert.equal(readdirSync(dirname(file)).filter((name) => name.endsWith('.lock')).length, 0);
});

test('validates cross references, dates, project keys, and pending save data', (t) => {
  const { store } = fixture(t);
  const snapshot = store.load();

  assert.throws(
    () => store.createProject({ name: '无效项目', objective: '引用不存在 Agent', agentIds: ['agent-missing'] }),
    /不存在的 Agent/,
  );
  assert.throws(
    () => store.createProject({ key: 'pilot-01', name: '重复项目', objective: '重复 key' }),
    /Project key 已存在/,
  );
  assert.throws(
    () => store.createProject({
      name: '日期无效',
      objective: '目标时间错误',
      startDate: '2026-09-30',
      targetDate: '2026-09-03',
    }),
    /targetDate 不能早于 startDate/,
  );

  snapshot.projects[0]!.progress = 101;
  assert.throws(() => store.save(snapshot), HarborStoreCorruptError);
  assert.equal(store.load().revision, 0);
  assert.equal(store.load().projects[0]?.progress, 38);
});

test('persists runtime verification state and rejects an older probe result', (t) => {
  const { store } = fixture(t);
  const initial = store.load();
  const runtimeId = initial.runtimes[0]!.id;

  const healthy = store.recordRuntimeVerification(runtimeId, {
    status: 'healthy',
    checkedAt: '2026-09-03T08:31:00.000Z',
    message: 'runtime is reachable',
    code: null,
  });
  assert.equal(healthy.status, 'online');
  assert.equal(healthy.lastSeenAt, '2026-09-03T08:31:00.000Z');
  assert.equal(healthy.lastVerification?.status, 'healthy');
  assert.equal(store.load().revision, 1);

  const failed = store.recordRuntimeVerification(runtimeId, {
    status: 'unhealthy',
    checkedAt: '2026-09-03T08:32:00.000Z',
    message: 'connection failed',
    code: 'ECONNREFUSED',
  });
  assert.equal(failed.status, 'offline');
  assert.equal(failed.lastSeenAt, '2026-09-03T08:31:00.000Z');
  assert.equal(failed.lastVerification?.code, 'ECONNREFUSED');

  assert.throws(() => store.recordRuntimeVerification(runtimeId, {
    status: 'healthy',
    checkedAt: '2026-09-03T08:31:30.000Z',
    message: 'late result',
  }), HarborStoreConflictError);
  assert.equal(store.load().runtimes[0]?.lastVerification?.status, 'unhealthy');
});
