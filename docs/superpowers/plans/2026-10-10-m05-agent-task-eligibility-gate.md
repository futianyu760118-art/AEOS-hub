# M05 Agent Task Eligibility Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the repository test-first workflow and complete each task as one independently reviewable, rollbackable commit.

**Goal:** Before any AEOS task can be handed to an Agent, let a manager see whether that Agent is eligible for the task and, when it is not, see the exact governance reason. This stage establishes the gate only; it does not dispatch work or permit an Agent to complete a business task.

**Architecture:** Extend the existing governed AI Harbor registry with a versioned *task service profile* for each Agent. A pure eligibility evaluator compares a task's tenant and type with the Agent's approved task types, lifecycle, access mode, bound Runtime, and latest Runtime verification. The server exposes a tenant-scoped read-only candidate endpoint. The Task Center renders this result as a decision aid, while its accountable assignee remains a human responsibility role and its existing business-owner verification remains unchanged.

**Tech Stack:** TypeScript, Node.js built-in test runner, Zod, existing atomic JSON persistence, existing M01 browser authentication, existing AI Harbor Runtime health verification, browser JavaScript.

**Spec sources:**

- `C:\Users\Administrator\Desktop\链路交接文档\AEOS Hub 后续开发需求文档 v2.0.docx` — RQ-02 requires Agent lifecycle, task applicability, tenant scope, data/access risk, version and health to be governed before routing.
- `C:\Users\Administrator\Desktop\AEOS多级Agent架构设计方案.md` — the L0–L3 hierarchy is a governance tree, not an unrestricted call graph; capabilities must stay controlled and read-only in the pilot.
- `docs/superpowers/plans/2026-10-10-m04-task-responsibility-loop.md` — M04 expressly blocks Agent assignment until lifecycle, task-type applicability, tenant, and health gates exist.

## Global Constraints

- Preserve M01 authentication, M02 audit/evidence behavior, the M03 Agent hierarchy and Runtime health checks, and the completed M04 human responsibility loop.
- Keep the current pilot read-only: no direct business-system write, arbitrary URL invocation, SQL execution, or automatic operational action.
- Keep `TaskRecord.currentAssignee` a human responsibility role in this release. An eligible Agent is a recommendation for a later human-approved assignment step, not a task owner and not an executor.
- Continue to require a non-Agent business Owner to verify or reject every pending Result. Eligibility never grants self-verification or completion authority.
- Do not trust a browser-supplied tenant, actor, Agent ID, task type, or health state. Resolve task and M01 actor context on the server; resolve Agent and Runtime state from the Harbor store.
- Keep existing persisted Harbor snapshots loadable. Add deterministic defaults for records created before the task-profile fields exist; do not rewrite a valid legacy snapshot merely by reading it.
- An Agent is eligible only when **all** gates pass: lifecycle is `active`; Agent status is usable; its service profile is read-only and approves the task type and tenant; it has a bound Runtime; that Runtime is usable; and its newest verification is `healthy`.
- Treat missing, stale, unverified, degraded, unhealthy, offline, suspended, retired, draft, or tenant-mismatched state as blocked—not as evidence of safety. Return a manager-readable blocked reason for each failed gate.
- Use stable machine-readable reason codes as well as Chinese explanatory text. The UI must distinguish “可作为后续人工派单候选” from “已派发”.
- Each task below begins with focused failing tests, ends with focused regression/type checks, and is committed separately. Do not stage `.env`, `.env.example`, local data snapshots, unrelated documents, or user changes.

## Review Focus

- Lifecycle `testing` and a task profile must not accidentally make an Agent eligible; only explicitly `active` may pass.
- A Runtime labelled online but with no fresh healthy verification must remain blocked.
- Tenant boundaries must fail closed: a task from one tenant can never list another tenant’s Agent as eligible.
- A page or API consumer cannot turn an eligibility result into dispatch, result submission, result verification, or business-system execution.
- Existing Agent registry snapshots, Harbor UI registration flow, task APIs, and Task Center state machine must continue working after the new optional profile fields are introduced.

