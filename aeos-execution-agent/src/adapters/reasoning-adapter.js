// 中台推理适配器（reasoning.analyze）。
//
// 契约为 2026-10-26 中台回复版：
//   POST {TARGET_REASONING_URL}
//   Header: X-App-Key / X-Timestamp / X-Signature（HMAC-SHA256），不接受 Bearer
//   Body:   { prompt, task_type, context, constraints, task_id(=runId), request_id }
//   返回:   { code, message, data }，code=0 时 data 即 run_complete.result
//   召回:   除 Abort 本地请求外，还需调用 POST {BASE}/tasks/{task_id}/cancel
//
// 兼容：未配置 URL 时返回“未接通”占位；上游直接返回裸结果（无信封）时按旧契约处理。
import { createHmac } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 180_000;
const CANCEL_TIMEOUT_MS = 5_000;
const ANALYZE_ENDPOINT = 'reasoning.analyze';
const CANCEL_ENDPOINT = 'reasoning.cancel';

const HTTP_ERROR_CODES = {
  400: 'INVALID_ARGUMENT',
  401: 'UPSTREAM_AUTH_FAILED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'TASK_IN_PROGRESS',
  422: 'INVALID_ARGUMENT',
  429: 'RATE_LIMITED',
};

const ENVELOPE_ERROR_CODES = {
  400: 'INVALID_ARGUMENT',
  401: 'UPSTREAM_AUTH_FAILED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'TASK_IN_PROGRESS',
  490: 'TASK_CANCELLED',
  500: 'INTERNAL_ERROR',
  503: 'UPSTREAM_UNAVAILABLE',
  504: 'UPSTREAM_TIMEOUT',
};

function errorWithCode(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
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

/** 中台 HMAC 签名：hex(HMAC-SHA256(app_secret, timestamp + app_key + endpoint_code + query_string))。 */
export function signReasoningRequest(appSecret, timestamp, appKey, endpointCode, queryString = '') {
  return createHmac('sha256', appSecret)
    .update(`${timestamp}${appKey}${endpointCode}${queryString}`)
    .digest('hex');
}

function buildRequestHeaders(config, endpointCode) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (config.appKey && config.appSecret) {
    const timestamp = Math.floor(Date.now() / 1000);
    headers['X-App-Key'] = config.appKey;
    headers['X-Timestamp'] = String(timestamp);
    headers['X-Signature'] = signReasoningRequest(config.appSecret, timestamp, config.appKey, endpointCode);
  } else if (config.token) {
    // 兼容非中台上游或联调 mock；中台正式环境不接受 Bearer。
    headers.authorization = `Bearer ${config.token}`;
  }
  if (config.agentId) headers['x-aeos-reasoning-agent-id'] = config.agentId;
  return headers;
}

/** 由 analyze 地址推导 cancel 地址；地址不符合中台形态时返回 null。 */
export function buildCancelUrl(analyzeUrl, taskId) {
  const trimmed = String(analyzeUrl ?? '').trim().replace(/\/+$/, '');
  const suffix = '/analyze';
  if (!trimmed.endsWith(suffix)) return null;
  return `${trimmed.slice(0, -suffix.length)}/tasks/${encodeURIComponent(taskId)}/cancel`;
}

function readEnvelope(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (!('code' in body) || !('data' in body)) return null;
  const code = Number(body.code);
  if (!Number.isFinite(code)) return null;
  return { code, message: typeof body.message === 'string' ? body.message : '', data: body.data };
}

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.trunc(seconds);
  const at = Date.parse(value);
  if (Number.isFinite(at)) return Math.max(0, Math.trunc((at - Date.now()) / 1000));
  return null;
}

