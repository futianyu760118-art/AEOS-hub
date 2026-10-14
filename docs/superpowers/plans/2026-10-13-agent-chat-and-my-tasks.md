# Agent 对话与我的任务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Agent-selectable, governed chat workspace and a tenant-safe “我的任务” task view without changing AEOS's read-only operating-analysis boundary.

**Architecture:** Reuse the conversation workbench, TaskCenter store, Harbor registry, AgentSquad mapping, Codex RuntimeAdapter, and server-side authentication. Add a server-resolved Agent binding to new conversations and pass its immutable instructions when the Codex thread is created; add a read-only task projection for the authenticated actor. The browser only displays candidate data and sends stable IDs, while identity, tenant and runtime checks remain server-side.

**Tech Stack:** Node.js 24, TypeScript, Zod, native Node test runner, plain HTML/CSS/JavaScript, Codex app-server RuntimeAdapter.

**Spec:** docs/superpowers/specs/2026-10-13-agent-chat-and-my-tasks.md

## Global Constraints

- All business analysis remains read-only; Agents provide recommendations only and do not accept, complete, verify, or execute business tasks.
- Keep Guard approval, Evidence records, tenant isolation, current TaskCenter authorization and HUMAN_OPERATOR_TARGET_REQUIRED intact.
- Browser-provided Agent names, models, instructions, runtime IDs, tenant IDs and actor IDs are never authoritative.
- Preserve old agent conversation records and existing risk-dispatch behavior.
- Do not claim absent, stale, or unavailable MCP data is normal or complete data.

## Review Focus

- A forged, draft, private, offline, unhealthy, or foreign-Runtime Agent ID must never create an Agent-bound conversation; test in Task 2.
- Changing an Agent's live model or instructions after a thread starts must not silently mutate that conversation's identity; test in Task 2.
- Existing specialist risk-dispatch sessions keyed by AgentSquad member ID must remain visible and resumable; test in Task 2.
- “我的任务” must return no cross-tenant tasks and must not honor a client-supplied actor ID; test in Task 4.
- An empty Agent list or empty personal task set must remain actionable and accessible on desktop and narrow screens; test in Tasks 3 and 5.

---

### Task 1: Bind Runtime Threads to Immutable Agent Instructions

**Files:**
- Modify: src/runtime/types.ts:44-58
- Modify: src/runtime/codex-runtime-adapter.ts:161-196
- Test: src/runtime/runtime-agent-profile.test.ts

**Interfaces:**
- Consumes: CreateRuntimeSessionRequest and ResumeRuntimeSessionRequest.
- Produces: optional developerInstructions in the session request. The adapter forwards it to thread/start and thread/resume only when present.

- [ ] **Step 1: Write failing adapter tests for instruction forwarding and omission**

Test that createSession with developerInstructions sends that exact parameter, while an empty request omits it; test the equivalent resume behavior.

- [ ] **Step 2: Run test to verify it fails**

Run: node --test src/runtime/runtime-agent-profile.test.ts
Expected: FAIL because the request field and protocol forwarding do not exist.

- [ ] **Step 3: Add developerInstructions to both session request types and forward it in the Codex adapter**

Copy the value into protocol parameters without adding it to runtime metadata or logs. Preserve model and working-directory behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: node --test src/runtime/runtime-agent-profile.test.ts
Expected: PASS.

- [ ] **Step 5: Commit**

Run: git add src/runtime/types.ts src/runtime/codex-runtime-adapter.ts src/runtime/runtime-agent-profile.test.ts
Run: git commit -m "feat: bind runtime sessions to agent instructions"

### Task 2: Create Server-Verified Agent Conversation Bindings

**Files:**
- Create: src/agent-chat.ts
- Modify: src/conversations.ts:20-55
- Modify: src/server.ts:605-655,1753-1857
- Test: test/agent-chat.test.ts
- Test: test/conversations.test.ts

**Interfaces:**
- Consumes: HarborSnapshot, AgentSquadSnapshot, registered CODEX_RUNTIME_ID, and a browser-supplied harborAgentId.
- Produces: resolveChatAgentBinding(input, harbor, squad, runtimeId): ChatAgentBinding. The result has harborAgentId, name, role, provider, model, runtimeId, optional squadMemberId/squadId, instructionFingerprint, and server-only developerInstructions.
- Produces: listSelectableChatAgents(harbor, squad, runtimeId): SelectableChatAgent[], a safe public projection without instructions.

- [ ] **Step 1: Write failing resolver tests for eligibility, safe projections, immutable bindings, and legacy mappings**

