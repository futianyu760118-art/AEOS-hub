# Task and Project Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a persistent, tenant-scoped task-and-project collaboration domain with board/list task management and project workspaces, while retaining AEOS's evidence-bound controlled-task workflow.

**Architecture:** Extend the existing `TaskCenterStore` snapshot to a backwards-compatible v2 collaboration aggregate containing projects, tasks, and histories, so task-to-project references and derived progress are validated atomically. Preserve the current controlled G1 task endpoints and add a narrow collaboration API for manual project/task work; render both from the existing single-page application with a shared task board and a project detail drawer.

**Tech Stack:** Node.js 24, TypeScript, Zod, native Node test runner, existing static HTML/CSS/ESM frontend, Lucide.

**Spec:** `docs/superpowers/specs/2026-10-13-task-project-collaboration.md`

## Global Constraints

- Preserve the existing G0/G1 task gate, tenant isolation, M01 identity controls, evidence requirements, audit trail, and human-only mutation restrictions.
- Keep browser-supplied actor identity, tenant ID, organization ID, and roles out of mutation payloads.
- Store data under the existing atomic task-center snapshot; migrate v1 snapshots losslessly to v2 before a write.
- Keep all new user-facing copy in Chinese and use the existing AEOS design system.
- Do not copy reference-site branding, real task content, or protected artwork.

## Review Focus

- A v1 snapshot containing only legacy tasks migrates to v2 without losing any task or history; covered by Task 1 migration tests.
- A task from another tenant cannot be read, linked to a project, or used to affect a project's derived progress; covered by Task 3 API tests.
- Moving a controlled G1 task must still use its existing server-side authorization and state machine, not a generic board mutation path; covered by Task 3 regression tests.
- A project with zero tasks renders 0% progress and a valid empty board rather than an invalid division or blank screen; covered by Task 4 UI projection tests.
- Search, status, project and assignee filters compose without leaking tasks from an inactive project; covered by Task 5 browser-state tests.

---

### Task 1: Versioned Collaboration Aggregate

**Files:**
- Modify: `src/task-center.ts`
- Modify: `test/task-center.test.ts`

**Interfaces:**
- Consumes: current `TaskCenterSnapshot` v1 data and `TaskRecord` state machine.
- Produces: `ProjectRecord`, `ProjectStatus`, `CollaborationMember`, `TaskRecord.projectId`, `TaskCenterStore.createProject`, `updateProject`, `listProjectsForTenant`, and `moveTaskToProject`.

- [ ] **Step 1: Write failing store tests for v1-to-v2 migration, project CRUD, task linking, tenant ownership, and derived completion progress.**
- [ ] **Step 2: Run `node --test test/task-center.test.ts`; expect the new cases to fail because collaboration fields and methods do not exist.**
- [ ] **Step 3: Implement Zod schemas and v1 migration in `src/task-center.ts`.** Add snapshot v2 fields `projects` and `projectHistory`; define project properties (`projectId`, `tenantId`, `name`, `description`, `status`, `priority`, `ownerActorId`, `memberActorIds`, `startDate`, `dueDate`, timestamps). Add nullable `projectId` to tasks, enforce same-tenant references, and calculate project progress only from task terminal states.
- [ ] **Step 4: Run `node --test test/task-center.test.ts`; expect all store tests to pass.**
- [ ] **Step 5: Commit `src/task-center.ts` and `test/task-center.test.ts` with message `feat: add persistent project collaboration domain`.**

### Task 2: Collaboration Authorization Policy

**Files:**
- Modify: `src/task-authorization.ts`
- Modify: `test/task-authorization.test.ts`

**Interfaces:**
- Consumes: authenticated `TaskAuthorizationActor`, `TaskRecord`, and `ProjectRecord` from Task 1.
- Produces: `authorizeCollaborationAction({ action, actor, task?, project? })` returning the existing allow/deny decision shape for `project_create`, `project_update`, `project_read`, `task_create_manual`, `task_update_manual`, and `task_move`.

- [ ] **Step 1: Write failing authorization tests for manager, assigned operator, project member, agent/service/system, and cross-tenant actors.**
- [ ] **Step 2: Run `node --test test/task-authorization.test.ts`; expect the new policy tests to fail.**
- [ ] **Step 3: Implement the collaboration policy without changing existing G1 action semantics.** Managers create and administer projects and manual tasks; a human task assignee may update only their assigned task; non-human identities remain read-only; all tenant mismatches deny.
- [ ] **Step 4: Run `node --test test/task-authorization.test.ts`; expect all policy tests to pass.**
- [ ] **Step 5: Commit `src/task-authorization.ts` and `test/task-authorization.test.ts` with message `feat: authorize collaboration projects and tasks`.**

### Task 3: Tenant-Scoped Project and Manual Task HTTP API

**Files:**
- Modify: `src/task-api.ts`
- Modify: `src/server.ts`
- Modify: `test/task-api.test.ts`
- Create: `test/project-api.test.ts`

**Interfaces:**
- Consumes: Task 1 store methods and Task 2 policy decisions.
- Produces: authenticated API endpoints `GET/POST /api/projects`, `GET/PATCH /api/projects/:projectId`, `GET /api/projects/:projectId/tasks`, `POST /api/tasks/manual`, and `PATCH /api/tasks/:taskId/collaboration`.

