# M02 Authentication Evidence Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record each M01 authentication success, authentication failure, and role-admission rejection as a safe, traceable Evidence event without changing the user-facing login result.

**Architecture:** Keep OIDC and role-admission decisions inside `src/web-auth.ts`; it emits a small, credential-free authentication audit event after each terminal outcome. A dedicated mapper converts that event into the existing JSONL Evidence contract, and `src/server.ts` injects the mapper into the M01 browser gateway. Audit persistence failure degrades Evidence health but must not reveal upstream authentication details or put tokens, cookies, passwords, authorization codes, states, or client secrets into Evidence.

**Tech Stack:** TypeScript, Node.js test runner, Zod Evidence contract, JSONL pilot Evidence adapter, Keycloak OIDC.

**Spec:** `docs/auth/m01-handover.md` §8 M02 item ①; `docs/AEOS Hub 后续开发需求文档 v2.0.docx` RQ-04.

## Global Constraints

- Do not alter root `docker-compose.yml`, the existing 8787 local-dev Hub, Keycloak credentials, Docker volumes, MCP routing, dashboard, tasks, or business data.
- Do not log or persist passwords, cookies, session IDs, access tokens, ID tokens, authorization codes, states, PKCE values, client secrets, or upstream exception messages.
- Keep the current M01 redirect contract: success redirects to `/`; authentication and admission failures redirect to `/?auth_error=1` and clear all authentication cookies.
- Preserve existing Evidence JSONL schema compatibility and its bounded `/api/evidence` read route.
- Treat the Evidence write as best effort for login availability; record failure through `evidenceHealth()` without changing the browser-visible authentication response.
- Use only `demo-ERP` data where test data is required; this task does not call an ERP or write to a business system.

## Review Focus

- Bad OIDC `code` or `state` must produce one generic `authentication_failed` audit event and never expose an upstream error string.
- A user authenticated by Keycloak but lacking an allowed role must produce one `admission_denied` event that retains only safe actor context.
- A successful M01 sign-in must record the admitted actor and tenant but no Hub session ID or token material.
- An Evidence append failure must not convert a valid sign-in into a failure or leak an internal storage error to the browser.
- Old gateway callers that omit the audit sink must retain their current behavior and test results.

---

### Task 1: M01 Authentication Audit Evidence

**Files:**
- Create: `src/authentication-audit.ts`
- Modify: `src/web-auth.ts:125-210`
- Modify: `src/server.ts:78-105,1199-1230`
- Test: `test/authentication-audit.test.ts`
- Test: `test/m01-auth-integration.test.ts`

**Interfaces:**
- Consumes: `ActorContext` from `src/auth/actor-context.ts`; `appendEvidence` from `src/evidence.ts`; M01 browser-gateway terminal outcomes.
- Produces: `AuthenticationAuditEvent` discriminated union and `appendAuthenticationAuditEvidence(event, append?)` mapper; `createBrowserAuthGateway({ onAuthenticationAudit })` optional sink.
- Preserves: `BrowserAuthGateway.callback(method, cookieHeader, code, state)` response shape and all M01 redirect/cookie behavior.

- [ ] **Step 1: Write the failing mapper tests**

In `test/authentication-audit.test.ts`, assert `appendAuthenticationAuditEvidence` writes three contract-valid events:

```ts
{ type: 'login_succeeded', authMode: 'm01', actor: m01Actor }
{ type: 'authentication_failed', authMode: 'm01' }
{ type: 'admission_denied', authMode: 'm01', actor: m01Actor }
```

Assert successful and admission-denied payloads contain only `actorId`, `actorType`, `tenantId`, and `roles`; failed payloads contain no actor. Assert serialized rows contain none of `password`, `cookie`, `session`, `token`, `secret`, `code`, `state`, or `verifier`.

- [ ] **Step 2: Run the mapper test to verify it fails**

Run: `node --test test/authentication-audit.test.ts`

Expected: FAIL because `src/authentication-audit.ts` does not exist.

- [ ] **Step 3: Implement the safe event-to-Evidence mapper**

Create `src/authentication-audit.ts` with:

```ts
export type AuthenticationAuditEvent =
  | { type: 'login_succeeded'; authMode: 'm01'; actor: ActorContext }
  | { type: 'authentication_failed'; authMode: 'm01' }
  | { type: 'admission_denied'; authMode: 'm01'; actor: ActorContext };

export function appendAuthenticationAuditEvidence(
  event: AuthenticationAuditEvent,
  append: typeof appendEvidence = appendEvidence,
): EvidenceEntry;
```

Use `kind: 'authentication_audit'`, source `aeos-hub`, `hub://identity/m01` for unauthenticated failures, and a tenant-scoped identity object reference only when an actor is available. Use stable, non-secret summaries and a minimal safe payload.

- [ ] **Step 4: Run mapper tests to verify they pass**

Run: `node --test test/authentication-audit.test.ts`

Expected: PASS.

- [ ] **Step 5: Write the failing gateway event tests**

Extend `test/m01-auth-integration.test.ts` with an optional `onAuthenticationAudit` collector. Assert:

```ts
await gateway.callback('GET', validBinding, 'code-value', 'state-value')
// emits login_succeeded with m01Actor

await gateway.callback('GET', undefined, 'code', 'state')
// emits authentication_failed and retains the existing generic redirect

await rejectedGateway.callback('GET', validBinding, 'code', 'state')
// emits admission_denied with safe m01Actor and retains the existing generic redirect
```

Add a collector that throws and assert a valid callback still creates the same session and redirect.

- [ ] **Step 6: Run the gateway tests to verify they fail**

Run: `node --test test/m01-auth-integration.test.ts`

Expected: FAIL because the gateway has no audit sink or terminal-event emission.

- [ ] **Step 7: Emit terminal M01 authentication audit events**

Add optional `onAuthenticationAudit?: (event: AuthenticationAuditEvent) => void` to `createBrowserAuthGateway` input. Emit exactly one event for each terminal M01 callback outcome:

- successful authorized callback: `login_succeeded` after creating the Hub session;
- malformed/invalid/failed OIDC callback: `authentication_failed`;
- completed OIDC callback with no allowed role: `admission_denied`.

Invoke the optional sink through a private best-effort helper that catches sink errors. Do not alter the public response, cookie clearing, or generic error behavior. Do not emit an actor for a failed callback.

- [ ] **Step 8: Wire the server to persist the events**

In `src/server.ts`, import `appendAuthenticationAuditEvidence` and give `createBrowserAuthGateway` an `onAuthenticationAudit` callback that calls it. Keep the mapping and write synchronous so a returned response has already attempted the audit write; the gateway's sink guard preserves login availability if the write fails.

- [ ] **Step 9: Run focused verification**

Run: `node --test test/authentication-audit.test.ts test/m01-auth-integration.test.ts && npm run test:auth && npm run test:evidence-contract && npm run check:types`

Expected: all pass; no test output includes credentials or opaque authentication material.

- [ ] **Step 10: Run live local smoke checks**

Restart only the 8790 Hub with `scripts/stop-m01-demo.ps1 -KeepIdentityStack` and `scripts/start-m01-demo.ps1 -NoBrowser`. Confirm `/` returns 200. In a browser, complete one allowed M01 login and inspect `/api/evidence?limit=10` from that authenticated session for one `authentication_audit` event containing safe actor context only. Do not print event payloads or credentials to the terminal.

- [ ] **Step 11: Commit the isolated change**

```bash
git add src/authentication-audit.ts src/web-auth.ts src/server.ts test/authentication-audit.test.ts test/m01-auth-integration.test.ts
git commit -m "feat(audit): record m01 authentication outcomes"
```

## Self-Review

- **Spec coverage:** This plan implements only the first M02 deliverable, M01 login success/failure/admission Evidence. Searchable actor fields, task-lifecycle correlation, and Back-Channel Logout are deliberately separate M02 increments.
- **Step scan:** Each task action is independently observable: a failing test, a narrow implementation, a passing test, live smoke check, and an isolated commit.
- **Type consistency:** The gateway owns authentication outcomes; the mapper owns Evidence shape; the server only injects the mapper. Existing callback signatures remain unchanged.
- **Review focus:** Each listed failure mode is asserted in Task 1 steps 1 or 5.
- **Proportion:** The plan adds one mapper and one optional gateway sink; it does not introduce a new database, endpoint, UI, or authorization model.
