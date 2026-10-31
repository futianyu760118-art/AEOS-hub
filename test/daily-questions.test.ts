import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  DEFAULT_DAILY_QUESTION_CONFIG,
  DailyQuestionConflictError,
  hasDailyGeneratedBatch,
  loadDailyQuestionConfig,
  replaceDailyGeneratedQuestions,
  saveDailyQuestionConfig,
} from '../src/daily-questions.ts';
import {
  buildDailyQuestionGenerationPrompt,
  generateDailyQuestionsWithRuntime,
  parseDailyQuestionGeneration,
} from '../src/daily-question-generator.ts';
import { selectDailyQuestions } from '../public/daily-questions.js';

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-daily-questions-'));
  const file = join(dir, 'daily-questions.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { file };
}

test('returns defaults without creating a configuration file', (t) => {
  const { file } = fixture(t);
  const config = loadDailyQuestionConfig(file);
  assert.equal(config.displayCount, 6);
  assert.equal(config.questions.length, 14);
  assert.equal(config.revision, 0);
  assert.deepEqual(config.generatedBatches, []);
  const riskQuestion = config.questions.find((question) => question.id === 'order-risks');
  assert.match(riskQuestion?.prompt ?? '', /仅使用 company-control/);
  assert.match(riskQuestion?.prompt ?? '', /不得调用 demo-erp/);
  assert.match(riskQuestion?.prompt ?? '', /risk_level/);
  const qualityQuestion = config.questions.find((question) => question.id === 'quality-issues');
  assert.match(qualityQuestion?.prompt ?? '', /quality_issues_list/);
  assert.match(qualityQuestion?.prompt ?? '', /quality_trace/);
  const productionQuestion = config.questions.find((question) => question.id === 'production-coordination');
  assert.match(productionQuestion?.prompt ?? '', /production_work_orders_list/);
  assert.match(productionQuestion?.prompt ?? '', /production_capacity_list/);
});

test('adds the built-in quality question to an existing configuration without replacing user content', (t) => {
  const { file } = fixture(t);
  const legacy = structuredClone(DEFAULT_DAILY_QUESTION_CONFIG);
  legacy.revision = 7;
  legacy.questions = legacy.questions.filter((question) => question.id !== 'quality-issues');
  legacy.questions = legacy.questions.filter((question) => question.id !== 'production-coordination');
  legacy.questions[0]!.title = '用户自定义目标问题';
  writeFileSync(file, JSON.stringify(legacy), 'utf8');

  const loaded = loadDailyQuestionConfig(file);
  assert.equal(loaded.revision, 7);
  assert.equal(loaded.questions[0]?.title, '用户自定义目标问题');
  assert.equal(loaded.questions.filter((question) => question.id === 'quality-issues').length, 1);
  assert.equal(loaded.questions.filter((question) => question.id === 'production-coordination').length, 1);
});

test('persists validated configuration and increments its revision', (t) => {
  const { file } = fixture(t);
  const config = loadDailyQuestionConfig(file);
  config.displayCount = 5;
  config.questions[0]!.title = '更新后的经营问题';
  const saved = saveDailyQuestionConfig(config, file);
  assert.equal(saved.revision, 1);
  assert.equal(loadDailyQuestionConfig(file).questions[0]!.title, '更新后的经营问题');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).displayCount, 5);
});

test('rejects stale revisions, duplicate ids, and too few enabled questions', (t) => {
  const { file } = fixture(t);
  const first = loadDailyQuestionConfig(file);
  const stale = structuredClone(first);
  saveDailyQuestionConfig(first, file);
  assert.throws(() => saveDailyQuestionConfig(stale, file), DailyQuestionConflictError);

  const duplicate = structuredClone(DEFAULT_DAILY_QUESTION_CONFIG);
  duplicate.questions[1]!.id = duplicate.questions[0]!.id;
  assert.throws(() => saveDailyQuestionConfig(duplicate, join(file, '..', 'duplicate.json')), /问题 id 不能重复/);

  const disabled = structuredClone(DEFAULT_DAILY_QUESTION_CONFIG);
  disabled.questions.forEach((question, index) => { question.enabled = index < 2; });
  assert.throws(() => saveDailyQuestionConfig(disabled, join(file, '..', 'disabled.json')), /启用的问题数量不能少于/);

  const roleGap = structuredClone(DEFAULT_DAILY_QUESTION_CONFIG);
  roleGap.displayCount = 6;
  roleGap.questions.slice(0, 8).forEach((question) => { question.roles = ['总经理']; });
  assert.throws(() => saveDailyQuestionConfig(roleGap, join(file, '..', 'role-gap.json')), /通用角色的启用问题数量不能少于/);
});

