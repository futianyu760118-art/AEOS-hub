import assert from 'node:assert/strict';
import test from 'node:test';
import { collectMcpPages } from '../src/mcp-pagination.ts';

function response(page: number, total: number, ids: string[]) {
  return {
    structuredContent: {
      source: 'company-control', data_confidence: 'high', data_as_of: '2026-09-23T00:00:00Z',
      data: ids.map((id) => ({ id })), evidence_refs: ids.map((id) => `control-platform://order/${id}@t`),
      page: { page, page_size: 50, total, truncated: page * 50 < total },
    },
  };
}

test('collects every available page and retains each row evidence reference', async () => {
  const firstPage = Array.from({ length: 50 }, (_, index) => `item-${index + 1}`);
  const secondPage = Array.from({ length: 5 }, (_, index) => `item-${index + 51}`);
  const payload = await collectMcpPages(async ({ page }) => page === 1
    ? response(1, 55, firstPage) : response(2, 55, secondPage), {}, 4) as { structuredContent: Record<string, unknown> };
  const result = payload.structuredContent;
  assert.equal((result.data as unknown[]).length, 55);
  assert.equal((result.page as Record<string, unknown>).truncated, false);
  assert.equal((result.evidence_refs as string[]).length, 55);
});

test('marks a capped result as partial instead of presenting it as complete', async () => {
  const payload = await collectMcpPages(async ({ page }) => response(Number(page), 500, [`item-${page}`]), {}, 2) as { structuredContent: Record<string, unknown> };
  assert.equal((payload.structuredContent.page as Record<string, unknown>).truncated, true);
  assert.ok((payload.structuredContent.warnings as string[]).some((warning) => warning.includes('部分数据')));
  assert.equal(payload.structuredContent.data_confidence, 'low');
});

test('preserves medium confidence across every complete page', async () => {
  const mediumResponse = (page: number) => ({
    structuredContent: {
      source: 'company-control', data_confidence: 'medium', data_as_of: '2026-09-28T15:28:43',
      data: [{ id: `item-${page}` }], page: { page, page_size: 1, total: 2, truncated: page < 2 },
    },
  });
  const payload = await collectMcpPages(async ({ page }) => mediumResponse(Number(page)), {}, 2) as { structuredContent: Record<string, unknown> };
  assert.equal(payload.structuredContent.data_confidence, 'medium');
});
