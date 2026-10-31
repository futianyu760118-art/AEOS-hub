import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const trimmedString = (max: number, min = 0) => z.string()
  .min(min)
  .max(max)
  .refine((value) => value === value.trim(), '字符串前后不能包含空白');

export const DailyQuestionSchema = z.object({
  id: trimmedString(80, 1).regex(/^[a-z0-9][a-z0-9-]*$/, 'id 只能包含小写字母、数字和连字符'),
  title: trimmedString(80, 1),
  prompt: trimmedString(1200, 1),
  roles: z.array(trimmedString(40, 1)).max(20),
  priority: z.number().int().min(0).max(100),
  enabled: z.boolean(),
  source: z.enum(['manual', 'generated']).optional(),
  generatedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  generatedRole: trimmedString(40, 1).nullable().optional(),
}).strict();

export const DailyGeneratedBatchSchema = z.object({
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  role: trimmedString(40, 1),
  generatedAt: z.string().datetime({ offset: true }),
}).strict();

export const DailyGeneratedQuestionDraftSchema = z.object({
  title: trimmedString(80, 1),
  prompt: trimmedString(1200, 1),
  priority: z.number().int().min(0).max(100),
}).strict();

export const DailyQuestionConfigSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  displayCount: z.number().int().min(1).max(12),
  questions: z.array(DailyQuestionSchema).min(1).max(100),
  generatedBatches: z.array(DailyGeneratedBatchSchema).max(100).default([]),
}).strict().superRefine((config, ctx) => {
  const ids = new Set<string>();
  config.questions.forEach((question, index) => {
    if (ids.has(question.id)) ctx.addIssue({ code: 'custom', path: ['questions', index, 'id'], message: `问题 id 不能重复: ${question.id}` });
    ids.add(question.id);
  });
  if (config.questions.filter((question) => question.enabled).length < config.displayCount) {
    ctx.addIssue({ code: 'custom', path: ['displayCount'], message: '启用的问题数量不能少于首页显示数量' });
  }
  if (config.questions.filter((question) => question.enabled && question.roles.length === 0).length < config.displayCount) {
    ctx.addIssue({ code: 'custom', path: ['displayCount'], message: '通用角色的启用问题数量不能少于首页显示数量' });
  }
});

export type DailyQuestion = z.infer<typeof DailyQuestionSchema>;
export type DailyQuestionConfig = z.infer<typeof DailyQuestionConfigSchema>;
export type DailyGeneratedQuestionDraft = z.infer<typeof DailyGeneratedQuestionDraftSchema>;

export const DEFAULT_DAILY_QUESTION_CONFIG: DailyQuestionConfig = {
  version: 1,
  revision: 0,
  displayCount: 6,
  generatedBatches: [],
  questions: [
    { id: 'current-objective', title: '企业现在追求什么？', prompt: '基于当前可用数据，说明企业现在追求什么目标，以及目标版本和硬约束。', roles: [], priority: 90, enabled: true },
    { id: 'previous-results', title: '上期结果怎样？', prompt: '基于当前 evidence，总结上期结果怎样，哪些结论的数据置信度不足。', roles: [], priority: 80, enabled: true },
    { id: 'recent-changes', title: '最近发生了什么新变化？', prompt: '扫描最近发生的重要变化，只保留会影响未来经营结果的变化。', roles: [], priority: 85, enabled: true },
    { id: 'future-outlook', title: '未来可能发生什么？', prompt: '分析未来 7/30/60/90 天可能发生的风险与机会，按优先级输出。', roles: [], priority: 95, enabled: true },
    { id: 'manager-decisions', title: '哪些事情需要总经理决定？', prompt: '列出当前真正需要总经理决定的事项，默认最多 5 项，并说明不决策的影响。', roles: ['总经理', '管理者', '决策责任人'], priority: 100, enabled: true },
    { id: 'today-actions', title: '今天企业应该行动什么？', prompt: '给出今天企业应该采取的行动：谁做、做什么、何时完成、需要何种审批。', roles: [], priority: 100, enabled: true },
    { id: 'order-risks', title: '未来订单有哪些交付风险？', prompt: '仅使用 company-control 扫描未来 30 天订单风险，不得调用 demo-erp。有真实 risk_probability 时按金额影响、概率与时效排序；缺少概率时按 risk_level 识别并明确标注概率待中台提供。逐条引用 evidence_refs。', roles: [], priority: 92, enabled: true },
    { id: 'material-shortages', title: '关键物料是否齐套？', prompt: '仅使用 company-control 的 material_kitting_results_list、material_shortages_list、inventory_availability_list 和 material_supplies_list 核查未来 30 天物料齐套与供应缺口。说明齐套状态、缺口数量、影响订单、预计齐套日期、责任部门和 evidence_refs；数据过期或缺失时明确“数据置信度不足”。', roles: [], priority: 92, enabled: true },
    { id: 'quality-issues', title: '当前有哪些质量异常需要关注？', prompt: '仅使用 company-control 的 quality_issues_list 与 quality_trace 核查当前未闭环质量异常及其订单行、产品与 BOM 关联。逐项说明事项、evidence_refs、责任角色、时间或金额影响、建议动作与置信度；不得补造严重度、检验结果、批次等缺失字段，涉及质量处置、放行或承诺必须标注需人工确认。', roles: [], priority: 92, enabled: true },
    { id: 'production-coordination', title: '当前生产协同有哪些阻塞？', prompt: '仅使用 company-control 的 production_work_orders_list、production_operations_list、production_order_links_list、production_reports_list 和 production_capacity_list 核查生产工单、工序、订单关联、报工与产能。必须引用 evidence_refs；工序按 order_no 锚定，关联缺失、空结果、数据过期或置信度不足时明确“数据置信度不足”，不得修改工单、报工或排产。', roles: [], priority: 94, enabled: true },
    { id: 'confidence-gaps', title: '哪些判断的数据置信度不足？', prompt: '核查当前经营判断的数据时效与证据完整性，列出数据置信度不足的事项及补数建议。', roles: [], priority: 75, enabled: true },
    { id: 'opportunities', title: '当前最值得把握的机会是什么？', prompt: '识别未来 30 天最值得把握的经营机会，说明潜在收益、成立条件、风险与 evidence_refs。', roles: ['总经理', '管理者', '决策责任人'], priority: 70, enabled: true },
    { id: 'cross-domain-conflicts', title: '有哪些跨部门冲突需要协调？', prompt: '识别当前影响经营目标的跨部门依赖或冲突，说明责任角色、时限、影响与建议协调路径。', roles: [], priority: 82, enabled: true },
    { id: 'unresolved-actions', title: '昨日行动还有哪些未闭环？', prompt: '核查昨日重点行动的闭环情况，列出未完成事项、责任角色、逾期影响和所需升级。', roles: [], priority: 78, enabled: true },
  ],
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const dailyQuestionsFile = join(root, 'data', 'daily-questions.json');

export class DailyQuestionConflictError extends Error {}
export class DailyQuestionStoreError extends Error {}

function cloneDefaults(): DailyQuestionConfig {
  return structuredClone(DEFAULT_DAILY_QUESTION_CONFIG);
}

function readConfigFile(file: string): DailyQuestionConfig {
  const config = DailyQuestionConfigSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const requiredQuestions = DEFAULT_DAILY_QUESTION_CONFIG.questions.filter((question) => ['quality-issues', 'production-coordination'].includes(question.id));
  const missingQuestions = requiredQuestions.filter((question) => !config.questions.some((candidate) => candidate.id === question.id));
  if (!missingQuestions.length) return config;
  return DailyQuestionConfigSchema.parse({
    ...config,
    questions: [...config.questions, ...missingQuestions.map((question) => structuredClone(question))],
  });
}

function writeTextAtomic(target: string, payload: string): void {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, payload, { encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true });
    renameSync(temporary, target);
  } catch (error) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      // 保留原始写入错误。
    }
    throw new DailyQuestionStoreError(`写入每日经营问题配置失败: ${target}`, { cause: error });
  }
}

