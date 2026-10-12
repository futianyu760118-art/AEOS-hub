# G0 Decision Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated, auditable Hub interface for recording and freezing the decisions required to pass G0 governance freeze.

**Architecture:** Add a small versioned local decision register that stores Hub governance decisions only; it must not become a source of business facts or create Keycloak accounts, M02 integrations, or business-system writes. Expose it through a narrow authenticated HTTP boundary, then provide one focused Web console view for authorized managers to review, save, and see whether all G0 decisions are ready.

**Tech Stack:** TypeScript, Node.js built-in test runner, Zod, existing atomic JSON persistence, existing browser session actor context, plain browser JavaScript.

**Spec:** `C:\Users\Administrator\Desktop\AEOS Hub 10月12日后续开发优化计划.docx`

## Global Constraints

- Keep the change limited to the G0 decision register, its authenticated API, its Web view, and direct tests.
- Store governance choices and their audit context only; do not create identities, assign roles, call M02, or write any business-system data.
- Keep Hub boundaries intact: business facts remain in approved business systems, and local JSON remains a pilot buffer rather than an enterprise authority.
- Accept the authenticated server actor only; never accept a browser-supplied actor ID, tenant ID, or role assertion.
- Only a human actor with the existing `manager` role may change the G0 register; every rejected and accepted mutation must be auditable.
- Use atomic local persistence and append-only Evidence events for successful and rejected decision changes.
- Do not modify unrelated authentication, task, Agent, MCP, dashboard, or Harbor behavior.

## Review Focus

- A forged `actorId`, `tenantId`, or `roles` field in the browser body must never alter the server-resolved decision actor; Task 2 pins this.
- A non-manager, Agent, service, or system actor must receive a denial and produce a safe audit record; Task 2 pins this.
- A G0 readiness signal must remain false until all required decisions are complete and internally consistent; Task 1 pins this.
- The Order Delivery Risk path must require distinct Owner and Verify actor IDs unless an explicit delegated-verification choice is added in a later scope; Task 1 pins this.
- The UI must only present governance recording and readiness, never imply that accounts, M02, agents, or business actions were automatically created or approved; Task 3 pins this.

---

### Task 1: Versioned G0 Decision Register

**Files:**
- Create: `src/g0-decision-register.ts`
- Create: `test/g0-decision-register.test.ts`

**Interfaces:**
- Consumes: a server-resolved `{ actorId, tenantId }`, a controlled decision patch, and an existing `atomicWrite` helper.
- Produces: `G0DecisionRegisterStore.load(): G0DecisionSnapshot` and `G0DecisionRegisterStore.record(input): G0DecisionSnapshot`.
- Defines: `G0DecisionSnapshot` with first scenario, business Owner actor, Verify actor, demo tenant and organization scope, three-account authorization state, M02 responsibility status, task-store decision, G4 admission state, revision, and immutable decision history.

- [ ] **Step 1: Write failing register tests**