## File Structure

- `src/harbor-store.ts` — add Agent service-profile schema, `testing` lifecycle, input validation, and safe legacy normalization.
- `test/harbor-store.test.ts` — profile/lifecycle validation and legacy-load regression coverage.
- `src/agent-task-eligibility.ts` — pure, side-effect-free eligibility contract and evaluator.
- `test/agent-task-eligibility.test.ts` — table-driven gate decision tests.
- `src/server.ts` — authenticated tenant-scoped read-only task-candidate route; no dispatch route.
- `test/task-agent-eligibility-api.test.ts` — HTTP authentication, tenant isolation, and safe response contract tests.
- `public/task-agent-eligibility.js` — browser-safe display policy helpers, kept independent of DOM/network code.
- `test/task-agent-eligibility-ui.test.ts` — manager-display policy regression tests.
- `public/app.js` — load/render eligible and blocked Agent candidates from a task card.
- `public/style.css` — narrowly scoped eligibility panel styles.

---

### Task 1: Governed Agent Service Profile and Lifecycle Readiness

**Files:**

- Modify: `src/harbor-store.ts`
- Modify: `test/harbor-store.test.ts`

**Interfaces:**

- Add `AgentTaskServiceProfile` beneath an Agent registration with: `profileVersion`, `businessOwner`, `technicalOwner`, `supportedTaskTypes`, `tenantIds`, `inputSchemaVersion`, `outputSchemaVersion`, `accessMode`, and `dataFreshnessMinutes`.
- Expand the existing lower-case lifecycle enum to include `testing` while preserving `draft`, `active`, `suspended`, and `retired` records.
- In this pilot, `accessMode` is constrained to `read_only`; it is descriptive governance metadata, not a credential or an executable permission.
- Existing snapshots missing the profile are normalized in memory to an unconfigured, non-routable profile. They must not become eligible by default.

- [ ] **Step 1: Write failing schema and legacy compatibility tests**

  Add tests proving that a newly created Agent accepts a complete read-only service profile and `testing` lifecycle. Prove that duplicate task types/tenant IDs, unsupported profile fields, invalid semantic versions, and non-read-only access modes fail validation. Create a pre-M05 serialized snapshot with no profile, load it, and assert it remains readable but is explicitly unconfigured/non-routable.

- [ ] **Step 2: Run the focused store test to verify it fails**

  Run: `node --test test/harbor-store.test.ts`

  Expected: FAIL because the service-profile schema and `testing` lifecycle do not yet exist.

- [ ] **Step 3: Implement schema, create-input allowlist, and safe normalizer**

  Add strict Zod schemas and export the profile types. Extend `HARBOR_AGENT_CREATE_KEYS` and creation validation only for the approved profile fields. Update legacy normalization so an old Agent gets a deterministic profile with no supported task types/tenant IDs; do not mutate the on-disk legacy source merely by reading. Keep all hierarchy, parent, Runtime-capability, and unique-code invariants intact.

- [ ] **Step 4: Add readiness invariants and regression coverage**

  Test that an `active` Agent must carry an explicit, non-empty approved profile before it can be considered routable by downstream code, while `draft`, `testing`, `suspended`, and `retired` Agents remain registrable. Do not change M03’s existing registration page into an activation workflow yet.

- [ ] **Step 5: Run focused and cross-module checks**

  Run: `node --test test/harbor-store.test.ts && npm run test:auth && npm run check:types`

  Expected: PASS.

- [ ] **Step 6: Commit the governed-profile slice**

  ```bash
  git add src/harbor-store.ts test/harbor-store.test.ts
  git commit -m "feat(agents): govern task service profiles"
  ```

### Task 2: Pure, Explainable Eligibility Evaluation

**Files:**

- Create: `src/agent-task-eligibility.ts`
- Create: `test/agent-task-eligibility.test.ts`

**Interfaces:**

