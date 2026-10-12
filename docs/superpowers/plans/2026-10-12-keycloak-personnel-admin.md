# Keycloak Personnel Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a trusted Hub `manager` administer pilot users and the `manager`/`operator`/`owner` roles from System Configuration while Keycloak remains the sole identity and credential authority.

**Architecture:** The Hub exposes a narrow, server-enforced personnel API backed by a dedicated Keycloak confidential service client. Browser requests never carry Keycloak credentials, tenant, organization, actor identity, or privileges; the authenticated manager's M01 claims determine the scope. The administrator client is provisioned once through an explicit local script using the existing Keycloak bootstrap channel and an ignored runtime secret, then only receives the minimum Keycloak management permissions necessary for pilot users in the `aeos` realm.

**Tech Stack:** TypeScript/Node.js fetch, Keycloak Admin REST API, PowerShell, Docker Compose, Node.js built-in test runner, plain browser JavaScript.

**Spec:** User direction on 2026-10-12: `manager` is the highest decision maker; daily personnel management must occur in Hub, not the Keycloak console. Related constraints: `docs/auth/m01-integration.md`, `docs/auth/g1-three-account-acceptance.md`.

## Global Constraints

- Keycloak remains authoritative for users, passwords, enabled state, tenant/organization attributes, and role assignments; Hub must not persist a copy of account records or credentials.
- Only authenticated human M01 actors with the `manager` role may call personnel mutations; no browser-supplied role, actor, tenant, organization, or target scope is trusted.
- All account mutations are limited to the authenticated manager's G0-ready `demoTenantId` and `organizationScope`; cross-scope users must appear as nonexistent.
- The only mutable business roles are `manager`, `operator`, and `owner`; no realm-admin, client role, service role, group, mapper, client, or Keycloak configuration management appears in Hub.
- Passwords are accepted only for create/reset, sent directly to Keycloak, never logged, returned, stored, put into Evidence payloads, or rendered after submission. Password reset always makes the new credential temporary.
- A manager cannot disable themself, remove their own `manager` role, or remove/disable the last active manager in the G0 scope.
- Every accepted/denied personnel mutation emits a redacted Evidence event; Keycloak failures expose stable user-safe messages and never upstream responses/tokens.
- Do not modify task, G0 decision, Agent, MCP, Harbor, or business-data behavior except to read the existing G0 scope for authorization.

## Review Focus

- Forged request fields for tenant, organization, actor, role, or target user cannot expand a manager's scope.
- A disabled/non-human/non-manager actor cannot list or mutate personnel, even with valid body fields.
- Passwords, service-client secrets, authorization headers, Keycloak errors, and user credential values never appear in responses, logs, or Evidence.
- A manager cannot strand the scoped tenant without an active manager or disable/de-role themself.
- Keycloak timeout, 401/403, conflict, malformed payload, and post-commit audit failure fail safely without falsely reporting a completed mutation.

### Task 1: Provision the dedicated Keycloak personnel service client

**Files:**
- Modify: `deploy/m01/.env.example`
- Modify: `deploy/m01/docker-compose.yml`
- Create: `deploy/m01/configure-personnel-admin.sh`
- Create: `scripts/provision-m01-personnel-admin.ps1`
- Modify: `scripts/run-m01-hub.ps1`
- Modify: `test/m01-local-scripts.test.mjs`

**Interfaces:**
- Consumes: ignored `deploy/m01/.env` values `M01_PERSONNEL_ADMIN_CLIENT_SECRET` and `M01_PERSONNEL_ADMIN_ENABLED` plus the existing bootstrap administrator channel.
- Produces: confidential Keycloak client `aeos-hub-personnel-admin` with service accounts enabled and only the documented management roles, and Hub runtime values `M01_PERSONNEL_ADMIN_CLIENT_ID`, `M01_PERSONNEL_ADMIN_CLIENT_SECRET`, `M01_PERSONNEL_ADMIN_ENABLED`.

- [ ] **Step 1: Write failing static script tests**

Assert the provision script uses only the ignored runtime `.env`, never prints the personnel-client secret, requires explicit confirmation, and the Hub runner enables personnel administration only when the feature flag and non-sentinel secret are present.

- [ ] **Step 2: Run the focused script test**

Run: `node --test test/m01-local-scripts.test.mjs`

Expected: FAIL because no personnel provisioning contract exists.

- [ ] **Step 3: Implement explicit, idempotent provisioning**

Add optional ignored runtime variables. The PowerShell script must default to dry-run/`-WhatIf`; with explicit confirmation, execute container-local `kcadm.sh` to create or reconcile `aeos-hub-personnel-admin`, set its pre-generated ignored secret, enable service accounts, and assign only required `realm-management` permissions (`query-users`, `manage-users`, and read-only realm-role lookup permissions). It must not create business users or alter browser client settings. The Hub runner must fail closed (feature disabled) unless enabled and fully configured.

- [ ] **Step 4: Verify scripts and configuration**

Run: `node --test test/m01-local-scripts.test.mjs && powershell -NoProfile -ExecutionPolicy Bypass -File scripts/provision-m01-personnel-admin.ps1 -WhatIf && git diff --check`

Expected: PASS; dry run reports planned client capability without secrets or mutations.

### Task 2: Keycloak personnel gateway and scope policy

**Files:**
- Create: `src/keycloak-personnel-admin.ts`
- Create: `src/personnel-authorization.ts`
- Create: `test/keycloak-personnel-admin.test.ts`
- Create: `test/personnel-authorization.test.ts`

