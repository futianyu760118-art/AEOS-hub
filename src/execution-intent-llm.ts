// 执行面「LLM 优先」意图解析器：把一句自然语言映射为受控的查询/推理派单请求。
// 查询语义由 Agent 注册的 intent（src/execution-intent-types.ts）自描述驱动，本模块不再内置任何具体系统的路径/字段。
// 设计原则：LLM 只做意图分类 + 槽位抽取，输出仍按 intent.paths 校验 path，绝不越过 Agent 声明的能力范围。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { hubRoot, readConfig } from './hub-config.ts';
import { type QueryIntent } from './execution-intent-types.ts';
import { recordModelCall } from './model-observability.ts';

export type IntentDecision =
  | { kind: 'query'; path: string; params: Record<string, string | number> }
  | { kind: 'reasoning'; request: { prompt: string; task_type: string; context: Record<string, unknown>; constraints: { read_only: boolean; require_evidence: boolean } } };

export type IntentParseFailureCode =
  | 'INVALID_INPUT'
  | 'MODEL_NOT_CONFIGURED'
  | 'MODEL_AUTH'
  | 'MODEL_RATE_LIMIT'
  | 'MODEL_SERVER'
  | 'MODEL_BAD_REQUEST'
  | 'MODEL_TIMEOUT'
  | 'MODEL_NETWORK'
  | 'MODEL_EMPTY'
  | 'MODEL_INVALID_INTENT';

export interface IntentParseFailure {
  error: string;
  code: IntentParseFailureCode;
  retryable: boolean;
  attempts: number;
  status?: number;
}

export interface IntentRetryOptions {
  /** 429/5xx 等 HTTP 瞬时错误的最大重试次数（不含首次）。 */
  httpMaxRetries?: number;
  /** 超时/网络错误的最大重试次数（不含首次）。 */
  networkMaxRetries?: number;
  /** 指数退避基数（毫秒）。 */
  baseDelayMs?: number;
}

export interface IntentParseDeps {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** 思考强度（DeepSeek：low/high/max）；不传则用模型默认（high）。 */
  effort?: 'low' | 'high' | 'max';
  timeoutMs?: number;
  retry?: IntentRetryOptions;
  /** 测试注入：替代 setTimeout 的等待实现。 */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Agent 注册的查询语义（query_control_platform 能力的 intent.paths），本模块据此动态生成提示。 */
  intent?: QueryIntent;
  /** 模型调用成功后回传用量（Token 计数与起止时间），由调用方决定是否记账。 */
  onUsage?: (usage: { model: string; tokensIn: number; cachedTokens: number; tokensOut: number; startedAt: string; endedAt: string }) => void;
}

