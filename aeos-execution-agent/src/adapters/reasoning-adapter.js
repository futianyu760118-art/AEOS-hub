// 中台推理适配器：未配置 URL 时保持“未接通”占位；配置后按期望契约调用真实 HTTP 接口。
// 契约见 docs/control-platform-reasoning-integration.md：
//   input  = { prompt, task_type, context, constraints }
//   output = { summary, conclusions:[{ matter, evidence_refs, risk, recommendation, confidence }], data_as_of, data_confidence }
// 硬性要求：结论必须有 evidence_refs；缺失时标低置信度，不伪造。
const DEFAULT_MODEL = 'deepseek-flash';
const DEFAULT_EFFORT = 'high';
const DEFAULT_TIMEOUT_MS = 180_000;

function errorWithCode(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function notConnectedResult() {
  return {
    summary: '推理能力尚未接通中台大模型（占位实现）。',
    conclusions: [{
      matter: '中台推理接口未接通',
      evidence_refs: ['control-platform://reasoning/not-connected'],
      risk: '无法给出真实分析结论',
      recommendation: '请向中台确认推理接口契约（地址/鉴权/参数/返回/错误码/evidence 规则等）并接入后重试',
      confidence: 'low',
    }],
    data_as_of: new Date().toISOString(),
    data_confidence: 'low',
  };
}

function normalizeConfidence(value, fallback) {
  return value === 'high' || value === 'medium' || value === 'low' ? value : fallback;
}

const TOKEN_ALIASES = {
  tokensIn: ['tokensIn', 'input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens'],
  cachedTokens: ['cachedTokens', 'cached_tokens', 'prompt_cache_hit_tokens', 'cache_hit_tokens'],
  tokensOut: ['tokensOut', 'output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens'],
  cost: ['cost', 'costCny', 'total_cost', 'totalCost'],
};

function pickNumber(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function pickString(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 160);
  }
  return null;
}

/**
 * 从上游返回里提取用量（可选能力）：支持 usage 嵌在顶层或 result 内，
 * 字段兼容 Hub run_complete.usage 的命名与常见模型 API 的命名。
 * 没有可用字段时返回 null，不伪造 0 成本。
 */
export function normalizeUpstreamUsage(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const payload = body.result && typeof body.result === 'object' && !Array.isArray(body.result)
    ? body.result
    : body;
  const sources = [body.usage, payload.usage, body, payload]
    .filter((source) => source && typeof source === 'object' && !Array.isArray(source));
  if (!sources.length) return null;
  const pick = (keys) => {
    for (const source of sources) {
      const value = pickNumber(source, keys);
      if (value !== null) return value;
    }
    return null;
  };
  const modelId = sources
    .map((source) => pickString(source, ['modelId', 'model']))
    .find(Boolean) ?? null;
  const tokensIn = pick(TOKEN_ALIASES.tokensIn) ?? 0;
  const cachedTokens = pick(TOKEN_ALIASES.cachedTokens) ?? 0;
  const tokensOut = pick(TOKEN_ALIASES.tokensOut) ?? 0;
  const cost = pick(TOKEN_ALIASES.cost) ?? 0;
  if (!modelId && tokensIn === 0 && cachedTokens === 0 && tokensOut === 0 && cost === 0) return null;
  return { modelId, tokensIn, cachedTokens, tokensOut, cost };
}

/** 把中台返回归一化为 Hub 期望的结论结构；缺证据/缺时间一律降为低置信度。 */
export function normalizeReasoningResult(body) {
  const payload = body && typeof body === 'object' && body.result && typeof body.result === 'object'
    ? body.result
    : body;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw errorWithCode('INVALID_RESULT', '推理接口返回不是 JSON 对象');
  }
  const conclusions = Array.isArray(payload.conclusions) ? payload.conclusions : [];
  if (!conclusions.length) throw errorWithCode('INVALID_RESULT', '推理结果缺少 conclusions');

  const warnings = [];
  const normalized = conclusions.map((item, index) => {
    const source = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
    const matter = typeof source.matter === 'string' && source.matter.trim()
      ? source.matter.trim()
      : `结论 ${index + 1}`;
    const evidenceRefs = Array.isArray(source.evidence_refs)
      ? source.evidence_refs
        .filter((ref) => typeof ref === 'string' && ref.trim())
        .map((ref) => ref.trim())
      : [];
    if (!evidenceRefs.length) warnings.push(`结论「${matter}」缺少 evidence_refs`);
    return {
      matter,
      evidence_refs: evidenceRefs,
      risk: typeof source.risk === 'string' ? source.risk : '',
      recommendation: typeof source.recommendation === 'string' ? source.recommendation : '',
      confidence: normalizeConfidence(source.confidence, evidenceRefs.length ? 'medium' : 'low'),
    };
  });

  const summary = typeof payload.summary === 'string' && payload.summary.trim()
    ? payload.summary.trim()
    : normalized[0].matter;
  const dataAsOf = typeof payload.data_as_of === 'string' && payload.data_as_of.trim()
    ? payload.data_as_of.trim()
    : null;
  if (!dataAsOf) warnings.push('缺少 data_as_of');
  if (summary === normalized[0].matter && !payload.summary) warnings.push('缺少 summary');

  const claimedConfidence = normalizeConfidence(payload.data_confidence, warnings.length ? 'low' : 'medium');
  const dataConfidence = warnings.length ? 'low' : claimedConfidence;
  const result = {
    summary,
    conclusions: normalized,
    data_as_of: dataAsOf,
    data_confidence: dataConfidence,
  };
  if (warnings.length) result.validation_warnings = warnings;
  return result;
}

export function createReasoningAdapter(config = {}) {
  const url = (config.url || '').trim();
  if (!url) {
    return async function reason() {
      return notConnectedResult();
    };
  }

  const model = (config.model || DEFAULT_MODEL).trim();
  const reasoningEffort = (config.reasoningEffort || DEFAULT_EFFORT).trim();
  const timeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  if (config.agentId) headers['x-aeos-reasoning-agent-id'] = config.agentId;

  return async function reason(request, ctx) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = () => controller.abort();
    if (ctx?.signal) {
      if (ctx.signal.aborted) controller.abort();
      else ctx.signal.addEventListener('abort', abortFromCaller, { once: true });
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: request.prompt,
          task_type: request.task_type,
          context: request.context ?? {},
          constraints: request.constraints ?? { read_only: true, require_evidence: true },
          model,
          reasoning_effort: reasoningEffort,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const code = response.status === 401 || response.status === 403
          ? 'UPSTREAM_AUTH_FAILED'
          : response.status >= 500
            ? 'UPSTREAM_UNAVAILABLE'
            : 'UPSTREAM_ERROR';
        throw errorWithCode(code, `推理接口返回 HTTP ${response.status}: ${detail.slice(0, 200)}`);
      }
      const body = await response.json();
      const result = normalizeReasoningResult(body);
      // 上游带用量时随 run_complete 一并回传（Hub 会记入用量台账并按模型目录补算成本）；
      // 没带就保持普通返回，行为与之前一致。
      const usage = normalizeUpstreamUsage(body);
      if (usage && typeof ctx?.sendComplete === 'function') {
        ctx.sendComplete(result, usage);
        return undefined;
      }
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw errorWithCode('REASONING_ABORTED', '推理请求已中止或超时');
      if (error && typeof error === 'object' && error.code) throw error;
      throw errorWithCode('UPSTREAM_ERROR', error?.message || String(error));
    } finally {
      clearTimeout(timer);
      ctx?.signal?.removeEventListener?.('abort', abortFromCaller);
    }
  };
}
