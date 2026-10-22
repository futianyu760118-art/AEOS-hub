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