**Interfaces:**
- Consumes: M01 issuer, dedicated client credentials, the trusted authenticated actor, and a G0-ready scope.
- Produces: `KeycloakPersonnelAdmin` methods `listUsers`, `createUser`, `updateUser`, `resetTemporaryPassword`, and `setPilotRoles`; a pure `authorizePersonnelAction` policy.

- [ ] **Step 1: Write failing gateway and policy tests**

Cover client-credentials token acquisition, bounded requests, tenant/organization attribute filtering, allow-listed role projection, redaction of Keycloak errors, manager/human/G0 scope gates, and request rejection for unknown roles or out-of-scope users.

- [ ] **Step 2: Run focused unit tests**

Run: `node --test test/keycloak-personnel-admin.test.ts test/personnel-authorization.test.ts`

Expected: FAIL because the gateway and policy do not exist.

- [ ] **Step 3: Implement the minimal Keycloak boundary**

Use HTTPS-only validated endpoints derived from configured M01 issuer. Cache the client-credentials access token only in process memory until expiry. Project users to safe fields (`id`, username/display fields, enabled, tenantId, organizationId, allowed pilot roles, actorId) and omit credentials, arbitrary attributes, tokens, and upstream errors. On every read/mutation, re-check target scope and allow-list roles; create users with the caller's trusted G0 scope only.

- [ ] **Step 4: Verify the focused boundary**

Run: `node --test test/keycloak-personnel-admin.test.ts test/personnel-authorization.test.ts && npm run check:types`

Expected: PASS.

### Task 3: Server personnel API, audit, and manager safeguards

**Files:**
- Create: `src/personnel-api.ts`
- Modify: `src/server.ts`
- Create: `test/personnel-api.test.ts`

**Interfaces:**
- Consumes: `KeycloakPersonnelAdmin`, `authorizePersonnelAction`, existing `G0DecisionRegisterStore`, authenticated `ActorContext`, and Evidence appender.
- Produces: tenant/organization-scoped APIs under `/api/system/personnel` for safe list, create, update enabled state/profile, replace pilot roles, and temporary-password reset.

- [ ] **Step 1: Write failing API tests**

Pin manager-only access; G0-ready scope; ignored forged body identity/scope; user-safe cross-scope 404; self-disable/self-de-role denial; last-active-manager protection; password redaction; accepted/denied audit; and token/Keycloak-error redaction.

- [ ] **Step 2: Run focused API tests**

Run: `node --test test/personnel-api.test.ts`

Expected: FAIL because personnel endpoints do not exist.

- [ ] **Step 3: Implement server-enforced personnel routes**

Use the server-held `ActorContext` only. Make G0 readiness and exact tenant/organization scope mandatory for every route. Return an explicit `committed`/`auditStatus` outcome when Keycloak committed but Evidence append fails. Do not attach password values to exceptions, audit events, or responses.

- [ ] **Step 4: Run auth and personnel regression checks**

Run: `node --test test/personnel-api.test.ts test/keycloak-personnel-admin.test.ts test/personnel-authorization.test.ts test/g0-decision-register.test.ts test/g0-decision-api.test.ts && npm run test:auth && npm run check:types`

Expected: PASS.

### Task 4: System Configuration personnel UI and operational guide

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Create: `public/personnel-admin.js`
- Create: `test/personnel-admin-ui.test.ts`
- Create: `docs/auth/hub-personnel-administration.md`

**Interfaces:**
- Consumes: safe personnel projections, authenticated session, G0 readiness, and personnel API responses.
- Produces: manager-only System Configuration controls to list/search, create, enable/disable, assign pilot roles, and issue temporary password resets.

- [ ] **Step 1: Write failing UI helper tests**

Assert non-manager/non-human/G0-not-ready sessions expose no controls; payloads omit trusted scope/actor fields; password fields are cleared after request construction; roles are limited to the three pilot roles; and server denial produces safe feedback.

- [ ] **Step 2: Run focused UI tests**

Run: `node --test test/personnel-admin-ui.test.ts`

Expected: FAIL because the UI module does not exist.

- [ ] **Step 3: Implement a narrow manager console**

Place the console beneath System Configuration. Do not render existing passwords, secrets, tokens, client configuration, or broad Keycloak administration. Require explicit confirmation for disable, role changes, and reset; show resulting stable actor ID and scope only after the API succeeds.

- [ ] **Step 4: Document setup, daily operations, and recovery**

Document the one-time provisioning command, the restricted service account, Keycloak-side emergency recovery, safe account lifecycle, and G0 scope dependency. State that users and roles are still stored in Keycloak; Hub is only the constrained operating surface.

- [ ] **Step 5: Run end-to-end regression checks**

Run: `node --test test/personnel-admin-ui.test.ts test/personnel-api.test.ts test/keycloak-personnel-admin.test.ts test/personnel-authorization.test.ts test/task-center-ui.test.ts test/task-api.test.ts test/g0-decision-register.test.ts test/g0-decision-api.test.ts && npm run test:auth && npm run check:types && node --check public/app.js && git diff --check`

Expected: PASS.

## Self-Review

- **Spec coverage:** Hub receives the requested daily personnel-management surface while Keycloak remains authority; manager is the approved highest decision maker; initialization is explicit and recoverable.
- **Step scan:** Provisioning, server gateway/policy, API safeguards, and UI each have a focused test boundary and independent review point.
- **Type consistency:** The service client configuration is optional until enabled; all downstream operations consume only safe user projections and G0 scope.
- **Review Focus:** Forged scope, non-manager access, secret leakage, self/last-manager lockout, and upstream failure are assigned to policy/API tests.
- **Proportion:** The design avoids a local account database, password storage, generic Keycloak proxy, realm-admin grants, or unrelated business changes.
