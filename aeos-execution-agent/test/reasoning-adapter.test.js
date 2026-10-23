import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createReasoningAdapter, normalizeReasoningResult } from '../src/adapters/reasoning-adapter.js';

async function startServer(handler, t) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  }));
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/reason` };
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

test('推理适配器按契约调用并归一化结果', async (t) => {
  let received;
  const { url } = await startServer(async (req, res) => {
    received = JSON.parse(await readBody(req));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      summary: '存在缺料风险',
      conclusions: [{
        matter: '关键物料未齐套',
        evidence_refs: ['control-platform://kitting/1'],
        risk: '预计延期 3 天',
        recommendation: '请采购负责人核实到货承诺，需人工确认',
        confidence: 'high',
      }],
      data_as_of: '2026-10-23T08:00:00+08:00',
      data_confidence: 'high',
    }));
  }, t);

  const reason = createReasoningAdapter({
    url,
    token: 'test-token',
    agentId: 'agent-1',
    model: 'deepseek-flash',
    reasoningEffort: 'high',
    timeoutMs: 1_000,
  });
  const result = await reason({
    prompt: '分析订单 HJY20260903-261 的交付风险',
    task_type: 'order_delivery_analysis',
    context: { businessObjectRef: 'business://order/HJY20260903-261' },
    constraints: { read_only: true, require_evidence: true },
  }, {});

  assert.equal(received.model, 'deepseek-flash');
  assert.equal(received.reasoning_effort, 'high');
  assert.equal(received.task_type, 'order_delivery_analysis');
  assert.equal(received.constraints.require_evidence, true);
  assert.equal(result.data_confidence, 'high');
  assert.equal(result.conclusions[0].evidence_refs[0], 'control-platform://kitting/1');
  assert.equal(result.validation_warnings, undefined);
});

test('缺少 evidence_refs 时降为低置信度并给出校验提示', () => {
  const result = normalizeReasoningResult({
    summary: '结论',
    conclusions: [{ matter: '无证据结论', risk: '未知' }],
    data_as_of: '2026-10-23T08:00:00+08:00',
    data_confidence: 'high',
  });
  assert.equal(result.data_confidence, 'low');
  assert.ok(result.validation_warnings.some((warning) => warning.includes('evidence_refs')));
});

test('推理接口 5xx 返回 UPSTREAM_UNAVAILABLE', async (t) => {
  const { url } = await startServer((_req, res) => {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('upstream boom');
  }, t);
  const reason = createReasoningAdapter({ url, timeoutMs: 1_000 });
  await assert.rejects(
    () => reason({ prompt: 'x', task_type: 'order_delivery_analysis' }, {}),
    (error) => error.code === 'UPSTREAM_UNAVAILABLE' && /HTTP 500/.test(error.message),
  );
});

test('超时中止推理请求', async (t) => {
  const { url } = await startServer((_req, _res) => { /* never respond */ }, t);
  const reason = createReasoningAdapter({ url, timeoutMs: 20 });
  await assert.rejects(
    () => reason({ prompt: 'x', task_type: 'order_delivery_analysis' }, {}),
    (error) => error.code === 'REASONING_ABORTED',
  );
});

test('调用方 AbortSignal 会中止推理请求', async (t) => {
  const { url } = await startServer((_req, _res) => { /* never respond */ }, t);
  const reason = createReasoningAdapter({ url, timeoutMs: 1_000 });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(
    () => reason({ prompt: 'x', task_type: 'order_delivery_analysis' }, { signal: controller.signal }),
    (error) => error.code === 'REASONING_ABORTED',
  );
});

test('未配置 URL 返回未接通且不伪造', async () => {
  const reason = createReasoningAdapter({});
  const result = await reason({ prompt: 'x', task_type: 'order_delivery_analysis' }, {});
  assert.match(result.summary, /未接通/);
  assert.equal(result.data_confidence, 'low');
  assert.ok(result.conclusions[0].evidence_refs.length > 0);
});
