# M01 Minimum-Viable Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in Keycloak-based M01 login and basic tenant/role identity context to AEOS Hub without changing its business, MCP, task, dashboard, or evidence behavior.

**Architecture:** Keep the existing password session login as `local-dev` compatibility mode. Add an M01 OIDC adapter for the browser authorization-code flow with PKCE, then have `server.ts` select exactly one adapter by `AEOS_AUTH_MODE`; both adapters yield one small authenticated session and the same `ActorContext`. No existing business route gets a new authorization rule in this iteration—the server only replaces the login identity source and continues using the existing authenticated-session gateway.

**Tech Stack:** Node.js 24, TypeScript, Node built-in HTTP/crypto, `jose` for OIDC/JWKS validation, Keycloak, PostgreSQL, Docker Compose, Node test runner.

**Spec:** `docs/M01 身份与权限接入方案 v1.0.docx` and `C:\Users\Administrator\Desktop\AEOS M01 身份中心建设开发文档 v1.0.docx`

## Global Constraints

- Only touch authentication integration, its tests, dependency/configuration samples, and its documentation; do not modify business analysis, MCP, task orchestration, dashboard, evidence, or existing data stores.
- Use Keycloak + PostgreSQL as M01; use an `aeos` Realm and `tenant_id` claim rather than one Realm per tenant.
- Browser authentication must use OIDC Authorization Code flow with PKCE; production must validate issuer, audience, expiry, signature, state, nonce, and required `tenant_id`.
- Keep `local-dev` behavior explicitly selectable so an unconfigured M01 cannot silently make the Hub unavailable; production configuration must reject `local-dev`.
- Never commit or log passwords, client secrets, authorization codes, refresh tokens, access tokens, ID tokens, or session identifiers.
- Use only `HttpOnly; SameSite=Lax` session cookies and append `Secure` when the Hub is configured for HTTPS.
- One future intelligent agent must use one independent service-account Client; this iteration documents/configures the capability but does not change agent execution code.

## Review Focus

- A callback with a missing, reused, expired, or mismatched `state` must be rejected before any code exchange; tested in Task 2.
- A signed token from a different Issuer/audience, an expired token, or a token without `tenant_id` must not create a Hub session; tested in Task 2.
- `AEOS_AUTH_MODE=m01` with incomplete configuration must fail at startup rather than fall back to the static account; tested in Task 1.
- A request authenticated through M01 must expose a stable actor ID, tenant ID, and roles without putting raw token values into the actor/evidence fields; tested in Task 3.
- Existing local password-login tests and WebSocket authentication must remain functional in explicit `local-dev` mode; tested in Task 3.

---

## File Structure

- Create: `src/auth/actor-context.ts` — immutable normalized identity object shared by local and M01 authentication.
- Create: `src/auth/m01-oidc.ts` — Keycloak discovery, PKCE transaction storage, code exchange, JWKS validation, and claims-to-context mapping.
- Create: `test/m01-oidc.test.ts` — M01 configuration, callback-state, and claim validation tests.
- Modify: `src/web-auth.ts` — expose a small session/authentication adapter interface while preserving the existing `BrowserSessionAuth` local implementation.
- Modify: `src/server.ts` — choose the adapter; add OIDC start/callback routes; store the normalized actor on the server session; preserve every business route and WebSocket behavior.
- Modify: `test/web-auth.test.ts` — pin local-dev compatibility and secure-cookie behavior.
- Modify: `package.json` — add only `jose`, needed for standards-compliant JWT/JWKS verification.
- Create: `deploy/m01/docker-compose.yml` — isolated development M01 Keycloak + PostgreSQL stack; it must not replace the current Hub Compose file.
- Create: `deploy/m01/.env.example` — non-secret M01 deployment variables and placeholders.
- Create: `docs/auth/m01-integration.md` — exact setup, Realm/Client/Mapper contract, Hub environment variables, agent service-account rules, test and rollback checklist.
- Modify: `docker-compose.env.example` and `README.md` — document the opt-in M01 switch; retain local development instructions.

### Task 1: Define M01 Configuration and ActorContext

