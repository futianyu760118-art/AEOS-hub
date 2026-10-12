# Dashboard Fixed-Height Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep dashboard operational-data panels at a predictable height while allowing their table content to scroll inside the panel.

**Architecture:** Apply one dashboard-only CSS rule to the existing table containers rather than changing the rendering code or global `.surface` behavior. The rule preserves the existing horizontal overflow for wide grids and adds a bounded vertical scroll area with sticky column headers.

**Tech Stack:** Static HTML, vanilla JavaScript, CSS, Node.js test runner.

**Spec:** User request in the 2026-10-08 Codex conversation: set dashboard panels to a fixed height and browse their contents by scrolling inside each panel.

## Global Constraints

- Modify only `public/style.css`; do not change application data, rendering behavior, or untracked `tmp/` files.
- Limit the change to dashboard data tables: future window, order risk, material kitting, quality, and production coordination.
- Use a 360px fixed content height; retain horizontal scrolling for tables wider than the viewport.
- Keep column headers visible while vertically scrolling and preserve access to all rows via keyboard, mouse wheel, and touch scrolling.

## Review Focus

- More than six data rows: the table stays 360px tall and exposes remaining rows through vertical scrolling; verify in the dashboard browser smoke check.
- A table narrower than the viewport: no unnecessary horizontal scrollbar appears; verify in the dashboard browser smoke check.
- A wide order/quality table: horizontal scrolling continues to reveal all columns; verify in the dashboard browser smoke check.
- Header visibility: the relevant table header remains pinned while its content scrolls vertically; verify in the dashboard browser smoke check.
- Small viewport (<=820px): fixed-height tables remain usable without widening the page; verify in the dashboard browser smoke check.

---

### Task 1: Bound dashboard data-table content

**Files:**
- Modify: `public/style.css` (dashboard table rules near `.future-window-table`, `.risk-table`, `.kitting-table`, and `.quality-table`)
- Test: browser dashboard smoke check using `npm run web` and the existing dashboard route

**Interfaces:**
- Consumes: Existing dashboard table container classes and header row classes emitted by `public/index.html` and `public/app.js`.
- Produces: A shared CSS behavior: four dashboard table container variants have `height: 360px`, `overflow: auto`, and their associated header row remains sticky at the top of the scrolling container.

- [ ] **Step 1: Start the web app and record the current table layout**

Run: `npm run web`
Expected: The dashboard opens and its operational table rows render in the existing containers without a CSS parsing error.

- [ ] **Step 2: Add the fixed-height scrolling declaration to the four dashboard table container selectors in `public/style.css`**

Set `height: 360px` and `overflow: auto` on `.future-window-table`, `.risk-table`, `.kitting-table`, and `.quality-table`; keep `scrollbar-width: thin`.

- [ ] **Step 3: Add sticky-header declarations for `.future-window-head`, `.risk-table .table-head`, `.kitting-head`, and `.quality-head` in `public/style.css`**

Use `position: sticky`, `top: 0`, a surface-matching background, and a stacking order above rows so the labels remain readable during vertical scrolling.

- [ ] **Step 4: Verify normal and narrow dashboard layouts in a browser**

Run: `npm run web`
Expected: At desktop and 820px-or-narrow widths, each listed table retains a 360px content region, supports vertical scrolling for extra rows, supports horizontal scrolling where needed, and keeps the header visible.

- [ ] **Step 5: Run the dashboard data regression test**

Run: `npm run test:dashboard`
Expected: PASS; server-side dashboard data construction remains unaffected by the CSS-only change.

- [ ] **Step 6: Commit**

```bash
git add public/style.css docs/superpowers/plans/2026-10-08-fixed-dashboard-panels.md
git commit -m "style: constrain dashboard data panels"
```
