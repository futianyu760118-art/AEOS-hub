# M04 Task Responsibility Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a manager create one traceable task from an existing operating case, assign one accountable responsibility role, follow its state and evidence, and require business-owner verification before the task can be completed.

**Architecture:** Keep `OperatingCenterStore` as the evidence-bound source of operating cases and add a separate local `TaskCenterStore` for task records and immutable task-history entries. The server is the orchestration boundary: it validates the source case, uses the authenticated M01 actor as the initiator, writes task events to existing Evidence, and later will ask the Agent Registry and dispatch policy whether an Agent is eligible. This first slice supports accountable human roles; it deliberately does not execute business actions or let an Agent verify its own result.

**Tech Stack:** TypeScript, Node.js built-in test runner, Zod, existing atomic JSON persistence, M01 browser authentication, Evidence JSONL pilot buffer, browser JavaScript.

**Spec:** `C:\Users\Administrator\Desktop\链路交接文档\AEOS Hub 后续开发需求文档 v2.0.docx`

## Global Constraints

- Implement RQ-01 before automatic Agent dispatch: the current deliverable is a human-accountable task loop built on existing operating cases and Result Verify.
- Use the required task states exactly: `DRAFT`, `ASSIGNED`, `ACCEPTED`, `IN_PROGRESS`, `AWAITING_DECISION`, `AWAITING_VERIFY`, `COMPLETED`, `REJECTED`, `FAILED`, `CANCELLED`.
- Every state transition, assignment, reassignment, reminder, evidence supplement, escalation, and verification must preserve actor, time, reason, task ID, correlation ID, and evidence references; no history entry may be overwritten.
- A task has exactly one current accountable assignee. This M04 slice accepts an accountable responsibility role; Agent assignment remains blocked until RQ-02 lifecycle, task-type applicability, tenant, and health gates are complete.
- Use M01 authenticated actor context at HTTP boundaries. Do not accept a browser-supplied actor name for task creation, transition, or verification.
- Results remain `PENDING` until a business Owner verifies or rejects them. Agents and system identities can never set a result or task to completed/verified.
- Hub stores task metadata and evidence links only; do not connect directly to business databases and do not execute operational writes.
- Preserve all existing operating-center snapshots and UI behavior. Use a new atomic local task-store file; local JSONL remains a trial buffer, not enterprise authority.
- Implement task-by-task with test-first checks and one rollbackable commit per independently reviewable deliverable.

## Review Focus

- A retry of task creation from the same case must not create duplicate current tasks; Task 1 pins idempotent source-case creation.
- Invalid or skipped state transitions cannot overwrite the task’s current assignee or history; Task 1 pins valid transition matrix and append-only history.
- A browser-submitted actor cannot impersonate another person; Task 2 pins server-side M01 actor injection.
- A pending Agent analysis cannot close a task until a non-Agent business owner verifies or rejects it; Task 2 pins Result-to-task outcome linkage.
- A timed-out or failed task must show the accountable role and a next action, never `COMPLETED`; Task 3 pins display and API projection.

---

## File Structure

- `src/task-center.ts` — Task contract, state transition matrix, assignment/history records, local atomic persistence, and source-case idempotency.
- `test/task-center.test.ts` — Task creation, transition, reassign, evidence supplement, escalation, and verification-state regression tests.
- `src/server.ts` — authenticated task APIs; operating-case lookup; Evidence event append; Result Verify-to-task linkage.
- `test/task-api.test.ts` — HTTP-level actor injection and guarded task API behavior, using an isolated store/test server seam.
- `public/index.html` — a Task Center navigation target and minimal task detail modal structure.
- `public/app.js` — task list, create-from-case action, human-role assignment, state update, evidence supplement, and verification display.
- `public/style.css` — narrowly scoped Task Center presentation styles.

### Task 1: Evidence-Bound Task Store and State Machine

**Files:**
- Create: `src/task-center.ts`
- Create: `test/task-center.test.ts`

