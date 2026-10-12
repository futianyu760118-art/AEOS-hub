# G1 Action RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce tenant-, role-, and assigned-person-based authorization for the human order-delivery-risk task loop, with auditable denials.

**Architecture:** Keep Keycloak/M01 as the authoritative identity provider and pass its complete authenticated actor context into the task boundary. Add a focused authorization policy to TaskApi and bind a task assignment to one actor ID as well as its business role, so task operations can be checked against both role and assigned resource; do not turn Hub into an identity directory or provision Keycloak users from the Web UI.

**Tech Stack:** TypeScript, Node.js built-in test runner, Zod, existing M01 ActorContext, TaskCenterStore, Evidence JSONL pilot buffer, plain browser JavaScript.

**Spec:** `C:\Users\Administrator\Desktop\AEOS Hub 10月12日后续开发优化计划.docx`

## Global Constraints

- Keep changes limited to M01 actor propagation, task authorization, task assignment identity, directly affected task UI, and focused tests.
- M01/Keycloak remains the authoritative source for identity, tenant, organization, and roles; the Hub must not create accounts or store passwords.
- The first G1 scenario is the G0-approved `order_delivery_risk` path; do not add Agent dispatch, M02 writes, or business-system writes.
- Enforce all permissions on the server; browser role fields, actor IDs, tenant IDs, and requested actions are untrusted.
- Require a manager to create, assign, or reassign; require the assigned operator to accept, start, supplement evidence, and submit a human result; require the registered business Owner to Verify or Reject.
- Agents and system identities must remain unable to verify, reject, or submit a task result before G4.
- Every accepted and denied mutation must preserve safe actor, tenant, task, correlation, state, and evidence context; deny cross-tenant access without leaking task data.
- Preserve legacy task snapshots by explicitly migrating role-only assignments to a safe `unassigned` state that requires manager reassignment before an operator action.
- Do not modify unrelated M01, dashboard, Agent, MCP, Harbor, or business-data code.

## Review Focus

- A browser body that claims `manager`, another actor ID, or another tenant must not obtain a privileged action; Task 2 pins this.
- A correct-role operator who is not the task's assigned person must be denied for accept, process, evidence, and submit-result operations; Task 1 and Task 2 pin this.
- A human with `owner` role but not the G0-registered Owner actor must be denied Verify/Reject; Task 2 pins this.
- Existing role-only task records must never become actionable by an arbitrary operator after migration; Task 1 pins this.
- Agent/system identities must remain blocked from result submission and verification even if their request carries a human role field; Task 2 pins this.

---

### Task 1: Actor-Bound Assignment Contract and Authorization Policy

**Files:**
- Modify: `src/task-center.ts: TaskAssignee schema, snapshot migration, assignment mutation, and operator-bound task transitions`
- Create: `src/task-authorization.ts`
- Modify: `test/task-center.test.ts`
- Create: `test/task-authorization.test.ts`

**Interfaces:**
- Consumes: the M01-safe actor shape `{ actorId, actorType, tenantId, roles }`, a task record, and G0 registered Owner actor ID supplied by TaskApi.
- Produces: `TaskAssignee` containing `{ kind: 'responsibility_role', role, actorId, assignedAt }` and `authorizeTaskAction(input): AuthorizationDecision`.
- Defines: actions `create`, `assign`, `reassign`, `accept`, `start`, `supplement_evidence`, `submit_result`, `verify`, and `reject` with manager/operator/owner rules.

- [ ] **Step 1: Write failing store and policy tests**

Assert a task assignment contains both the business role and intended operator actor ID; a role-only legacy assignment loads as unassigned and needs manager reassignment; the assigned operator passes operator actions while another operator is denied; and each action maps to the specified role requirement.

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `node --test test/task-center.test.ts test/task-authorization.test.ts`

Expected: FAIL because actor-bound assignment and the authorization module do not exist.

- [ ] **Step 3: Implement the minimal task assignment migration and `authorizeTaskAction`**

Make `TaskCenterStore.assign` require `assigneeActorId`. Preserve history and evidence. Migrate only persisted role-only assignments to a state with no actionable person, retaining their historical role but requiring reassignment. Keep policy pure: it returns a safe allow/deny code rather than writing Evidence or reading HTTP.

- [ ] **Step 4: Run focused tests and type checking**

Run: `node --test test/task-center.test.ts test/task-authorization.test.ts && npm run check:types`

Expected: PASS.

- [ ] **Step 5: Commit the task-contract slice**

```bash
git add src/task-center.ts src/task-authorization.ts test/task-center.test.ts test/task-authorization.test.ts
git commit -m "feat(tasks): bind assignments to authorized actors"
```

### Task 2: Server-Enforced Task RBAC and Denial Audit

**Files:**
- Modify: `src/task-api.ts: actor shape, action checks, G0 Owner lookup, and safe accepted/denied audits`
- Modify: `src/server.ts: pass the complete authenticated actor context to TaskApi only`
- Modify: `test/task-api.test.ts`

**Interfaces:**
- Consumes: `authorizeTaskAction`, `TaskAssignee.actorId`, authenticated M01 actor roles, and `G0DecisionRegisterStore.load()`.
- Produces: guarded task endpoints whose mutation routes return 403 for missing role, wrong assignee, wrong registered Owner, Agent/system actor, or another tenant, with a safe Evidence event.
- Guarantees: task reads remain tenant-scoped; authorization never uses body identity fields.

