import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = readFileSync(join(process.cwd(), 'public', 'app.js'), 'utf8');

test('用量台账的 Agent 与系统名称支持中文映射', () => {
  assert.match(app, /USAGE_AGENT_LABELS/);
  assert.match(app, /'agent-aeos-hub': 'AEOS 智能助手'/);
  assert.match(app, /'control-platform-assistant': '中台助手'/);
  assert.match(app, /'control-platform': '公司中控平台'/);
  assert.match(app, /USAGE_SYSTEM_LABELS/);
  assert.match(app, /function usageAgentLabel/);
  assert.match(app, /function usageSystemLabel/);
  assert.match(app, /function isExecutionChannelAgent/);
  assert.match(app, /function isQueryOnlyUsageRow/);
});

test('用量台账加载执行面 Agent 名称', () => {
  assert.match(app, /fetch\('\/api\/execution\/agents'/);
  assert.match(app, /usageAgentNames/);
});

test('未上报用量的助手会明确提示', () => {
  assert.match(app, /未上报模型用量/);
  assert.match(app, /需中台回传 Token/);
});

test('纯查询调用显示无模型 Token，不显示 Token 0 / 成本 0', () => {
  assert.match(app, /function usageIsQueryOnly/);
  assert.match(app, /无模型 Token/);
  assert.match(app, /查询接口不产生模型费用/);
  assert.match(app, /queryEvents/);
});

test('分析成本按系统与 Agent 合并展示，并提供调用方切换', () => {
  assert.match(app, /function usageHierarchyHtml/);
  assert.match(app, /usageAgentSystem/);
  assert.match(app, /usage-hierarchy/);
  assert.match(app, /usage-system-row/);
  assert.match(app, /usage-agent-row/);
  assert.match(app, /usageTab = 'system'/);
  assert.match(app, /data-usage-tab/);
});

test('分析工作台展示每个 Agent 的成本与调用次数', () => {
  assert.match(app, /executionUsageByAgent/);
  assert.match(app, /executionUsageBySystem/);
  assert.match(app, /function executionUsageText/);
  assert.match(app, /execution-agent-usage/);
  assert.match(app, /execution-system-usage/);
  assert.match(app, /fetch\('\/api\/usage\/summary'/);
});

test('按调用方视图使用台账的 callerId 字段并展示调用方名称', () => {
  assert.match(app, /usageTableHtml\(byCallerUser, 'callerId'/);
  assert.match(app, /usageTableHtml\(byCallerAgent, 'callerId'/);
  assert.match(app, /function usageCallerLabel/);
  assert.match(app, /USAGE_CALLER_LABELS/);
  assert.match(app, /验收测试/);
  assert.match(app, /我（M01 用户）/);
});

test('系统与 Agent 卡片可跳转到处理记录与分析成本', () => {
  assert.match(app, /function openLatestTraceForAgent/);
  assert.match(app, /function openUsageForAgent/);
  assert.match(app, /function openUsageForSystem/);
  assert.match(app, /execution-agent-trace/);
  assert.match(app, /execution-agent-usage/);
  assert.match(app, /data-execution-system-usage/);
  assert.match(app, /data-registry-system-usage/);
  assert.match(app, /usage-focus/);
  assert.match(app, /data-usage-focus-clear/);
});
