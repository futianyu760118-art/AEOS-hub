import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('执行面按系统分组展示，支持展开收起', () => {
  const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');
  const css = readFileSync(join(root, 'public', 'style.css'), 'utf8');
  assert.match(app, /groupExecutionAgentsBySystem/);
  assert.match(app, /data-execution-system-toggle=/);
  assert.match(app, /execution-system-group/);
  assert.match(app, /execution-system-agents/);
  assert.match(css, /\.execution-system-head\s*\{/);
});

test('最高风险订单编排接到推理页面与服务端路由', () => {
  const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');
  const server = readFileSync(join(root, 'src', 'server.ts'), 'utf8');
  assert.match(app, /isHighestRiskOrderQuery/);
  assert.match(app, /api\/execution\/highest-risk-order/);
  assert.match(app, /dispatchHighestRiskOrderOrchestration/);
  assert.match(server, /\/api\/execution\/highest-risk-order/);
  assert.match(server, /executionOrchestrator\.highestRiskOrder/);
});

test('中枢对话窄路由与 assistant_reply 渲染已接线', () => {
  const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');
  const server = readFileSync(join(root, 'src', 'server.ts'), 'utf8');
  assert.match(server, /routeHubExecutionTurn/);
  assert.match(server, /recognizeHubIntent/);
  assert.match(server, /selectAgentForIntent/);
  assert.match(server, /buildIntentDispatch/);
  assert.match(server, /executionOrchestrator\.runCapability/);
  assert.match(server, /type: 'assistant_reply'/);
  assert.match(app, /case 'assistant_reply'/);
  assert.match(app, /中枢 Agent · 执行面/);
});
