# Realtime Control Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Attention Center real-time company-control queries accurate, transparent, and usable without hidden checkbox-and-Enter interaction.

**Architecture:** Retain the read-only dashboard snapshot as the sole middle-platform read path. Strengthen bounded pagination and production-capacity contract adaptation, extend the pure live-search mapper to browse or search by domain, then replace the hidden UI trigger with an explicit query action.

**Tech Stack:** TypeScript, Node built-in test runner, Zod, existing MCP gateway, static HTML, CSS, and JavaScript.

**Spec:** `docs/superpowers/specs/2026-10-08-realtime-control-query.md`

## Global Constraints

- All company-control calls remain read-only and preserve actual evidence references.
- Stale, partial, unknown, and malformed data remains low or unknown confidence.
- Production capacity uses `date_start` and `date_end` exactly as required by the company-control contract.
- Page reads remain bounded; a page-cap or malformed response must be reported as partial.
- This change does not deploy or write business data.

## Review Focus

- Numeric cursors must advance to the correct page, and unusable cursors must keep a partial warning. Task 1 owns this test.
- Capacity must use `date_start` and `date_end`, not legacy names. Task 2 owns this test.
- An explicit blank live query must browse bounded available items instead of claiming no match. Task 3 owns this test.
- A production-only query must return a production overview without inventing a risk. Task 3 owns this test.
- Partial, stale, and unavailable data must be visually distinct from a valid zero-result query. Task 4 owns this check.

---

### Task 1: Make MCP pagination cursor-aware

**Files:**
- Modify: `src/mcp-pagination.ts`
- Modify: `test/mcp-pagination.test.ts`

**Interfaces:**
- Consumes: list envelopes with `data`, `page.total`, `page.truncated`, and optional `page.next_cursor`.
- Produces: backward-compatible `collectMcpPages(call, args, maxPages?, pageSize?)` normalized envelopes.

- [ ] Add a failing test where page 1 returns `next_cursor: '7'` and assert that the next read requests page 7.
- [ ] Add a failing test for a non-numeric cursor and assert the result stays partial with a cursor warning.
- [ ] Run `npm run test:pagination` and confirm the new tests fail.
- [ ] Change `collectMcpPages` to track request page separately from the page-budget counter; use a positive numeric cursor when supplied, otherwise use sequential pages; preserve partial warnings for read errors, repeats, malformed cursors, and page caps.
- [ ] Run `npm run test:pagination` and confirm it passes.
- [ ] Commit with `git add src/mcp-pagination.ts test/mcp-pagination.test.ts` and `git commit -m "fix: make MCP pagination cursor-aware"`.

### Task 2: Align production reads with the company-control contract

**Files:**
- Create: `src/dashboard-read-plan.ts`
- Modify: `src/server.ts`
- Modify: `src/production-coordination.ts`
- Create: `test/dashboard-read-plan.test.ts`
- Modify: `test/production-coordination.test.ts`

**Interfaces:**
- Produces: `dashboardReadPlan(now: Date)` with order, kitting, and capacity query ranges; capacity range uses `date_start` and `date_end`.
- Produces: `ProductionSummary` fields sufficient for a bounded production overview, with malformed inputs retained as warnings.

- [ ] Add a failing `dashboardReadPlan` test that checks the exact capacity parameter names and dates.
- [ ] Add a production-summary test for a valid capacity data array and a malformed capacity response.
- [ ] Run `node --test test/dashboard-read-plan.test.ts test/production-coordination.test.ts` and confirm the new request-plan case fails.
- [ ] Extract dashboard query date windows from `src/server.ts`; replace the current invalid capacity argument names with the plan's `date_start` and `date_end`; use one page size valid for current and legacy company-control list capabilities.
- [ ] Keep capacity count, data timestamp, confidence, warnings, work-order rows, and evidence references in `ProductionSummary`; do not infer production risk from missing fields.
- [ ] Run `node --test test/dashboard-read-plan.test.ts test/production-coordination.test.ts && npm run check:types` and confirm it passes.
- [ ] Commit with `git add src/dashboard-read-plan.ts src/server.ts src/production-coordination.ts test/dashboard-read-plan.test.ts test/production-coordination.test.ts` and `git commit -m "fix: align production dashboard reads with control contract"`.

### Task 3: Make live search browseable and source-scoped

**Files:**
- Modify: `src/attention-search.ts`
- Modify: `src/server.ts`
- Modify: `test/attention-search.test.ts`

**Interfaces:**
- Consumes: `{ query: string; live: true; source?: 'all' | 'order' | 'kitting' | 'quality' | 'production' }`.
- Produces: `AttentionLiveSearchResult` with evidence-backed risk records and a production overview record where applicable.

- [ ] Add failing tests for an empty live query returning bounded results and production-only scope returning an overview without an invented risk.
- [ ] Run `npm run test:attention-search` and confirm the cases fail because the schema requires text and production is omitted.
- [ ] Permit an empty trimmed query only in explicit live requests; filter by requested source before optional keyword matching.
- [ ] Create production overview records only from returned work-order, capacity-count, timestamp, confidence, warning, and evidence fields; preserve source degradation status.
- [ ] Update `/api/attention/search` to pass the structured request to the mapper while preserving its read-only behavior.
- [ ] Run `npm run test:attention-search && npm run check:types` and confirm it passes.
- [ ] Commit with `git add src/attention-search.ts src/server.ts test/attention-search.test.ts` and `git commit -m "feat: make live control queries scoped and browseable"`.

### Task 4: Replace hidden live-search controls with a query workspace

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: Attention filter state and `/api/attention/search` results.
- Produces: an explicit `核查中台` button, source scope including production, plain-language query status, and distinct degraded-data details.

- [ ] Replace the “实时核查中台” checkbox with a visible `核查中台` button and add a hint that empty input means viewing available items.
- [ ] Add `生产协同` to the source filter and pass the selected scope with every live request.
- [ ] Keep input typing as immediate local filtering; make the button the primary live-query action and retain Enter only as an optional shortcut.
- [ ] Add loading and last-result state so a new request never silently clears the previous result.
- [ ] Render completed, partial, unavailable, and zero-match states separately; show data time, loaded quantity, and warnings apart from result cards.
- [ ] Apply a compact two-row enterprise toolbar with clear primary action, readable status, responsive stacking, and existing keyboard-focus behavior.
- [ ] Manually check local filtering, blank live browse, keyword query, all source scopes, partial data, unavailable data, and narrow viewport layout.
- [ ] Commit with `git add public/index.html public/app.js public/style.css` and `git commit -m "feat: simplify Attention live control queries"`.

### Task 5: Verify without deployment

**Files:**
- Modify: no product files expected

**Interfaces:**
- Consumes: Tasks 1 through 4.
- Produces: passing focused tests, full tests, type check, and Docker configuration validation.

- [ ] Run `npm run test:pagination && node --test test/dashboard-read-plan.test.ts && npm run test:production && npm run test:attention-search`.
- [ ] Run `npm test && npm run check:types && git diff --check`.
- [ ] Run `docker compose config --quiet`.
- [ ] Commit the verified change set with a scoped message, without deployment.

## Self Review

- Coverage: Tasks 1 and 2 fix middle-platform compatibility; Task 3 fixes browse and search semantics; Task 4 replaces the confusing interaction; Task 5 validates the result.
- Type consistency: the plan keeps `collectMcpPages` compatible, uses a pure query plan for server arguments, and keeps `AttentionLiveSearchResult` as the browser API boundary.
- Review Focus: each listed failure mode has named test or UI verification ownership.
- Proportion: implementation decisions are documented without embedding code bodies.