function buildRequestBody(request, taskId) {
  const body = {
    prompt: request.prompt,
    task_type: request.task_type,
    context: request.context ?? {},
    constraints: request.constraints ?? { read_only: true, require_evidence: true },
  };
  if (taskId) body.task_id = taskId;
  if (typeof request.request_id === 'string' && request.request_id.trim()) body.request_id = request.request_id.trim();
  return body;
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
 * 从上游返回里提取用量（可选能力）：支持 usage 嵌在信封 data、result 或顶层，
 * 字段兼容 Hub run_complete.usage 的命名与常见模型 API 的命名。
 * 没有可用字段时返回 null，不伪造 0 成本。
 */
export function normalizeUpstreamUsage(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const payload = body.data && typeof body.data === 'object' && !Array.isArray(body.data)
    ? body.data
    : body.result && typeof body.result === 'object' && !Array.isArray(body.result)
      ? body.result
      : body;
  const sources = [payload.usage, body.usage, payload]
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

/**
 * 把中台返回归一化为 Hub 期望的结论结构。
 * - 缺证据/缺时间的结论降为低置信度并附 validation_warnings；
 * - conclusions 为空（全部被证据校验剔除）时返回空结论 + 低置信度，明确“不代表无风险”，不抛错。
 */
export function normalizeReasoningResult(body) {
  const payload = body && typeof body === 'object' && body.data && typeof body.data === 'object' && !Array.isArray(body.data)
    ? body.data
    : body && typeof body === 'object' && body.result && typeof body.result === 'object' && !Array.isArray(body.result)
      ? body.result
      : body;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw errorWithCode('INVALID_RESULT', '推理接口返回不是 JSON 对象');
  }

  const warnings = [];
  if (Array.isArray(payload.warnings)) {
    warnings.push(...payload.warnings.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()));
  }

  const rawConclusions = Array.isArray(payload.conclusions) ? payload.conclusions : [];
  const normalized = rawConclusions.map((item, index) => {
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

  const dataAsOf = typeof payload.data_as_of === 'string' && payload.data_as_of.trim()
    ? payload.data_as_of.trim()
    : null;
  if (!dataAsOf) warnings.push('缺少 data_as_of');

  let summary;
  if (typeof payload.summary === 'string' && payload.summary.trim()) {
    summary = payload.summary.trim();
  } else if (normalized.length) {
    summary = normalized[0].matter;
    warnings.push('缺少 summary');
  } else {
    summary = '中台未返回有效结论，不代表无风险';
  }

  if (!normalized.length) {
    const dropped = Number.isInteger(payload.dropped_conclusions) && payload.dropped_conclusions > 0
      ? `（被证据校验剔除 ${payload.dropped_conclusions} 条）`
      : '';
    warnings.push(`中台未返回有效结论${dropped}，不代表无风险`);
  }

  const claimedConfidence = normalizeConfidence(payload.data_confidence, warnings.length ? 'low' : 'medium');
  const dataConfidence = warnings.length || !normalized.length ? 'low' : claimedConfidence;
  const result = {
    summary,
    conclusions: normalized,
    data_as_of: dataAsOf,
    data_confidence: dataConfidence,
  };
  if (warnings.length) result.validation_warnings = warnings;
  return result;
}

function upstreamMeta(envelope, payload) {
  if (!envelope && (!payload || typeof payload !== 'object')) return null;
  const source = payload && typeof payload === 'object' ? payload : {};
  const llm = source.llm && typeof source.llm === 'object' ? source.llm : null;
  return {
    task_id: source.task_id ?? null,
    status: source.status ?? null,
    llm_called: llm ? llm.called === true : null,
    llm_model: llm && typeof llm.model === 'string' ? llm.model : null,
    llm_provider: llm && typeof llm.provider === 'string' ? llm.provider : null,
    llm_latency_ms: llm && Number.isFinite(llm.latency_ms) ? llm.latency_ms : null,
    duration_ms: Number.isFinite(source.duration_ms) ? source.duration_ms : null,
    idempotent_replay: source.idempotent_replay === true,
    stale: source.stale === true,
    dropped_conclusions: Number.isInteger(source.dropped_conclusions) ? source.dropped_conclusions : null,
    request_id: source.request_id ?? null,
  };
}

export function createReasoningAdapter(config = {}) {
  const url = (config.url || '').trim();
  if (!url) {
    return async function reason() {
      return notConnectedResult();
    };
  }

  const timeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : DEFAULT_TIMEOUT_MS;

  return async function reason(request, ctx) {
    const taskId = typeof ctx?.runId === 'string' && ctx.runId.trim() ? ctx.runId.trim() : null;
    const cancelUrl = taskId ? buildCancelUrl(url, taskId) : null;
    const controller = new AbortController();
    let cancelSent = false;

    // 召回/超时时除断开本地请求外，还要通知中台取消服务端任务。
    const cancelUpstream = () => {
      if (cancelSent || !cancelUrl) return;
      cancelSent = true;
      fetch(cancelUrl, {
        method: 'POST',
        headers: buildRequestHeaders(config, CANCEL_ENDPOINT),
        body: '{}',
        signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
      }).catch(() => { /* 取消是尽力而为，不覆盖主流程结果 */ });
    };

    const timer = setTimeout(() => {
      controller.abort();
      cancelUpstream();
    }, timeoutMs);
    const abortFromCaller = () => {
      controller.abort();
      cancelUpstream();
    };
    if (ctx?.signal) {
      if (ctx.signal.aborted) abortFromCaller();
      else ctx.signal.addEventListener('abort', abortFromCaller, { once: true });
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: buildRequestHeaders(config, ANALYZE_ENDPOINT),
        body: JSON.stringify(buildRequestBody(request, taskId)),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const code = HTTP_ERROR_CODES[response.status]
          ?? (response.status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'UPSTREAM_ERROR');
        throw errorWithCode(code, `推理接口返回 HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`, {
          status: response.status,
          retryAfterSec: parseRetryAfter(response.headers.get('retry-after')),
        });
      }

      let body;
      try {
        body = await response.json();
      } catch {
        throw errorWithCode('UPSTREAM_ERROR', '推理接口返回不是 JSON');
      }

      const envelope = readEnvelope(body);
      if (envelope && envelope.code !== 0) {
        const code = ENVELOPE_ERROR_CODES[envelope.code] ?? 'UPSTREAM_ERROR';
        throw errorWithCode(code, `中台推理错误 ${envelope.code}: ${envelope.message || '未知错误'}`, {
          envelopeCode: envelope.code,
        });
      }

      const payload = envelope ? envelope.data : body;
      const result = normalizeReasoningResult(payload);
      const usage = normalizeUpstreamUsage(body);
      const meta = upstreamMeta(envelope, payload);
      if (meta) ctx?.onUpstreamMeta?.(meta);

      // 上游带用量时随 run_complete 一并回传（Hub 记入用量台账、缺成本时按模型目录补算）。
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
