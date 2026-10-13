# Access Control Three Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SPC-style User Management, Role Management, and Permission Management modules to Hub, ready the model for a one-way company-OA database sync, and retain non-bypassable Keycloak and G0/G1 safeguards.

**Architecture:** OA is authoritative for employee, department, position, organization, and employment-status master data. A future read-only OA adapter projects those attributes into Keycloak, which remains authoritative for credentials, login sessions, stable IDs, realm roles, and role assignments. Hub owns a scope-partitioned permission-resource tree and role-permission grants; it shows them in three manager-only views and uses grants only as an additional authorization layer after existing G0/G1 checks.

**Tech Stack:** TypeScript, Node.js, Keycloak Admin REST API, Zod, atomic JSON persistence, browser JavaScript/CSS, Node test runner.

**Spec:** User-supplied screenshots on 2026-10-12: SPC User Management, Role Management, Permission Management.

## Global Constraints

- Keycloak remains the sole authority for account, password, tenant/organization attribute, realm-role, and assignment data.
- OA is the sole authority for employee number, display name, department, position, organization hierarchy, and employment status once OA synchronization is enabled; Hub and Keycloak retain only its synchronized projection.
- The OA adapter must use a least-privilege read-only database account or an OA-owned read-only view. It must never write OA tables or receive OA credentials from a browser.
- Synchronization keys use an immutable OA employee identifier, never a person name or mutable login name; a departure disables the Keycloak user and never deletes historical Hub records.
- APIs use only the authenticated server session for actor and scope; browser identity/scope fields are ignored.
- Only a human `manager` in matching G0-ready scope can manage users, roles, and permissions.
- `manager`, `owner`, and `operator` are protected pilot roles: assignable but not deletable or renameable from Hub.
- Permission grants never override G0/G1 scope checks, task binding, business-owner verification, self/last-manager protection, or Evidence audit behavior.
- Do not reveal secrets, tokens, credentials, or raw Keycloak failures; preserve untracked `.docx` files.

## Review Focus

- Forged tenant, organization, actor, role, or permission identifiers are rejected before mutation.
- Protected, assigned, self-critical, and last-manager roles cannot be deleted or weakened.
- Invalid or cyclic permission trees, duplicate codes, invalid routes, invalid CRUD sets, and oversized catalogs fail atomically.
- A custom role without an admitted Hub role does not imply login access; UI documents this constraint.
- A permission grant cannot make a G0/G1-denied business action succeed.
- OA schema changes, missing delta markers, duplicate employee IDs, and a failed sync must leave the last good identity projection usable and produce an auditable failure rather than mass deletion.

---

### Task 0: OA-ready identity projection and sync contract

**Files:**
- Create: `src/oa-identity-sync.ts`
- Create: `test/oa-identity-sync.test.ts`
- Modify: `src/keycloak-personnel-admin.ts`
- Modify: `src/personnel-api.ts`
- Modify: `test/keycloak-personnel-admin.test.ts`
- Modify: `test/personnel-api.test.ts`
- Create: `docs/auth/oa-identity-sync-contract.md`

**Interfaces:**
- `OaIdentityRecord { externalEmployeeId, displayName, departmentId?, departmentName?, positionCode?, positionName?, organizationId, tenantId, active, updatedAt }` is the normalized, database-independent OA record.
- `OaIdentitySource` is a read-only adapter interface: `listInitial(): AsyncIterable<OaIdentityRecord>` and `listChanges(cursor): AsyncIterable<OaIdentityRecord>`; no database driver is chosen until the OA database engine and approved view/schema are supplied.
- `KeycloakPersonnelAdmin.upsertSyncedUser(record)` and `disableSyncedUser(externalEmployeeId, scope)` manage only OA-owned profile attributes and enable state; application roles remain untouched.

- [ ] **Step 1: Write failing source-policy and projection tests**

Test immutable `externalEmployeeId` matching, profile projection, active-to-disabled handling, no physical deletion, duplicate/malformed record rejection, role preservation, scoped organization mapping, resumable cursor semantics, and an auditable no-op on an unavailable source.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `node --test test/oa-identity-sync.test.ts test/keycloak-personnel-admin.test.ts test/personnel-api.test.ts`

Expected: OA contract and Keycloak projection methods are absent.

- [ ] **Step 3: Implement the database-independent OA synchronization core**

Persist sync cursor/status separately from personnel data; normalize and validate records before any Keycloak call; update only OA-owned Keycloak attributes (`external_employee_id`, department, position, organization, source, last-sync timestamp); preserve password, stable Keycloak ID, Hub roles, permission grants, G0 decisions, and audit history. Expose safe read-only source/last-sync fields to User Management.

- [ ] **Step 4: Document the required OA database handoff**

