# AEOS Hub 精益安全控制台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AEOS Hub 收敛为安全的经营工作台，隐藏技术证据细节，合并冗余导航，以服务端认证与最小权限取代演示登录。

**Architecture:** 新增独立认证授权层，由服务端会话确定用户与角色，并在 HTTP、WebSocket、页面导航和写接口一致执行策略。前端保留既有业务与审计数据模型，但重新组织成三个日常页面和一个管理员专属系统区；原始证据 URI 继续后端留存，只通过审计员授权的按需详情显示。

**Tech Stack:** Node.js 24、TypeScript、Zod、Node crypto scrypt、原生 HTML/CSS/JavaScript、Node test runner。

**Spec:** `docs/superpowers/specs/2026-09-30-lean-secure-console.md`

## Global Constraints

- 不执行或新增 ERP、MCP、订单、物料、质量或生产写操作；删除 Autopilot 的全部调度与入口。
- 正常用户界面不得渲染完整 `evidence_ref`、`control-platform://` URI 或本地审计文件路径。
- UI 隐藏不是权限控制：API、WebSocket 和静态管理入口必须在服务端按角色拒绝。
- 禁止默认账号、浏览器端密码判断、`--no-auth`、`HUB_NO_AUTH` 和 URL 查询令牌。
- 未配置 `AEOS_BOOTSTRAP_ADMIN_USERNAME` 或 `AEOS_ADMIN_PASSWORD_HASH` 时服务拒绝启动；密码和会话 token 不写入日志或 Evidence。
- TLS 反向代理是局域网部署前置条件；无 `AEOS_PUBLIC_ORIGIN` 时仅监听 loopback。
- 保留全部既有历史数据文件和 API 数据模型，除非后续迁移明确验证后才删除。

## Review Focus

- 直接访问隐藏的 `/api/config`、`/api/evidence`、Harbor、Squad、Registry 和其 WebSocket 动作：必须由服务端返回 401/403，而非依赖前端隐藏（Task 2）。
- 缺失、伪造或过期的会话/CSRF Cookie：状态改变请求和 Socket 升级必须拒绝（Task 1、Task 2）。
- 风险详情、看板表格、事项卡、Inbox、搜索和 Agent 活动中的证据 URI：普通角色均不得泄露；审计员只有显式打开证据详情后才可见（Task 3）。
- 由 `innerHTML` 渲染的经营数据与反馈文本：必须继续转义，且不能把审计 URI 拼进常规页面（Task 3）。
- 数据缺失、STALE_DATA、UPSTREAM_UNAVAILABLE 或空结果：界面必须表达“数据待确认/置信度不足”，不得因精简而显示为零风险（Task 3、Task 4）。

---

## File Structure

- Create: `src/auth.ts` — 密码哈希解析、本地账号、服务端会话、角色与 CSRF 策略。
- Create: `scripts/generate-password-hash.mjs` — 仅生成可粘贴的 scrypt 密码哈希，不读取或写入账号库。
- Create: `test/auth.test.ts` — 认证、过期、权限、CSRF 和 Cookie 安全属性测试。
- Modify: `src/server.ts` — 移除演示访问模式，接入登录/退出、角色门禁、Socket 授权和安全响应头。
- Modify: `src/http-security.ts` — 增加状态变更的严格 Origin 校验和受限公开源校验。
- Modify: `test/security-hardening.test.ts` — 路由与 Socket 的未认证/越权回归覆盖。
- Modify: `public/index.html` — 精简一级导航、合并经营闭环、增加受控证据详情与真实登录结构。
- Modify: `public/app.js` — 服务器登录、角色感知导航、合并工作台、无 URI 的业务展示。
- Modify: `public/style.css` — 中文字体令牌、四级字阶、精简布局和受控审计样式。
- Modify: `README.md`, `docker-compose*.yml`, `docker-compose.env.example` — 安全部署与 TLS/环境变量说明。

### Task 1: 服务端认证、会话与最小角色模型

**Files:**
- Create: `src/auth.ts`
- Create: `scripts/generate-password-hash.mjs`
- Create: `test/auth.test.ts`
- Modify: `src/server.ts:72-130,1192-1560`

**Interfaces:**
- Produces: `AuthService.login(input, requestContext)`, `AuthService.requireSession(req)`, `AuthService.requireRole(session, permission)`, `AuthService.requireCsrf(req, session)`, and typed `Principal` with `manager | operator | auditor | admin` roles.
- Consumes: Node `crypto.scrypt`, `timingSafeEqual`, existing cookie helpers, `readJsonBody`, `sendJson`, and `appendEvidence`.

- [ ] **Step 1: Write failing authentication tests**

