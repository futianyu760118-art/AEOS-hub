import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { HarborStore } from '../src/harbor-store.ts';
import { boundedLimit } from '../src/http-security.ts';

function storeFixture(t: TestContext): HarborStore {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-security-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new HarborStore({
    file: join(dir, 'data', 'ai-harbor.json'),
    workspaceRoot: dir,
    clock: () => new Date('2026-09-28T00:00:00.000Z'),
    idFactory: (() => {
      let index = 0;
      return () => `security-${++index}`;
    })(),
  });
}

test('HTTP list limits fail closed for malformed values', () => {
  assert.equal(boundedLimit(null), 100);
  assert.equal(boundedLimit('25'), 25);
  assert.throws(() => boundedLimit('0'), /1 至 1000/);
  assert.throws(() => boundedLimit('not-a-number'), /1 至 1000/);
});

test('Harbor agent creation rejects unknown fields and validates hierarchy', (t) => {
  const store = storeFixture(t);
  const snapshot = store.load();
  const parent = snapshot.agents[0]!;

  assert.throws(
    () => store.createAgent({
      name: '字段污染 Agent',
      role: '测试',
      provider: 'openai',
      unexpected: 'must be rejected',
    }),
    /未知字段/,
  );

  const child = store.createAgent({
    name: 'L1 子 Agent',
    role: '测试',
    provider: 'openai',
    parentAgentId: parent.id,
    hierarchyLevel: 'L1',
  });
  assert.equal(child.parentAgentId, parent.id);
  assert.equal(child.hierarchyLevel, 'L1');
});
