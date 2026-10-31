# AEOS Hub UI Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不改变中台只读数据边界的前提下，优化首页、AI 港湾、Attention 和 Evidence 的可读性与操作反馈，并保留现有布局拖拽能力。

**Architecture:** 继续沿用现有单页 HTML/CSS/原生 JavaScript，不引入 UI 框架。新增统一的页面编辑态与状态组件样式，前端仅管理布局、筛选和展示状态；业务数据仍由现有 API/MCP 提供。

**Tech Stack:** TypeScript server, 原生 JavaScript, HTML, CSS, Node test runner。

**Spec:** 本轮用户需求：“先在本地优化一下，先不部署 Docker”。

## Global Constraints

- 不执行 Docker 部署。
- 不修改业务中台/MCP 返回的数据，只优化展示、布局和交互反馈。
- 保持现有 Agent 会话隔离、并行调度和 Evidence 引用行为。
- 所有本地布局偏好继续保存到浏览器当前工作区。

## Review Focus

- 编辑态开启/关闭：关闭后不应误触发拖拽或隐藏操作。
- 并行 Agent 执行：非当前会话的运行状态不能覆盖当前会话的输入状态。
- Attention 空数据/低置信度：不能把“未读取到数据”显示成“没有风险”。
- AI 港湾层级过长名称：树节点和表格在窄屏下必须截断且仍可操作。
- Evidence 筛选无结果：需要明确显示空状态而不是空白页面。

---

### Task 1: 首页编辑态与视觉层级

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Reuse existing `DASHBOARD_LAYOUT_STORAGE`, `applyDashboardLayout`, `saveDashboardLayout`.
- Add an explicit edit-mode toggle and module visibility controls without changing dashboard snapshot data.

- [x] Add an “编辑布局” toggle and visible module count to the dashboard header.
- [x] Show drag handles and hide controls only while edit mode is active; keep existing reset behavior.
- [x] Add compact responsive spacing and consistent surface headers for the dashboard modules.
- [x] Verify layout order and hidden module state survive reload and reset correctly.

### Task 2: Parallel Agent task feedback

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Reuse `runningConversationIds`, `riskAgentDispatches`, and existing conversation filters.

- [x] Add a task-status strip/drawer entry point that lists running specialist conversations.
- [x] Show Agent name, task label, elapsed state, and a direct conversation action.
- [x] Keep current conversation composer scoped to the selected conversation.
- [x] Verify completion/failure removes or updates only the matching task.

### Task 3: AI 港湾 and Agent squad readability

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`

- [x] Add search/filter controls for Agent name, hierarchy level, squad and status.
- [x] Improve hierarchy badges for L0–L3 and make long names/details truncate safely.
- [x] Add squad summary counts for active, waiting and failed work without mutating source data.
- [x] Verify an empty search result has a clear empty state.

### Task 4: Attention and Evidence information hierarchy

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`

- [x] Add Attention filters for source, severity and lifecycle state while retaining drag-to-state behavior.
- [x] Add clearer low-confidence, stale-data and no-result states.
- [x] Improve Evidence row metadata with source, freshness and related entity emphasis using existing fields.
- [x] Verify filtering does not change persisted business records.

### Task 5: Verification

**Files:**
- Test: existing TypeScript and Node test suites

- [x] Run `npm run check:types`.
- [x] Run `node --check public/app.js`.
- [x] Run dashboard, conversations, squad, harbor and operating-center tests.
- [x] Do not run `docker compose up -d --build` in this round.
