import { createHmac, timingSafeEqual } from 'node:crypto';

export interface AeosHmacConfig {
  keyId: string;
  secret: string;
  maxSkewSeconds?: number;
  nowMs?: number;
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const value = headers[name];
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

export function verifyAeosHmac(
  headers: Record<string, string | string[] | undefined>,
  raw: Buffer,
  config: AeosHmacConfig,
): boolean {
  const keyId = headerValue(headers, 'x-aeos-key-id');
  const timestamp = headerValue(headers, 'x-aeos-timestamp');
  const supplied = headerValue(headers, 'x-aeos-signature').replace(/^sha256=/, '');
  const timestampMs = Number(timestamp);
  const nowMs = config.nowMs ?? Date.now();
  const maxSkew = Math.max(1, config.maxSkewSeconds ?? 300) * 1000;

  if (!config.keyId || !config.secret || keyId !== config.keyId) return false;
  if (!timestamp || !Number.isInteger(timestampMs) || !supplied) return false;
  if (Math.abs(nowMs - timestampMs) > maxSkew) return false;

  const expected = createHmac('sha256', config.secret)
    .update(timestamp)
    .update('.')
    .update(raw)
    .digest('hex');
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length
    && timingSafeEqual(expectedBytes, suppliedBytes);
}
