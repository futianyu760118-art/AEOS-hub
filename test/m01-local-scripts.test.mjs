import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = async (name) => readFile(path.join(root, 'scripts', name), 'utf8');

test('M01 startup scripts use the ignored runtime file and preserve secrets', async () => {
  const scripts = await Promise.all(['start-m01-demo.ps1', 'run-m01-hub.ps1', 'test-m01-demo.ps1'].map(source));
  const combined = scripts.join('\n');
  assert.match(combined, /deploy\\m01\\\.env/);
  assert.doesNotMatch(combined, /\.env\.example/);
  assert.match(combined, /docker compose --env-file deploy\/m01\/\.env -f deploy\/m01\/docker-compose\.yml up -d/);
  assert.match(combined, /NODE_EXTRA_CA_CERTS/);
  assert.match(combined, /AEOS_AUTH_MODE = 'm01'/);
  assert.match(combined, /PORT = '8790'/);
  assert.match(combined, /HOST = '127\.0\.0\.1'/);
  assert.match(await source('start-m01-demo.ps1'), /SupportsShouldProcess = \$true/);
  assert.match(await source('test-m01-demo.ps1'), /SupportsShouldProcess = \$true/);
  assert.doesNotMatch(combined, /Write-(?:Host|Output).*M01_CLIENT_SECRET/);
});

test('M01 shutdown script refuses unrelated listeners and preserves volumes', async () => {
  const script = await source('stop-m01-demo.ps1');
  assert.match(script, /Get-NetTCPConnection -LocalPort 8790 -State Listen/);
  assert.match(script, /run-m01-hub\\\.ps1/);
  assert.match(script, /Refusing to stop it/);
  assert.match(script, /SupportsShouldProcess = \$true/);
  assert.match(script, /docker compose --env-file deploy\/m01\/\.env -f deploy\/m01\/docker-compose\.yml stop/);
  assert.doesNotMatch(script, /down\s+-v/);
  assert.doesNotMatch(script, /\.env\.example/);
});
