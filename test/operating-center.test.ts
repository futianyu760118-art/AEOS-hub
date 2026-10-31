import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OperatingCenterStore } from '../src/operating-center.ts';
import type { DashboardRisk } from '../src/dashboard.ts';

const risk: DashboardRisk = {
  source: 'quality', orderNo: 'SO-01', issueNo: 'QI-01', summary: '来料质量异常待确认', customer: '', product: 'P-01',
  orderQty: null, completedQty: null, amountCny: null, probability: null, riskScore: null, dueDate: '', shippingPlan: '', owner: '',
  orderStatus: 'open', riskLevel: '高', evidenceRef: 'control-platform://quality/issue/QI-01@2026-09-23',
  prompt: '使用 quality_issues_list 核查异常，并引用 evidence_refs。', kitRateByItem: null, shortageItemCount: null, shortageQty: null,
  estimatedFullKitDate: '', occurredAt: '2026-09-23T09:00:00+08:00',
};

test('creates evidence-bound operating cases, Inbox work, and human decisions without business execution', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-operating-center-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new OperatingCenterStore(join(directory, 'operating-center.json'), () => new Date('2026-09-23T01:00:00.000Z'));

  const first = store.upsertDashboardRisks([risk], 'dashboard', 5);
  assert.equal(first.created.length, 1);
  assert.equal(first.created[0]?.requiresHumanApproval, true);
  assert.deepEqual(first.created[0]?.evidenceRefs, [risk.evidenceRef]);
  assert.equal(store.load().inbox.filter((item) => item.state === 'unread').length, 1);

  const repeated = store.upsertDashboardRisks([risk], 'dashboard', 5);
  assert.equal(repeated.created.length, 0);
  assert.equal(repeated.existing, 1);

  const item = first.created[0]!;
  const decision = store.addDecision({ caseId: item.id, action: 'approve_analysis', note: '同意继续进行只读分析，业务处置另行审批。', actor: '质量负责人' });
  assert.equal(decision.action, 'approve_analysis');
  assert.equal(store.load().cases[0]?.status, 'in_review');
  assert.equal(store.load().inbox.length, 2);
});

test('migrates legacy Autopilot snapshots without losing operating records', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-autopilot-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'operating-center.json');
  const store = new OperatingCenterStore(file, () => new Date('2026-09-23T01:00:00.000Z'));
  const created = store.upsertDashboardRisks([risk], 'dashboard', 1).created[0]!;
  const current = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({
    ...current,
    version: 1,
    autopilot: { id: 'autopilot-daily-risk-triage', name: '旧计划', enabled: true, time: '08:30', timezone: 'Asia/Shanghai', sources: ['quality'], maxCases: 3, lastRunDate: null, lastRunAt: null, lastStatus: 'never', lastSummary: '尚未执行' },
    runs: [{ id: 'autopilot-run-legacy', autopilotId: 'autopilot-daily-risk-triage', startedAt: '2026-09-23T01:00:00.000Z', completedAt: '2026-09-23T01:00:02.000Z', status: 'completed', scanned: 1, createdCases: 1, skippedExisting: 0, message: '旧运行记录' }],
  }, null, 2));

  const migrated = store.load();
  assert.equal(migrated.version, 2);
  assert.equal(migrated.cases[0]?.id, created.id);
  assert.ok(!('autopilot' in migrated));
  assert.ok(!('runs' in migrated));

  store.updateCase({ id: created.id, status: 'in_review' });
  const persisted = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(persisted.version, 2);
  assert.ok(!('autopilot' in persisted));
  assert.ok(!('runs' in persisted));
});
