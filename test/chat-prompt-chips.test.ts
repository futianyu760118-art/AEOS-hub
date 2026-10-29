import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const app = readFileSync(join(process.cwd(), 'public', 'app.js'), 'utf8');
const html = readFileSync(join(process.cwd(), 'public', 'index.html'), 'utf8');

test('智能助手空状态展示常用问题示例卡片', () => {
  assert.match(html, /id="capability-prompt-chips"/);
  assert.match(app, /label: '当前交付风险最高的订单', prompt: '当前交付风险最高的订单有哪些'/);
  assert.match(app, /label: '查订单明细', prompt: '查 HJ202602-0009-0028 的订单明细'/);
  assert.match(app, /label: '改交付日期', prompt: '改写订单 HJ202602-0009-0028 的交付日期为 2026-11-15'/);
  assert.match(app, /data-capability-prompt/);
  assert.doesNotMatch(app, /中控经营风险核查/);
});
