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
  assert.match(combined, /HOST = '0\.0\.0\.0'/);
  assert.match(await source('start-m01-demo.ps1'), /SupportsShouldProcess = \$true/);
  assert.match(await source('test-m01-demo.ps1'), /SupportsShouldProcess = \$true/);
  assert.doesNotMatch(combined, /Write-(?:Host|Output).*M01_CLIENT_SECRET/);
});

test('M01 startup waits for the public session endpoint to confirm M01 auth mode', async () => {
  const script = await source('start-m01-demo.ps1');
  assert.match(script, /\/api\/auth\/session/);
  assert.match(script, /localAuthMode\s+-ne\s+'m01'/);
  assert.match(script, /Get-HubAuthMode[^\n]*-eq\s+'m01'/);
  assert.equal(script.match(/AddSeconds\(120\)/g)?.length, 2);
  assert.match(script, /Start-Process[^\n]*-PassThru/);
  assert.match(script, /M01 Hub is ready/);
  assert.doesNotMatch(script, /M01 Hub is starting/);
});

test('M01 status script uses braced interpolation before port-label colons', async () => {
  const script = await source('test-m01-demo.ps1');
  assert.match(script, /\$\{identityPort\}:/);
  assert.match(script, /\$\{hubHttpsPort\}:/);
  assert.doesNotMatch(script, /\$identityPort:/);
  assert.doesNotMatch(script, /\$hubHttpsPort:/);
});

test('M01 hub runner admits the pilot roles and gates personnel admin on flag + secret', async () => {
  const runner = await source('run-m01-hub.ps1');
  assert.match(runner, /AEOS_M01_ALLOWED_ROLES = 'manager,supervisor,operator,owner,analyst'/);
  assert.match(runner, /HOST = '0\.0\.0\.0'/);
  assert.match(runner, /M01_PERSONNEL_ADMIN_ENABLED/);
  assert.match(runner, /M01_PERSONNEL_ADMIN_CLIENT_ID = 'aeos-hub-personnel-admin'/);
  assert.match(runner, /M01_PERSONNEL_ADMIN_CLIENT_SECRET/);
  assert.match(runner, /__REPLACE_BEFORE_START__/);
  // Fail closed: the else branch leaves personnel administration disabled.
  assert.match(runner, /M01_PERSONNEL_ADMIN_ENABLED = '0'/);
  assert.doesNotMatch(runner, /Write-(?:Host|Output).*M01_PERSONNEL_ADMIN_CLIENT_SECRET/);
});

test('personnel provisioning uses the ignored runtime file, requires confirmation, and never prints the secret', async () => {
  const script = await source('provision-m01-personnel-admin.ps1');
  const profile = JSON.parse(await readFile(path.join(root, 'deploy', 'm01', 'aeos-user-profile.json'), 'utf8'));
  const compose = await readFile(path.join(root, 'deploy', 'm01', 'docker-compose.yml'), 'utf8');
  const config = await readFile(path.join(root, 'deploy', 'm01', 'configure-personnel-admin.sh'), 'utf8');
  assert.match(script, /deploy\\m01\\\.env/);
  assert.doesNotMatch(script, /\.env\.example/);
  assert.match(script, /SupportsShouldProcess = \$true/);
  assert.match(script, /ConfirmImpact = 'High'/);
  assert.match(script, /ShouldProcess/);
  assert.match(script, /aeos-hub-personnel-admin/);
  assert.match(script, /query-users/);
  assert.match(script, /manage-users/);
  assert.match(script, /view-realm/);
  assert.match(script, /manage-realm/);
  assert.doesNotMatch(script, /for role in[^\n]*realm-admin/);
  assert.match(script, /configure-personnel-admin\.sh/);
  assert.match(script, /docker compose --env-file deploy\/m01\/\.env -f deploy\/m01\/docker-compose\.yml/);
  assert.match(script, /function Wait-KeycloakReady/);
  assert.match(script, /\/realms\/master\/\.well-known\/openid-configuration/);
  assert.match(script, /AddSeconds\(120\)/);
  assert.match(script, /Wait-KeycloakReady -Settings \$settings/);
  assert.match(script, /RandomNumberGenerator\]::Create\(\)/);
  assert.match(script, /\.GetBytes\(\$bytes\)/);
  assert.doesNotMatch(script, /RandomNumberGenerator\]::Fill/);
  assert.match(script, /BitConverter\]::ToString\(\$bytes\)\.Replace\('-', ''\)/);
  assert.doesNotMatch(script, /Convert\]::ToHexString/);
  assert.doesNotMatch(script, /Write-(?:Host|Output).*M01_PERSONNEL_ADMIN_CLIENT_SECRET/);
  assert.match(compose, /aeos-user-profile\.json:\/opt\/aeos\/aeos-user-profile\.json:ro/);
  assert.match(config, /update users\/profile -r aeos -f/);
  assert.match(config, /for role in manager supervisor operator/);
  assert.match(config, /kcadm\.sh create roles -r aeos/);
  assert.equal(profile.unmanagedAttributePolicy, 'ADMIN_EDIT');
  for (const name of ['email', 'firstName', 'lastName']) {
    const attribute = profile.attributes.find((entry) => entry.name === name);
    assert.deepEqual(attribute?.permissions, { view: ['admin'], edit: ['admin'] });
    assert.equal(Object.hasOwn(attribute ?? {}, 'required'), false);
  }
});

test('M01 shutdown script refuses unrelated listeners and preserves volumes', async () => {
  const script = await source('stop-m01-demo.ps1');
  assert.match(script, /Get-NetTCPConnection -LocalPort 8790 -State Listen/);
  assert.match(script, /run-m01-hub\\\.ps1/);
  assert.match(script, /Invoke-WebRequest -UseBasicParsing -Uri 'http:\/\/127\.0\.0\.1:8790\/'/);
  assert.match(script, /response\.Content -match 'AEOS'/);
  assert.match(script, /Refusing to stop it/);
  assert.match(script, /SupportsShouldProcess = \$true/);
  assert.match(script, /docker compose --env-file deploy\/m01\/\.env -f deploy\/m01\/docker-compose\.yml stop/);
  assert.doesNotMatch(script, /down\s+-v/);
  assert.doesNotMatch(script, /\.env\.example/);
});