function readDeepSeekApiKey(): string {
  const fromEnv = process.env.DEEPSEEK_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const envFile = join(hubRoot, '.env');
  if (!existsSync(envFile)) return '';
  const content = readFileSync(envFile, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*DEEPSEEK_API_KEY\s*=\s*([^\r\n#]*?)\s*$/);
    if (match) return match[1].replace(/^["']|["']$/g, '').trim();
  }
  return '';
}

function deepSeekConfig(deps: IntentParseDeps): { baseUrl: string; model: string; apiKey: string } {
  const cfg = readConfig();
  const provider = cfg.providers.find((p) => p.id === (cfg.modelProvider || 'deepseek'))
    ?? cfg.providers.find((p) => p.id === 'deepseek');
  return {
    baseUrl: (deps.baseUrl ?? provider?.base_url ?? 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    model: deps.model ?? (cfg.model || 'deepseek-flash'),
    apiKey: deps.apiKey ?? readDeepSeekApiKey(),
  };
}

/** 从 Agent 自描述的查询语义动态生成系统提示。 */
function buildQueryIntentPrompt(intent: QueryIntent): string {
  const lines = [
    '你是 AEOS Hub 执行面的意图解析器。根据用户的自然语言输入，输出且只输出一个 JSON 对象，必须是以下两种之一：',
    '',
    '1. 只读数据查询（kind="query"）：',
    '   {"kind":"query","path":"<接口路径>","params":{<字段>:<值>}}',
    '2. 只读分析推理（kind="reasoning"）：',
    '   {"kind":"reasoning","task_type":"operating_case_analysis","prompt":"<原样分析问题>"}',
    '',
    '判断规则：',
    '- 意图是"查询/列出/统计/查某类业务数据"→ query；',
    '- 意图是"分析/评估/判断/风险/建议/预测/影响/是否/为什么/怎么办/能否/会不会"→ reasoning。',
    '',
    'query 的 path 只能是下列之一，params 只能用该行 path 后列出的字段：',
  ];
  for (const p of intent.paths) {
    const keywordHint = p.keywords?.length ? `；关键词：${p.keywords.join('/')}` : '';
    const paramHint = (p.params || []).map((param) => {
      const labelHint = param.label ? `（${param.label}）` : '';
      const enumHint = param.enum?.length ? `可选值：${param.enum.map((e) => `${e.label}→${e.value}`).join('、')}` : '';
      return `${param.name}${labelHint}${enumHint ? `[${enumHint}]` : ''}`;
    }).join('，');
    lines.push(`- ${p.path}（${p.label}${keywordHint}）；参数：${paramHint || '无'}`);
  }
  lines.push(
    '',
    '规则：',
    '- 日期参数（*_start/*_end）用 YYYY-MM-DD。',
    '- 枚举不确定时不要填；无法确定 path 时输出 {"error":"..."}。',
    '- 只输出 JSON，不要输出解释、注释或 Markdown 代码块。',
  );
  return lines.join('\n');
}

function normalizeParams(params: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!params || typeof params !== 'object' || Array.isArray(params)) return out;
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number') out[key] = value;
    else if (value != null) out[key] = String(value);
  }
  return out;
}

function clampPagination(params: Record<string, string | number>): Record<string, string | number> {
  const out = { ...params };
  if (typeof out.page === 'number') out.page = Math.min(Math.max(Math.trunc(out.page), 1), 1000);
  if (typeof out.page_size === 'number') out.page_size = Math.min(Math.max(Math.trunc(out.page_size), 1), 100);
  return out;
}

function extractJson(content: string): unknown {
  const stripped = content.replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    return null;
  }
}

function toDecision(raw: unknown, intent: QueryIntent): IntentDecision | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: '意图解析结果格式无效' };
  const obj = raw as Record<string, unknown>;
  if (obj.error) return { error: String(obj.error) };
  if (obj.kind === 'query') {
    const path = typeof obj.path === 'string' ? obj.path.trim() : '';
    const params = clampPagination(normalizeParams(obj.params));
    if (!intent.paths.some((p) => p.path === path)) {
      return { error: `查询 path 不在能力声明范围内：${path || '(空)'}` };
    }
    return { kind: 'query', path, params };
  }
  if (obj.kind === 'reasoning') {
    const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : '';
    const taskType = typeof obj.task_type === 'string' ? obj.task_type.trim() : '';
    if (!prompt) return { error: '推理输入缺少 prompt' };
    if (prompt.length > 2000) return { error: '推理 prompt 过长（最多 2000 字符）' };
    return {
      kind: 'reasoning',
      request: {
        prompt,
        task_type: taskType || 'operating_case_analysis',
        context: {},
        constraints: { read_only: true, require_evidence: true },
      },
    };
  }
  return { error: '意图类型必须为 query 或 reasoning' };
}