**Files:**
- Create: `src/auth/actor-context.ts`
- Create: `src/auth/m01-oidc.ts`
- Create: `test/m01-oidc.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `NodeJS.ProcessEnv`.
- Produces: `type ActorContext = { actorId: string; actorType: 'human' | 'service'; tenantId: string; organizationId?: string; roles: string[]; clientId?: string; authSource: 'local-dev' | 'm01' }`.
- Produces: `readM01Config(env): M01Config` and `M01OidcAuth.beginLogin(returnTo?: string): { redirectUrl: string; transactionId: string }`.
- Produces: `M01OidcAuth.completeLogin(input: { code: string; state: string }): Promise<ActorContext>`.

- [ ] **Step 1: Write failing configuration and actor-context tests in `test/m01-oidc.test.ts`**

Test that `AEOS_AUTH_MODE=m01` requires `M01_ISSUER`, `M01_CLIENT_ID`, `M01_CLIENT_SECRET`, `M01_REDIRECT_URI`, and `M01_AUDIENCE`; test that the normalized actor cannot be created without `sub` and `tenant_id`; test role de-duplication and stable `actorId` generation.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test:auth -- test/m01-oidc.test.ts`

Expected: FAIL because the M01 module and exported configuration functions do not exist.

- [ ] **Step 3: Add `jose` and implement `src/auth/actor-context.ts` and the configuration-only part of `src/auth/m01-oidc.ts`**

Implement `normalizeActorContext(claims: UnknownClaims, source: 'm01'): ActorContext` with only `sub`, `tenant_id`, `organization_id`, `roles`, and `azp/client_id` mapped. Reject malformed types and missing required claims. `readM01Config` must parse the exact environment names above and reject invalid URL/empty values.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test test/m01-oidc.test.ts && npm run check:types`

Expected: PASS.

- [ ] **Step 5: Commit the self-contained configuration/identity model**

```bash
git add package.json src/auth/actor-context.ts src/auth/m01-oidc.ts test/m01-oidc.test.ts
git commit -m "feat(auth): add M01 identity context contract"
```

### Task 2: Implement the Secure Keycloak OIDC Browser Flow

**Files:**
- Modify: `src/auth/m01-oidc.ts`
- Modify: `test/m01-oidc.test.ts`

**Interfaces:**
- Consumes: `M01Config` and `ActorContext` from Task 1.
- Produces: `M01OidcAuth.beginLogin`, `M01OidcAuth.completeLogin`, and `M01OidcAuth.revokeTransaction(state)`.

- [ ] **Step 1: Write failing OIDC-flow tests**

Use a stubbed discovery, token exchange, and JWKS verifier. Assert that `beginLogin` includes `response_type=code`, `client_id`, exact `redirect_uri`, `scope=openid`, `state`, `nonce`, and `code_challenge_method=S256`. Assert that missing/reused/expired state, invalid issuer/audience/signature/expiry, and missing `tenant_id` all reject without returning an actor.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/m01-oidc.test.ts`

Expected: FAIL for unimplemented OIDC transaction and callback functions.

- [ ] **Step 3: Implement OIDC discovery, PKCE, transaction storage, exchange, and JWKS validation**

Keep short-lived state/nonce/verifier transactions in memory and consume them exactly once. Use the issuer discovery document and `jose` remote-JWKS validation; validate `iss`, exact Hub audience, `exp`, `nbf`, and nonce before calling `normalizeActorContext`. Do not return raw token material from public interfaces or errors.

- [ ] **Step 4: Run focused authentication verification**

Run: `node --test test/m01-oidc.test.ts && npm run check:types`

Expected: PASS, including the five review-focus authentication rejection cases.

- [ ] **Step 5: Commit the OIDC implementation**

```bash
git add src/auth/m01-oidc.ts test/m01-oidc.test.ts
git commit -m "feat(auth): add Keycloak OIDC PKCE flow"
```

### Task 3: Integrate M01 Without Changing Business Behavior

**Files:**
- Modify: `src/web-auth.ts`
- Modify: `src/server.ts`
- Modify: `test/web-auth.test.ts`

**Interfaces:**
- Consumes: `ActorContext` and `M01OidcAuth` from Tasks 1–2.
- Produces: an authenticated Hub session resolving to `ActorContext`, used by HTTP and WebSocket authentication.

- [ ] **Step 1: Write failing local compatibility and server-adapter tests**

