import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { G0DecisionRegisterStore } from '../src/g0-decision-register.ts';

const MAX_FILE_BYTES = 1024 * 1024;

function fixture(t: TestContext): G0DecisionRegisterStore {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-g0-decisions-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return new G0DecisionRegisterStore(
    join(directory, 'g0-decision-register.json'),
    () => new Date('2026-10-12T01:02:03.000Z'),
  );
}

const actor = { actorId: 'manager-demo', tenantId: 'demo-tenant' };

test('starts incomplete and records explicit, versioned G0 choices', (t) => {
  const store = fixture(t);
  const initial = store.load();

  assert.equal(initial.version, 1);
  assert.equal(initial.revision, 0);
  assert.equal(initial.readyForG1, false);
  assert.deepEqual(initial.history, []);

  const partial = store.record({
    actor,
    patch: {
      firstScenario: 'order_delivery_risk',
      businessOwnerActorId: 'owner-demo',
      verifyActorId: 'verify-demo',
    },
    note: '首个闭环为订单交付风险，明确业务 Owner 与核验人。',
  });

  assert.equal(partial.readyForG1, false);
  assert.equal(partial.decisions.firstScenario?.value, 'order_delivery_risk');
  assert.equal(partial.decisions.businessOwnerActor?.value.actorId, 'owner-demo');
  assert.equal(partial.decisions.verifyActor?.value.actorId, 'verify-demo');
  assert.equal(partial.history.length, 3);
  assert.equal(partial.history[0]?.actorId, 'manager-demo');
  assert.equal(partial.history[0]?.tenantId, 'demo-tenant');

  const ready = store.record({
    actor,
    patch: {
      scope: { demoTenantId: 'demo-tenant', organizationScope: '订单交付组' },
      threeAccountAuthorization: {
        managerActorId: 'manager-demo', operatorActorId: 'operator-demo', ownerActorId: 'owner-demo',
        decision: 'approved_for_g1',
      },
      m02Responsibility: { ownerActorId: 'owner-demo', status: 'assigned' },
      taskStoreDecision: 'reuse_existing_task_center',
      g4Admission: 'blocked_until_g1',
    },
    note: '其余 G0 治理决策已冻结；账号实际开通及后续集成不在本登记范围内。',
  });

  assert.equal(ready.readyForG1, true);
  assert.equal(ready.revision, 2);
  assert.equal(ready.history.length, 8);
  assert.equal(ready.decisions.g4Admission?.value, 'blocked_until_g1');
  assert.doesNotThrow(() => store.load());
});

test('rejects an Order Delivery Risk decision with the same Owner and Verify actor', (t) => {
  const store = fixture(t);

  assert.throws(
    () => store.record({
      actor,
      patch: {
        firstScenario: 'order_delivery_risk',
        businessOwnerActorId: 'owner-demo',
        verifyActorId: 'owner-demo',
      },
      note: '错误地让同一人担任 Owner 与 Verify。',
    }),
    /Owner.*Verify.*不同|Owner 与 Verify.*不同/,
  );
  assert.equal(store.load().revision, 0);
});

test('does not mark G1 ready when the M02 responsibility belongs to someone other than the business Owner', (t) => {
  const store = fixture(t);
  const mismatch = store.record({
    actor,
    patch: {
      firstScenario: 'order_delivery_risk',
      businessOwnerActorId: 'owner-demo',
      verifyActorId: 'verify-demo',
      scope: { demoTenantId: 'demo-tenant', organizationScope: '订单交付组' },
      threeAccountAuthorization: {
        managerActorId: 'manager-demo', operatorActorId: 'operator-demo', ownerActorId: 'owner-demo',
        decision: 'approved_for_g1',
      },
      m02Responsibility: { ownerActorId: 'm02-owner-demo', status: 'assigned' },
      taskStoreDecision: 'reuse_existing_task_center',
      g4Admission: 'blocked_until_g1',
    },
    note: 'M02 责任人尚未与业务 Owner 对齐。',
  });

  assert.equal(mismatch.readyForG1, false);
  const aligned = store.record({
    actor,
    patch: { m02Responsibility: { ownerActorId: 'owner-demo', status: 'assigned' } },
    note: 'M02 责任人已与业务 Owner 对齐。',
  });
  assert.equal(aligned.readyForG1, true);
});

test('refuses a mutation that would make the stored snapshot too large to read back', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aeos-g0-decisions-size-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'g0-decision-register.json');
  const store = new G0DecisionRegisterStore(file, () => new Date('2026-10-12T01:02:03.000Z'));
  const base = store.load();
  const historyEntry = (index: number) => ({
    eventId: `g0-decision-${String(index).padStart(36, '0')}`,
    revision: 1,
    field: 'g4Admission' as const,
    value: 'blocked_until_g1',
    decidedAt: '2026-10-12T01:02:03.000Z',
    actorId: 'manager-demo',
    tenantId: 'demo-tenant',
    note: 'x',
  });
  const sizeFor = (count: number) => Buffer.byteLength(JSON.stringify({
    ...base, revision: 1, history: Array.from({ length: count }, (_, index) => historyEntry(index)),
  }, null, 2) + '\n', 'utf8');
  let low = 0;
  let high = 10_000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (sizeFor(middle) <= MAX_FILE_BYTES) low = middle;
    else high = middle - 1;
  }
  const nearLimit = {
    ...base,
    revision: 1,
    history: Array.from({ length: low }, (_, index) => historyEntry(index)),
  };
  const nextSize = Buffer.byteLength(JSON.stringify({
    ...nearLimit,
    revision: 2,
    history: [...nearLimit.history, historyEntry(low)],
  }, null, 2) + '\n', 'utf8');
  assert.ok(sizeFor(low) <= MAX_FILE_BYTES);
  assert.ok(nextSize > MAX_FILE_BYTES);
  writeFileSync(file, JSON.stringify(nearLimit, null, 2) + '\n', 'utf8');

  assert.throws(
    () => store.record({ actor, patch: { g4Admission: 'blocked_until_g1' }, note: 'x' }),
    /超过大小上限/,
  );
  assert.equal(store.load().revision, 1);
});