test('writes atomically, keeps the previous revision, and recovers a corrupt primary', (t) => {
  const { file } = fixture(t);
  const first = saveDailyQuestionConfig(loadDailyQuestionConfig(file), file);
  first.questions[0]!.title = '第二版问题';
  const second = saveDailyQuestionConfig(first, file);

  assert.equal(second.revision, 2);
  assert.ok(existsSync(`${file}.bak`));
  assert.equal(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).revision, 1);
  assert.equal(readdirSync(join(file, '..')).filter((name) => name.endsWith('.tmp')).length, 0);

  writeFileSync(file, '{broken-json', 'utf8');
  const recovered = loadDailyQuestionConfig(file);
  assert.equal(recovered.revision, 1);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).revision, 1);
});

test('daily selection is stable, changes by day, respects roles, and rotates manually', () => {
  const config = structuredClone(DEFAULT_DAILY_QUESTION_CONFIG);
  const today = selectDailyQuestions(config, { dateKey: '2026-09-20', role: '决策责任人', offset: 0 });
  const repeated = selectDailyQuestions(config, { dateKey: '2026-09-20', role: '决策责任人', offset: 0 });
  const tomorrow = selectDailyQuestions(config, { dateKey: '2026-09-21', role: '决策责任人', offset: 0 });
  const nextGroup = selectDailyQuestions(config, { dateKey: '2026-09-20', role: '决策责任人', offset: 6 });
  assert.deepEqual(today.map((item) => item.id), repeated.map((item) => item.id));
  assert.notDeepEqual(today.map((item) => item.id), tomorrow.map((item) => item.id));
  assert.equal(today.length, 6);
  assert.equal(nextGroup.length, 6);
  assert.equal(today.filter((item) => nextGroup.some((next) => next.id === item.id)).length, 0);

  config.displayCount = 2;
  config.questions = [
    { id: 'role-only', title: '角色专属', prompt: '角色专属问题', roles: ['总经理'], priority: 100, enabled: true },
    { id: 'shared-a', title: '通用 A', prompt: '通用问题 A', roles: [], priority: 50, enabled: true },
    { id: 'shared-b', title: '通用 B', prompt: '通用问题 B', roles: [], priority: 50, enabled: true },
  ];
  const employee = selectDailyQuestions(config, { dateKey: '2026-09-20', role: '员工' });
  assert.ok(employee.every((item) => item.id !== 'role-only'));
});

test('stores one generated batch per date and role, replaces it, and prunes old dates', (t) => {
  const { file } = fixture(t);
  const first = replaceDailyGeneratedQuestions('2026-09-21', '决策责任人', [
    { title: '今日现金风险是什么？', prompt: '分析今日现金风险并引用 evidence_refs。', priority: 96 },
    { title: '今日交付缺口是什么？', prompt: '分析今日交付缺口并引用 evidence_refs。', priority: 91 },
  ], file);
  assert.equal(first.revision, 1);
  assert.equal(first.questions.filter((item) => item.source === 'generated').length, 2);
  assert.ok(hasDailyGeneratedBatch(first, '2026-09-21', '决策责任人'));

  const replaced = replaceDailyGeneratedQuestions('2026-09-21', '决策责任人', [
    { title: '替换后的问题', prompt: '分析替换后的问题并引用 evidence_refs。', priority: 99 },
  ], file);
  assert.equal(replaced.questions.filter((item) => item.source === 'generated').length, 1);
  assert.equal(replaced.generatedBatches.length, 1);

  const secondRole = replaceDailyGeneratedQuestions('2026-09-21', '财务负责人', [
    { title: '财务负责人问题', prompt: '分析财务问题并引用 evidence_refs。', priority: 98 },
  ], file);
  assert.equal(secondRole.questions.filter((item) => item.source === 'generated').length, 2);
  assert.equal(secondRole.generatedBatches.length, 2);

  const nextDay = replaceDailyGeneratedQuestions('2026-09-22', '决策责任人', [
    { title: '次日问题', prompt: '分析次日问题并引用 evidence_refs。', priority: 97 },
  ], file);
  assert.equal(nextDay.questions.filter((item) => item.source === 'generated').length, 1);
  assert.equal(nextDay.generatedBatches.length, 1);
  assert.ok(hasDailyGeneratedBatch(nextDay, '2026-09-22', '决策责任人'));
});

test('allows generated questions to be deleted and manual questions to be added', (t) => {
  const { file } = fixture(t);
  const generated = replaceDailyGeneratedQuestions('2026-09-21', '决策责任人', [
    { title: '可删除的 AI 问题', prompt: '分析问题并引用 evidence_refs。', priority: 90 },
  ], file);
  generated.questions = generated.questions.filter((item) => item.source !== 'generated');
  generated.questions.push({
    id: 'custom-added', title: '新增人工问题', prompt: '分析新增问题并引用 evidence_refs。', roles: [], priority: 60, enabled: true, source: 'manual',
  });
  const saved = saveDailyQuestionConfig(generated, file);
  assert.ok(saved.questions.every((item) => item.source !== 'generated'));
  assert.ok(saved.questions.some((item) => item.id === 'custom-added'));
  assert.ok(hasDailyGeneratedBatch(saved, '2026-09-21', '决策责任人'));
});

