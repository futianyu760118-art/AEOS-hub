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
  assert.deepEqual(project.agentIds, [agent.id]);
  assert.equal(run.trigger, 'project');
  assert.equal(snapshot.revision, 4);
  assert.equal(snapshot.runs[0]?.id, run.id);
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
