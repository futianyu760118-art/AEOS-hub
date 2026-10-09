import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardReadPlan } from '../src/dashboard-read-plan.ts';

test('uses the company-control capacity parameter names and a shared bounded date window', () => {
  const plan = dashboardReadPlan(new Date('2026-10-08T12:00:00.000Z'));
  assert.deepEqual(plan.orders, { date_from: '2026-09-08', date_to: '2026-12-07' });
  assert.deepEqual(plan.kitting, { required_date_start: '2026-09-08', required_date_end: '2026-12-07' });
  assert.deepEqual(plan.capacity, { date_start: '2026-09-08', date_end: '2026-12-07' });
  assert.equal('date_from' in plan.capacity, false);
});
