// 通用能力模板的自然语言匹配与参数提取。
// 页面不认识任何具体系统的私有参数；只读取模板里的 intent.keywords / parameterHints。

const IDENTIFIER_RE = /\b[A-Za-z0-9]+(?:[.:_-][A-Za-z0-9]+)+\b/;
const QUOTED_RE = /[“"]([^”"]+)[”"]/;
const NUMBER_RE = /\b(\d+)\b/;

function normalizeText(value) {
  return String(value ?? '').toLowerCase();
}

export function matchCapabilityTemplate(text, templates) {
  const query = normalizeText(text);
  if (!query || !Array.isArray(templates)) return null;
  let best = null;
  let bestScore = 0;
  for (const template of templates) {
    const keywords = Array.isArray(template?.intent?.keywords) ? template.intent.keywords : [];
    const score = keywords.filter((keyword) => keyword && query.includes(normalizeText(keyword))).length;
    if (score > bestScore) {
      best = template;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function extractHint(text, hint) {
  if (hint === 'identifier') return text.match(IDENTIFIER_RE)?.[0] ?? '';
  if (hint === 'quoted') return text.match(QUOTED_RE)?.[1]?.trim() ?? '';
  if (hint === 'number') {
    const raw = text.match(NUMBER_RE)?.[1];
    return raw === undefined ? undefined : Number(raw);
  }
  return undefined;
}

export function buildCapabilityParams(text, template) {
  if (!template || !template.parameterSchema) return null;
  const schema = template.parameterSchema;
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const hints = template.intent?.parameterHints && typeof template.intent.parameterHints === 'object'
    ? template.intent.parameterHints
    : {};
  const params = { ...(template.parameterDefaults && typeof template.parameterDefaults === 'object' ? template.parameterDefaults : {}) };

  for (const name of Object.keys(properties)) {
    const hint = hints[name] ?? (name === 'keyword' ? 'identifier' : undefined);
    if (!hint) continue;
    const value = extractHint(String(text ?? ''), hint);
    if (value !== undefined && value !== '') params[name] = value;
  }

  for (const name of required) {
    if (params[name] === undefined || params[name] === null || params[name] === '') return null;
  }
  return params;
}

function present(value) {
  return value !== undefined && value !== null && value !== '';
}

function displayValue(value) {
  if (typeof value === 'number') return value.toLocaleString('zh-CN');
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

/** 把能力调用结果转成页面可读摘要；字段由模板 display 控制。 */
export function summarizeCapabilityResult(result, template) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return '查询完成，但没有返回结构化结果。';
  }
  const display = template?.display && typeof template.display === 'object' ? template.display : {};
  const labels = display.labels && typeof display.labels === 'object' ? display.labels : {};
  const items = Array.isArray(result.items) ? result.items : [];
  const total = present(result.total) ? result.total : items.length;
  const meta = [
    present(result.data_as_of) ? `${labels.data_as_of || '数据时间'}：${result.data_as_of}` : '',
    present(result.data_confidence) ? `${labels.data_confidence || '数据置信度'}：${result.data_confidence}` : '',
    present(result.stale) ? `${labels.stale || '是否过期'}：${displayValue(result.stale)}` : '',
  ].filter(Boolean);

  if (!items.length) {
    return [`查询完成：共 ${displayValue(total)} 条，没有查到相关记录。`, ...meta].join('\n');
  }

  const titleKeys = Array.isArray(display.title) && display.title.length
    ? display.title
    : ['name', 'projectName', 'order_no', 'material_name'];
  const first = items[0] && typeof items[0] === 'object' ? items[0] : {};
  const fieldKeys = Array.isArray(display.fields) && display.fields.length
    ? display.fields
    : Object.keys(first).slice(0, 6);
  const lines = items.slice(0, 12).map((item, index) => {
    const title = titleKeys.map((key) => item?.[key]).find(present) || `记录 ${index + 1}`;
    const details = fieldKeys
      .filter((key) => present(item?.[key]))
      .map((key) => `${labels[key] || key}：${displayValue(item[key])}`)
      .join('；');
    return `${index + 1}. ${title}${details ? `\n   ${details}` : ''}`;
  });
  const more = items.length > 12 ? `\n本页还有 ${items.length - 12} 条未展开。` : '';
  return [`查询完成：共 ${displayValue(total)} 条`, ...lines, ...(more ? [more] : []), ...meta].join('\n');
}

