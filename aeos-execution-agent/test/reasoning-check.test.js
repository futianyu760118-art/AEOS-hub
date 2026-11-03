import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'reasoning-check.js');
const BASE_ENV = {
  PATH: process.env.PATH,
  TARGET_REASONING_URL: '',
  TARGET_REASONING_TOKEN: '',
  TARGET_REASONING_APP_KEY: '',
  TARGET_REASONING_APP_SECRET: '',
  TARGET_REASONING_AGENT_ID: '',
};

async function startServer(body, t, onRequest = () => {}) {
  const server = createServer((req, res) => {
    onRequest(req);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  }));
  return `http://127.0.0.1:${server.address().port}/api/v1/external/reasoning/analyze`;
}

// 必须异步等子进程：用例的 mock 服务跑在测试进程里，同步阻塞会让子进程请求等不到响应。
function runCheck(args, { url = '', appKey = '', appSecret = '' } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: {
        ...BASE_ENV,
        TARGET_REASONING_URL: url,
        TARGET_REASONING_APP_KEY: appKey,
        TARGET_REASONING_APP_SECRET: appSecret,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill(), 20_000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

function envelope(data) {
  return { code: 0, message: 'success', data };
}

const VALID_BODY = envelope({
  task_id: 'check-order-delivery-risk',
  status: 'succeeded',
  summary: '存在缺料风险',
  conclusions: [{
    matter: '关键物料未齐套',
    evidence_refs: ['control-platform://kitting/result/HJY20260903-261:1'],
    risk: '预计影响交付 3 天',
    recommendation: '请采购负责人核实，需人工确认',
    confidence: 'high',
  }],
  data_as_of: '2026-10-26T14:30:00+08:00',
  data_confidence: 'high',
  warnings: [],
  llm: { called: true, provider: 'openai', model: 'deepseek-flash', latency_ms: 4_200 },
  usage: { modelId: 'deepseek-flash', tokensIn: 1_200, tokensOut: 300 },
  duration_ms: 5_300,
  idempotent_replay: false,
});

test('合规响应：必测用例通过，退出码 0，usage 与 llm 被识别', async (t) => {
  const headers = [];
  const url = await startServer(VALID_BODY, t, (req) => headers.push(req.headers));
  const result = await runCheck(['--case', 'order-delivery-risk', '--json'], { url, appKey: 'key', appSecret: 'secret' });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.reports.length, 1);
  assert.equal(parsed.reports[0].pass, true);
  assert.equal(parsed.reports[0].usage.tokensIn, 1_200);
  assert.equal(parsed.reports[0].meta.llm_called, true);
  assert.equal(headers[0]['x-app-key'], 'key');
  assert.ok(headers[0]['x-signature']);
});

test('缺证据响应：必测用例失败，退出码 1', async (t) => {
  const url = await startServer(envelope({
    summary: '没有证据的结论',
    conclusions: [{ matter: '缺证据结论', risk: '未知', confidence: 'high' }],
    data_confidence: 'high',
    llm: { called: true, provider: 'openai', model: 'deepseek-flash', latency_ms: 1_000 },
  }), t);
  const result = await runCheck(['--case', 'order-delivery-risk', '--json'], { url, appKey: 'key', appSecret: 'secret' });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.reports[0].pass, false);
  assert.ok(parsed.reports[0].checks.some((check) => !check.pass && check.name.includes('evidence_refs')));
});

test('边界用例：信封 404 视为预期结果', async (t) => {
  const url = await startServer({ code: 404, message: '无可用证据，不代表无风险', data: null }, t);
  const result = await runCheck(['--case', 'unknown-order-boundary', '--json'], { url, appKey: 'key', appSecret: 'secret' });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.reports[0].pass, true);
  assert.equal(parsed.reports[0].error.code, 'NOT_FOUND');
});

test('未配置 URL 退出码 2；dry-run 仍可查看请求', async () => {
  const missing = await runCheck([]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /TARGET_REASONING_URL/);

  const dryRun = await runCheck(['--dry-run']);
  assert.equal(dryRun.status, 0);
  const preview = JSON.parse(dryRun.stdout);
  assert.ok(preview.requests.length >= 5);
  assert.equal(preview.requests[0].request.constraints.read_only, true);
  assert.equal(preview.requests[0].request.model, undefined);
});

test('URL 已配置但未配置 HMAC 凭据时退出码 2', async () => {
  const result = await runCheck(['--case', 'order-delivery-risk'], { url: 'http://127.0.0.1:9/api/v1/external/reasoning/analyze' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /TARGET_REASONING_APP_KEY/);
});
