# Task and Project Agent Result Linkage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an agent-run's source result from its governed task detail and from the workspace of the project containing that task.

**Architecture:** Persist the runtime-run correlation on the task when a governed run finishes. The task API will resolve that correlation into a task-scoped execution-result projection; the browser will use this projection in both the task detail and the project workspace instead of duplicating or trusting a client-side result. Existing Result verification remains unchanged.

**Tech Stack:** TypeScript, Node.js HTTP API, Zod, vanilla JavaScript, node:test.

**Spec:** User request in this conversation: "你做出一个详情联动；同时我项目模块也要一起联动起来".

## Global Constraints

- Only modify the task-result linkage, project workspace linkage, and their focused tests.
- Preserve the existing read-only execution boundary and the business Owner verification flow.
- Expose raw execution output only through the authenticated, tenant-scoped task/project APIs.
- Do not create a second persisted copy of the execution result.

## Review Focus

- A historical task without an agent run renders a clear empty state; covered by Task 2's UI test.
- A failed or pending execution run surfaces its state/error and is never presented as a verified business result; covered by Task 1's API test.
- A task from another tenant cannot expose a run through either task or project detail; covered by Task 1's authorization test.
- A project only displays runs for tasks linked to that project; covered by Task 2's project-workspace test.
- Execution output is escaped before browser rendering; covered by Task 2's rendering-source test.

---

### Task 1: Persist and serve a task-scoped execution result

**Files:**
- Modify: `src/task-center.ts`
- Modify: `src/task-api.ts`
- Modify: `src/server.ts`
- Test: `test/task-agent-run-api.test.ts`

**Interfaces:**
- Consumes: `AgentTaskRun.runtimeRunId`, `AgentTaskRun.runtimeSessionId`, and the execution-plane registry run record.
- Produces: optional `task.agentRun` correlation metadata and task/project API details containing `agentRun` with its current execution state, result, or error.

- [ ] **Step 1: Write failing API contract tests**

Add tests proving a completed agent run is correlated to its task and detail returns its raw result, a non-completed run is labelled as non-business-final, and another tenant receives no task/project detail.

- [ ] **Step 2: Run the focused API test to verify it fails**

Run: `node --test test/task-agent-run-api.test.ts`

Expected: FAIL because task records do not retain a runtime run correlation and task detail has no execution result projection.

- [ ] **Step 3: Add task correlation and API projection**

In `src/task-center.ts`, add a backwards-compatible optional agent-run correlation containing `runtimeRunId`, `runtimeSessionId`, `agentId`, `startedAt`, and `endedAt`; set it only from the server-side `AgentTaskRun`. In `src/task-api.ts`, inject a server-owned execution-run lookup and include a constrained `agentRun` projection in task detail and project task responses. In `src/server.ts`, supply the lookup from `executionPlane.list().runs`.

- [ ] **Step 4: Run the focused API test to verify it passes**

Run: `node --test test/task-agent-run-api.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/task-center.ts src/task-api.ts src/server.ts test/task-agent-run-api.test.ts
git commit -m "feat: expose linked agent run in task details"
```

### Task 2: Render one result detail in both task and project views

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`
- Test: `test/task-agent-result-linkage-ui.test.ts`

**Interfaces:**
- Consumes: task/project API `agentRun` projection from Task 1.
- Produces: an expandable task result panel and project workspace result summaries that link to the associated task detail.

- [ ] **Step 1: Write failing UI contract tests**

Add static/rendering tests for completed, failed, and absent `agentRun` data; assert the task panel and a project-linked task panel use escaped output and retain the pending-verification notice.

- [ ] **Step 2: Run the focused UI test to verify it fails**

Run: `node --test test/task-agent-result-linkage-ui.test.ts`

Expected: FAIL because no shared agent-result renderer or project workspace result panel exists.

- [ ] **Step 3: Implement a shared browser result renderer**

In `public/app.js`, add one escaped renderer for execution result state, structured output/error, and the task Result verification state. Fetch project task details when a project opens and render each linked task's result in the workspace; task "查看历史" uses the same renderer. Add compact, responsive styles in `public/style.css`.

- [ ] **Step 4: Run the focused UI test to verify it passes**

Run: `node --test test/task-agent-result-linkage-ui.test.ts`

Expected: PASS.

- [ ] **Step 5: Run regression checks**

Run: `node --test test/task-agent-run-api.test.ts test/project-api.test.ts test/project-center-ui.test.ts test/task-agent-result-linkage-ui.test.ts && npm run check:types && node --check public/app.js && git diff --check`

Expected: all tests and checks pass.

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/style.css test/task-agent-result-linkage-ui.test.ts
git commit -m "feat: link agent results in task and project views"
```