**Interfaces:**
- Consumes an existing operating-case reference: `{ caseId, source, entityId, title, evidenceRefs, ownerRole }`.
- Produces `TaskRecord` with `taskId`, `tenantId`, `businessObjectRef`, `caseId`, `evidenceRefs`, `priority`, `dueAt`, `initiatedBy`, `currentAssignee`, `status`, `correlationId`, `createdAt`, and `updatedAt`.
- Produces append-only `TaskHistoryEntry` with `eventId`, `taskId`, `eventType`, `fromStatus`, `toStatus`, `actor`, `reason`, `evidenceRefs`, and `occurredAt`.
- Exposes `TaskCenterStore.createFromOperatingCase`, `assign`, `transition`, `supplementEvidence`, `escalate`, `recordPendingResult`, `verifyResult`, and `load`.

- [ ] **Step 1: Write failing tests for idempotent task creation and the required state matrix**

  Create a task from an evidence-bound operating case. Assert a repeat with the same open case returns the same task rather than a second active task. Assert `DRAFT → ASSIGNED → ACCEPTED → IN_PROGRESS → AWAITING_VERIFY → COMPLETED` succeeds, while skipping from `DRAFT` to `COMPLETED` fails.

- [ ] **Step 2: Run the focused store test to verify it fails**

  Run: `node --test test/task-center.test.ts`

  Expected: FAIL because `src/task-center.ts` does not exist.

- [ ] **Step 3: Implement the Task and history schemas plus atomic local store**

  Use Zod strict schemas and a versioned `data/task-center.json` snapshot. Use a fixed transition matrix; append history for every mutation. Seed nothing. Require at least one evidence reference, a non-empty correlation ID, and one responsibility-role assignee for `ASSIGNED` and subsequent states.

- [ ] **Step 4: Add failing tests for reassignment, evidence supplementation, escalation, and result verification control**

  Assert reassignment preserves the former assignee in history; evidence additions deduplicate but never remove existing refs; escalation moves an unfinished task to `AWAITING_DECISION` with a required next-action reason; and `verifyResult` rejects actor IDs beginning with `agent:` or `system:`.

- [ ] **Step 5: Implement the remaining store operations**

  Ensure `recordPendingResult` moves a task only to `AWAITING_VERIFY`; `verifyResult(VERIFIED)` moves it to `COMPLETED`, while `verifyResult(REJECTED)` moves it to `REJECTED`. `FAILED` and overdue escalation retain the assigned responsibility role and may never be represented as complete.

- [ ] **Step 6: Run store tests and type checking**

  Run: `node --test test/task-center.test.ts && npm run check:types`

  Expected: PASS.

- [ ] **Step 7: Commit the task-store slice**

  ```bash
  git add src/task-center.ts test/task-center.test.ts
  git commit -m "feat(tasks): add evidence-bound responsibility store"
  ```

### Task 2: Authenticated Task APIs and Evidence Linkage

**Files:**
- Modify: `src/server.ts: authenticated route handling and operating-case/result handlers`
- Create: `test/task-api.test.ts`
- Modify: `test/operating-center.test.ts` only when a shared Result-to-task adapter is needed

**Interfaces:**
- `POST /api/operating-cases/:caseId/tasks` — creates/returns the idempotent task using the server-resolved M01 actor.
- `GET /api/tasks`, `GET /api/tasks/:taskId` — list/read task state and history.
- `POST /api/tasks/:taskId/assignments`, `POST /api/tasks/:taskId/transitions`, `POST /api/tasks/:taskId/evidence`, `POST /api/tasks/:taskId/escalations` — task mutations using the server-resolved actor.
- `POST /api/tasks/:taskId/results` and `POST /api/tasks/:taskId/results/:resultId/verify` — pending result and owner verification operations; request payload never supplies the actor.

- [ ] **Step 1: Write failing HTTP tests for task creation and trusted actor injection**

  Use a test seam around the route handler to create a task from a known operating case. Send a forged `actor` field and assert the resulting task/history use only the M01 session actor. Assert unknown case ID, unauthenticated request, and a missing evidence context fail closed.

- [ ] **Step 2: Run the focused API test to verify it fails**

  Run: `node --test test/task-api.test.ts`

  Expected: FAIL because task routes do not exist.

- [ ] **Step 3: Add guarded task routes and Evidence events**

  Resolve the source case from `operatingCenter.load()` before calling the task store. For every successful mutation append an `app_event` Evidence entry carrying task ID, correlation ID, source case ID, safe actor ID, state/action, and evidence references. Do not include credentials or arbitrary user payloads.