/** 用大模型把一句自然语言解析为受控派单请求；瞬时错误自动重试，失败返回结构化原因。 */
export async function parseIntentWithLLM(text: string, deps: IntentParseDeps = {}): Promise<IntentDecision | IntentParseFailure> {
  const query = String(text || '').trim();
  if (!query) return { error: '输入为空', code: 'INVALID_INPUT', retryable: false, attempts: 0 };
  if (!deps.intent || !Array.isArray(deps.intent.paths) || deps.intent.paths.length === 0) {
    return { error: '未提供查询语义（intent），无法解析', code: 'INVALID_INPUT', retryable: false, attempts: 0 };
  }
  const { baseUrl, model, apiKey } = deepSeekConfig(deps);
  if (!apiKey) {
    return { error: '未配置 DeepSeek 模型密钥，已回退本地规则解析', code: 'MODEL_NOT_CONFIGURED', retryable: false, attempts: 0 };
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 30_000;
  const httpMaxRetries = deps.retry?.httpMaxRetries ?? 2;
  const networkMaxRetries = deps.retry?.networkMaxRetries ?? 1;
  const baseDelayMs = deps.retry?.baseDelayMs ?? 500;
  const sleep = deps.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const attemptOnce = async (): Promise<
    { kind: 'decision'; value: IntentDecision } | { kind: 'failure'; failure: Omit<IntentParseFailure, 'attempts'> }
  > => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = new Date().toISOString();
    try {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          ...(deps.effort ? { reasoning_effort: deps.effort } : {}),
          messages: [
            { role: 'system', content: buildQueryIntentPrompt(deps.intent) },
            { role: 'user', content: query },
          ],
          temperature: 0,
        }),
        signal: controller.signal,
      });
      if (!response.ok) return { kind: 'failure', failure: classifyHttpFailure(response.status) };
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_cache_hit_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };
      const tokensIn = typeof data?.usage?.prompt_tokens === 'number' ? data.usage.prompt_tokens : 0;
      const tokensOut = typeof data?.usage?.completion_tokens === 'number' ? data.usage.completion_tokens : 0;
      const cachedTokens = typeof data?.usage?.prompt_cache_hit_tokens === 'number'
        ? data.usage.prompt_cache_hit_tokens
        : typeof data?.usage?.prompt_tokens_details?.cached_tokens === 'number'
          ? data.usage.prompt_tokens_details.cached_tokens
          : 0;
      // 模型实际消耗了 Token，无论内容是否有效都回传用量，便于记账。
      if (deps.onUsage && (tokensIn > 0 || tokensOut > 0)) {
        deps.onUsage({ model, tokensIn, cachedTokens, tokensOut, startedAt, endedAt: new Date().toISOString() });
      }
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        return { kind: 'failure', failure: { error: '模型未返回有效内容', code: 'MODEL_EMPTY', retryable: false } };
      }
      const decision = toDecision(extractJson(content), deps.intent);
      if ('error' in decision) {
        return { kind: 'failure', failure: { error: decision.error, code: 'MODEL_INVALID_INTENT', retryable: false } };
      }
      return { kind: 'decision', value: decision };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return { kind: 'failure', failure: { error: '意图解析超时', code: 'MODEL_TIMEOUT', retryable: true } };
      }
      return { kind: 'failure', failure: { error: `意图解析失败：${(error as Error).message}`, code: 'MODEL_NETWORK', retryable: true } };
    } finally {
      clearTimeout(timer);
    }
  };

  let attempts = 0;
  while (true) {
    attempts += 1;
    const outcome = await attemptOnce();
    if (outcome.kind === 'decision') {
      recordModelCall({ ok: true, status: 200, kind: 'success', model });
      return outcome.value;
    }
    const failure: IntentParseFailure = { ...outcome.failure, attempts };
    const retryLimit = failure.retryable
      ? (failure.code === 'MODEL_TIMEOUT' || failure.code === 'MODEL_NETWORK' ? networkMaxRetries : httpMaxRetries)
      : 0;
    if (attempts > retryLimit) {
      recordModelCall({
        ok: false,
        status: failure.status ?? null,
        kind: failure.code === 'MODEL_TIMEOUT' ? 'timeout' : (failure.status !== undefined ? 'http' : 'network'),
        model,
      });
      return failure;
    }
    await sleep(baseDelayMs * (2 ** (attempts - 1)));
  }
}

function classifyHttpFailure(status: number): Omit<IntentParseFailure, 'attempts'> {
  if (status === 401 || status === 403) {
    return { error: `模型接口返回 ${status}（密钥无效或已失效）`, code: 'MODEL_AUTH', retryable: false, status };
  }
  if (status === 429) {
    return { error: '模型接口返回 429（触发限流）', code: 'MODEL_RATE_LIMIT', retryable: true, status };
  }
  if (status >= 500) {
    return { error: `模型接口返回 ${status}（服务端异常）`, code: 'MODEL_SERVER', retryable: true, status };
  }
  return { error: `模型接口返回 ${status}`, code: 'MODEL_BAD_REQUEST', retryable: false, status };
}
