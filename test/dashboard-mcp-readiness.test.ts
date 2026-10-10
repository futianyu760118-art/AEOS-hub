import assert from 'node:assert/strict';
import test from 'node:test';
import { McpReadinessError, hasReadOnlyTools, waitForReadOnlyMcpTools } from '../src/mcp-readiness.ts';

const readyInventory = {
  data: [{
    name: 'company-control',
    tools: {
      detail_orders_list: { name: 'detail_orders_list', annotations: { readOnlyHint: true } },
      material_shortages_list: { name: 'material_shortages_list', annotations: { readOnlyHint: true } },
    },
  }],
};

const notReadyInventory = {
  data: [{
    name: 'company-control',
    tools: {
      detail_orders_list: { name: 'detail_orders_list', annotations: {} },
      material_shortages_list: { name: 'material_shortages_list', annotations: {} },
    },
  }],
};

test('waits for company-control to publish every required read-only annotation', async () => {
  const inventories = [notReadyInventory, readyInventory];
  let reads = 0;
  let sleeps = 0;
  const inventory = await waitForReadOnlyMcpTools({
    readInventory: async () => inventories[reads++],
    server: 'company-control',
    tools: ['detail_orders_list', 'material_shortages_list'],
    attempts: 2,
    delayMs: 1,
    sleep: async () => { sleeps += 1; },
  });
  assert.equal(inventory, readyInventory);
  assert.equal(reads, 2);
  assert.equal(sleeps, 1);
});

test('does not accept a listed tool without a read-only annotation', () => {
  assert.equal(hasReadOnlyTools(notReadyInventory, 'company-control', ['detail_orders_list']), false);
});

test('fails closed after the bounded readiness wait', async () => {
  await assert.rejects(
    () => waitForReadOnlyMcpTools({
      readInventory: async () => notReadyInventory,
      server: 'company-control',
      tools: ['detail_orders_list'],
      attempts: 2,
      delayMs: 0,
    }),
    (error: unknown) => error instanceof McpReadinessError && error.server === 'company-control',
  );
});
