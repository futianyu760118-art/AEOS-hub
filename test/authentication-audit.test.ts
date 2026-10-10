import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { ActorContext } from '../src/auth/actor-context.ts';
import { appendEvidence } from '../src/evidence.ts';
import { appendAuthenticationAuditEvidence } from '../src/authentication-audit.ts';

const m01Actor: ActorContext = {
  actorId: 'm01:user:manager-42', actorType: 'human', tenantId: 'tenant-42', roles: ['manager'], authSource: 'm01',
};

function evidenceFile(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-auth-audit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'evidence.jsonl');
}

test('writes credential-free Evidence for each terminal M01 authentication outcome', (t) => {
  const file = evidenceFile(t);
  const append = (input: Parameters<typeof appendEvidence>[0]) => appendEvidence(input, file);

  const succeeded = appendAuthenticationAuditEvidence({ type: 'login_succeeded', authMode: 'm01', actor: m01Actor }, append);
  const failed = appendAuthenticationAuditEvidence({ type: 'authentication_failed', authMode: 'm01' }, append);
  const denied = appendAuthenticationAuditEvidence({ type: 'admission_denied', authMode: 'm01', actor: m01Actor }, append);

  assert.equal(succeeded.kind, 'authentication_audit');
  assert.equal(succeeded.tenant_id, 'tenant-42');
  assert.equal(succeeded.object_ref, 'hub://identity/m01/tenant-42/m01%3Auser%3Amanager-42');
  assert.deepEqual(succeeded.payload, {
    outcome: 'login_succeeded', authMode: 'm01', actor: { actorId: 'm01:user:manager-42', actorType: 'human', tenantId: 'tenant-42', roles: ['manager'] },
  });
  assert.equal(failed.object_ref, 'hub://identity/m01');
  assert.deepEqual(failed.payload, { outcome: 'authentication_failed', authMode: 'm01' });
  assert.deepEqual(denied.payload, {
    outcome: 'admission_denied', authMode: 'm01', actor: { actorId: 'm01:user:manager-42', actorType: 'human', tenantId: 'tenant-42', roles: ['manager'] },
  });

  const stored = readFileSync(file, 'utf8');
  assert.doesNotMatch(stored, /password|cookie|session|token|secret|code|state|verifier/i);
});