Specify that the future connector requires: database engine/version, network endpoint, an approved read-only account, a read-only employee/organization view, immutable employee ID, tenant/organization mapping, active-status rule, delta cursor column or change table, and retention/error policy. Explicitly reject direct writes and browser-held database credentials.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/oa-identity-sync.test.ts test/keycloak-personnel-admin.test.ts test/personnel-api.test.ts`

Expected: PASS.

Commit message: `feat(identity): prepare OA identity synchronization`

### OA Connector Decision Gate

The actual database adapter is intentionally not implemented until the user provides the OA database engine and approved read-only schema/view. After that handoff, add one adapter task with the selected maintained driver, an initial full-sync command, a scheduled incremental-sync command, operational metrics, and an acceptance run against non-production OA data. Do not infer table names, connection settings, or credentials.

---

### Task 1: Scoped permission catalog and role-grant persistence

**Files:**
- Create: `src/access-control-store.ts`
- Create: `test/access-control-store.test.ts`

**Interfaces:**
- `AccessControlStore.listResources(scope)`, `createResource(scope, input)`, `updateResource(scope, code, input)`, `deleteResource(scope, code)`, `listRolePermissions(scope, roleKey)`, `replaceRolePermissions(scope, roleKey, grants)`.
- `AccessResource` includes name, stable code, optional route, CRUD operations, sort, enabled state, and children.

- [ ] **Step 1: Write failing store tests**

Test scope isolation, default seeded Hub tree, nested rows, role-grant replacement, recovery, and rejection of duplicate/cyclic/oversized invalid data.

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/access-control-store.test.ts`

Expected: missing module failure.

- [ ] **Step 3: Implement `AccessControlStore`**

