# AEOS Hub UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 AEOS Hub 改造成深色、低噪声、数据密度友好的经营工作台，提升导航层级、卡片可读性、看板列式布局和操作反馈，同时不改变既有业务接口与只读边界。

**Architecture:** 保留现有 HTML 结构、数据加载和事件绑定，仅在 `public/style.css` 建立新的视觉 token、层级、响应式布局和交互状态；在 `public/index.html` 增加少量导航/看板语义标记，在 `public/app.js` 增加拖拽和按钮反馈所需的最小状态。所有用户布局仍使用现有 localStorage，不写入中控业务数据。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Lucide 图标、现有 Node/TypeScript 服务；不新增前端依赖，不部署 Docker。

**Spec:** 本地 UI redesign request from user, 2026-09-29.

## Global Constraints

- 不改变现有 API、MCP 只读约束、Evidence/Guard 语义和登录流程。
- 不新增外部字体或网络依赖；优先使用系统 Inter/Segoe UI 字体栈。
- 颜色采用 Linear 风格深色中性面板，风险状态仍使用高对比语义色。
- 所有可点击控件保持键盘 focus、`aria-label` 和至少 40px 触控尺寸。
- 本轮只本地预览，不执行 Docker build、compose up 或数据迁移。

## Review Focus

- 编辑模式、拖拽模式与普通浏览模式必须有明显且不冲突的视觉状态。
- Attention/Registry 看板列在窄屏时必须可横向滚动，不能压缩到不可读。
- 侧栏折叠或窄屏时导航仍能看到当前页面与未读数量。
- 加载、成功、错误、空状态和已保存反馈不能只依赖颜色。
- 深色背景上的风险红/黄/绿文字必须满足可读性，不影响现有状态含义。

---

### Task 1: Establish visual system and shell hierarchy

**Files:**
- Modify: `public/style.css`
- Modify: `public/index.html`

- [ ] Define Linear-inspired dark tokens, surface elevations, typography, spacing, borders, focus rings and semantic status colors.
- [ ] Restyle app shell, sidebar, topbar, page headings, buttons, inputs, status pills and modal surfaces.
- [ ] Add explicit navigation grouping, active rail treatment and compact unread badges without changing view routing.
- [ ] Add responsive shell rules for desktop/tablet/mobile and verify no content becomes inaccessible.

### Task 2: Convert management surfaces to readable board layouts

**Files:**
- Modify: `public/style.css`
- Modify: `public/index.html`

- [ ] Style dashboard widgets as elevated metric cards with clear primary/secondary hierarchy.
- [ ] Restyle Attention and Capability Registry containers as horizontal Kanban columns with sticky column headers, drop targets and scroll affordances.
- [ ] Improve Agent Harbor/Squad roster cards, conversation pane and Inbox rows with density controls, hover states and clear action placement.
- [ ] Preserve existing `data-kanban-column`, filter IDs and action hooks used by `public/app.js`.

### Task 3: Add interaction feedback and local preview verification

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css`

- [ ] Add shared pressed/dragging/saved/loading feedback classes to existing handlers without changing persistence semantics.
- [ ] Ensure edit mode announces state changes and drag/drop columns expose visual success/error feedback.
- [ ] Run `npm run check:types` and `npm test`.
- [ ] Start a separate local preview port, inspect dashboard, Attention, AI Harbor, Inbox and Registry, then report the preview URL and remaining visual trade-offs.