- `AgentTaskEligibilityInput`: task identity, tenant ID, task type, and the Harbor Agent/Runtime snapshot needed for a decision.
- `AgentTaskEligibilityDecision`: `agentId`, `eligible`, `reasonCodes`, `reasons`, and a safe manager-facing readiness summary.
- `evaluateAgentTaskEligibility(input)` is deterministic and performs no I/O, persistence, Runtime probe, task mutation, or dispatch.
- A task type is an explicit controlled identifier. For M04 tasks that predate this field, map only the existing operating-case analysis category during server projection; never infer broad Agent capabilities from free-text title/role/skill data.

- [ ] **Step 1: Write table-driven failing tests for every gate**

  Cover one fully eligible Agent and blocked cases for: no profile, lifecycle not active, Agent offline/archived, tenant mismatch, task type unsupported, missing Runtime, Runtime offline/unstable, missing verification, and degraded/unhealthy verification. Assert that a Runtime’s `online` status alone does not pass without latest `healthy` verification. Assert reason codes are stable and that multiple failures are reported together.

- [ ] **Step 2: Run the focused evaluator test to verify it fails**

  Run: `node --test test/agent-task-eligibility.test.ts`

  Expected: FAIL because the evaluator does not exist.

- [ ] **Step 3: Implement the pure evaluator and controlled task-type mapping**

  Keep all eligibility rule constants in one module. Use strict input schemas; use a closed task-type set for this phase. Export a safe candidate projection that excludes instructions, endpoints, work directories, or credentials. A blocked decision must never be represented as eligible with a warning.

- [ ] **Step 4: Run evaluator and store regressions**

  Run: `node --test test/agent-task-eligibility.test.ts test/harbor-store.test.ts && npm run check:types`

  Expected: PASS.

- [ ] **Step 5: Commit the eligibility-rule slice**

  ```bash
  git add src/agent-task-eligibility.ts test/agent-task-eligibility.test.ts
  git commit -m "feat(agents): evaluate task eligibility gates"
  ```

### Task 3: Authenticated, Tenant-Scoped Candidate Query

**Files:**

- Modify: `src/server.ts`
- Create: `test/task-agent-eligibility-api.test.ts`

**Interfaces:**

- `GET /api/tasks/:taskId/agent-candidates` returns the task-safe candidate projection and eligibility decision for the authenticated task tenant.
- The endpoint derives its tenant and task type from the server-loaded task, not query parameters or browser input.
- It returns no dispatch token, Runtime endpoint/workdir, Agent instructions, secret, action URL, or capability invocation payload.
- It is read-only and creates no Evidence event; reviewing possible candidates is not an operational task mutation.

- [ ] **Step 1: Write failing HTTP tests for authorization and isolation**

  Authenticate as a known M01 actor and request candidates for a tenant-matched task. Assert the response contains only the safe decision projection. Assert unauthenticated access is rejected, a task outside the authenticated tenant is not disclosed, an unknown task returns the existing safe not-found behavior, and forged `tenantId`, `agentId`, `actor`, or task-type query values cannot alter the decision.

- [ ] **Step 2: Run the focused API test to verify it fails**

  Run: `node --test test/task-agent-eligibility-api.test.ts`

  Expected: FAIL because the route does not exist.

- [ ] **Step 3: Add the guarded read-only route**

  Reuse the existing M01 request-authentication and Task Center lookup path. Resolve the Task’s stored tenant and controlled type, load Harbor once, evaluate candidates, and return an explicit `dispatchEnabled: false` contract. Preserve existing `/api/tasks` behavior and do not add an Agent assignment mutation.

- [ ] **Step 4: Add no-side-effect regression tests**

  Verify that candidate reads do not modify task revision/history, Harbor revision, evidence JSONL, Runtime verification state, or task assignee. Verify a legacy M04 task is handled by the narrow default mapping rather than causing a broad recommendation.

