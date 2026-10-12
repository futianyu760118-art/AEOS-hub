# Dashboard MCP Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the authenticated M01 dashboard wait briefly for `company-control` to publish read-only tool metadata before its read-only data queries begin.

**Architecture:** Keep the existing fail-closed `McpAccessGateway`: it must still deny a tool whose live runtime metadata lacks `readOnlyHint`. Add a small, bounded readiness helper in the Hub that refreshes the live MCP inventory after the dashboard session starts, retries only while the configured dashboard tools are not yet marked read-only, then uses the resulting inventory for every dashboard call.

**Tech Stack:** Node.js/TypeScript, existing Codex app-server runtime, MCP runtime inventory, Node test runner.

**Spec:** User-reported empty M01 dashboard; audit evidence showing `MCP_NOT_READ_ONLY` denials while direct read-only `company-control/detail_orders_list` succeeds.

## Global Constraints

- Do not weaken or bypass `McpAccessGateway`'s runtime `readOnlyHint` check.
- Do not enable `demo-erp`, alter `mcp/registry.json`, business data, M01 authentication, or any write-capability policy.
- Retry only the local runtime inventory read, for a finite bounded duration; do not retry business writes or fabricate dashboard records.
- When MCP metadata never becomes ready, preserve the current safe-empty dashboard with a clear readiness warning.
- Preserve evidence recording for every actual MCP tool call.

## Review Focus

- Initial runtime inventory lacks tool annotations, later inventory is ready: dashboard calls must use the refreshed ready inventory. Tested in Task 1.
- Metadata never reaches ready state: no MCP data tool call is made and a bounded readiness error reaches the dashboard. Tested in Task 1.
- A tool appears but lacks `readOnlyHint`: it remains denied; the retry helper must not treat its name alone as ready. Tested in Task 1.
- `demo-erp` remains disabled while `company-control` is the configured source. Tested by existing registry tests and scope review.
- Concurrent dashboard loads continue sharing one in-flight load and do not create unbounded polling loops. Tested in Task 1.

---

### Task 1: Bounded Company-Control Readiness Refresh

**Files:**
- Modify: `src/server.ts:825-954`
- Create or modify: `test/dashboard-mcp-readiness.test.ts`

**Interfaces:**
- Consumes: `codexRuntime.listMcpServerStatus(): Promise<unknown>`, configured `company-control` tool names, and the existing `McpAccessGateway.callReadOnly` runtime-inventory contract.
- Produces: a local readiness helper returning the latest inventory only when required dashboard tools expose `annotations.readOnlyHint === true`, otherwise throwing a sanitized bounded-timeout error.

- [ ] **Step 1: Write failing readiness tests**

Cover an initially annotation-less `company-control` inventory followed by a ready inventory, and assert that dashboard tool calls receive the second inventory. Cover a permanently incomplete inventory and assert no tool call executes.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/dashboard-mcp-readiness.test.ts`

Expected: FAIL because no bounded inventory-readiness helper exists.

- [ ] **Step 3: Implement the bounded readiness helper and use it after `createSession`**

In `src/server.ts`, define a focused helper for the dashboard's configured `company-control` read-only tools. It should poll `listMcpServerStatus` a small fixed number of times with a short delay, return only a live inventory where all required tools have `readOnlyHint === true`, and surface a generic readiness warning/error after the limit. Refresh the capability registry from the ready inventory where practical. Do not change `McpAccessGateway`'s deny behavior.

- [ ] **Step 4: Run focused verification**

Run: `node --test test/dashboard-mcp-readiness.test.ts && node --test test/mcp-access-gateway.test.ts test/dashboard.test.ts && npm run check:types`

Expected: all tests pass; gateway tests still prove missing annotations are denied.

- [ ] **Step 5: Run live read-only acceptance**

Start or restart only the Hub, then invoke the authenticated dashboard refresh. Confirm the dashboard reports a returned data baseline and nonzero risk/attention count; do not create, edit, or close business records.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts test/dashboard-mcp-readiness.test.ts
git commit -m "fix(dashboard): wait for MCP read-only readiness"
```

## Self-Review

- **Spec coverage:** The single task targets the observed `MCP_NOT_READ_ONLY` startup race, while preserving the existing fail-closed access boundary.
- **Step scan:** The test defines the exact initial-not-ready and permanently-not-ready behavior before the helper implementation; live acceptance is read-only.
- **Type consistency:** The helper consumes the existing `listMcpServerStatus` return shape and passes the unchanged inventory object into `McpAccessGateway`.
- **Review focus:** All five stated failure modes are assigned to Task 1 tests or existing gateway coverage.
- **Proportion:** One narrowly scoped source change plus one focused test; no configuration or data migration.
