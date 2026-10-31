import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProductionSummary } from '../src/production-coordination.ts';

const envelope = (data: unknown[], asOf = '2026-09-28T10:00:00+08:00', confidence = 'high') => ({
  structuredContent: { data, data_as_of: asOf, data_confidence: confidence, evidence_refs: data.map((_, index) => `control-platform://production/${index}@${asOf}`) },
});

test('summarizes production envelopes and preserves freshness metadata', () => {
  const summary = parseProductionSummary({
    workOrders: envelope([{ work_order_no: 'WO-1', status: 'in_progress' }]),
    operations: envelope([{ operation_id: 'OP-1' }]),
    orderLinks: envelope([{ link_id: 'L-1' }]),
    reports: envelope([{ report_id: 'R-1' }]),
    capacity: envelope([{ capacity_date: '2026-09-28' }]),
  });
  assert.equal(summary.available, true);
  assert.equal(summary.confidence, 'high');
  assert.equal(summary.workOrderCount, 1);
  assert.equal(summary.inProgressCount, 1);
  assert.equal(summary.operationCount, 1);
  assert.equal(summary.linkedCount, 1);
  assert.equal(summary.reportCount, 1);
  assert.equal(summary.capacityCount, 1);
  assert.equal(summary.evidenceRefCount, 1);
});

test('does not turn unavailable or empty production data into a no-risk conclusion', () => {
  const summary = parseProductionSummary({ operations: { structuredContent: { error: { code: 'UPSTREAM_UNAVAILABLE', message: '时效字段缺失' } } } });
  assert.equal(summary.available, false);
  assert.match(summary.warnings.join(' '), /UPSTREAM_UNAVAILABLE/);
  assert.equal(summary.workOrderCount, 0);
});
