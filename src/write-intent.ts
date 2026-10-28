// 通用写操作意图解析：由提供方声明的能力 schema 驱动，不在 Hub 里硬编码具体写命令。
// 优先用模型把自然语言映射为 {systemId, capability, input}；无法解析时要求用户补充，绝不猜测。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hubRoot, readConfig } from './hub-config.ts';
import { validateAgainstSchema } from './schema-validation.ts';
import { extractBusinessIdentifier } from './hub-intent-router.ts';
import type { ExecutionCapabilityOperation } from './execution-plane.ts';
import type { WriteCapabilityDescriptor } from './write-request-service.ts';

export type WriteIntent =
  | { kind: 'write'; systemId: string; capability: string; operation: string; input: Record<string, unknown>; raw: string }
  | { kind: 'confirm' }
  | { kind: 'cancel' }
  | { kind: 'clarify'; message: string };

const CONFIRM_PATTERN = /^(确认|批准|执行|同意|可以)$/;
const CANCEL_PATTERN = /^(取消|放弃|不执行|算了)$/;
const WRITE_ACTION_PATTERN = /(改写|修改|更新|调整|变更|设置|设为|改为|改成|置为|标记为|录入|提交|写)/;
const IDENTIFIER_PATTERN = /business:\/\/(?:order|product|batch)\/[^\s，。；,;]+|\b(?:[A-Z]{2,}\d{4,}[-_]\d{2,}(?:[-_]\d+)*|[A-Z]{2,}[-_]\d{2,}(?:[-_]\d+)*)\b/i;

