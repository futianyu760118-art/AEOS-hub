import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntentWithLLM } from '../src/execution-intent-llm.ts';
import { type QueryIntent } from '../src/execution-intent-types.ts';

function deepSeekResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

function fetchReturning(content: string): typeof fetch {
  return (async () => new Response(JSON.stringify(deepSeekResponse(content)), { status: 200 })) as unknown as typeof fetch;
}

const MOCK_INTENT: QueryIntent = {
  paths: [
    { path: '/external/orders/list', label: '订单', keywords: ['订单', 'order'], params: [{ name: 'keyword', label: '关键字/订单号' }] },
    { path: '/external/material-kitting/shortages', label: '缺料', keywords: ['缺料', 'shortage'], params: [{ name: 'demand_no', label: '订单号' }] },
    { path: '/external/suppliers/list', label: '供应商', keywords: ['供应商'], params: [{ name: 'keyword', label: '关键字' }] },
  ],
};

const deps = {
  apiKey: 'test-key',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  intent: MOCK_INTENT,
  // 测试中不等待真实退避时间。
  retry: { baseDelayMs: 0 },
};

test('query 意图：LLM 返回合法路径与参数', async () => {
  const fetchImpl = fetchReturning('{"kind":"query","path":"/external/orders/list","params":{"keyword":"HJY20260903-261"}}');
  const result = await parseIntentWithLLM('查订单 HJY20260903-261', { ...deps, fetchImpl });
  assert.deepEqual(result, { kind: 'query', path: '/external/orders/list', params: { keyword: 'HJY20260903-261' } });
});

test('query 意图：LLM 返回带 Markdown 代码块的 JSON 也能解析', async () => {
  const fetchImpl = fetchReturning('```json\n{"kind":"query","path":"/external/material-kitting/shortages","params":{"demand_no":"HJY1"}}\n```');
  const result = await parseIntentWithLLM('查 HJY1 的缺料', { ...deps, fetchImpl });
  assert.deepEqual(result, { kind: 'query', path: '/external/material-kitting/shortages', params: { demand_no: 'HJY1' } });
});

test('reasoning 意图：LLM 返回 task_type 与 prompt，自动补全只读约束', async () => {
  const fetchImpl = fetchReturning('{"kind":"reasoning","task_type":"operating_case_analysis","prompt":"分析订单 HJY1 的交付风险"}');
  const result = await parseIntentWithLLM('分析订单 HJY1 的交付风险', { ...deps, fetchImpl });
  assert.deepEqual(result, {
    kind: 'reasoning',
    request: {
      prompt: '分析订单 HJY1 的交付风险',
      task_type: 'operating_case_analysis',
      context: {},
      constraints: { read_only: true, require_evidence: true },
    },
  });
});

test('query 意图：LLM 输出 intent 之外的 path 被拒绝', async () => {
  const fetchImpl = fetchReturning('{"kind":"query","path":"/external/orders/delete","params":{}}');
  const result = await parseIntentWithLLM('删除订单', { ...deps, fetchImpl });
  assert.ok('error' in result && /不在能力声明范围/.test((result as { error: string }).error));
});

test('query 意图：按 intent 解析非中台路径（schema 驱动，不再写死中台）', async () => {
  const bossIntent: QueryIntent = { paths: [{ path: '/api/boss/orders', label: '老板订单', keywords: ['老板订单'], params: [{ name: 'order_no', label: '订单号' }] }] };
  const fetchImpl = fetchReturning('{"kind":"query","path":"/api/boss/orders","params":{"order_no":"B-100"}}');
  const result = await parseIntentWithLLM('查老板订单 B-100', { ...deps, intent: bossIntent, fetchImpl });
  assert.deepEqual(result, { kind: 'query', path: '/api/boss/orders', params: { order_no: 'B-100' } });
});

test('reasoning 意图：缺 prompt 被拒绝', async () => {
  const fetchImpl = fetchReturning('{"kind":"reasoning","task_type":"operating_case_analysis"}');
  const result = await parseIntentWithLLM('分析一下', { ...deps, fetchImpl });
  assert.ok('error' in result && /prompt/.test((result as { error: string }).error));
});

test('LLM 返回非 JSON / 空内容时返回 error', async () => {
  const fetchImpl = fetchReturning('这不是 JSON');
  const result = await parseIntentWithLLM('随便说点什么', { ...deps, fetchImpl });
  assert.ok('error' in result);
});

test('未提供 intent 时直接返回 error，不发起请求', async () => {
  let called = false;
  const fetchImpl = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
  const result = await parseIntentWithLLM('查订单', { fetchImpl, apiKey: 'k', baseUrl: 'https://x', model: 'm' });
  assert.equal(called, false);
  assert.ok('error' in result && /intent/.test((result as { error: string }).error));
});

