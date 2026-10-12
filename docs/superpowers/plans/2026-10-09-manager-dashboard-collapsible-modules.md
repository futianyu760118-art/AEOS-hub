# Manager Dashboard Collapsible Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make detailed modules on the manager dashboard collapsed by default and expandable on demand without changing dashboard data, APIs, Agent behavior, or operating-center logic.

**Architecture:** Keep the dashboard's existing data-target elements and refresh code intact. Add presentation-only wrapper markup and toggle controls in `public/index.html`, with CSS controlling visual state and a small client-side event handler managing `aria-expanded` and visibility. High-level objective and metrics remain visible; detail modules begin collapsed.

**Tech Stack:** Static HTML, browser JavaScript, CSS, existing Lucide icons.

**Spec:** User request in this conversation: the manager page's detailed modules are folded by default and opened only when needed; unrelated and core code must not change.

## Global Constraints

- Modify only `public/index.html`, `public/style.css`, and a focused UI test or verification note if one already fits the project.
- Do not change API routes, dashboard data loading, MCP calls, Agent behavior, Result/Verify logic, or operating-center persistence.
- Keep each existing dashboard content element and its `id` so current live refresh code continues to write to it.
- Default state after a page load is collapsed; users may open more than one module at once.
- Toggle controls must be keyboard accessible and expose `aria-expanded` / `aria-controls`.

## Review Focus

- A module refreshes while collapsed: its existing content target still receives new data and is shown correctly when opened.
- Keyboard use: Tab reaches every toggle; Enter and Space toggle it; accessibility state matches visibility.
- Existing header actions still work and do not toggle their containing module accidentally.
- Narrow screens: collapsed headers, action buttons, and chevrons do not overlap or force horizontal page overflow.
- Reload behavior: detailed modules start collapsed again without storing a misleading or stale UI state.

---

### Task 1: Add presentation-only collapsible module structure

**Files:**
- Modify: `public/index.html:180-238`

**Interfaces:**
- Consumes: Current dashboard targets such as `dashboard-future-table`, `dashboard-risk-table`, `dashboard-kitting-table`, `dashboard-quality-table`, `dashboard-production-table`, and `dashboard-decision-list`.
- Produces: A `dashboard-module-toggle` button and a uniquely identified `dashboard-module-content` wrapper for each detailed dashboard module.

- [ ] **Step 1: Add collapsed-state markup for detailed modules**

Keep the objective strip and compact metrics visible. For the future-risk, order-risk, kitting, quality, production, TOP decisions, and governance-pulse modules, add a header toggle with `aria-expanded="false"`, an `aria-controls` reference, and a collapsed content wrapper. Do not rename dynamic data target IDs or remove existing action buttons.

- [ ] **Step 2: Add a delegated dashboard-toggle handler**

Handle only `.dashboard-module-toggle` clicks and keyboard-native button activation. Toggle the parent module's collapsed class, `aria-expanded`, and the content wrapper's `hidden` state. Stop no events globally so existing navigation and Agent buttons retain their current behavior.

- [ ] **Step 3: Manually verify data-target preservation**

Open the manager dashboard, refresh it, expand each module, and confirm existing risk, kitting, quality, production, decision, and governance content renders in the original location.

### Task 2: Style collapsed dashboard modules

**Files:**
- Modify: `public/style.css:445-520`

**Interfaces:**
- Consumes: `dashboard-module-toggle`, `dashboard-module-content`, and the parent collapsed-state class from Task 1.
- Produces: Compact accessible headers, a rotating chevron indicator, visible focus styling, and responsive layout behavior.

- [ ] **Step 1: Add focused module toggle styles**

Make toggle labels visually match existing dashboard headings. Keep header action buttons separate, preserve the existing visual hierarchy, and add a clear keyboard focus ring.

- [ ] **Step 2: Hide only the content wrapper in collapsed state**

Use the wrapper's `hidden` state and collapsed modifier to avoid overriding existing table/grid CSS. Rotate the chevron when expanded.

- [ ] **Step 3: Verify desktop and narrow-screen layouts**

Check that collapsed headers are readable at desktop width and at a narrow browser width, and that action buttons remain usable without opening the module by accident.

### Task 3: Verify no behavioral regression

**Files:**
- Test: Existing dashboard verification commands

**Interfaces:**
- Consumes: Existing dashboard data and static client page.
- Produces: Evidence that the presentation change did not affect dashboard calculation or TypeScript validation.

- [ ] **Step 1: Run dashboard and type checks**

Run: `npm run test:dashboard; npm run check:types`

Expected: PASS; no dashboard data or server behavior changed.

- [ ] **Step 2: Rebuild and open the Docker service**

Run: `docker compose up -d --build aeos-hub`

Expected: `AEOS` reports healthy at `http://localhost:8787`; all detailed manager-dashboard modules start collapsed and can be expanded individually.