export interface WriteIntentDeps {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export function parseWriteConfirmation(text: string): 'confirm' | 'cancel' | null {
  const value = String(text || '').trim();
  if (CONFIRM_PATTERN.test(value)) return 'confirm';
  if (CANCEL_PATTERN.test(value)) return 'cancel';
  return null;
}

/** 只有同时包含写动作和业务标识时才尝试解析，避免劫持普通对话。 */
export function looksLikeWriteCommand(text: string): boolean {
  const value = String(text || '').trim();
  return WRITE_ACTION_PATTERN.test(value) && IDENTIFIER_PATTERN.test(value);
}

function readDeepSeekKey(): string {
  const fromEnv = process.env.DEEPSEEK_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = join(hubRoot, '.env');
  if (!existsSync(file)) return '';
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*DEEPSEEK_API_KEY\s*=\s*([^\r\n#]*?)\s*$/);
      if (match?.[1]) return match[1];
    }
  } catch {
    // 读取失败按未配置处理。
  }
  return '';
}

function deepSeekConfig(deps: WriteIntentDeps): { baseUrl: string; model: string; apiKey: string } {
  const cfg = readConfig();
  const provider = cfg.providers.find((item) => item.id === (cfg.modelProvider || 'deepseek'))
    ?? cfg.providers.find((item) => item.id === 'deepseek');
  return {
    baseUrl: (deps.baseUrl ?? provider?.base_url ?? 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    model: deps.model ?? (cfg.model || 'deepseek-flash'),
    apiKey: deps.apiKey ?? readDeepSeekKey(),
  };
}


function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDateValue(value: string): string | null {
  const match = value.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
  if (!match) return null;
  return `${match[1]!.padStart(4, '0')}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`;
}

function operationScore(text: string, detail: ExecutionCapabilityOperation): number {
  let score = 0;
  for (const keyword of detail.keywords ?? []) {
    if (keyword && text.includes(keyword)) score += 2;
  }
  if (detail.title) {
    for (const token of detail.title.split(/[\s·/]+/)) {
      if (token && token.length >= 2 && text.includes(token)) score += 1;
    }
  }
  return score;
}

function extractFieldValue(text: string, field: { label: string; type?: 'string' | 'date' | 'number' }): string | null {
  const label = escapeRegExp(field.label);
  if (field.type !== 'date' && field.type !== 'number'
    && new RegExp(`${label}\s*(?:清空|置空|删除)`).test(text)) return '';
  const pattern = new RegExp(`${label}\\s*(?:改为|改成|更新为|设为|设成|为|是|：|:)\\s*([^，。；;\\n]+)`, 'i');
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const value = match[1].trim();
  if (field.type === 'date') return normalizeDateValue(value);
  if (field.type === 'number') {
    const number = value.match(/-?\d+(?:\.\d+)?/);
    return number?.[0] ?? null;
  }
  const cleaned = value
    .replace(/^[：:，,。；;\s]+/, '')
    .replace(/[。；;]+$/, '')
    .replace(/^[“"']|[”"']$/g, '')
    .trim();
  return cleaned || null;
}

/** 提供方声明了 operations 元数据时，不依赖模型即可解析；新增命令无需改 Hub 代码。 */
function parseByMetadata(text: string, capabilities: WriteCapabilityDescriptor[]): WriteIntent | null {
  const identifier = extractBusinessIdentifier(text);
  if (!identifier) return null;
  const candidates = capabilities
    .flatMap((capability) => capability.operationDetails.map((detail) => ({
      capability,
      detail,
      score: operationScore(text, detail),
    })))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  if (!candidates.length) return null;
  const top = candidates[0]!;
  const tied = candidates.filter((item) => item.score === top.score
    && (item.detail.name !== top.detail.name || item.capability.capability !== top.capability.capability));
  if (tied.length) {
    return {
      kind: 'clarify',
      message: `这条写命令可能对应多个操作：${[top, ...tied].map((item) => item.detail.title || item.detail.name).join('、')}，请说明要修改哪一项。`,
    };
  }
  const { capability, detail } = top;
  const changes: Record<string, string> = {};
  const missing: string[] = [];
  for (const field of detail.fields) {
    const value = extractFieldValue(text, field);
    if (value === null) {
      if (field.required) missing.push(field.label);
      continue;
    }
    changes[field.name] = value;
  }
  if (missing.length) {
    return { kind: 'clarify', message: `缺少必要信息：${missing.join('、')}。` };
  }
  const targetField = detail.targetField || 'orderNo';
  const changesField = detail.changesField === null ? null : (detail.changesField || 'changes');
  const input: Record<string, unknown> = { operation: detail.name, [targetField]: identifier };
  if (changesField) input[changesField] = changes;
  else Object.assign(input, changes);
  if (capability.inputSchema) {
    const validationError = validateAgainstSchema(input, capability.inputSchema);
    if (validationError) return { kind: 'clarify', message: `写操作参数不完整：${validationError}` };
  }
  return { kind: 'write', systemId: capability.systemId, capability: capability.capability, operation: detail.name, input, raw: text };
}

function buildPrompt(capabilities: WriteCapabilityDescriptor[]): string {
  const lines = [
    '你是 AEOS Hub 的写操作意图解析器。根据用户输入，输出且只输出一个 JSON 对象，必须是以下两种之一：',
    '1. 可执行的写操作：{"kind":"write","systemId":"<系统ID>","capability":"<能力名>","input":{...}}',
    '2. 需要补充信息：{"kind":"clarify","message":"需要用户补充什么"}',
    '',
    '可用写能力：',
  ];
  for (const capability of capabilities) {
    lines.push(`- 系统 ${capability.systemName}（${capability.systemId}）/ 能力 ${capability.capability}`);
    lines.push(`  操作枚举：${capability.operations.join('、') || '无'}`);
    lines.push(`  inputSchema：${JSON.stringify(capability.inputSchema ?? {})}`);
  }
  lines.push(
    '',
    '规则：',
    '- input 必须符合对应能力的 inputSchema，必须包含 operation 和用户原话中的业务标识（如订单号）；不得编造订单号、字段名或字段值。',
    '- 只允许使用列出的操作；操作不确定时返回 clarify。',
    '- 缺少必要信息时返回 clarify，不要猜测。',
    '- 只输出 JSON，不要输出解释、注释或 Markdown 代码块。',
  );
  return lines.join('\n');
}

function extractJson(content: string): unknown {
  const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 用提供方声明的写能力解析自然语言；失败返回 clarify，由调用方回复用户。 */
export async function parseWriteIntentWithLLM(
  text: string,
  capabilities: WriteCapabilityDescriptor[],
  deps: WriteIntentDeps = {},
): Promise<WriteIntent> {
  const raw = String(text || '').trim();
  const confirmation = parseWriteConfirmation(raw);
  if (confirmation) return { kind: confirmation };
  if (!capabilities.length) {
    return { kind: 'clarify', message: '当前没有可用的写能力，提供方尚未注册写操作。' };
  }
  // 优先使用提供方声明的 operations 元数据（确定性、无需模型）；没有匹配时再走模型。
  const byMetadata = parseByMetadata(raw, capabilities);
  if (byMetadata) return byMetadata;
  const { baseUrl, model, apiKey } = deepSeekConfig(deps);
  if (!apiKey) {
    return { kind: 'clarify', message: '写命令解析服务未配置模型密钥，暂时无法解析写操作。' };
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let content = '';
  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: buildPrompt(capabilities) },
          { role: 'user', content: raw },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { kind: 'clarify', message: `写命令解析失败（HTTP ${response.status}），请稍后重试。` };
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    content = typeof data?.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content : '';
  } catch {
    return { kind: 'clarify', message: '写命令解析超时或网络异常，请稍后重试。' };
  } finally {
    clearTimeout(timer);
  }
  const parsed = extractJson(content);
  if (!isRecord(parsed)) {
    return { kind: 'clarify', message: '未能理解这条写命令，请说明订单号、要修改的字段和目标值。' };
  }
  if (parsed.kind === 'clarify') {
    const message = typeof parsed.message === 'string' && parsed.message.trim()
      ? parsed.message.trim()
      : '这条写命令缺少必要信息，请补充订单号和目标值。';
    return { kind: 'clarify', message };
  }
  if (parsed.kind !== 'write') {
    return { kind: 'clarify', message: '未能识别为写操作，请说明要修改的订单和字段。' };
  }
  const systemId = typeof parsed.systemId === 'string' ? parsed.systemId.trim() : '';
  const capabilityName = typeof parsed.capability === 'string' ? parsed.capability.trim() : '';
  const capability = capabilities.find((item) => item.systemId === systemId && item.capability === capabilityName);
  if (!capability) {
    return { kind: 'clarify', message: '解析出的系统或能力不在可用写能力中，请补充说明。' };
  }
  if (!isRecord(parsed.input)) {
    return { kind: 'clarify', message: '写操作缺少 input，请说明要修改的字段和目标值。' };
  }
  const operation = typeof parsed.input.operation === 'string' ? parsed.input.operation.trim() : '';
  if (!operation || !capability.operations.includes(operation)) {
    return { kind: 'clarify', message: `不支持的操作：${operation || '（空）'}。可用操作：${capability.operations.join('、')}。` };
  }
  if (capability.inputSchema) {
    const validationError = validateAgainstSchema(parsed.input, capability.inputSchema);
    if (validationError) {
      return { kind: 'clarify', message: `写操作参数不完整：${validationError}` };
    }
  }
  return {
    kind: 'write',
    systemId,
    capability: capabilityName,
    operation,
    input: parsed.input,
    raw,
  };
}
