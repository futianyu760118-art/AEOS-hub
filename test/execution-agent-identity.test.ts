import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('执行面列表展示本机与来源系统身份', () => {
  const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');
  const css = readFileSync(join(root, 'public', 'style.css'), 'utf8');
  assert.match(app, /agent\.local/);
  assert.match(app, /agent\.sourceSystem/);
  assert.match(app, /本机/);
  assert.match(app, /来源：/);
  assert.match(css, /execution-agent-identity/);
  assert.match(css, /\.execution-agent-title \{[^}]*max-width: 100%/);
  assert.match(css, /\.execution-agent-identities \{[^}]*max-width: 100%/);
  assert.match(css, /\.execution-agent-source \{[^}]*min-width: 0[^}]*text-overflow: ellipsis/);
});

test('执行面身份契约要求来源系统且由管理面判定本机', () => {
  const simulator = readFileSync(join(root, 'scripts', 'execution-plane-simulator.mjs'), 'utf8');
  const contract = readFileSync(join(root, 'docs', 'execution-plane-agent-contract.md'), 'utf8');
  assert.match(simulator, /EXECUTION_SOURCE_SYSTEM/);
  assert.match(simulator, /sourceSystem/);
  assert.match(contract, /sourceSystem/);
  assert.match(contract, /管理面.*回环地址/);
});
