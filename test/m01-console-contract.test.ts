import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');

test('Harbor console exposes the M01 registration state and retry action', () => {
  const app = readFileSync(join(root, 'public', 'app.js'), 'utf8');
  assert.match(app, /m01Registration/);
  assert.match(app, /\/api\/harbor\/agents\/\$\{encodeURIComponent\(agentId\)\}\/m01\/register/);
  assert.match(app, /注册到 M01|接入 M01/);
  assert.doesNotMatch(app, /M01_AGENT_REGISTRATION_SECRET/);
});

test('the one-shot seed command targets only the HUB central Agent', () => {
  const scriptPath = join(root, 'scripts', 'register-m01-hub-agent.ts');
  assert.equal(existsSync(scriptPath), true);
  const script = readFileSync(scriptPath, 'utf8');
  assert.match(script, /agent-aeos-hub/);
  assert.doesNotMatch(script, /agents\.map|for \(.*agents/);
});
