// 中台推理联调自检：按 2026-10-26 中台回复的契约调用真实接口，逐条核对 Hub 侧验收标准。
//
// 用法（在 aeos-execution-agent 目录）：
//   npm run reasoning:check                         跑全部用例
//   npm run reasoning:check -- --case order-delivery-risk
//   npm run reasoning:check -- --dry-run            只打印将要发送的请求，不发请求
//   npm run reasoning:check -- --json               机器可读输出
//   npm run reasoning:check -- --timeout-ms 240000  覆盖超时
//
// 依赖 TARGET_REASONING_URL；中台 HMAC 鉴权需 TARGET_REASONING_APP_KEY / TARGET_REASONING_APP_SECRET。
// 退出码：0=全部必测用例通过；1=有必测用例失败；2=配置/参数问题（还没到联调阶段）。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReasoningAdapter } from './adapters/reasoning-adapter.js';

const DEFAULT_TIMEOUT_MS = 180_000;
const CASES_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'reasoning-acceptance-cases.json');

function usage() {
  console.log(`中台推理联调自检

用法：
  npm run reasoning:check [选项]

选项：
  --case <id>         只跑指定用例（可重复）
  --dry-run           只打印请求体，不调用接口
  --json              以 JSON 输出结果
  --timeout-ms <n>    覆盖超时（默认取 TARGET_REASONING_TIMEOUT_MS，再默认 ${DEFAULT_TIMEOUT_MS}）
  --help              显示本说明

必测用例失败时退出码为 1；未配置 TARGET_REASONING_URL 时退出码为 2。`);
}

function parseArgs(argv) {
  const options = { cases: [], dryRun: false, json: false, timeoutMs: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--case') options.cases.push(argv[++index] ?? '');
    else if (arg.startsWith('--case=')) options.cases.push(arg.slice('--case='.length));
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else if (arg.startsWith('--timeout-ms=')) options.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    else throw new Error(`未知参数 ${arg}`);
  }
  return options;
}

function loadCases(file = CASES_FILE) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) throw new Error('验收用例文件没有 cases');
  for (const item of parsed.cases) {
    if (!item?.id || !item?.input?.prompt || !item?.input?.task_type) {
      throw new Error('验收用例缺少 id / input.prompt / input.task_type');
    }
  }
  return parsed.cases;
}

function buildConfig(env, timeoutOverride) {
  const envTimeout = Number(env.TARGET_REASONING_TIMEOUT_MS) > 0 ? Math.trunc(Number(env.TARGET_REASONING_TIMEOUT_MS)) : DEFAULT_TIMEOUT_MS;
  return {
    url: (env.TARGET_REASONING_URL ?? '').trim(),
    token: (env.TARGET_REASONING_TOKEN ?? '').trim(),
    appKey: (env.TARGET_REASONING_APP_KEY ?? '').trim(),
    appSecret: (env.TARGET_REASONING_APP_SECRET ?? '').trim(),
    agentId: (env.TARGET_REASONING_AGENT_ID ?? '').trim(),
    timeoutMs: Number(timeoutOverride) > 0 ? Math.trunc(Number(timeoutOverride)) : envTimeout,
  };
}

function endpointOf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '(URL 无法解析)';
  }
}

function authLabel(config) {
  if (config.appKey && config.appSecret) return 'HMAC（X-App-Key/X-Timestamp/X-Signature）';
  if (config.token) return 'Bearer（兼容模式，中台正式环境不支持）';
  return '未配置鉴权';
}