test('未配置密钥时不发起请求，直接返回 error', async () => {
  let called = false;
  const fetchImpl = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
  const result = await parseIntentWithLLM('查订单', { fetchImpl, apiKey: '', baseUrl: 'https://x', model: 'm', intent: MOCK_INTENT });
  assert.equal(called, false);
  assert.ok('error' in result && /密钥/.test((result as { error: string }).error));
});

test('模型接口返回非 2xx 时返回 error', async () => {
  const fetchImpl = (async () => new Response('bad gateway', { status: 502 })) as unknown as typeof fetch;
  const result = await parseIntentWithLLM('查订单', { ...deps, fetchImpl });
  assert.ok('error' in result && /502/.test((result as { error: string }).error));
});

test('分页越界被钳制到安全范围', async () => {
  const fetchImpl = fetchReturning('{"kind":"query","path":"/external/suppliers/list","params":{"page":99999,"page_size":999}}');
  const result = await parseIntentWithLLM('查供应商', { ...deps, fetchImpl });
  assert.deepEqual(result, { kind: 'query', path: '/external/suppliers/list', params: { page: 1000, page_size: 100 } });
});

test('effort 透传为 reasoning_effort，并回传缓存命中 Token', async () => {
  let sentBody: Record<string, unknown> = {};
  const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
    sentBody = JSON.parse(init?.body ?? '{}');
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"kind":"query","path":"/external/orders/list","params":{}}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 60 },
    }), { status: 200 });
  }) as unknown as typeof fetch;
  let usage: { tokensIn: number; cachedTokens: number; tokensOut: number } | undefined;
  await parseIntentWithLLM('查订单', {
    ...deps,
    effort: 'low',
    fetchImpl,
    onUsage: (value) => { usage = value; },
  });
  assert.equal(sentBody.reasoning_effort, 'low');
  assert.deepEqual(usage && { tokensIn: usage.tokensIn, cachedTokens: usage.cachedTokens, tokensOut: usage.tokensOut },
    { tokensIn: 100, cachedTokens: 60, tokensOut: 20 });
});

test('未指定 effort 时不发送 reasoning_effort', async () => {
  let sentBody: Record<string, unknown> = {};
  const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
    sentBody = JSON.parse(init?.body ?? '{}');
    return new Response(JSON.stringify(deepSeekResponse('{"kind":"query","path":"/external/orders/list","params":{}}')), { status: 200 });
  }) as unknown as typeof fetch;
  await parseIntentWithLLM('查订单', { ...deps, fetchImpl });
  assert.equal('reasoning_effort' in sentBody, false);
});

test('401 不重试，返回结构化鉴权错误', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return new Response('', { status: 401 }); }) as unknown as typeof fetch;
  const result = await parseIntentWithLLM('查订单', { ...deps, fetchImpl });
  assert.equal(calls, 1);
  const failure = result as { code?: string; retryable?: boolean; attempts?: number };
  assert.equal(failure.code, 'MODEL_AUTH');
  assert.equal(failure.retryable, false);
  assert.equal(failure.attempts, 1);
});

test('429 自动重试后成功', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) return new Response('', { status: 429 });
    return new Response(JSON.stringify(deepSeekResponse('{"kind":"query","path":"/external/orders/list","params":{}}')), { status: 200 });
  }) as unknown as typeof fetch;
  const result = await parseIntentWithLLM('查订单', { ...deps, fetchImpl });
  assert.equal(calls, 2);
  assert.equal((result as { kind?: string }).kind, 'query');
});

test('5xx 重试耗尽后返回 MODEL_SERVER，共调用 3 次', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return new Response('', { status: 503 }); }) as unknown as typeof fetch;
  const result = await parseIntentWithLLM('查订单', { ...deps, fetchImpl });
  assert.equal(calls, 3);
  const failure = result as { code?: string; attempts?: number };
  assert.equal(failure.code, 'MODEL_SERVER');
  assert.equal(failure.attempts, 3);
});

test('超时只重试 1 次', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  }) as unknown as typeof fetch;
  const result = await parseIntentWithLLM('查订单', { ...deps, fetchImpl });
  assert.equal(calls, 2);
  assert.equal((result as { code?: string }).code, 'MODEL_TIMEOUT');
});

test('网络错误重试后成功', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) throw new Error('ECONNRESET');
    return new Response(JSON.stringify(deepSeekResponse('{"kind":"query","path":"/external/orders/list","params":{}}')), { status: 200 });
  }) as unknown as typeof fetch;
  const result = await parseIntentWithLLM('查订单', { ...deps, fetchImpl });
  assert.equal(calls, 2);
  assert.equal((result as { kind?: string }).kind, 'query');
});

test('400 不重试', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls += 1; return new Response('', { status: 400 }); }) as unknown as typeof fetch;
  const result = await parseIntentWithLLM('查订单', { ...deps, fetchImpl });
  assert.equal(calls, 1);
  assert.equal((result as { code?: string }).code, 'MODEL_BAD_REQUEST');
});