- [ ] **Step 5: Run affected backend checks**

  Run: `node --test test/task-center.test.ts test/task-api.test.ts test/task-agent-eligibility-api.test.ts test/agent-task-eligibility.test.ts test/harbor-store.test.ts && npm run test:auth && npm run test:evidence-contract && npm run check:types`

  Expected: PASS.

- [ ] **Step 6: Commit the candidate API slice**

  ```bash
  git add src/server.ts test/task-agent-eligibility-api.test.ts
  git commit -m "feat(tasks): expose governed agent candidates"
  ```

### Task 4: Manager-Facing Candidate Explanation, Not Dispatch

**Files:**

- Create: `public/task-agent-eligibility.js`
- Create: `test/task-agent-eligibility-ui.test.ts`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**

- The task detail card gains a “查看 Agent 接手条件” action.
- The panel separates eligible candidates from blocked candidates and displays only safe labels: lifecycle, approved task types, Runtime verification time/status, and readable reasons.
- The eligible state’s only callout is “可作为后续人工派单候选；本阶段不会自动派发或执行。”

- [ ] **Step 1: Write failing browser-helper tests**

  Test that eligible candidates display the recommendation-only label, blocked candidates display their reasons, missing/old verification never renders “可派发”, and the generated view contains no buttons or action data attributes for dispatch, execution, result verification, or business writes.

- [ ] **Step 2: Run the focused UI test to verify it fails**

  Run: `node --test test/task-agent-eligibility-ui.test.ts`

  Expected: FAIL because the display-policy helper does not exist.

- [ ] **Step 3: Add the narrow Task Center panel**

  On explicit manager click, call the read-only candidate endpoint for that task and render its decision. Reuse the existing task-detail refresh flow. Do not change the human responsibility-role assignment control, and do not add auto-refresh polling, Agent dispatch, Runtime probing, or business-system action controls.

- [ ] **Step 4: Add static-auth coverage and run full client regressions**

  If a new static asset is added, add it to the M01 authenticated static-asset allowlist and test it returns only after login. Then run:

  ```bash
  node --check public/app.js
  node --check public/task-agent-eligibility.js
  node --test test/task-agent-eligibility-ui.test.ts test/task-center-ui.test.ts
  npm run test:dashboard
  npm run test:auth
  npm run check:types
  git diff --check
  ```

  Expected: PASS.

- [ ] **Step 5: Perform a local authenticated smoke check without dispatching work**

  At `http://127.0.0.1:8790`, open one existing task, view its Agent eligibility panel, and verify that it shows clear reason(s) when no configured healthy Agent exists. Do not create/modify business data, assign an Agent, submit a Result, or expose credentials.

- [ ] **Step 6: Commit the manager explanation slice**

  ```bash
  git add public/index.html public/app.js public/style.css public/task-agent-eligibility.js test/task-agent-eligibility-ui.test.ts test/m01-auth-integration.test.ts
  git commit -m "feat(tasks): explain agent task readiness"
  ```

## Self-Review

- **Spec coverage:** This is the smallest safe closure of the M04 prerequisite for RQ-02: lifecycle, explicit supported task type, tenant scope, read-only access risk, profile/schema version, Runtime binding, and independently verified health. It makes routing explainable to a manager while preserving human accountability.
- **Intentionally deferred:** Actual Agent task assignment, queue/dispatch, retry/cancel commands, response callbacks, Agent work-result submission, external-system onboarding OpenAPI, metrics/alerting, and full activation/change approval workflows. These require a later M06 plan because they change authority and operational side effects.
- **Compatibility:** The plan preserves M03’s lower-case persisted lifecycle format, extends it only with `testing`, defaults old records to non-routable, and makes no database/schema deployment requirement. It does not alter task transitions or M01 login.
- **Safety:** The eligibility result is advisory and read-only. The system fails closed whenever profile, tenant, lifecycle, Runtime, or health evidence is absent or unfit.
- **Proportion:** Four small vertical slices provide a usable manager decision surface without prematurely building an orchestration engine.
