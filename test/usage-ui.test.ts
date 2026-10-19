import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = readFileSync(join(process.cwd(), 'public', 'app.js'), 'utf8');

test('用量台账的 Agent 与系统名称支持中文映射', () => {
  assert.match(app, /USAGE_AGENT_LABELS/);
  assert.match(app, /'agent-aeos-hub': 'AEOS 中枢 Agent'/);
  assert.match(app, /'control-platform-assistant': '中台智能助手'/);
  assert.match(app, /USAGE_SYSTEM_LABELS/);
  assert.match(app, /function usageAgentLabel/);
  assert.match(app, /function usageSystemLabel/);
});

test('用量台账加载执行面 Agent 名称', () => {
  assert.match(app, /fetch\('\/api\/execution\/agents'/);
  assert.match(app, /usageAgentNames/);
});

test('未上报用量的助手会明确提示', () => {
  assert.match(app, /未上报模型用量/);
  assert.match(app, /需中台回传 Token/);
});
