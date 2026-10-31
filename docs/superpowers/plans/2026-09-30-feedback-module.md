# 反馈模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AEOS Hub 的已登录用户提供可提交、可按当前会话回看且可审计的产品反馈模块。

**Architecture:** 新建独立的 `FeedbackStore`，用 Zod 严格校验版本化 JSON 快照并通过 `atomicWrite` 落盘。`server.ts` 以已有的会话 actor 作为反馈归属，暴露最小 GET/POST API，提交只落元数据到 Evidence；原生前端新增“反馈中心”视图并调用该 API。

**Tech Stack:** Node.js 24、TypeScript、Zod、原生 HTML/CSS/JavaScript、Node test runner。

**Spec:** `docs/superpowers/specs/2026-09-30-feedback-module.md`

## Global Constraints

- 只记录 AEOS Hub 产品反馈，不调用或写入 ERP、MCP 或任何业务系统。
- 反馈正文不得写入 Evidence；审计事件仅保留 ID、类型和服务端会话 actor。
- 请求归属、ID、状态和时间均由服务端生成，客户端输入不得覆盖这些字段。
- 保持现有访问口令、同源校验、会话 Cookie 与 `cache-control: no-store` 的安全边界。
- 使用现有 `atomicWrite`，数据保存于 `data/feedback.json`，快照最大 5 MiB、最多 5,000 条。
- 用户仅能读到当前 Web 会话的最近 100 条反馈，按时间倒序。

## Review Focus

- 空白或超长主题/正文：POST 应返回校验错误且不创建记录（Task 1）。
- 客户端伪造 `actor`、`status`、`id` 或时间：存储接口只接收三项可填字段，并由路由传入服务端 actor（Task 1、Task 2）。
- 不同会话的数据隔离：`listForActor` 不得泄露另一 actor 的记录（Task 1）。
- 损坏或超限的反馈文件：读取应沿用主文件/`.bak` 恢复语义，并在不可恢复时明确失败（Task 1）。
- 反馈正文中的 HTML：前端历史记录必须使用转义文本渲染，不能经 `innerHTML` 注入（Task 3）。

---

## File Structure

- Create: `src/feedback.ts` — 反馈数据模式、版本化本地存储、创建与按 actor 查询接口。
- Create: `test/feedback.test.ts` — 存储校验、归属隔离、排序、边界和持久化测试。
- Modify: `src/server.ts` — 注册 `/api/feedback` 的 GET/POST 路由并写入最小 Evidence 元数据。
- Modify: `public/index.html` — 新增侧栏入口及反馈表单和个人记录区域。
- Modify: `public/app.js` — 视图装载、提交、转义渲染、空态和失败态处理。
- Modify: `public/style.css` — 反馈表单、记录卡和小屏布局样式，复用现有设计令牌。
- Modify: `package.json` — 增加 `test:feedback` 并将它并入 `npm test`。

### Task 1: 反馈数据存储与验证

**Files:**
- Create: `src/feedback.ts`
- Test: `test/feedback.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `atomicWrite(file, content)` from `src/atomic-file.ts`.
- Produces: `FeedbackStore`, `Feedback`, `FeedbackCategory`, `FeedbackStatus`, and `feedbackFile` for HTTP 层调用。

- [ ] **Step 1: Write failing store tests**

Add tests that create a temporary `FeedbackStore` with a fixed clock and assert: a valid `create({ category: 'idea', subject: '增加反馈入口', detail: '…' }, 'web-session:a')` returns an `submitted` item with generated ID/timestamps; `listForActor('web-session:a')` is newest-first and excludes `web-session:b`; invalid/unknown fields and empty or boundary-overflow strings throw; the persisted snapshot reloads; 101 records return only 100.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/feedback.test.ts`

Expected: FAIL because `src/feedback.ts` does not exist.

- [ ] **Step 3: Implement the store in `src/feedback.ts`**

Implement `FeedbackStore.create(input: { category: FeedbackCategory; subject: string; detail: string }, actor: string): Feedback` and `FeedbackStore.listForActor(actor: string): Feedback[]`. Define strict Zod schemas for `bug | idea | experience | other`, `submitted`, one `version: 1` snapshot, and bounded `items`; enforce the limits in the spec, use random UUIDs, `clock().toISOString()`, 5 MiB file guard, primary/`.bak` reads and `atomicWrite`. Do not expose a mutation that accepts client-supplied actor/status/id/time.

- [ ] **Step 4: Run focused tests and type check**

Run: `node --test test/feedback.test.ts && npm run check:types`

Expected: PASS.

- [ ] **Step 5: Wire the test into the suite and commit**

Add `test:feedback` to `package.json` and insert it into the aggregate `test` script.

Run: `npm run test:feedback`

Expected: PASS.