Cover a workspace/idle/active Agent bound to runtime-codex-local; reject private, draft, offline, unhealthy and unknown candidates; assert projections omit instructions; assert an old AgentSquad-member conversation can map to a Harbor Agent.

- [ ] **Step 2: Run tests to verify they fail**

Run: node --test test/agent-chat.test.ts test/conversations.test.ts
Expected: FAIL because no resolver or persisted binding exists.

- [ ] **Step 3: Implement src/agent-chat.ts and extend Conversation with optional agentBinding**

Generate an SHA-256 fingerprint from server-resolved instructions plus Agent ID, provider, model and Runtime ID. Preserve legacy scope, agentId and squadId. Store no raw Agent instructions in threads.json.

- [ ] **Step 4: Add authenticated GET /api/chat/agents and canonicalize WebSocket new requests in src/server.ts**

Return only safe candidates. For Agent scope, resolve harborAgentId on the server, reject ineligible IDs before writing a conversation, use binding model and developer instructions to create the thread, and reuse the persisted binding on later turns. Continue accepting existing AgentSquad-member fields for specialist dispatch.

- [ ] **Step 5: Run focused tests and type checking**

Run: node --test test/agent-chat.test.ts test/conversations.test.ts && npm run check:types
Expected: PASS.

- [ ] **Step 6: Commit**

Run: git add src/agent-chat.ts src/conversations.ts src/server.ts test/agent-chat.test.ts test/conversations.test.ts
Run: git commit -m "feat: govern agent-bound conversations"

### Task 3: Add the Reference-Style Agent Picker to the Chat Workbench

**Files:**
- Modify: public/index.html:255-267
- Modify: public/app.js:94-200,1076-1205,5000-5085,5125-5225,5824-5830
- Modify: public/style.css:693-770,1537-1580
- Test: test/chat-agent-picker-ui.test.ts

**Interfaces:**
- Consumes: GET /api/chat/agents and agentBinding.harborAgentId.
- Produces: a chat-agent-picker popover with searchable Agent rows; selecting one changes chat scope, creates a new Agent-bound conversation, and renders only that Agent's sessions in the left rail.

- [ ] **Step 1: Write failing UI contract tests**

Assert chat HTML contains a picker trigger, searchable popover, live-status region and empty candidate message. Assert app.js fetches /api/chat/agents, sends only harborAgentId for a selected Agent, and retains the central-session action.

- [ ] **Step 2: Run test to verify it fails**

Run: node --test test/chat-agent-picker-ui.test.ts
Expected: FAIL because picker markup and behavior are absent.

- [ ] **Step 3: Implement the picker and scoped conversation behavior**

Make the current plus button open the picker. Include the central Agent and server-eligible Agents, group by optional squad, show model/availability, manage focus and outside-click close, and create a new conversation on selection. Existing sessions never silently rebind.

- [ ] **Step 4: Refine the layout without copying the reference brand**

Retain the left conversation rail and wide empty/chat panel, add a compact anchored overlay, and ensure small screens retain a route back from scoped conversations. Use the existing AEOS palette and icon set.

- [ ] **Step 5: Run test to verify it passes**

Run: node --test test/chat-agent-picker-ui.test.ts
Expected: PASS.

- [ ] **Step 6: Commit**

Run: git add public/index.html public/app.js public/style.css test/chat-agent-picker-ui.test.ts
Run: git commit -m "feat: add selectable agent chat picker"

### Task 4: Add a Tenant-Safe My Tasks Projection

**Files:**
- Modify: src/task-api.ts:59-175
- Modify: src/task-center.ts:37-70
- Test: test/task-api.test.ts
- Test: test/my-tasks-api.test.ts

**Interfaces:**
- Consumes: authenticated TaskApiActor only.
- Produces: GET /api/tasks/mine response { tasks, total, assignedTotal, createdTotal }, containing current-tenant tasks where currentAssignee.actorId equals actor.actorId or initiatedBy equals actor.actorId, sorted by updatedAt descending.

- [ ] **Step 1: Write failing API tests for personal task scope and aggregation**

Create tasks assigned to the current actor, created by that actor but assigned elsewhere, other actors in the same tenant, and another tenant. Assert only the first two appear, counts distinguish assigned/created predicates, unauthenticated reads get 401, and a client actor field cannot widen scope.

- [ ] **Step 2: Run test to verify it fails**

Run: node --test test/my-tasks-api.test.ts
Expected: FAIL because /api/tasks/mine is absent.

- [ ] **Step 3: Add TaskCenterStore.listMyTasksForActor(tenantId, actorId) and expose it through TaskApi**

Validate both identifiers using the existing store/API boundary, preserve task snapshots without mutation, and calculate assignedTotal and createdTotal as distinct predicates.

- [ ] **Step 4: Run focused API tests**