Use existing atomic-file conventions and seed only real Hub roots: dashboard, topbar, analysis, cases, tasks, evidence, agents, and system. Restrict operations to `create`, `read`, `update`, `delete`; record that personnel profile fields sourced by OA remain read-only in Hub.

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test test/access-control-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat(access): add scoped permission catalog`

### Task 2: Safe Keycloak role lifecycle

**Files:**
- Modify: `src/keycloak-personnel-admin.ts`
- Modify: `src/personnel-authorization.ts`
- Modify: `deploy/m01/configure-personnel-admin.sh`
- Modify: `scripts/provision-m01-personnel-admin.ps1`
- Modify: `test/keycloak-personnel-admin.test.ts`
- Modify: `test/personnel-authorization.test.ts`
- Modify: `test/m01-local-scripts.test.mjs`

**Interfaces:**
- `KeycloakPersonnelAdmin.listHubRoles(scope)`, `createHubRole(scope, input)`, `deleteHubRole(scope, roleKey)`, `setUserHubRoles(scope, userId, roleKeys)`.
- `HubRole { key, code, name, description?, protected, userCount, permissionCount }`.
- `authorizeAccessControlAction(input)` enforces human-manager and matching G0 scope.

- [ ] **Step 1: Write failing adapter/policy tests**

Cover scope-marked Hub roles, protected-role filtering, assignment, refusal to delete protected/in-use roles, upstream error redaction, and no secret leakage.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `node --test test/keycloak-personnel-admin.test.ts test/personnel-authorization.test.ts test/m01-local-scripts.test.mjs`

Expected: missing role lifecycle methods.

- [ ] **Step 3: Implement the Keycloak adapter and policy**

Give the existing dedicated client only the smallest additional role-management permission, never `realm-admin`. Namespace and mark custom Hub roles by trusted scope so unrelated realm roles cannot be edited. Count scoped users before deleting a role and preserve existing pilot-role assignment behavior.

- [ ] **Step 4: Update provisioning**

Reconcile the least-privilege permission in the container script and WhatIf output without printing the secret.

- [ ] **Step 5: Verify and commit**

Run: `node --test test/keycloak-personnel-admin.test.ts test/personnel-authorization.test.ts test/m01-local-scripts.test.mjs`

Expected: PASS.

Commit message: `feat(access): manage scoped Hub roles through Keycloak`

### Task 3: Guarded User, Role, and Permission APIs

**Files:**
- Create: `src/access-control-api.ts`
- Create: `test/access-control-api.test.ts`
- Modify: `src/personnel-api.ts`
- Modify: `src/server.ts`
- Modify: `test/personnel-api.test.ts`

**Interfaces:**
- `AccessControlApi.handle(request)` serves resource, role, and role-permission routes under `/api/system/access-control/`.
- `hasGrantedOperation(actor, resourceCode, operation)` is an additional check after existing authorization.

- [ ] **Step 1: Write failing API tests**

Cover resource CRUD/child/toggle, role list/create/delete, role-permission replacement, forged scope, cross-scope 404, protected/in-use role rejection, Evidence success/failure, and catalog-load failure.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `node --test test/access-control-api.test.ts test/personnel-api.test.ts`

Expected: access-control routes absent.

- [ ] **Step 3: Implement API and server wiring**

Append redacted Evidence events for accepted/denied mutations and return stable errors plus `committed`/`auditStatus`. Seed the initial manager with administrative rights so recovery remains possible.

- [ ] **Step 4: Verify and commit**

Run: `node --test test/access-control-api.test.ts test/personnel-api.test.ts test/task-api.test.ts`

Expected: PASS.

Commit message: `feat(access): expose guarded management APIs`

### Task 4: Three SPC-aligned management views

**Files:**
- Create: `public/access-control.js`
- Create: `test/access-control-ui.test.ts`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Modify: `public/personnel-admin.js`
- Modify: `test/personnel-admin-ui.test.ts`

**Interfaces:**
- System Configuration entries/views: `user-management`, `role-management`, `permission-management`.
- Browser request helpers never send actor, tenant, organization, or privilege assertions.

- [ ] **Step 1: Write failing UI contract tests**

Assert all three entries, manager/G0 visibility, User summary/filter/table, Role summary/filter/table, per-role `权限` and `删除`, protected delete state, and expandable permission-tree columns: name, code, route, CRUD, order, enabled, actions.

- [ ] **Step 2: Run UI tests and verify they fail**

Run: `node --test test/access-control-ui.test.ts test/personnel-admin-ui.test.ts`

Expected: three view contracts absent.

- [ ] **Step 3: Implement User Management**

Include search, status filter, create/edit/reset/enable/delete, user identity, current scope, roles, enabled status, audit-safe login metadata, and the OA projection fields/source/last-sync state. Once OA mode is active, make employee, department, position, organization, and employment-state fields read-only; do not invent supplier or enterprise-WeChat integrations.

- [ ] **Step 4: Implement Role Management**

Show role code/name, scope, user count, permission overview, and per-row `权限` / `删除`. Add role creation and a permission-tree dialog; protected pilot roles cannot expose deletion.

- [ ] **Step 5: Implement Permission Management**

Render an expandable resource tree matching the supplied structure; add root/child/edit/toggle/delete flows and confirm deletion before destructive mutation.

- [ ] **Step 6: Verify and commit**

Run: `node --test test/access-control-ui.test.ts test/personnel-admin-ui.test.ts`

Expected: PASS.

Commit message: `feat(access): add user role permission modules`

### Task 5: Documentation and end-to-end verification

**Files:**
- Modify: `docs/auth/hub-personnel-administration.md`
- Modify: `docs/auth/m01-personnel-restart-tutorial.md`
- Create: `docs/auth/hub-access-control-acceptance.md`

- [ ] **Step 1: Document the operating model**

Explain three modules, protected roles, custom-role scope, role deletion conditions, permission meanings, the difference between UI permissions and hard G0/G1 guards, recovery, and unsupported SPC integrations.

- [ ] **Step 2: Add a manager acceptance sequence**

Create a custom role, grant permissions, assign it alongside an admitted pilot role, verify allowed/denied UI/API paths, attempt protected/in-use deletion, and verify a G0/G1 denial remains denied.

- [ ] **Step 3: Run the full verification set**

Run: `npm run check:types && npm test && git diff --check`

Expected: all tests and type check pass with no whitespace errors.

- [ ] **Step 4: Commit**

Commit message: `docs(access): add management acceptance guide`

## Self-Review

1. **Spec coverage:** Task 0 establishes OA-ready data ownership; Task 4 implements the three screenshot structures, role actions, and permission tree; Tasks 1-3 provide scoped authority; Task 5 covers operation.
2. **Step scan:** Every task has a failing test, focused verification, and an independently reviewable boundary.
3. **Type consistency:** Store catalog/grants feed Keycloak role projections, API routes, then safe UI models.
4. **Review focus:** OA projection failures, scope forgery, protected/in-use roles, custom admission, invalid trees, and G0/G1 conflicts have explicit tests.
5. **Proportion:** The plan implements the requested management architecture without pretending Hub integrates SPC-only department, supplier, or WeCom fields.

## Implementation status — 2026-10-13

- Completed in the working tree: the database-independent OA identity contract and sync state runner; scoped permission catalog and grants; scoped Keycloak role lifecycle; guarded management APIs; the three System Configuration modules; operation documentation and acceptance checklist.
- Verified: `npm run check:types`, `npm test`, focused access-control/OA/personnel suites, `node --check public/app.js`, and `git diff --check` all passed.
- Intentionally not performed: selecting or connecting a real OA database adapter, supplying OA credentials, provisioning Keycloak in a live environment, restarting Hub, creating users, or committing Git changes. Those require deployment data or explicit user authorization.
