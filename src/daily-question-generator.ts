import { z } from 'zod';
import { DailyGeneratedQuestionDraftSchema, type DailyGeneratedQuestionDraft, type DailyQuestionConfig } from './daily-questions.ts';
import type { RuntimeSupervisor } from './runtime/index.ts';
import type { RuntimeEvent } from './runtime/types.ts';

const GenerationResponseSchema = z.object({
  questions: z.array(DailyGeneratedQuestionDraftSchema).min(1).max(12),
}).strict();

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseDailyQuestionGeneration(text: string, count: number): DailyGeneratedQuestionDraft[] {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1]?.trim();
  const candidates = [fenced, trimmed, trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)].filter(Boolean) as string[];
  let lastError: unknown;
  for (const candidate of [...new Set(candidates)]) {
    try {
      const parsed = GenerationResponseSchema.parse(JSON.parse(candidate));
      const unique = parsed.questions.filter((question, index, all) => (
        all.findIndex((item) => item.title.toLocaleLowerCase('zh-CN') === question.title.toLocaleLowerCase('zh-CN')) === index
      ));
      if (unique.length < count) throw new Error(`大模型只返回 ${unique.length} 条有效问题，期望 ${count} 条`);
      return unique.slice(0, count);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`无法解析大模型生成的问题：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export function buildDailyQuestionGenerationPrompt(
  dateKey: string,
  role: string,
  config: DailyQuestionConfig,
  capabilitySummary = '',
): string {
  const seeds = config.questions
    .filter((question) => question.source !== 'generated' && question.enabled)
    .map((question) => ({ title: question.title, priority: question.priority }))
    .slice(0, 30);
  return [
    '你是 AEOS 企业经营分析问题设计器。',
    `为日期 ${dateKey}、角色“${role}”生成 ${config.displayCount} 个当天最值得管理者追问的经营问题。`,
    '问题应覆盖目标、结果、变化、风险/机会、决策和行动，结合给定人工问题池主题但不要机械复制。',
    capabilitySummary
      ? `当前已接入能力：${capabilitySummary}。问题只能要求调用这些能力；不要引用未接入的数据源或演示订单/物料。`
      : '当前未获取到业务能力清单。问题应优先要求先核验可用能力与数据新鲜度，不得假定订单、指标或物料数据存在。',
    '每个 prompt 必须要求基于可用业务数据分析、引用 evidence_refs，并在数据陈旧或缺失时明确“数据置信度不足”。',
    '仅设计问题，不执行分析，不调用工具，不输出 Markdown。',
    '严格输出 JSON：{"questions":[{"title":"不超过80字","prompt":"发给中枢Agent的完整指令","priority":0到100整数}]}',
    `人工问题池参考：${JSON.stringify(seeds)}`,
  ].join('\n');
}

export async function generateDailyQuestionsWithRuntime(options: {
  supervisor: RuntimeSupervisor;
  runtimeInstanceId: string;
  workingDirectory: string;
  dateKey: string;
  role: string;
  config: DailyQuestionConfig;
  capabilitySummary?: string;
  timeoutMs?: number;
}): Promise<DailyGeneratedQuestionDraft[]> {
  const session = await options.supervisor.createSession(options.runtimeInstanceId, {
    workingDirectory: options.workingDirectory,
    metadata: { purpose: 'daily-question-generation', dateKey: options.dateKey, role: options.role },
  });
  let runId: string | null = null;
  let completedText = '';
  let streamedText = '';
  const unsubscribe = options.supervisor.onEvent((event: RuntimeEvent) => {
    if (event.sessionId !== session.id) return;
    if (runId && event.runId && event.runId !== runId) return;
    const payload = record(event.data);
    const item = record(payload.item);
    if (event.name === 'item/agentMessage/delta' && typeof payload.delta === 'string') streamedText += payload.delta;
    if (event.name === 'item/completed' && item.type === 'agentMessage' && typeof item.text === 'string') {
      completedText = item.text;
    }
  }, options.runtimeInstanceId);

  try {
    const run = await options.supervisor.startRun(options.runtimeInstanceId, session.id, {
      input: buildDailyQuestionGenerationPrompt(options.dateKey, options.role, options.config, options.capabilitySummary),
      metadata: { purpose: 'daily-question-generation', dateKey: options.dateKey, role: options.role },
    });
    runId = run.id;
    const outcome = await options.supervisor.waitForRun(options.runtimeInstanceId, run.id, options.timeoutMs ?? 180_000);
    if (outcome.state !== 'completed') throw new Error(outcome.failure?.message || `生成运行状态：${outcome.state}`);
    return parseDailyQuestionGeneration(completedText || streamedText, options.config.displayCount);
  } finally {
    unsubscribe();
    if (runId) await options.supervisor.interruptRun(options.runtimeInstanceId, runId).catch(() => undefined);
    await options.supervisor.deleteSession(options.runtimeInstanceId, session.id).catch(() => undefined);
  }
}