Add fixed-clock tests proving: a configured scrypt hash accepts the correct administrator password and rejects a wrong one in constant-time comparison; login creates a bounded server-side session; logout/revocation and expiration invalidate it; every generated session cookie is `HttpOnly`, `SameSite=Strict`, scoped to `/`, and `Secure` when public origin is HTTPS; a missing configuration produces a startup configuration error without exposing a fallback password.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/auth.test.ts`

Expected: FAIL because `src/auth.ts` does not exist.

- [ ] **Step 3: Implement `AuthService` and local-account bootstrap**

Implement a strict `AEOS_ADMIN_PASSWORD_HASH` parser in `src/auth.ts` using a versioned `scrypt$N$r$p$salt$derivedKey` representation; add `scripts/generate-password-hash.mjs` to emit that value without saving it. On the first empty account store only, create the `AEOS_BOOTSTRAP_ADMIN_USERNAME` admin record from the configured hash; otherwise require the persisted account store. Maintain accounts and sessions in bounded, atomically persisted files under `data/`, rotate the identifier on login, cap idle and absolute lifetime, and issue a second opaque CSRF token bound to the session. Expose no default account or password.

- [ ] **Step 4: Replace browser-only login with server endpoints**

In `src/server.ts`, delete the `NO_AUTH`, share-token and implicit session-actor branches. Add `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/session`; login accepts only `{ username, password }`, returns no password-derived details, creates server cookies, and records a sanitized authentication event. Refuse non-loopback startup unless `AEOS_PUBLIC_ORIGIN` is valid HTTPS; make loopback use a secure deployment warning rather than an insecure bypass.

- [ ] **Step 5: Run focused verification and commit**

Run: `node --test test/auth.test.ts && npm run check:types`

Expected: PASS.

Commit:

```bash
git add src/auth.ts test/auth.test.ts src/server.ts
git commit -m "feat: add server-side authentication"
```

### Task 2: API、WebSocket 和管理面的授权边界

**Files:**
- Modify: `src/server.ts`
- Modify: `src/http-security.ts`
- Modify: `test/security-hardening.test.ts`
- Modify: `test/auth.test.ts`

**Interfaces:**
- Consumes: Task 1 `Principal`, permission checks and CSRF verifier.
- Produces: route-level permission map and WebSocket upgrade guard; `401` for no session, `403` for valid session without a permission, and role-filtered API responses.

- [ ] **Step 1: Write failing authorization matrix tests**

Add table-driven tests for unauthenticated, manager, operator, auditor and admin principals. Assert: manager may read dashboard/cases and start only read-only analysis; operator may record permitted human decisions; auditor alone may read raw evidence; admin alone may access config, Harbor, Squad, Registry, runtime verification and local-account administration. Assert POST/PATCH/PUT/DELETE rejects missing/mismatched Origin or CSRF token, and WebSocket upgrade rejects missing/invalid server session.

- [ ] **Step 2: Run focused security tests to verify they fail**

Run: `node --test test/auth.test.ts test/security-hardening.test.ts`

Expected: FAIL until routes and Socket upgrade enforce the matrix.

- [ ] **Step 3: Apply central permission and CSRF checks before route dispatch**

Define permissions once (`dashboard:read`, `case:decide`, `audit:read`, `system:manage`, `agent:read`) and map every `/api/` route and WebSocket message type to one. Require strict same-origin plus session-bound CSRF for state-changing browser requests; do not retain the current “missing Origin is accepted” compatibility branch for browser APIs. Set `Cache-Control: no-store`, `Permissions-Policy`, a restrictive CSP, `Cross-Origin-Opener-Policy`, and HSTS only for HTTPS public origins. Make failed authorization auditable without logging tokens, passwords or request bodies.

- [ ] **Step 4: Restrict administration and lifecycle controls**

Require `system:manage` for provider settings, MCP registry, AI Harbor, Agent Squad, runtime verification, account creation/role assignment and any destructive conversation action. Add an admin-only local-account endpoint that accepts a username, generated-password hash and one of the four fixed roles; it must reject duplicate names, unknown fields and any attempt to send a plaintext password. Require `case:decide` for decisions, edits and autopilot configuration/run; retain confirmation and Evidence for every allowed mutation. Do not change MCP read-only policy or grant new business actions.

- [ ] **Step 5: Run security regression checks and commit**

Run: `node --test test/auth.test.ts test/security-hardening.test.ts && npm run check:types`

Expected: PASS.

Commit:

```bash
git add src/server.ts src/http-security.ts test/auth.test.ts test/security-hardening.test.ts
git commit -m "feat: enforce API and socket authorization"
```

### Task 3: 精简日常工作台并受控展示证据

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `GET /api/auth/session`, role-filtered APIs, and a new auditor-only `GET /api/audit/evidence/:id` endpoint from Task 2.
- Produces: three daily views—`dashboard`, `cases`, `chat`—and an admin-only `system` area; `openEvidenceDetail()` only for `auditor` or `admin`.

- [ ] **Step 1: Write a UI exposure checklist before changing markup**

List all existing raw-reference output points in `public/app.js`: risk modal, Attention cards/search, case cards, Inbox modal, kitting/quality/production tables, activity prompts and Evidence page. Mark each as “replace with evidence-state label,” “internal-only,” or “auditor detail.” Include the screenshot URI as the acceptance example: a normal material-kitting card must not render `control-platform://kitting-result/...`.