- [ ] **Step 1: Write failing API tests for each G1 responsibility**

Create a G0-ready order-delivery fixture. Assert manager creates and assigns; only the assigned `operator` accepts, starts, supplements evidence, and submits; only the registered `owner` with owner role verifies/rejects; manager/operator/other-owner/Agent/system attempts are denied and audited. Include forged body actor/role/tenant fields and cross-tenant task access.

- [ ] **Step 2: Run the focused API test to verify it fails**

Run: `node --test test/task-api.test.ts`

Expected: FAIL because current TaskApi does not enforce action-level roles or assigned-person scope.

- [ ] **Step 3: Implement TaskApi authorization before every mutation**

Extend the server-supplied TaskApi actor with roles and organization ID only from `ActorContext`. For order-delivery verification, look up the G0 registered business Owner actor. Call the pure policy before each mutation; on denial emit a minimal Evidence event that names only trusted actor/task context and a policy code. Agent result submission remains disabled until G4.

- [ ] **Step 4: Run TaskApi, G0, authentication, and type regression tests**

Run: `node --test test/task-center.test.ts test/task-authorization.test.ts test/task-api.test.ts test/g0-decision-register.test.ts test/g0-decision-api.test.ts && npm run test:auth && npm run check:types`

Expected: PASS.

- [ ] **Step 5: Commit the authorization slice**

```bash
git add src/task-api.ts src/server.ts test/task-api.test.ts
git commit -m "feat(authz): enforce task action RBAC"
```

### Task 3: Role-Aware Task Center and G1 Acceptance Guide

**Files:**
- Modify: `public/index.html: assignment input and task-action labels only`
- Modify: `public/app.js: session-role policy projection, actor-bound assignment payload, and denial feedback only`
- Modify: `public/style.css: only styles needed by the revised assignment fields`
- Modify: `test/task-center-ui.test.ts`
- Create: `docs/auth/g1-three-account-acceptance.md`

**Interfaces:**
- Consumes: safe task projection including `currentAssignee.actorId`, session roles, and 403 error responses.
- Produces: a manager assignment form requiring intended operator actor ID, read-only/disabled controls for unauthorized UI roles, and an acceptance guide for Keycloak-side creation of `manager-demo`, `operator-demo`, and `owner-demo` in one demo tenant.
- Must not produce: a Keycloak management API, account password, direct M02 access, Agent dispatch, or business-system changes.

- [ ] **Step 1: Write failing UI helper tests**

Assert a manager assignment payload includes role and assignee actor ID but no current actor or tenant claim; an operator sees only actionable tasks assigned to their actor ID; an owner sees Verify/Reject only when their actor ID is the G0 Owner; and Agent/system sessions expose no mutation controls.

- [ ] **Step 2: Run the focused UI test to verify it fails**

Run: `node --test test/task-center-ui.test.ts`

Expected: FAIL because the existing task UI only models a responsibility role.

- [ ] **Step 3: Implement the narrow task UI changes and acceptance guide**

Keep server authorization authoritative. Update the manager assignment prompt/form to request the target M01 actor ID. Add the exact three-account Keycloak setup and three-browser acceptance sequence to the guide, instructing operators to use the stable actor ID returned from the Hub session rather than assuming username equals actor ID.

- [ ] **Step 4: Run end-to-end regression checks**

Run: `node --test test/task-center.test.ts test/task-authorization.test.ts test/task-api.test.ts test/task-center-ui.test.ts test/g0-decision-register.test.ts test/g0-decision-api.test.ts test/g0-decision-ui.test.ts && npm run test:auth && npm run check:types && node --check public/app.js`

Expected: PASS.

- [ ] **Step 5: Perform the manual three-account acceptance**

Use the Keycloak administrator workflow outside the Hub to provision the approved demo accounts and roles, record their stable M01 actor IDs through the Hub session endpoint, register the actual Owner in G0, and verify the manager/operator/owner flow. Do not put credentials or token values in repository files or test output.

- [ ] **Step 6: Commit the UI and guide slice**

```bash
git add public/index.html public/app.js public/style.css test/task-center-ui.test.ts docs/auth/g1-three-account-acceptance.md
git commit -m "feat(tasks): present role-aware task controls"
```

## Self-Review

- **Spec coverage:** G1's three-account identity, tenant, action, resource, and denial-audit requirements are implemented through actor-bound assignments and server-side policy. The separate manual acceptance guide respects Keycloak as the identity authority.
- **Step scan:** Each task contains a focused contract, failing test, implementation, verification, and reviewable commit.
- **Type consistency:** Task assignments hold an actor ID; TaskApi receives roles from ActorContext and delegates policy to `authorizeTaskAction`; the UI forwards only assignment target data.
- **Review Focus:** Forged browser identity, wrong operator, wrong owner, legacy role-only tasks, and Agent/system mutation are assigned to explicit tests.
- **Proportion:** The plan changes the existing task loop only where required to establish G1 responsibility separation; it does not introduce a new workflow engine, Keycloak management surface, M02 integration, or Agent dispatch.
