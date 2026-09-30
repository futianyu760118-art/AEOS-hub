# Docker Logout and Dark Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make logout invalidate the current Docker browser session, and restore the login/first-run screens to the prior dark appearance without changing workspace visuals.

**Architecture:** Add a narrow `POST /api/auth/logout` endpoint ahead of other API routing. It validates the existing gateway authorization, clears both browser cookies with their exact scope and security attributes, and returns a no-store JSON result; the front end invokes it before removing local UI state and closing its WebSocket. Limit CSS changes to login, transition, and welcome selectors so the workbench redesign layer remains untouched.

**Tech Stack:** Node.js 24 HTTP server, browser Fetch/WebSocket APIs, vanilla JavaScript, CSS, Node test runner.

**Spec:** User request in this chat (2026-09-30): "能退出登录，同时把这个界面回退到之前的深色界面，其余界面不变".

## Global Constraints

- Modify only authentication/logout handling and login/onboarding visual selectors; do not alter any workspace selector or business API behavior.
- Logout must clear the server gateway token (`hub_token`), actor session (`aeos_session`), browser-local UI session, and active WebSocket.
- Logout response remains `Cache-Control: no-store` and uses the same Cookie scope/security attributes as issuance.
- The existing Docker deployment remains read-only at runtime except for its mounted state volumes.

## Review Focus

- A logout request with valid cookies clears both cookie names using `Path=/`, `HttpOnly`, `SameSite=Lax`, and immediate expiry; test in Task 1.
- A logout request without a valid gateway token remains rejected by the existing authorization gate; test in Task 1.
- Failed or offline logout does not leave the client workspace displayed; test the front-end state transition in Task 2.
- No CSS selector under `.workspace-root`, `.workspace-sidebar`, `.workspace-frame`, or `.app-view` changes; review the diff in Task 2.
- Login and welcome remain usable on narrow displays after dark styles are restored; inspect the existing responsive breakpoint in Task 2.

---

### Task 1: Server-side logout endpoint

**Files:**
- Modify: `src/server.ts:111-122, 1171-1201`
- Create: `test/auth-logout.test.ts`

**Interfaces:**
- Consumes: `addCookie(res, value)`, the request authorization gate, and Node HTTP response headers.
- Produces: `clearAuthenticationCookies(res: ServerResponse): void` and `POST /api/auth/logout` returning `{ ok: true }`.

- [ ] **Step 1: Write failing HTTP integration tests for logout cookies and authorization**

Create a disposable server fixture that first receives the issued gateway cookie, then posts to `/api/auth/logout`; assert status `200`, JSON `{ ok: true }`, `cache-control: no-store`, and two expiring `Set-Cookie` values for `hub_token` and `aeos_session`. Post without the gateway token and assert the existing `401` result.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth-logout.test.ts`
Expected: FAIL because `/api/auth/logout` does not exist.

- [ ] **Step 3: Implement `clearAuthenticationCookies(res: ServerResponse): void` and the endpoint in `src/server.ts`**

Use `addCookie` to expire both cookies with `Path=/; HttpOnly; SameSite=Lax; Max-Age=0`; place the `POST` route immediately after authorization and before static/API dispatch. Return `405` for other methods and `{ ok: true }` for a successful post.

- [ ] **Step 4: Run focused tests**

Run: `node --test test/auth-logout.test.ts test/security-hardening.test.ts`
Expected: PASS.

### Task 2: Logout client flow and dark onboarding restoration

**Files:**
- Modify: `public/app.js:470-481, 3790-3810`
- Modify: `public/style.css:160-250, 1423-1451`

**Interfaces:**
- Consumes: `POST /api/auth/logout`, `STORAGE.session`, and the existing `ws` connection.
- Produces: `async function logout(): Promise<void>` that always exits the local workspace and attempts server session invalidation before UI teardown.

- [ ] **Step 1: Update `logout()` in `public/app.js`**

Call `fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })`, close and null the active WebSocket, clear any reconnect timeout, then always remove the local session and show the login stage. Do not block local sign-out on a failed network request; show a concise error toast explaining that server-session invalidation could not be confirmed.

- [ ] **Step 2: Restore the dark login/onboarding CSS only**

Remove or override the later light-product-language rules for `.login-shell`, `.login-card`, login text/inputs/submit button, and `.welcome-shell` with the pre-redesign dark palette (`#08090a` base, white text, translucent white input borders, white primary onboarding button). Make the login transition veil dark rather than white. Leave every workspace CSS selector unchanged.

- [ ] **Step 3: Verify static client contracts and type safety**

Run: `rg -n "api/auth/logout|credentials: 'same-origin'|ws\.close|login-shell|welcome-shell" public/app.js public/style.css src/server.ts; npm run check:types`
Expected: logout route and client call are present; TypeScript exits 0.

- [ ] **Step 4: Build the Docker image and manually verify the user flow**

Run: `docker compose up -d --build`
Expected: container is healthy; after logging in, pressing “退出登录” opens the dark login screen, closes the connection, and a page refresh no longer admits the prior browser cookies.

## Self-Review

- Spec coverage: Task 1 implements security-complete logout; Task 2 restores only login/onboarding visual scope and verifies Docker behavior.
- Step scan: each implementation action fixes a single interface or presentation boundary with a defined check.
- Type consistency: the front end calls the exact endpoint created by Task 1; `clearAuthenticationCookies` is server-only.
- Review focus: each identified cookie, authorization, offline, CSS containment, and responsive risk has an owning test or review step.
- Proportion: two tasks match the two independent user requirements without restructuring unrelated code.