- [ ] **Step 2: Consolidate navigation without deleting capabilities**

Make `dashboard`, `cases`, and `chat` the only normal user navigation/command targets. Fold Attention and Inbox content into the `cases` view as sections for “待处理风险”“经营事项”“工作消息”; retain their current data functions but do not load duplicate pages on application startup. Move Harbor, Squad, Registry, Evidence and Config under one `system` view rendered only for admin; direct hash navigation must fall back to the first authorized view. Remove these technical labels from the welcome preview and header shortcuts.

- [ ] **Step 3: Replace all normal-view raw references**

Remove direct URI `<code>` rendering and URI search from all dashboard, case, inbox and risk-detail rendering. Use only `证据已关联`, `证据待补充`, `数据待确认` labels derived from the existence and freshness/confidence of the existing field. Preserve `evidenceRef` in the JavaScript model for server calls and agent prompts, but never concatenate it into ordinary HTML. In risk details, add an auditor-only “查看证据详情” button that requests an allowlisted server record and displays it in a modal with copy disabled by default; non-auditors see no button or URI.

- [ ] **Step 4: Define and apply typography tokens**

Replace scattered `font` declarations with `--font-ui`, `--font-data`, `--font-audit` and named size/line-height tokens. Set a Chinese-first UI stack (`Microsoft YaHei UI`, `PingFang SC`, `Noto Sans SC`, system fallback); reserve `ui-monospace` for auditor identifiers only. Apply the four levels consistently: page title 26px, section title 16px, body/control 14px, metadata 12px; maintain 4.5:1 text contrast and visible focus states.

- [ ] **Step 5: Verify page behavior manually**

Run: `npm run check:types && npm test`

Then start the server with an administrator hash, verify manager navigation contains only three working pages, verify a material-kitting card corresponding to the supplied screenshot displays no `control-platform://` URI, verify direct admin URL/API access returns 403 for manager, and verify an auditor can open the explicit evidence-detail modal.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: streamline workspace and protect evidence details"
```

### Task 4: 删除定时 Autopilot 并迁移既有本地快照

**Files:**
- Modify: `src/server.ts`
- Modify: `test/operating-center.test.ts`
- Modify: `src/operating-center.ts`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Modify: `README.md`

**Interfaces:**
- Consumes: existing `OperatingCenterStore` snapshots and `loadDashboardSnapshot`.
- Produces: a version-2 operating-center snapshot containing only cases, decisions and Inbox; `/api/autopilot` and `/api/autopilot/run` no longer exist; a server-owned five-minute read-only dashboard refresh cache.

- [ ] **Step 1: Add failing Autopilot removal and migration tests**

Replace the Autopilot schedule tests with a version-1 fixture containing `autopilot` and `runs`; assert loading it preserves cases, decisions and Inbox, drops the removed fields, and writes a version-2 snapshot on the next normal mutation. Add an HTTP regression test that `/api/autopilot` and `/api/autopilot/run` return 404.

- [ ] **Step 2: Remove scheduler, routes, UI and persisted fields**

Delete `runDailyRiskAutopilot`, `runDueAutopilot`, the Autopilot interval lifecycle, the two Autopilot routes, all Autopilot DOM elements/listeners/styles, and `Autopilot*` schemas/methods. Add a separate five-minute server-owned `refreshDecisionData()` timer that calls only `loadDashboardSnapshot`, caches the latest result and never creates cases; migrate legacy version-1 snapshots in-memory to version 2 without changing cases, decisions or Inbox; exclude legacy `autopilot_result` Inbox messages from future UI display but retain them in the raw data file for audit.

- [ ] **Step 3: Update operator documentation**

Remove Autopilot from the README feature list, console description and known behavior. Document that scheduled risk scans were removed and existing operating cases remain available; retain the current demo login documentation.

- [ ] **Step 4: Run full verification and review diff**

Run: `npm test && npm run check:types && git diff --check`

Expected: PASS; no Autopilot route, schedule schema, DOM element, listener or style remains; the only background timer performs read-only dashboard refresh; and no new MCP business-write capability exists.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/operating-center.ts test/operating-center.test.ts public/index.html public/app.js public/style.css README.md
git commit -m "refactor: remove scheduled autopilot"
```