Run: node --test test/my-tasks-api.test.ts test/task-api.test.ts
Expected: PASS.

- [ ] **Step 5: Commit**

Run: git add src/task-api.ts src/task-center.ts test/task-api.test.ts test/my-tasks-api.test.ts
Run: git commit -m "feat: expose authenticated my tasks view"

### Task 5: Add My Tasks Navigation and Reuse Task-Center Interactions

**Files:**
- Modify: public/index.html:122-130,492-500
- Modify: public/app.js:631-670,3460-3710,5421-5445
- Modify: public/style.css:941-1035,1537-1585
- Test: test/my-tasks-ui.test.ts
- Test: test/task-center-navigation.test.ts

**Interfaces:**
- Consumes: GET /api/tasks/mine and current authenticated session.
- Produces: a data-view=my-tasks route under task-center-nav, with tabs 全部, 分配给我, 我创建的 and a personal board/list reusing existing task rendering helpers.

- [ ] **Step 1: Write failing navigation and UI contract tests**

Assert “我的任务” appears before “任务” under task collaboration; showView('my-tasks') loads the new endpoint; tabs use response data only; the empty state says assigned-or-created tasks will appear here; and no copy implies Agents execute human task actions.

- [ ] **Step 2: Run test to verify it fails**

Run: node --test test/my-tasks-ui.test.ts test/task-center-navigation.test.ts
Expected: FAIL because route and view do not exist.

- [ ] **Step 3: Implement separate personal-task state, filters and rendering**

Add myTaskState and loadMyTasks() without mutating all-task state. Reuse filterCollaborationTasks, renderCollaborationCard, board/list toggle and task detail/action endpoints. Leave the existing 任务 view as tenant-wide collaboration.

- [ ] **Step 4: Add narrow-screen and empty-state styles**

Ensure tabs wrap or scroll without clipping, filters remain reachable, and the empty-state action exposes existing new-task flow only if the current role can create tasks.

- [ ] **Step 5: Run focused tests and collaboration suite**

Run: node --test test/my-tasks-ui.test.ts test/task-center-navigation.test.ts && npm run test:collaboration
Expected: PASS.

- [ ] **Step 6: Commit**

Run: git add public/index.html public/app.js public/style.css test/my-tasks-ui.test.ts test/task-center-navigation.test.ts
Run: git commit -m "feat: add personal task workspace"

### Task 6: Verify the Integrated Guarded Experience

**Files:**
- Modify: README.md:36-45,118-130
- Test: test/security-hardening.test.ts
- Test: test/chinese-copy.test.ts

**Interfaces:**
- Consumes: completed Tasks 1–5.
- Produces: documented Agent-selection and My Tasks behavior, plus regression coverage that no governance boundary is loosened.

- [ ] **Step 1: Write failing regression tests**

Assert the new UI/copy does not advertise automatic dispatch, Agent task completion, or business execution. Assert direct Agent conversations retain Guard and Evidence paths.

- [ ] **Step 2: Run test to verify it fails**

Run: node --test test/security-hardening.test.ts test/chinese-copy.test.ts
Expected: FAIL until new contracts and copy are covered.

- [ ] **Step 3: Document the capabilities and limits**

Update feature and console tables for server-governed Agent selection, immutable bindings and My Tasks. State that Agent selection does not grant execution authority.

- [ ] **Step 4: Run full verification**

Run: npm run check:types && npm test
Expected: PASS.

- [ ] **Step 5: Perform an authenticated manual smoke check**

Run: npm run web
Expected: after login, a user can select an eligible Agent, start/reopen a scoped conversation, open My Tasks, switch tabs, and observe accurate empty states; all actions remain governed.

- [ ] **Step 6: Commit**

Run: git add README.md test/security-hardening.test.ts test/chinese-copy.test.ts
Run: git commit -m "docs: describe governed agent chat and my tasks"

## Self-Review

- **Spec coverage:** Tasks 1–3 implement real Agent selection and reference-style chat behavior; Tasks 4–5 add a current-user task workspace; Task 6 verifies the read-only and governance boundaries. The Agent/team task tab is explicitly deferred rather than faked.
- **Step scan:** Every task starts with a concrete failing test, identifies files and interfaces, verifies a focused pass, and ends with a reviewable commit.
- **Type consistency:** ChatAgentBinding is server-resolved, stored on Conversation, and consumed by runtime session creation; listMyTasksForActor feeds only /api/tasks/mine and myTaskState.
- **Review Focus:** The five listed failure modes are assigned to Tasks 2–5.
- **Proportion:** This extends existing store, adapter and UI seams; it does not redesign TaskCenter or AI Harbor.