- [ ] **Step 1: Write failing API tests for creation, read filtering, project task association, status change, derived progress, forbidden identities, and cross-tenant denial.**
- [ ] **Step 2: Run `node --test test/project-api.test.ts test/task-api.test.ts`; expect the new endpoint tests to fail.**
- [ ] **Step 3: Add HTTP routing and a separate collaboration API branch in `src/task-api.ts`.** Validate request bodies, derive identity and tenancy from the server session, append an Evidence event after committed writes, and return only tenant-scoped records. Retain `/api/operating-cases/:id/tasks` and controlled status/result routes unchanged.
- [ ] **Step 4: Run `node --test test/project-api.test.ts test/task-api.test.ts`; expect both the existing controlled-task suite and the new API tests to pass.**
- [ ] **Step 5: Commit `src/task-api.ts`, `src/server.ts`, and the tests with message `feat: expose project collaboration APIs`.**

### Task 4: Shared Task and Project View Model

**Files:**
- Modify: `public/task-center.js`
- Modify: `test/task-center-ui.test.ts`
- Create: `test/project-center-ui.test.ts`

**Interfaces:**
- Consumes: tenant-scoped task/project API responses and authenticated session.
- Produces: pure helpers `projectDisplayState(project, tasks)`, `taskBoardColumns(tasks)`, `filterCollaborationTasks(tasks, filters)`, and sanitized builders for collaboration mutation bodies.

- [ ] **Step 1: Write failing browser-independent tests for project progress, zero-task projects, task grouping, filters, and payload sanitization.**
- [ ] **Step 2: Run `node --test test/task-center-ui.test.ts test/project-center-ui.test.ts`; expect the new helper tests to fail.**
- [ ] **Step 3: Implement shared display, filtering, and safe request-builder helpers.** Map controlled and manual task states to the same board columns but retain the controlled server transition rules; calculate displayed project progress from API records rather than mutable browser state.
- [ ] **Step 4: Run `node --test test/task-center-ui.test.ts test/project-center-ui.test.ts`; expect all projection tests to pass.**
- [ ] **Step 5: Commit the helpers and tests with message `feat: add project and task board view models`.**

### Task 5: Task Board, Project List, and Project Workspace UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`
- Modify: `test/task-center-navigation.test.ts`
- Create: `test/project-navigation.test.ts`

**Interfaces:**
- Consumes: Task 3 endpoints and Task 4 helpers.
- Produces: navigation entries for 任务 and 项目; `renderTaskCenter()`, `renderProjectList()`, `renderProjectWorkspace(projectId)` and their delegated event handlers.

- [ ] **Step 1: Write failing navigation and rendering contract tests for the two routes, board/list toggle, project table, empty project workspace, and scoped project task list.**
- [ ] **Step 2: Run `node --test test/task-center-navigation.test.ts test/project-navigation.test.ts`; expect the new UI contracts to fail.**
- [ ] **Step 3: Implement the responsive collaboration experience in the existing frontend files.** Add a compact 任务协同 navigation group. Render the task board with search, filters, status columns, counts, cards, list view, task detail drawer and create form. Render a searchable/sortable project list; selecting a project opens a task board and right-hand project detail panel with owner, dates, members, description and derived progress. Use `data-*` actions and delegated events.
- [ ] **Step 4: Run `node --test test/task-center-navigation.test.ts test/project-navigation.test.ts`; expect route and rendering contracts to pass.**
- [ ] **Step 5: Commit frontend files and tests with message `feat: build task and project collaboration workspace`.**

### Task 6: End-to-End Regression and Visual Verification

**Files:**
- Modify: `README.md`
- Modify: `test/task-api.test.ts`
- Modify: `test/project-api.test.ts`

**Interfaces:**
- Consumes: completed implementation from Tasks 1–5.
- Produces: documented API/UI behavior and a verified local user flow.

- [ ] **Step 1: Add an integration regression that creates a project, adds a manual task, assigns/updates it, verifies project progress, and confirms legacy controlled-task routes still enforce their state machine.**
- [ ] **Step 2: Run the focused task/project suites; expect all tests to pass.**
- [ ] **Step 3: Update `README.md` with the task/project routes, permissions, state model, and local verification command.**
- [ ] **Step 4: Run `npm run check:types` and `npm test`; expect both to pass.**
- [ ] **Step 5: Start the local web server and perform browser QA for task creation, filtering, project workspace navigation, and mobile-width layout.**
- [ ] **Step 6: Commit documentation and regression tests with message `test: verify task project collaboration flow`.**

## Self-Review

- Spec coverage: Tasks 1–3 cover durable, tenant-scoped domain and API behavior; Task 4 covers derived presentation state; Task 5 covers all requested task/project views; Task 6 covers regressions and operating documentation.
- Step scan: Every task begins with a failing test, runs it, makes a bounded implementation, then verifies it independently.
- Type consistency: `ProjectRecord` and `TaskRecord.projectId` originate in Task 1 and are used unchanged by authorization, API, projection, and UI tasks.
- Review Focus: Each migration, tenancy, controlled-task, zero-task progress, and composed-filter condition is explicitly assigned to one test task above.
- Proportion: The plan specifies only the domain boundary, routes, functions, and tests necessary for the requested feature; component implementation details remain with the executor.
