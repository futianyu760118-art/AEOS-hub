// 跨系统查询能力模板：把“能力名”翻译成目标 Agent 可执行的只读请求。
// 目标是模板化接入：Hub 不写死 PLM，业务系统也只调用统一的 capability invocation API。
import type { Schema } from './schema-validation.ts';
import { validateAgainstSchema } from './schema-validation.ts';

export interface CapabilityQueryTemplate {
  /** Hub 对外暴露的稳定能力名，例如 query_plm。 */
  capability: string;
  /** 模板契约版本；变更 path/参数语义时必须升级。 */
  version: string;
  title: string;
  description?: string;
  /** 业务域，仅用于目录展示与路由提示。 */
  domain: string;
  /** 提供方系统 ID；必须和执行面登记/系统别名解析一致。 */
  providerSystem: string;
  /** 固定提供方 Agent；Phase 1 精确路由，避免误选同能力多 Agent。 */
  providerAgentId?: string;
  /** 查询模板只允许只读能力。 */
  readOnly: true;
  /** 渲染后发送给执行面 Agent 的只读请求。 */
  requestTemplate: {
    path: string;
    params: Record<string, unknown> | string;
  };
  /** 调用方 params 的校验规则。 */
  parameterSchema: Schema;
  /** 调用方缺省时补齐的参数默认值。 */
  parameterDefaults?: Record<string, unknown>;
  /** 执行面页面/中枢自然语言入口的匹配提示；不参与 Agent dispatch。 */
  intent?: {
    keywords: string[];
    examples?: string[];
    parameterHints?: Record<string, 'identifier' | 'quoted' | 'number'>;
  };
}

export class CapabilityQueryTemplateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'CapabilityQueryTemplateError';
  }
}

const CAPABILITY_PATTERN = /^[a-z][a-z0-9_]*$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

function requireText(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', `${field} 必须是非空字符串`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', `${field} 不能超过 ${max} 字符`);
  return trimmed;
}

function plainObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', `${field} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

/** 解析并校验一个能力模板；禁止非只读或结构不完整的模板进入运行时。 */
export function parseCapabilityQueryTemplate(value: unknown): CapabilityQueryTemplate {
  const raw = plainObject(value, 'template');
  const capability = requireText(raw.capability, 'template.capability', 100);
  if (!CAPABILITY_PATTERN.test(capability)) {
    throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', 'template.capability 只能包含小写字母、数字和下划线');
  }
  const version = requireText(raw.version, 'template.version', 40);
  const title = requireText(raw.title, 'template.title', 200);
  const domain = requireText(raw.domain, 'template.domain', 80);
  const providerSystem = requireText(raw.providerSystem, 'template.providerSystem', 160);
  const providerAgentId = typeof raw.providerAgentId === 'string' && raw.providerAgentId.trim()
    ? requireText(raw.providerAgentId, 'template.providerAgentId', 160)
    : undefined;
  if (raw.readOnly !== true) {
    throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', `${capability} 模板必须声明 readOnly=true`);
  }

  const requestTemplate = plainObject(raw.requestTemplate, `${capability}.requestTemplate`);
  const path = requireText(requestTemplate.path, `${capability}.requestTemplate.path`, 512);
  const pathPlaceholder = path.match(/^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/);
  if (!pathPlaceholder && !path.startsWith('/')) {
    throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', `${capability}.requestTemplate.path 必须以 / 开头，或使用 {{parameter}} 占位符`);
  }
  const rawRequestParams = requestTemplate.params;
  const parameterSchema = plainObject(raw.parameterSchema, `${capability}.parameterSchema`) as unknown as Schema;
  if (validateAgainstSchema({}, parameterSchema) !== null && parameterSchema.type !== 'object') {
    throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', `${capability}.parameterSchema 必须是 object schema`);
  }
  let params: Record<string, unknown> | string;
  if (typeof rawRequestParams === 'string') {
    const paramsPlaceholder = rawRequestParams.match(/^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/);
    if (!paramsPlaceholder || !(paramsPlaceholder[1] in (parameterSchema.properties ?? {}))) {
      throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', `${capability}.requestTemplate.params 必须是对象，或引用已定义的 object 参数`);
    }
    params = rawRequestParams;
  } else {
    params = plainObject(rawRequestParams, `${capability}.requestTemplate.params`);
  }
  if (pathPlaceholder && !(pathPlaceholder[1] in (parameterSchema.properties ?? {}))) {
    throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', `${capability}.requestTemplate.path 引用的参数未定义：${pathPlaceholder[1]}`);
  }
  const parameterDefaults = raw.parameterDefaults === undefined
    ? undefined
    : plainObject(raw.parameterDefaults, `${capability}.parameterDefaults`);
  const intent = (() => {
    if (raw.intent === undefined) return undefined;
    const intentRaw = plainObject(raw.intent, `${capability}.intent`);
    if (!Array.isArray(intentRaw.keywords) || intentRaw.keywords.length === 0) {
      throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', `${capability}.intent.keywords 不能为空`);
    }
    const keywords = intentRaw.keywords.map((keyword) => requireText(keyword, `${capability}.intent.keywords[]`, 80));
    const examples = intentRaw.examples === undefined
      ? undefined
      : (() => {
        if (!Array.isArray(intentRaw.examples)) throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', `${capability}.intent.examples 必须是数组`);
        return intentRaw.examples.map((example) => requireText(example, `${capability}.intent.examples[]`, 300));
      })();
    const parameterHints = intentRaw.parameterHints === undefined
      ? undefined
      : (() => {
        const hints = plainObject(intentRaw.parameterHints, `${capability}.intent.parameterHints`);
        const parsed: Record<string, 'identifier' | 'quoted' | 'number'> = {};
        for (const [name, hint] of Object.entries(hints)) {
          if (hint !== 'identifier' && hint !== 'quoted' && hint !== 'number') {
            throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', `${capability}.intent.parameterHints.${name} 必须是 identifier/quoted/number`);
          }
          parsed[name] = hint;
        }
        return parsed;
      })();
    return { keywords, ...(examples ? { examples } : {}), ...(parameterHints ? { parameterHints } : {}) };
  })();

  const template: CapabilityQueryTemplate = {
    capability,
    version,
    title,
    domain,
    providerSystem,
    readOnly: true,
    requestTemplate: { path, params },
    parameterSchema,
    ...(parameterDefaults ? { parameterDefaults } : {}),
    ...(intent ? { intent } : {}),
    ...(providerAgentId ? { providerAgentId } : {}),
  };
  if (typeof raw.description === 'string' && raw.description.trim()) {
    template.description = raw.description.trim().slice(0, 500);
  }
  return template;
}