/** 按 Hub 侧验收标准逐条核对（与 docs/control-platform-reasoning-integration.md 第七节一致）。 */
function evaluate(item, result, error, elapsedMs, meta) {
  const checks = [];

  if (item.expect_error_code) {
    const expected = String(item.expect_error_code);
    checks.push({
      name: `按预期返回错误码 ${expected}`,
      pass: error?.code === expected,
      detail: error ? `${error.code ?? '-'}: ${error.message}` : '接口返回了结果，未返回预期错误',
    });
    if (error) {
      checks.push({
        name: '错误说明明确“不代表无风险”',
        pass: /不代表无风险|无可用证据/.test(error.message || ''),
        detail: error.message || '',
        informational: true,
      });
    }
    return checks;
  }

  if (error) {
    checks.push({ name: '接口可达并返回可解析结果', pass: false, detail: error.code ? `${error.code}: ${error.message}` : error.message || String(error) });
    return checks;
  }
  checks.push({ name: '接口可达并返回可解析结果', pass: true, detail: `${elapsedMs}ms` });

  const conclusions = Array.isArray(result?.conclusions) ? result.conclusions : [];
  checks.push({ name: 'conclusions 非空', pass: conclusions.length > 0, detail: `${conclusions.length} 条` });

  const missingEvidence = conclusions.filter((entry) => !Array.isArray(entry?.evidence_refs) || entry.evidence_refs.length === 0);
  checks.push({
    name: '每条结论都有 evidence_refs',
    pass: conclusions.length > 0 && missingEvidence.length === 0,
    detail: missingEvidence.length ? `${missingEvidence.length} 条缺证据` : `${conclusions.length} 条均有`,
  });

  const dataAsOf = result?.data_as_of;
  checks.push({
    name: 'data_as_of 存在且可解析',
    pass: typeof dataAsOf === 'string' && !Number.isNaN(Date.parse(dataAsOf)),
    detail: typeof dataAsOf === 'string' && dataAsOf ? dataAsOf : '缺失',
  });

  const warnings = Array.isArray(result?.validation_warnings) ? result.validation_warnings : [];
  checks.push({ name: '没有 validation_warnings', pass: warnings.length === 0, detail: warnings.join('；') || '无' });

  if (meta) {
    checks.push({
      name: '中台确认实际调用大模型（llm.called）',
      pass: meta.llm_called === true,
      detail: meta.llm_called === null || meta.llm_called === undefined
        ? '响应未包含 llm 信息'
        : `${meta.llm_provider ?? '-'}/${meta.llm_model ?? '-'} · ${meta.llm_latency_ms ?? '-'}ms`,
    });
  }

  const confidence = result?.data_confidence;
  if (item.expect_confidence === 'not-low') {
    checks.push({
      name: 'data_confidence 不是 low',
      pass: confidence === 'high' || confidence === 'medium',
      detail: String(confidence ?? '缺失'),
    });
  } else if (item.expect_confidence === 'low') {
    checks.push({
      name: 'data_confidence 为 low（边界用例）',
      pass: confidence === 'low',
      detail: String(confidence ?? '缺失'),
      informational: true,
    });
  }
  return checks;
}

async function runCase(reason, item, config) {
  let captured = null;
  let meta = null;
  const startedAt = Date.now();
  let returned;
  let error = null;
  try {
    returned = await reason(item.input, {
      runId: `check-${item.id}-${startedAt}`.slice(0, 64),
      sendComplete: (result, upstreamUsage) => { captured = { result, usage: upstreamUsage }; },
      onUpstreamMeta: (value) => { meta = value; },
    });
  } catch (caught) {
    error = caught;
  }
  const elapsedMs = Date.now() - startedAt;
  const result = captured?.result ?? returned ?? null;
  const checks = evaluate(item, result, error, elapsedMs, meta);
  const failed = checks.some((check) => !check.pass && !check.informational);
  return {
    id: item.id,
    name: item.name,
    required: item.required !== false,
    note: item.note ?? null,
    pass: !failed,
    elapsed_ms: elapsedMs,
    checks,
    usage: captured?.usage ?? null,
    meta,
    summary: result?.summary ?? '',
    data_confidence: result?.data_confidence ?? null,
    data_as_of: result?.data_as_of ?? null,
    conclusions: Array.isArray(result?.conclusions) ? result.conclusions : [],
    error: error ? { code: error.code ?? null, message: error.message || String(error), retry_after_sec: error.retryAfterSec ?? null } : null,
  };
}