Commit:

```bash
git add src/feedback.ts test/feedback.test.ts package.json
git commit -m "feat: add feedback storage"
```

### Task 2: 会话隔离的反馈 HTTP API 与审计

**Files:**
- Modify: `src/server.ts:12,1192-1540`
- Test: `test/feedback.test.ts`

**Interfaces:**
- Consumes: `FeedbackStore.create`, `FeedbackStore.listForActor` from Task 1; `sessionActorFromRequest`, `readJsonBody`, `sendJson`, and `appendEvidence` from `src/server.ts`.
- Produces: `GET /api/feedback -> { items: Feedback[] }` and `POST /api/feedback -> 201 { item: Feedback }`.

- [ ] **Step 1: Add failing API-contract tests around the store boundary**

Extend `test/feedback.test.ts` with the exact accepted POST body `{ category, subject, detail }`; assert a payload carrying an extra `actor` field is rejected by the strict schema and that a created record cannot be reclassified by input.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/feedback.test.ts`

Expected: FAIL until strict API input parsing is present.

- [ ] **Step 3: Register `/api/feedback` before the generic `/api/` 404 branch**

Import the singleton store. For `GET`, return `feedbackStore.listForActor(requestActor)`. For `POST`, require `application/json` through `readJsonBody`, strictly parse only `category`, `subject`, and `detail`, create with `requestActor`, then append `{ kind: 'app_event', summary: 'feedback submitted', payload: { feedbackId: item.id, category: item.category, actor: requestActor } }`; return 201. Return 405 for other methods and 400 for validation failures. Do not include `subject` or `detail` in the Evidence payload.

- [ ] **Step 4: Run focused tests and project checks**

Run: `node --test test/feedback.test.ts && npm run check:types && npm run test:security`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts test/feedback.test.ts
git commit -m "feat: expose session-scoped feedback API"
```

### Task 3: 反馈中心工作区页面

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `GET /api/feedback` and `POST /api/feedback` from Task 2.
- Produces: `feedback` view registered in `commands`, `VIEW_TITLES`, side navigation and command palette; `loadFeedback()` and submit handler.

- [ ] **Step 1: Add the feedback view markup and navigation**

Place a “反馈中心” navigation item in the existing “系统” group. Add `#view-feedback` with a page header, a form containing `#feedback-category`, `#feedback-subject`, `#feedback-detail`, and `#feedback-submit`, plus `#feedback-list` for “我的反馈”；make all three inputs required and set client-side `maxlength` values to 160 and 2800 for text fields.

- [ ] **Step 2: Implement loading, submit, and safe rendering in `public/app.js`**

Add the required element references and `{ view: 'feedback', label: '反馈中心', desc: '提交产品问题与改进建议', icon: 'message-square-plus', group: '系统' }` command. Make `showView('feedback')` call `loadFeedback()`. `loadFeedback()` fetches GET, renders an empty state or a newest-first record list using the existing `esc()` helper for category labels, subject and detail. On form submit, disable the button, POST exactly `{ category, subject, detail }` with `content-type: application/json`, reset only after 201, reload the list and use existing `toast`; retain entered text and show a failure toast for non-OK responses.

- [ ] **Step 3: Add focused responsive styles in `public/style.css`**

Add styles scoped under `.feedback-*` for a two-column desktop layout, stacked layout below the project’s existing compact breakpoint, form field spacing, clear status pill, metadata and long-text wrapping. Preserve keyboard focus styling and avoid styles that affect other surfaces.

- [ ] **Step 4: Perform static and manual browser verification**

Run: `npm run check:types && npm test`

Expected: PASS.

Start `npm run web`, log in with the documented demo account, open “反馈中心”, submit one valid feedback item, refresh the page, and verify it remains visible only in that session’s list. Inspect Evidence and verify the event has the feedback ID/type but no submitted subject/detail.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: add feedback center UI"
```

### Task 4: Regression documentation and whole-feature verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: completed feedback API and UI from Tasks 1–3.
- Produces: concise operator-visible documentation for scope, privacy behavior, and storage location.

- [ ] **Step 1: Document the MVP boundary**

Add “反馈中心” to the Web 控制台 feature list. State that records are session-scoped, stored in `data/feedback.json`, and Evidence records only submission metadata, not the free-text contents; explicitly state that it does not execute business actions.

- [ ] **Step 2: Run the entire verification suite**

Run: `npm test && npm run check:types`

Expected: PASS.

- [ ] **Step 3: Review the final diff for privacy and scope**

Run: `git diff --check && git diff -- src/feedback.ts src/server.ts public/index.html public/app.js public/style.css README.md`

Expected: no whitespace errors, no feedback content in `appendEvidence`, no MCP or ERP write path, and no unrelated changes.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document feedback center"
```