Create tests that assert a new register is incomplete; recording Order Delivery Risk with `owner-demo` and `verify-demo` remains incomplete until all required G0 choices are recorded; and an identical Owner/Verify pair is rejected.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/g0-decision-register.test.ts`

Expected: FAIL because the register module does not exist.

- [ ] **Step 3: Implement `G0DecisionRegisterStore` in `src/g0-decision-register.ts`**

Persist a Zod-validated, versioned snapshot to `data/g0-decision-register.json`. Model all G0 items as explicit recorded choices with decision timestamp, server actor, and note. Derive `readyForG1` only when the first scenario, distinct Owner/Verify actors, demo tenant scope, three-account authorization, M02 owner/status, task-store decision, and G4 gate are all complete.

- [ ] **Step 4: Run register tests and type checking**

Run: `node --test test/g0-decision-register.test.ts && npm run check:types`

Expected: PASS.

- [ ] **Step 5: Commit the register slice**

```bash
git add src/g0-decision-register.ts test/g0-decision-register.test.ts
git commit -m "feat(governance): add G0 decision register"
```

### Task 2: Authenticated G0 Decision API and Audit Events

**Files:**
- Create: `src/g0-decision-api.ts`
- Create: `test/g0-decision-api.test.ts`
- Modify: `src/server.ts: authenticated HTTP route handling and G0 register initialization only`

**Interfaces:**
- Consumes: `G0DecisionRegisterStore`, the authenticated `ActorContext`, request JSON, and the existing Evidence append function.
- Produces: `GET /api/governance/g0-decisions` and `PUT /api/governance/g0-decisions` responses with the current snapshot and readiness status.
- Guarantees: only a server-resolved human `manager` may record decisions; the request body cannot supply actor, tenant, or roles.

- [ ] **Step 1: Write failing API tests**

Cover manager read/write, ignored forged actor fields, non-manager/Agent/service denial, invalid Owner/Verify combination, and an Evidence event for both an accepted decision and an authorization denial.

- [ ] **Step 2: Run the focused API test to verify it fails**

Run: `node --test test/g0-decision-api.test.ts`

Expected: FAIL because the API module and routes do not exist.

- [ ] **Step 3: Implement `G0DecisionApi.handle` and the two server routes**

Pass the complete authenticated actor context from `src/server.ts` to the API. Authorize the `manager` role in the API, validate only controlled decision fields, write append-only Evidence entries without secrets or arbitrary browser fields, and return 401/403/400 as appropriate.

- [ ] **Step 4: Run API, register, and authentication regression tests**

Run: `node --test test/g0-decision-register.test.ts test/g0-decision-api.test.ts && npm run test:auth && npm run check:types`

Expected: PASS.

- [ ] **Step 5: Commit the API slice**

```bash
git add src/g0-decision-api.ts test/g0-decision-api.test.ts src/server.ts
git commit -m "feat(governance): add guarded G0 decision API"
```

### Task 3: Focused Governance Decision View

**Files:**
- Modify: `public/index.html: one G0 governance navigation entry and view`
- Modify: `public/app.js: G0 decision load, form, and save handlers only`
- Modify: `public/style.css: narrowly scoped G0 decision view styles only`
- Create: `test/g0-decision-ui.test.ts`

**Interfaces:**
- Consumes: the G0 API snapshot `{ decisions, readiness, history }`.
- Produces: a manager-facing form that records the G0 decisions and a read-only readiness/history display for all authenticated users.
- Must not produce: Keycloak provisioning, M02 calls, Agent dispatch, business-system writes, or browser-provided identity data.

- [ ] **Step 1: Write failing UI helper tests**

Assert that incomplete snapshots render the missing decision items, a ready snapshot renders G1 readiness, and the UI labels authorization as a decision rather than completed account provisioning.

- [ ] **Step 2: Run the focused UI test to verify it fails**

Run: `node --test test/g0-decision-ui.test.ts`

Expected: FAIL because the G0 UI helpers do not exist.

- [ ] **Step 3: Add the G0 governance view and API integration**

Use the existing Web navigation and fetch conventions. Present controlled fields for the G0 choices, a save action available only when the session reports `manager`, and a compact immutable decision history. On API denial, show the returned reason; never fall back to client-side authorization.

- [ ] **Step 4: Run UI, API, auth, and type regressions**

Run: `node --test test/g0-decision-ui.test.ts test/g0-decision-api.test.ts test/g0-decision-register.test.ts && npm run test:auth && npm run check:types`

Expected: PASS.

- [ ] **Step 5: Commit the UI slice**

```bash
git add public/index.html public/app.js public/style.css test/g0-decision-ui.test.ts
git commit -m "feat(governance): add G0 decision view"
```

## Self-Review

- **Spec coverage:** The plan captures the G0 decisions named in the supplied optimization plan and makes their readiness for G1 visible and auditable. It deliberately excludes actual Keycloak provisioning, M02 integration, Agent dispatch, and business writes.
- **Step scan:** Each task starts with a failing test, has one implementation unit, and ends with focused regression checks and a reviewable commit.
- **Type consistency:** The store owns decision persistence; the API owns authorization and Evidence events; `server.ts` only resolves the authenticated actor and routes; the browser consumes the returned snapshot.
- **Review Focus:** Owner/Verify separation, untrusted browser identity fields, non-manager denial, incomplete readiness, and non-automation UI wording are covered by the listed tasks.
- **Proportion:** Three independently testable slices add only the governance functionality requested and leave unrelated systems unchanged.