function printTextReports(reports, config) {
  const total = reports.length;
  const requiredFailed = reports.filter((report) => report.required && !report.pass).length;
  console.log(`中台推理联调自检 · ${total} 个用例`);
  console.log(`接口：${endpointOf(config.url)}`);
  console.log(`鉴权：${authLabel(config)} · 超时 ${config.timeoutMs}ms · 模型/思考强度由中台服务端配置`);
  console.log('');
  reports.forEach((report, index) => {
    const tags = [report.required ? '必测' : '参考'];
    console.log(`[${index + 1}/${total}] ${report.name}（${report.id}）${report.pass ? 'PASS' : 'FAIL'} · ${report.elapsed_ms}ms · ${tags.join('/')}`);
    for (const check of report.checks) {
      const mark = check.informational ? 'INFO' : check.pass ? 'PASS' : 'FAIL';
      console.log(`   ${mark} ${check.name}${check.detail ? `（${check.detail}）` : ''}`);
    }
    if (report.usage) {
      const { modelId, tokensIn, cachedTokens, tokensOut, cost } = report.usage;
      console.log(`   INFO usage：model=${modelId ?? '未上报'} in=${tokensIn} cached=${cachedTokens} out=${tokensOut} cost=${cost === 0 ? '未上报（Hub 按模型目录补算）' : cost}`);
    } else {
      console.log('   INFO usage：上游未返回，Hub 会记为 missing');
    }
    if (report.meta) {
      console.log(`   INFO 中台任务：task_id=${report.meta.task_id ?? '-'} status=${report.meta.status ?? '-'} duration=${report.meta.duration_ms ?? '-'}ms replay=${report.meta.idempotent_replay} stale=${report.meta.stale}`);
    }
    if (report.note) console.log(`   INFO 人工核对：${report.note}`);
    if (report.summary) console.log(`   INFO 摘要：${report.summary.slice(0, 160)}`);
    console.log('');
  });
  console.log(`结果：${total - requiredFailed}/${total} 通过；必测失败 ${requiredFailed} 个`);
  if (reports.some((report) => report.required && report.pass)) {
    console.log('提示：召回/超时已在单元测试覆盖；真实联调时请在中台审计表确认任务被取消、llm_called=1。');
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`参数错误：${error.message}`);
    usage();
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    usage();
    return;
  }

  const allCases = loadCases();
  const selected = options.cases.length
    ? allCases.filter((item) => options.cases.includes(item.id))
    : allCases;
  if (selected.length === 0) {
    console.error(`未找到用例：${options.cases.join(', ')}`);
    console.error(`可用用例：${allCases.map((item) => item.id).join(', ')}`);
    process.exitCode = 2;
    return;
  }

  const config = buildConfig(process.env, options.timeoutMs);
  if (!config.url && !options.dryRun) {
    console.error('TARGET_REASONING_URL 未配置：推理能力当前是“未接通”占位，先把中台提供的地址写进 .env 再跑自检。');
    process.exitCode = 2;
    return;
  }
  if (!options.dryRun && !((config.appKey && config.appSecret) || config.token)) {
    console.error('未配置鉴权：中台要求 TARGET_REASONING_APP_KEY 与 TARGET_REASONING_APP_SECRET（HMAC）。');
    process.exitCode = 2;
    return;
  }

  if (options.dryRun) {
    const preview = selected.map((item) => ({
      id: item.id,
      request: {
        prompt: item.input.prompt,
        task_type: item.input.task_type,
        context: item.input.context ?? {},
        constraints: item.input.constraints ?? { read_only: true, require_evidence: true },
        task_id: `<runId，例如 check-${item.id}-1750000000000>`,
        ...(item.input.request_id ? { request_id: item.input.request_id } : {}),
      },
    }));
    console.log(JSON.stringify({
      endpoint: config.url ? endpointOf(config.url) : 'TARGET_REASONING_URL 未配置',
      auth: authLabel(config),
      timeout_ms: config.timeoutMs,
      note: 'model / reasoning_effort 由中台服务端配置，不在请求体中',
      requests: preview,
    }, null, 2));
    return;
  }

  const reason = createReasoningAdapter(config);
  const reports = [];
  for (const item of selected) reports.push(await runCase(reason, item, config));

  if (options.json) {
    console.log(JSON.stringify({ endpoint: endpointOf(config.url), auth: authLabel(config), timeout_ms: config.timeoutMs, reports }, null, 2));
  } else {
    printTextReports(reports, config);
  }

  if (reports.some((report) => report.required && !report.pass)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`自检异常：${error?.message || error}`);
  process.exitCode = 2;
});
