import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEvent } from '../src/event-contract.ts';
import { validateResult } from '../src/result-contract.ts';

const pending = {
  result_id: 'result-1001',
  result_type: 'risk_analysis',
  tenant_id: 'tenant-a',
  object_ref: 'business://order/SO-1001',
  owner: '订单交付负责人',
  created_by: 'agent:risk-analysis',
  status: 'PENDING',
  source_system: 'aeos-hub',
  correlation_id: 'case-1001',
  version: '1.0',
  evidence_refs: ['control-platform://order/SO-1001@2026-10-09T00:00:00Z'],
  summary: '订单交付风险待业务确认。',
  created_at: '2026-10-09T00:00:00.000Z',
  verified_by: null,
  verified_at: null,
  verification_note: null,
};

test('accepts a PENDING result without a verification decision', () => {
  assert.equal(validateResult(pending).status, 'PENDING');
});

test('requires source, object, tenant, and evidence context for an Event', () => {
  assert.equal(validateEvent({
    event_id: 'event-1001', event_type: 'risk_detected', tenant_id: 'tenant-a',
    object_ref: 'business://order/SO-1001', source_system: 'company-control', correlation_id: 'case-1001', version: '1.0',
    occurred_at: '2026-10-09T00:00:00.000Z', evidence_refs: ['control-platform://order/SO-1001@2026-10-09T00:00:00Z'],
  }).event_type, 'risk_detected');
});

test('requires a verifier and timestamp before a result becomes VERIFIED', () => {
  assert.throws(
    () => validateResult({ ...pending, status: 'VERIFIED' }),
    /verified_by|verified_at/,
  );
  assert.equal(validateResult({
    ...pending,
    status: 'VERIFIED',
    verified_by: '业务负责人:张三',
    verified_at: '2026-10-09T01:00:00.000Z',
    verification_note: '已核实订单交付风险。',
  }).status, 'VERIFIED');
});
