import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  buildCancelUrl,
  createReasoningAdapter,
  normalizeReasoningResult,
  normalizeUpstreamUsage,
  signReasoningRequest,
} from '../src/adapters/reasoning-adapter.js';

const ANALYZE_PATH = '/api/v1/external/reasoning/analyze';

async function startServer(handler, t, path = ANALYZE_PATH) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  }));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}${path}` };
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

function envelope(data) {
  return JSON.stringify({ code: 0, message: 'success', data });
}

test('HMAC 三头、task_id、信封解包、usage 与 llm 元信息', async (t) => {
  let received;
  const { url } = await startServer(async (req, res) => {
    received = { url: req.url, headers: req.headers, body: JSON.parse(await readBody(req)) };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(envelope({
      task_id: 'exec-run-1',
      status: 'succeeded',
      summary: '存在缺料导致的延期风险',
      conclusions: [{
        matter: '关键物料尚未齐套',
        evidence_refs: ['control-platform://kitting/result/HJY20260903-261:1'],
        risk: '预计影响交付 3 天',
        recommendation: '建议采购负责人核实，需人工确认',
        confidence: 'high',
      }],
      evidence_refs: ['control-platform://order/HJY20260903-261/line/1'],
      data_as_of: '2026-10-26T14:30:00+08:00',
      data_confidence: 'high',
      warnings: [],
      llm: { called: true, provider: 'openai', model: 'deepseek-flash', latency_ms: 4_200 },
      usage: { modelId: 'deepseek-flash', tokensIn: 1_234, cachedTokens: 0, tokensOut: 456 },
      duration_ms: 5_300,
      idempotent_replay: false,
      request_id: 'req-abc',
    }));
  }, t);

  const reason = createReasoningAdapter({
    url,
    appKey: 'key',
    appSecret: 'secret',
    agentId: 'runtime-control-platform-reasoning',
    timeoutMs: 1_000,
  });
  const calls = [];
  let meta = null;
  const returned = await reason({
    prompt: '分析订单 HJY20260903-261 的交付风险',
    task_type: 'order_delivery_analysis',
    context: { businessObjectRef: 'business://order/HJY20260903-261' },
    constraints: { read_only: true, require_evidence: true },
    request_id: 'req-abc',
  }, {
    runId: 'exec-run-1',
    sendComplete: (result, usage) => calls.push({ result, usage }),
    onUpstreamMeta: (value) => { meta = value; },
  });

  assert.equal(returned, undefined);
  assert.equal(received.headers['x-app-key'], 'key');
  assert.equal(typeof received.headers['x-timestamp'], 'string');
  assert.ok(Number.isInteger(Number(received.headers['x-timestamp'])));
  assert.equal(
    received.headers['x-signature'],
    signReasoningRequest('secret', Number(received.headers['x-timestamp']), 'key', 'reasoning.analyze'),
  );
  assert.equal(received.headers.authorization, undefined);
  assert.equal(received.body.task_id, 'exec-run-1');
  assert.equal(received.body.request_id, 'req-abc');
  assert.equal(received.body.model, undefined);
  assert.equal(received.body.reasoning_effort, undefined);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].result.conclusions[0].evidence_refs[0], 'control-platform://kitting/result/HJY20260903-261:1');
  assert.deepEqual(calls[0].usage, {
    modelId: 'deepseek-flash',
    tokensIn: 1_234,
    cachedTokens: 0,
    tokensOut: 456,
    cost: 0,
  });
  assert.equal(meta.llm_called, true);
  assert.equal(meta.llm_model, 'deepseek-flash');
  assert.equal(meta.duration_ms, 5_300);
  assert.equal(meta.task_id, 'exec-run-1');
});

test('裸结果（无信封）仍可处理', async (t) => {
  const { url } = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      summary: '结论',
      conclusions: [{ matter: '事项', evidence_refs: ['control-platform://x/1'], confidence: 'high' }],
      data_as_of: '2026-10-26T08:00:00+08:00',
      data_confidence: 'high',
    }));
  }, t);
  const reason = createReasoningAdapter({ url, timeoutMs: 1_000 });
  const result = await reason({ prompt: 'x', task_type: 'order_delivery_analysis' }, {});
  assert.equal(result.data_confidence, 'high');
  assert.equal(result.conclusions.length, 1);
});

test('缺少 evidence_refs 时降为低置信度并给出校验提示', () => {
  const result = normalizeReasoningResult({
    summary: '结论',
    conclusions: [{ matter: '无证据结论', risk: '未知' }],
    data_as_of: '2026-10-26T08:00:00+08:00',
    data_confidence: 'high',
  });
  assert.equal(result.data_confidence, 'low');
  assert.ok(result.validation_warnings.some((warning) => warning.includes('evidence_refs')));
});

test('结论被证据校验全部剔除时返回空结论并明确不代表无风险', () => {
  const result = normalizeReasoningResult({
    code: 0,
    message: 'success',
    data: {
      summary: '全部结论未通过证据校验',
      conclusions: [],
      dropped_conclusions: 2,
      warnings: ['EVIDENCE_FILTERED'],
      data_as_of: '2026-10-26T08:00:00+08:00',
      data_confidence: 'high',
    },
  });
  assert.equal(result.conclusions.length, 0);
  assert.equal(result.data_confidence, 'low');
  assert.ok(result.validation_warnings.some((warning) => warning.includes('EVIDENCE_FILTERED')));
  assert.ok(result.validation_warnings.some((warning) => warning.includes('被证据校验剔除 2 条')));
  assert.ok(result.validation_warnings.some((warning) => warning.includes('不代表无风险')));
});

test('信封错误码映射为明确错误', async (t) => {
  const cases = [
    { code: 503, message: '未配置真实大模型', expected: 'UPSTREAM_UNAVAILABLE' },
    { code: 404, message: '无可用证据，不代表无风险', expected: 'NOT_FOUND' },
    { code: 490, message: '任务被取消', expected: 'TASK_CANCELLED' },
    { code: 409, message: '任务运行中', expected: 'TASK_IN_PROGRESS' },
  ];
  for (const item of cases) {
    const { url } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: item.code, message: item.message, data: null }));
    }, t);
    const reason = createReasoningAdapter({ url, timeoutMs: 1_000 });
    await assert.rejects(
      () => reason({ prompt: 'x', task_type: 'order_delivery_analysis' }, {}),
      (error) => error.code === item.expected && error.message.includes(String(item.code)),
    );
  }
});

test('HTTP 错误映射：403 → FORBIDDEN，429 → RATE_LIMITED 带 Retry-After', async (t) => {
  const forbidden = await startServer((_req, res) => {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('signature invalid');
  }, t);
  await assert.rejects(
    () => createReasoningAdapter({ url: forbidden.url, timeoutMs: 1_000 })({ prompt: 'x', task_type: 'order_delivery_analysis' }, {}),
    (error) => error.code === 'FORBIDDEN' && /HTTP 403/.test(error.message),
  );

  const limited = await startServer((_req, res) => {
    res.writeHead(429, { 'content-type': 'text/plain', 'retry-after': '7' });
    res.end('too many requests');
  }, t);
  await assert.rejects(
    () => createReasoningAdapter({ url: limited.url, timeoutMs: 1_000 })({ prompt: 'x', task_type: 'order_delivery_analysis' }, {}),
    (error) => error.code === 'RATE_LIMITED' && error.retryAfterSec === 7,
  );
});

test('超时中止推理请求并调用中台 cancel', { timeout: 5_000 }, async (t) => {
  let cancelRequest = null;
  let resolveCancel;
  const cancelSeen = new Promise((resolve) => { resolveCancel = resolve; });
  const { url } = await startServer((req, res) => {
    if (req.url.endsWith('/cancel')) {
      cancelRequest = { url: req.url, headers: req.headers };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(envelope({ status: 'cancelling' }));
      resolveCancel();
      return;
    }
    /* analyze 不返回，触发超时 */
  }, t);

  const reason = createReasoningAdapter({ url, appKey: 'key', appSecret: 'secret', timeoutMs: 30 });
  await assert.rejects(
    () => reason({ prompt: 'x', task_type: 'order_delivery_analysis' }, { runId: 'exec-run-9' }),
    (error) => error.code === 'REASONING_ABORTED',
  );
  await cancelSeen;
  assert.match(cancelRequest.url, /\/tasks\/exec-run-9\/cancel$/);
  assert.equal(cancelRequest.headers['x-signature'], signReasoningRequest('secret', Number(cancelRequest.headers['x-timestamp']), 'key', 'reasoning.cancel'));
});

test('调用方 AbortSignal 会中止推理并调用中台 cancel', { timeout: 5_000 }, async (t) => {
  let cancelled = false;
  const { url } = await startServer((req, res) => {
    if (req.url.endsWith('/cancel')) {
      cancelled = true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(envelope({ status: 'cancelling' }));
      return;
    }
    /* analyze 不返回 */
  }, t);

  const reason = createReasoningAdapter({ url, timeoutMs: 1_000 });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(
    () => reason({ prompt: 'x', task_type: 'order_delivery_analysis' }, { runId: 'exec-run-10', signal: controller.signal }),
    (error) => error.code === 'REASONING_ABORTED',
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(cancelled, true);
});

test('未配置 URL 返回未接通且不伪造', async () => {
  const reason = createReasoningAdapter({});
  const result = await reason({ prompt: 'x', task_type: 'order_delivery_analysis' }, {});
  assert.match(result.summary, /未接通/);
  assert.equal(result.data_confidence, 'low');
  assert.ok(result.conclusions[0].evidence_refs.length > 0);
});

test('usage 嵌在信封 data 内也能提取', () => {
  const usage = normalizeUpstreamUsage({
    code: 0,
    message: 'success',
    data: {
      conclusions: [],
      usage: { modelId: 'deepseek-flash', tokensIn: 12, tokensOut: 3, cost: 0.004 },
    },
  });
  assert.deepEqual(usage, {
    modelId: 'deepseek-flash',
    tokensIn: 12,
    cachedTokens: 0,
    tokensOut: 3,
    cost: 0.004,
  });
});

test('cancel 地址由 analyze 地址推导，签名向量稳定', () => {
  assert.equal(
    buildCancelUrl('https://host:18085/api/v1/external/reasoning/analyze', 'exec-run-1'),
    'https://host:18085/api/v1/external/reasoning/tasks/exec-run-1/cancel',
  );
  assert.equal(buildCancelUrl('https://host/other/path', 'exec-run-1'), null);
  assert.equal(
    signReasoningRequest('secret', 1_700_000_000, 'key', 'reasoning.analyze'),
    'bfbacc76ec4038b21e31a1ed5d068491594c4ebbb70b69a6ae5b2936355a04b6',
  );
});