function configPayload(config: DailyQuestionConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function loadDailyQuestionConfig(file = dailyQuestionsFile): DailyQuestionConfig {
  if (!existsSync(file)) return cloneDefaults();
  try {
    return readConfigFile(file);
  } catch (primaryError) {
    const backupFile = `${file}.bak`;
    if (!existsSync(backupFile)) {
      throw new DailyQuestionStoreError(`每日经营问题配置无法读取且没有可用备份: ${file}`, { cause: primaryError });
    }
    try {
      const backup = readConfigFile(backupFile);
      writeTextAtomic(file, configPayload(backup));
      return backup;
    } catch (backupError) {
      throw new DailyQuestionStoreError(`每日经营问题配置及备份均无法读取: ${file}`, { cause: backupError });
    }
  }
}

export function saveDailyQuestionConfig(input: unknown, file = dailyQuestionsFile): DailyQuestionConfig {
  const pending = DailyQuestionConfigSchema.parse(input);
  const current = loadDailyQuestionConfig(file);
  if (pending.revision !== current.revision) {
    throw new DailyQuestionConflictError(`配置已被其他管理者更新（当前版本 ${current.revision}）`);
  }
  const saved = DailyQuestionConfigSchema.parse({ ...pending, revision: current.revision + 1 });
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) writeTextAtomic(`${file}.bak`, configPayload(current));
  writeTextAtomic(file, configPayload(saved));
  return saved;
}

export function hasDailyGeneratedBatch(config: DailyQuestionConfig, dateKey: string, role: string): boolean {
  return config.generatedBatches.some((batch) => batch.dateKey === dateKey && batch.role === role);
}

export function replaceDailyGeneratedQuestions(
  dateKey: string,
  role: string,
  drafts: unknown,
  file = dailyQuestionsFile,
): DailyQuestionConfig {
  const parsedDrafts = z.array(DailyGeneratedQuestionDraftSchema).min(1).max(12).parse(drafts);
  const current = loadDailyQuestionConfig(file);
  const retainedQuestions = current.questions.filter((question) => (
    question.source !== 'generated'
    || (question.generatedDate === dateKey && question.generatedRole !== role)
  ));
  const generatedQuestions: DailyQuestion[] = parsedDrafts.map((draft) => ({
    id: `ai-${dateKey.replace(/-/g, '')}-${randomUUID()}`,
    title: draft.title,
    prompt: draft.prompt,
    roles: [role],
    priority: draft.priority,
    enabled: true,
    source: 'generated',
    generatedDate: dateKey,
    generatedRole: role,
  }));
  const generatedBatches = current.generatedBatches
    .filter((batch) => batch.dateKey === dateKey && batch.role !== role)
    .concat({ dateKey, role, generatedAt: new Date().toISOString() });
  return saveDailyQuestionConfig({
    ...current,
    questions: [...retainedQuestions, ...generatedQuestions],
    generatedBatches,
  }, file);
}