test('selection excludes generated questions from a different date', () => {
  const config = structuredClone(DEFAULT_DAILY_QUESTION_CONFIG);
  config.questions.push({
    id: 'ai-20260920-old',
    title: '昨日 AI 问题',
    prompt: '昨日问题',
    roles: ['决策责任人'],
    priority: 100,
    enabled: true,
    source: 'generated',
    generatedDate: '2026-09-20',
    generatedRole: '决策责任人',
  });
  const today = selectDailyQuestions(config, { dateKey: '2026-09-21', role: '决策责任人' });
  assert.ok(today.every((item) => item.id !== 'ai-20260920-old'));
});

test('selection prefers today generated questions and uses the manual pool as fallback', () => {
  const config = structuredClone(DEFAULT_DAILY_QUESTION_CONFIG);
  config.displayCount = 2;
  config.questions.push(
    {
      id: 'ai-20260921-a', title: '今日 AI A', prompt: '问题 A', roles: ['决策责任人'], priority: 1, enabled: true,
      source: 'generated', generatedDate: '2026-09-21', generatedRole: '决策责任人',
    },
    {
      id: 'ai-20260921-b', title: '今日 AI B', prompt: '问题 B', roles: ['决策责任人'], priority: 1, enabled: true,
      source: 'generated', generatedDate: '2026-09-21', generatedRole: '决策责任人',
    },
  );
  const selected = selectDailyQuestions(config, { dateKey: '2026-09-21', role: '决策责任人' });
  assert.deepEqual(new Set(selected.map((item) => item.id)), new Set(['ai-20260921-a', 'ai-20260921-b']));
});

test('parses strict model output and builds a role-specific daily prompt', () => {
  const parsed = parseDailyQuestionGeneration('```json\n{"questions":[{"title":"交付风险？","prompt":"分析交付风险并引用 evidence_refs。","priority":95}]}\n```', 1);
  assert.deepEqual(parsed, [{ title: '交付风险？', prompt: '分析交付风险并引用 evidence_refs。', priority: 95 }]);
  assert.throws(() => parseDailyQuestionGeneration('{"questions":[]}', 1), /无法解析大模型生成的问题/);

  const prompt = buildDailyQuestionGenerationPrompt(
    '2026-09-21',
    '决策责任人',
    DEFAULT_DAILY_QUESTION_CONFIG,
    'company-control/get_system_health；company-control/detail_orders_list',
  );
  assert.match(prompt, /2026-09-21/);
  assert.match(prompt, /决策责任人/);
  assert.match(prompt, /生成 6 个/);
  assert.match(prompt, /不调用工具/);
  assert.match(prompt, /company-control\/detail_orders_list/);
  assert.match(prompt, /不要引用未接入的数据源或演示订单\/物料/);
});

test('runs daily generation through the runtime and always cleans up its session', async () => {
  let listener: ((event: Record<string, unknown>) => void) | null = null;
  const calls: string[] = [];
  const supervisor = {
    async createSession() {
      calls.push('create');
      return { id: 'daily-session' };
    },
    onEvent(next: (event: Record<string, unknown>) => void) {
      listener = next;
      return () => { calls.push('unsubscribe'); listener = null; };
    },
    async startRun() {
      calls.push('start');
      listener?.({
        sessionId: 'daily-session',
        runId: 'daily-run',
        name: 'item/completed',
        data: { item: { type: 'agentMessage', text: '{"questions":[{"title":"模型问题","prompt":"分析模型问题并引用 evidence_refs。","priority":93}]}' } },
      });
      return { id: 'daily-run' };
    },
    async waitForRun() {
      calls.push('wait');
      return { state: 'completed' };
    },
    async interruptRun() {
      calls.push('interrupt');
    },
    async deleteSession() {
      calls.push('delete');
    },
  };
  const config = structuredClone(DEFAULT_DAILY_QUESTION_CONFIG);
  config.displayCount = 1;
  const generated = await generateDailyQuestionsWithRuntime({
    supervisor: supervisor as never,
    runtimeInstanceId: 'runtime-test',
    workingDirectory: '.',
    dateKey: '2026-09-21',
    role: '决策责任人',
    config,
  });
  assert.equal(generated[0]?.title, '模型问题');
  assert.deepEqual(calls, ['create', 'start', 'wait', 'unsubscribe', 'interrupt', 'delete']);
});
