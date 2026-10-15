import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntentWithLLM } from '../src/execution-intent-llm.ts';

function deepSeekResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

function fetchReturning(content: string): typeof fetch {
  return (async () => new Response(JSON.stringify(deepSeekResponse(content)), { status: 200 })) as unknown as typeof fetch;
}

const deps = { apiKey: 'test-key', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' };

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
  const fetchImpl = fetchReturning('{"kind":"reasoning","task_type":"order_delivery_analysis","prompt":"分析订单 HJY1 的交付风险"}');
  const result = await parseIntentWithLLM('分析订单 HJY1 的交付风险', { ...deps, fetchImpl });
  assert.deepEqual(result, {
    kind: 'reasoning',
    request: {
      prompt: '分析订单 HJY1 的交付风险',
      task_type: 'order_delivery_analysis',
      context: {},
      constraints: { read_only: true, require_evidence: true },
    },
  });
});

test('query 意图：LLM 输出白名单外 path 被拒绝', async () => {
  const fetchImpl = fetchReturning('{"kind":"query","path":"/external/orders/delete","params":{}}');
  const result = await parseIntentWithLLM('删除订单', { ...deps, fetchImpl });
  assert.ok('error' in result && /白名单/.test((result as { error: string }).error));
});

test('reasoning 意图：缺 prompt 被拒绝', async () => {
  const fetchImpl = fetchReturning('{"kind":"reasoning","task_type":"quality_analysis"}');
  const result = await parseIntentWithLLM('分析质量', { ...deps, fetchImpl });
  assert.ok('error' in result && /prompt/.test((result as { error: string }).error));
});

test('LLM 返回非 JSON / 空内容时返回 error', async () => {
  const fetchImpl = fetchReturning('这不是 JSON');
  const result = await parseIntentWithLLM('随便说点什么', { ...deps, fetchImpl });
  assert.ok('error' in result);
});

test('未配置密钥时不发起请求，直接返回 error', async () => {
  let called = false;
  const fetchImpl = (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch;
  const result = await parseIntentWithLLM('查订单', { fetchImpl, apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' });
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
