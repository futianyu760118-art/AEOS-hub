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
  TARGET_REASONING_AGENT_ID: '',
};

async function startServer(body, t) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  }));
  return `http://127.0.0.1:${server.address().port}/reason`;
}

// 必须异步等子进程：用例的 mock 服务跑在测试进程里，同步阻塞会让子进程请求等不到响应。
function runCheck(args, url = '') {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...BASE_ENV, TARGET_REASONING_URL: url },
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

const VALID_BODY = {
  summary: '存在缺料风险',
  conclusions: [{
    matter: '关键物料未齐套',
    evidence_refs: ['control-platform://material-kitting/shortages/HJY20260903-261'],
    risk: '预计影响交付 3 天',
    recommendation: '请采购负责人核实，需人工确认',
    confidence: 'high',
  }],
  data_as_of: '2026-10-26T08:00:00+08:00',
  data_confidence: 'high',
  usage: { model: 'deepseek-flash', input_tokens: 1_200, output_tokens: 300 },
};

test('合规响应：必测用例通过，退出码 0，usage 被识别', async (t) => {
  const url = await startServer(VALID_BODY, t);
  const result = await runCheck(['--case', 'order-delivery-risk', '--json'], url);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.reports.length, 1);
  assert.equal(parsed.reports[0].pass, true);
  assert.equal(parsed.reports[0].usage.tokensIn, 1_200);
});

test('缺证据响应：必测用例失败，退出码 1', async (t) => {
  const url = await startServer({
    summary: '没有证据的结论',
    conclusions: [{ matter: '缺证据结论', risk: '未知', confidence: 'high' }],
    data_confidence: 'high',
  }, t);
  const result = await runCheck(['--case', 'order-delivery-risk', '--json'], url);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.reports[0].pass, false);
  assert.ok(parsed.reports[0].checks.some((check) => !check.pass && check.name.includes('evidence_refs')));
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
});