export function parseCapabilityQueryTemplates(value: unknown): CapabilityQueryTemplate[] {
  if (!Array.isArray(value)) throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', 'templates 必须是数组');
  const byCapability = new Map<string, CapabilityQueryTemplate>();
  for (const item of value) {
    const template = parseCapabilityQueryTemplate(item);
    if (byCapability.has(template.capability)) {
      throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', `重复的 capability：${template.capability}`);
    }
    byCapability.set(template.capability, template);
  }
  return [...byCapability.values()].sort((left, right) => left.capability.localeCompare(right.capability));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function renderText(text: string, params: Record<string, unknown>, encode: boolean): unknown {
  const exact = text.match(/^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/);
  if (exact) {
    const key = exact[1]!;
    if (!(key in params)) throw new CapabilityQueryTemplateError('TEMPLATE_PLACEHOLDER_MISSING', `模板占位符缺少参数：${key}`);
    return cloneJson(params[key]);
  }
  const rendered = text.replace(PLACEHOLDER_RE, (_match, key: string) => {
    if (!(key in params)) throw new CapabilityQueryTemplateError('TEMPLATE_PLACEHOLDER_MISSING', `模板占位符缺少参数：${key}`);
    const value = params[key]!;
    const textValue = typeof value === 'string' ? value : JSON.stringify(value);
    return encode ? encodeURIComponent(textValue) : textValue;
  });
  return rendered;
}

function renderValue(value: unknown, params: Record<string, unknown>, encode: boolean): unknown {
  if (typeof value === 'string') return renderText(value, params, encode);
  if (Array.isArray(value)) return value.map((item) => renderValue(item, params, encode));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, renderValue(item, params, encode)]),
    );
  }
  return cloneJson(value);
}

/** 校验调用参数、补默认值，并渲染 path/params。 */
export function renderCapabilityQuery(
  template: CapabilityQueryTemplate,
  rawParams: unknown,
): { path: string; params: Record<string, unknown> } {
  if (rawParams === undefined || rawParams === null) rawParams = {};
  if (!rawParams || typeof rawParams !== 'object' || Array.isArray(rawParams)) {
    throw new CapabilityQueryTemplateError('INVALID_ARGUMENT', 'params 必须是 JSON 对象');
  }
  const input = { ...(rawParams as Record<string, unknown>) };
  const schema = template.parameterSchema;
  const allowedKeys = new Set(Object.keys(schema.properties ?? {}));
  const unknownKeys = Object.keys(input).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) {
    throw new CapabilityQueryTemplateError('INVALID_ARGUMENT', `不支持的参数：${unknownKeys.join(', ')}`);
  }
  for (const [key, value] of Object.entries(template.parameterDefaults ?? {})) {
    if (input[key] === undefined) input[key] = cloneJson(value);
  }
  const issue = validateAgainstSchema(input, schema);
  if (issue) throw new CapabilityQueryTemplateError('INVALID_ARGUMENT', issue);

  const pathValue = renderText(template.requestTemplate.path, input, true);
  if (typeof pathValue !== 'string' || !pathValue.startsWith('/')) {
    throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', '渲染后的 path 无效');
  }
  const paramsValue = renderValue(template.requestTemplate.params, input, false);
  if (!paramsValue || typeof paramsValue !== 'object' || Array.isArray(paramsValue)) {
    throw new CapabilityQueryTemplateError('INVALID_TEMPLATE', '渲染后的 params 必须是对象');
  }
  return { path: pathValue, params: paramsValue as Record<string, unknown> };
}

/** 校验调用方传入的 requestId；不传时由调用方生成。 */
export function validateInvocationRequestId(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || !REQUEST_ID_PATTERN.test(text)) {
    throw new CapabilityQueryTemplateError(
      'INVALID_ARGUMENT',
      'requestId 只能包含字母、数字、点、下划线、冒号和连字符，长度 1-160',
    );
  }
  return text;
}