Extend `test/web-auth.test.ts` to assert explicit `local-dev` sessions yield a bounded `ActorContext` with configured default tenant/role, session cookies retain browser-session semantics, and production configuration rejects `local-dev`. Add a small adapter-level test covering an M01-completed actor stored against a new Hub session.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm run test:auth`

Expected: FAIL because Hub sessions currently only retain a UUID and cannot resolve an actor context.

- [ ] **Step 3: Change only the authentication boundary in `src/web-auth.ts` and `src/server.ts`**

Select mode through `AEOS_AUTH_MODE` (`local-dev` default for unconfigured development, `m01` only when complete M01 settings exist). Add `GET /api/auth/login` and `GET /api/auth/callback` only for M01 mode; retain `POST /api/auth/login` solely for `local-dev`. Make `/api/auth/session` return a safe actor summary. Keep the existing public asset allowlist, all current `401` behavior, and WebSocket session verification. Replace the generated `web-session:<uuid>` actor only with `ActorContext.actorId`; do not add permissions to business routes in this task.

- [ ] **Step 4: Run focused regression tests**

Run: `npm run test:auth && npm run test:security && npm run test:dashboard && npm run test:mcp-policy && npm run check:types`

Expected: PASS. Existing local login, protected assets/API, WebSocket gate, dashboard, and MCP policy behavior remain unchanged.

- [ ] **Step 5: Commit the authentication-boundary integration**

```bash
git add src/web-auth.ts src/server.ts test/web-auth.test.ts
git commit -m "feat(auth): make Hub sessions M01-aware"
```

### Task 4: Provide an Isolated M01 Development Stack and Contract

**Files:**
- Create: `deploy/m01/docker-compose.yml`
- Create: `deploy/m01/.env.example`
- Create: `docs/auth/m01-integration.md`
- Modify: `docker-compose.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: environment names and claim contract from Tasks 1–3.
- Produces: a separately runnable Keycloak + PostgreSQL development environment and a repeatable registration contract.

- [ ] **Step 1: Write a configuration completeness checklist in `docs/auth/m01-integration.md`**

Specify one `aeos` Realm; `aeos-hub-web` confidential Client; exact redirect URI registration; `tenant_id`, `organization_id`, and roles mappers; and one independent service-account Client per future agent. Include only placeholders, never usable secrets.

- [ ] **Step 2: Add the isolated Compose stack and sample environment**

Create `deploy/m01/docker-compose.yml` containing a Keycloak service and a PostgreSQL service with named volume and health check. It must use variables from `deploy/m01/.env`, have no impact on the existing root `docker-compose.yml`, and bind development-only local ports by default.

- [ ] **Step 3: Update only authentication-facing setup documentation**

Document `AEOS_AUTH_MODE=local-dev` as the current compatibility mode and provide the exact M01 environment-variable template. State explicitly that production uses `m01`, HTTPS, a managed secret store, and a separate PostgreSQL backup plan; do not change application feature documentation.

- [ ] **Step 4: Verify configuration and documentation**

Run: `docker compose --env-file deploy/m01/.env.example -f deploy/m01/docker-compose.yml config` and `npm run check:types`

Expected: Compose renders without missing required variables, and TypeScript remains PASS.

- [ ] **Step 5: Commit the isolated stack and documentation**

```bash
git add deploy/m01 docs/auth/m01-integration.md docker-compose.env.example README.md
git commit -m "docs(auth): add M01 development setup"
```

## Self-Review

- **Spec coverage:** M01 identity source, Keycloak/PostgreSQL deployment, OIDC + PKCE, tenant/role claims, Hub session integration, intelligent-agent service-account guidance, interface documentation, testing, and rollout safety are covered by Tasks 1–4.
- **Scope control:** No Task modifies MCP, dashboard, analysis, task orchestration, evidence, data persistence, or existing business routes. `src/server.ts` changes are restricted to the existing authentication gateway and actor identity handoff.
- **Type consistency:** Task 1 defines `ActorContext`; Task 2 produces it; Task 3 stores/resolves it; Task 4 documents the matching claim names and configuration keys.
- **Review focus:** Each listed failure mode is explicitly assigned to Task 1, 2, or 3 test steps.
- **Proportion:** The plan is implementation-oriented but leaves implementation details to the executor; it specifies exact boundaries and expected behavior without duplicating the eventual source code.
