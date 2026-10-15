// 执行面「LLM 优先」意图解析器：把一句自然语言映射为受控的查询/推理派单请求。
// 设计原则：LLM 只做意图分类 + 槽位抽取，输出仍强制通过 execution-capabilities 的
// 只读白名单校验（validateQueryInput / validateReasoningInput），绝不绕过安全边界。
// 本模块是前端本地正则（public/execution-query-intent.js）的「优先」路径；解析失败时
// 前端自动回退到正则，因此任何网络/密钥/模型问题都只会降级、不会阻断查询。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { hubRoot, readConfig } from './hub-config.ts';
import { validateQueryInput, validateReasoningInput } from './execution-capabilities.ts';

export type IntentDecision =
  | { kind: 'query'; path: string; params: Record<string, string | number> }
  | { kind: 'reasoning'; request: { prompt: string; task_type: string; context: Record<string, unknown>; constraints: { read_only: boolean; require_evidence: boolean } } };

export interface IntentParseDeps {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

// 与 public/execution-query-intent.js 的 INTENTS 及 execution-capabilities 的白名单保持一致。
const QUERY_SCHEMA: Array<{ path: string; label: string; params: string[] }> = [
  { path: '/external/orders/list', label: '订单', params: ['keyword', 'status', 'risk_level', 'customer_code', 'promised_date_start', 'promised_date_end', 'page', 'page_size'] },
  { path: '/external/material-kitting/results', label: '齐套', params: ['demand_no', 'demand_line_no', 'kit_status', 'risk_level', 'required_date_start', 'required_date_end', 'page', 'page_size'] },
  { path: '/external/material-kitting/shortages', label: '缺料', params: ['demand_no', 'material_code', 'is_key_material', 'page', 'page_size'] },
  { path: '/external/inventory/availability', label: '库存', params: ['material_code', 'keyword', 'wh_code', 'page', 'page_size'] },
  { path: '/external/material-supplies/list', label: '供给', params: ['material_code', 'supply_no', 'supply_type', 'expected_date_start', 'expected_date_end', 'page', 'page_size'] },
  { path: '/external/quality-issues/list', label: '质量异常', params: ['issue_no', 'order_no', 'product_code', 'status', 'defect_type', 'submit_dept', 'occurred_start', 'occurred_end', 'page', 'page_size'] },
  { path: '/external/production/work-orders/list', label: '生产工单', params: ['work_order_no', 'order_no', 'product_code', 'status', 'workshop', 'planned_end_start', 'planned_end_end', 'page', 'page_size'] },
  { path: '/external/suppliers/list', label: '供应商', params: ['keyword', 'page', 'page_size'] },
];

const SYSTEM_PROMPT = [
  '你是 AEOS Hub 执行面的意图解析器。根据用户的自然语言输入，输出且只输出一个 JSON 对象，必须是以下两种之一：',
  '',
  '1. 只读数据查询（kind="query"）：',
  '   {"kind":"query","path":"<接口路径>","params":{<字段>:<值>}}',
  '2. 只读分析推理（kind="reasoning"）：',
  '   {"kind":"reasoning","task_type":"<任务类型>","prompt":"<原样分析问题>"}',
  '',
  '判断规则：',
  '- 意图是"查询/列出/统计/查某类业务数据"→ query；',
  '- 意图是"分析/评估/判断/风险/建议/预测/影响/是否/为什么/怎么办/能否/会不会"→ reasoning。',
  '',
  'query 的 path 只能是下列之一，params 只能用该行列出的字段：',
  ...QUERY_SCHEMA.map((s) => `- ${s.path}（${s.label}）：${s.params.join(',')}`),
  '',
  'reasoning 的 task_type 只能是下列之一：',
  '- order_delivery_analysis（订单交付）',
  '- material_kitting_analysis（齐套/缺料）',
  '- supply_analysis（供给）',
  '- inventory_analysis（库存）',
  '- quality_analysis（质量）',
  '- production_analysis（生产）',
  '- supplier_analysis（供应商）',
  '- operating_case_analysis（其他经营事项）',
  '',
  '常用枚举：',
  '- status（订单）：pending_review(待评审), in_progress(进行中), partially_closed(部分关闭), completed(已完成), cancelled(已取消)',
  '- kit_status（齐套）：BLOCKED(阻塞), PARTIAL(部分齐套), SHORTAGE(缺料), FULL(完全齐套), PENDING(待计算)',
  '- risk_level：red(高), yellow(中), green(低)',
  '- supply_type：PURCHASE(采购), OUTSOURCE(委外), PRODUCTION(自制), TRANSFER(调拨)',
  '- is_key_material：true/false',
  '',
  '规则：',
  '- 日期参数（*_start/*_end）用 YYYY-MM-DD。',
  '- 枚举不确定时不要填；无法确定 path 或 task_type 时输出 {"error":"..."}。',
  '- 只输出 JSON，不要输出解释、注释或 Markdown 代码块。',
].join('\n');

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
    model: deps.model ?? (cfg.model || 'deepseek-chat'),
    apiKey: deps.apiKey ?? readDeepSeekApiKey(),
  };
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

function toDecision(raw: unknown): IntentDecision | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: '意图解析结果格式无效' };
  const obj = raw as Record<string, unknown>;
  if (obj.error) return { error: String(obj.error) };
  if (obj.kind === 'query') {
    const path = typeof obj.path === 'string' ? obj.path.trim() : '';
    const params = clampPagination(normalizeParams(obj.params));
    const invalid = validateQueryInput({ path, params });
    if (invalid) return { error: `查询意图校验失败：${invalid}` };
    return { kind: 'query', path, params };
  }
  if (obj.kind === 'reasoning') {
    const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : '';
    const taskType = typeof obj.task_type === 'string' ? obj.task_type.trim() : '';
    const request = {
      prompt,
      task_type: taskType || 'operating_case_analysis',
      context: {},
      constraints: { read_only: true, require_evidence: true },
    };
    const invalid = validateReasoningInput(request);
    if (invalid) return { error: `推理意图校验失败：${invalid}` };
    return { kind: 'reasoning', request };
  }
  return { error: '意图类型必须为 query 或 reasoning' };
}

/** 用大模型把一句自然语言解析为受控派单请求；失败/不可用返回 { error }，由前端回退正则。 */
export async function parseIntentWithLLM(text: string, deps: IntentParseDeps = {}): Promise<IntentDecision | { error: string }> {
  const query = String(text || '').trim();
  if (!query) return { error: '输入为空' };
  const { baseUrl, model, apiKey } = deepSeekConfig(deps);
  if (!apiKey) return { error: '未配置 DeepSeek 模型密钥，已回退本地规则解析' };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: query },
        ],
        temperature: 0,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { error: `模型接口返回 ${response.status}` };
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) return { error: '模型未返回有效内容' };
    return toDecision(extractJson(content));
  } catch (error) {
    if ((error as Error).name === 'AbortError') return { error: '意图解析超时' };
    return { error: `意图解析失败：${(error as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}
