# M01 G1 Admission Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the private-LAN M01 Hub runner admit the three G1 human roles and align its authentication-script test with the required LAN listener.

**Architecture:** Keep Keycloak as the only authority for users, passwords, organizations, tenants, and role grants. The Hub runner continues to bind `0.0.0.0:8790` solely so Caddy in Docker can reverse-proxy to the Windows host; the static script test is updated to protect that topology rather than reverting it. The runner's admission list expands from the legacy manager/analyst pair to the G1 manager/operator/owner roles while retaining analyst compatibility.

**Tech Stack:** PowerShell, Node.js built-in test runner, Keycloak/M01 OIDC configuration.

**Spec:** `docs/auth/g1-three-account-acceptance.md`, `docs/auth/m01-lan-demo.md`, `docs/superpowers/plans/2026-10-12-m01-lan-demo.md`

## Global Constraints

- Do not create, edit, or delete Keycloak users, passwords, client secrets, tokens, or the ignored `deploy/m01/.env` file.
- Do not revert the Hub listener to loopback; Caddy must keep access to the host-side Hub at port 8790.
- Keep direct exposure limited to the existing Caddy HTTPS endpoints; do not add a firewall rule for 8790.
- Hub remains an admission and action-RBAC consumer, not an identity-directory or account-management surface.
- Change only the runner, its focused static test, and directly affected G1 acceptance documentation.

## Review Focus

- `HOST` must remain exactly `0.0.0.0`, while no script opens or advertises an external 8790 firewall port.
- `AEOS_M01_ALLOWED_ROLES` must include `manager`, `operator`, and `owner`; existing `analyst` admission must not regress.
- The update must never print `.env` values, client secrets, passwords, or tokens.
- A Keycloak account with no allowed role must remain unable to establish a Hub session.
- Documentation must distinguish Keycloak account administration from G0 person-to-responsibility registration.

### Task 1: Align M01 LAN admission and script contract

**Files:**
- Modify: `scripts/run-m01-hub.ps1`
- Modify: `test/m01-local-scripts.test.mjs`
- Modify: `docs/auth/g1-three-account-acceptance.md`

**Interfaces:**
- Consumes: existing trusted Keycloak top-level `roles` claim and the Hub's `AEOS_M01_ALLOWED_ROLES` admission environment variable.
- Produces: a runner admission list `manager,analyst,operator,owner` and static tests that require the LAN listener and all supported pilot roles.

- [ ] **Step 1: Write the focused failing script assertions**

In `test/m01-local-scripts.test.mjs`, require `$env:HOST = '0.0.0.0'` and require the runner's admission list to contain all four role identifiers. Keep the existing assertions that credentials are not printed and runtime values come from ignored `.env`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/m01-local-scripts.test.mjs`

Expected: FAIL because the test still expects the superseded loopback listener and the runner omits `operator` and `owner`.

- [ ] **Step 3: Update the runner and acceptance explanation**

Set `AEOS_M01_ALLOWED_ROLES` in `scripts/run-m01-hub.ps1` to `manager,analyst,operator,owner`, preserving the existing secure M01 variables and `0.0.0.0:8790` listener. In the G1 guide, state that Keycloak creates/manages accounts and roles; the Hub allow-list only admits identities and does not assign roles or create users.

- [ ] **Step 4: Run focused verification**

Run: `node --test test/m01-local-scripts.test.mjs && npm run test:auth && npm run check:types && git diff --check`

Expected: PASS. The full authentication command returns zero while no secret value appears in output.

- [ ] **Step 5: Commit the repair**

```bash
git add scripts/run-m01-hub.ps1 test/m01-local-scripts.test.mjs docs/auth/g1-three-account-acceptance.md
git commit -m "fix(auth): admit G1 M01 roles in LAN runner"
```

## Self-Review

- **Spec coverage:** The runner keeps the Caddy-required listener and admits all G1 human roles; the focused test and guide record both contracts.
- **Step scan:** One task owns the only runtime value, its static regression test, and its directly affected manual procedure.
- **Type consistency:** Role identifiers match the G1 authorization policy exactly: `manager`, `operator`, and `owner`; `analyst` remains an admission-only compatible role.
- **Review Focus:** Listener topology, admission roles, secret handling, unauthorized admission, and identity-management boundaries are pinned to Task 1's assertions and existing OIDC checks.
- **Proportion:** No Keycloak automation, account UI, firewall mutation, or application authorization code is added.