- [ ] **Step 4: Add failing tests for Result verification and failure visibility**

  Assert posting an Agent result creates a `PENDING` Result and an `AWAITING_VERIFY` task; an Agent verification request is rejected; owner verification changes both result and task outcome; a `FAILED` task response retains its assignee and next action.

- [ ] **Step 5: Connect existing Result Contract verification to task state**

  Reuse `OperatingCenterStore.createPendingResult` and `verifyResult` rather than duplicating the Result schema. Bridge the verified/rejected Result outcome into `TaskCenterStore.verifyResult`; leave operating-case closure as an explicit separate human decision.

- [ ] **Step 6: Run affected checks**

  Run: `node --test test/task-center.test.ts test/task-api.test.ts test/operating-center.test.ts && npm run test:auth && npm run test:evidence-contract && npm run check:types`

  Expected: PASS.

- [ ] **Step 7: Commit the API slice**

  ```bash
  git add src/server.ts test/task-api.test.ts test/operating-center.test.ts
  git commit -m "feat(tasks): add authenticated responsibility APIs"
  ```

### Task 3: Minimal Task Center for Managers

**Files:**
- Modify: `public/index.html: navigation and task center view/modal`
- Modify: `public/app.js: task data loading, create/assign/transition actions, and rendering`
- Modify: `public/style.css: task center styles`
- Create: `test/task-center-ui.test.ts`

**Interfaces:**
- Consumes the read/task mutation APIs from Task 2.
- Produces manager-readable task cards showing source case, accountable role, deadline, current state, evidence count, current blocker, next action, and immutable history.

- [ ] **Step 1: Write failing client-helper tests for task display decisions**

  Test that a failed/overdue task is rendered as attention required with assigned role and next action; a `PENDING` result renders as awaiting business verification; no UI control advertises automatic business execution or Agent self-verification.

- [ ] **Step 2: Run the focused UI test to verify it fails**

  Run: `node --test test/task-center-ui.test.ts`

  Expected: FAIL because task UI helpers do not exist.

- [ ] **Step 3: Add the narrow Task Center UI**

  Add a Tasks navigation item and a list/detail view. From an existing operating case, allow a manager to create the task, select one responsibility role, record a reason, update a valid next state, attach an evidence reference, and submit an Agent analysis as pending. Render verification as a distinct business-owner action. Do not add automated dispatch, external notifications, or business-system write controls.

- [ ] **Step 4: Run UI/helper and regression checks**

  Run: `node --test test/task-center-ui.test.ts && npm run test:dashboard && npm run test:operating-center && npm run test:auth && npm run check:types`

  Expected: PASS.

- [ ] **Step 5: Perform a local authenticated smoke check without creating business-system writes**

  Log into `http://127.0.0.1:8790`, create one task from an existing dashboard operating case, assign a responsibility role, verify that its state/history/evidence render, then stop before submitting a business operation.

- [ ] **Step 6: Commit the UI slice**

  ```bash
  git add public/index.html public/app.js public/style.css test/task-center-ui.test.ts
  git commit -m "feat(tasks): add manager responsibility center"
  ```

## Self-Review

- **Spec coverage:** This plan implements the smallest independently usable RQ-01 closure: task ID/correlation ID, source/evidence trace, current accountable role, complete state model, immutable responsibility history, pending Result, and business-owner Verify/Reject. It preserves the document’s no-direct-business-write boundary.
- **Intentional gaps:** RQ-02 full Agent lifecycle/health/task-type eligibility, RQ-03 explainable Agent recommendation and human dispatch control, RQ-04 M02 enterprise delivery, RQ-05 OpenAPI/JSON Schemas, and RQ-06 monitoring/CI are separate P0/P1 plans. Agent assignment is therefore not enabled prematurely.
- **Type consistency:** Task record references existing `OperatingCase.id`, `ResultContract.result_id`, M01 actor IDs, and Evidence correlation IDs. Server mutations use the TaskStore signatures established in Task 1.
- **Review focus:** Every listed failure mode is assigned to a test in Task 1, 2, or 3.
- **Proportion:** The plan adds one dedicated task store, guarded APIs, and one manager surface; it does not redesign the existing operating-center data or create a second workflow engine.
