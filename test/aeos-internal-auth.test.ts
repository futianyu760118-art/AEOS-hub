import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { verifyAeosHmac } from '../src/aeos-internal-auth.ts';

function signedHeaders(secret: string, keyId: string, timestamp: string, body: Buffer) {
  const signature = createHmac('sha256', secret)
    .update(timestamp)
    .update('.')
    .update(body)
    .digest('hex');
  return {
    'x-aeos-key-id': keyId,
    'x-aeos-timestamp': timestamp,
    'x-aeos-signature': `sha256=${signature}`,
  };
}

test('accepts a valid internal AEOS HMAC signature', () => {
  const body = Buffer.alloc(0);
  const timestamp = '1763517000000';
  assert.equal(
    verifyAeosHmac(
      signedHeaders('secret-1', 'fac-m09', timestamp, body),
      body,
      {
        keyId: 'fac-m09',
        secret: 'secret-1',
        maxSkewSeconds: 300,
        nowMs: 1763517000000,
      },
    ),
    true,
  );
});

test('rejects stale timestamps and wrong key ids', () => {
  const body = Buffer.from('{}');
  const timestamp = '1763517000000';
  const headers = signedHeaders('secret-1', 'fac-m09', timestamp, body);
  assert.equal(
    verifyAeosHmac(headers, body, {
      keyId: 'other',
      secret: 'secret-1',
      nowMs: 1763517000000,
    }),
    false,
  );
  assert.equal(
    verifyAeosHmac(headers, body, {
      keyId: 'fac-m09',
      secret: 'secret-1',
      maxSkewSeconds: 10,
      nowMs: 1763517020001,
    }),
    false,
  );
});
