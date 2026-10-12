# M03 Minimum Agent Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AEOS Hub able to register future system master Agents and specialist Agents with governed ownership, lifecycle, hierarchy, and runtime capability allowlists, and document the corresponding local control-plane architecture, without changing the existing business task dispatch flow.

**Architecture:** Reuse the existing AI Harbor snapshot as the sole local Agent Definition registry. Add a separate `registration` object to each Harbor Agent so governance lifecycle is not confused with the current runtime activity status. Keep organization hierarchy as a validated tree; capability authorization remains an explicit allowlist derived from the selected Runtime, while the existing Capability Registry remains the source for displaying MCP business tools.

**Tech Stack:** TypeScript, Node.js built-in test runner, Zod, existing JSON snapshot store, browser JavaScript.

**Spec:** `C:\Users\Administrator\Desktop\AEOS多级Agent架构设计方案.md`

## Global Constraints

- Only change the AI Harbor Agent registry and its creation form; do not alter M01 login, dashboard data loading, business-system integrations, current Agent Squad data, or task dispatch behavior.
- Preserve existing local `data/ai-harbor.json` data by normalizing legacy records at read time; never require the user to delete or manually edit local data.
- Use an explicit `allowedRuntimeCapabilities` allowlist; never add arbitrary SQL, arbitrary URL, or write-operation access.
- Keep the Hub as the sole root; future system master Agents and specialist Agents must form an acyclic parent tree.
- This increment creates Agent Definitions only. Immutable Agent Versions, directed call-graph edges, cross-system workflow routing, external connections, policy engine, approval flow, and management-page editing are separate future increments.
- Use test-first implementation, run focused tests and type checking after each task, and commit only the files changed by that task.

## Review Focus

- An old snapshot missing `registration` still loads with a deterministic, safe registration default; Task 1 pins this migration.
- Two Agents cannot share a code even if letter case differs; Task 1 pins case-insensitive uniqueness.
- Persisted data cannot contain a parent loop even when it bypasses the browser form; Task 1 pins cycle rejection.
- An Agent cannot permit a capability absent from its bound Runtime, or keep an allowlist without a Runtime; Task 1 pins both cases.
- The creation form cannot submit an impossible parent/type/level combination and clearly explains the selected Runtime capability allowlist; Task 2 pins payload construction and server-side behavior.

---

## File Structure

- `src/harbor-store.ts` — Agent Definition registration schema, legacy normalization, hierarchy/capability validation, and creation input handling.
- `test/harbor-store.test.ts` — persistence and validation coverage for the governed Agent Definition registry.
- `public/app.js` — minimal creation-form fields and client-side parent/capability guidance; no edit or routing UI.
- `test/harbor-agent-registry-ui.test.ts` — DOM-free regression checks for the form payload helpers extracted from `public/app.js`, if the current test setup supports it; otherwise add a focused browser-independent helper under `src/` and test it there.
- `docs/architecture/agent-control-plane-v1.md` — implementation-level architecture: current controlled objects, boundaries, hierarchy rules, traceability fields, and explicitly deferred control-plane subsystems.

### Task 0: Record the M03 Control-Plane Architecture

**Files:**
- Create: `docs/architecture/agent-control-plane-v1.md`

**Interfaces:**
- Consumes the target design in `C:\Users\Administrator\Desktop\AEOS多级Agent架构设计方案.md`.
- Produces the local implementation boundary for Tasks 1–2 and for later Agent Version, Capability Contract, Routing, Workflow, Policy, and Approval increments.

- [ ] **Step 1: Document the current-to-target architecture mapping**

  State that `HarborAgent.registration` is the local Agent Definition; `HarborRuntime` is the execution reference; `allowedRuntimeCapabilities` is the current local capability binding; and `parentAgentId` is the organization tree. Include the fixed four-level hierarchy: Hub → system master → specialist → tool.

- [ ] **Step 2: Document non-goals and the later extension seams**

  Distinguish the tree from the future directed invocation graph, and mark immutable Agent Versions, business Capability Contracts, external connections, policy decisions, approvals, workflow state, and multi-tenant isolation as later modules. State that no Agent receives arbitrary SQL or arbitrary URL authority.

- [ ] **Step 3: Verify the document against the existing code and plan**

  Check that every named current object exists in `src/harbor-store.ts`, and that every deferred object is absent from the M03 implementation scope.

- [ ] **Step 4: Commit the architecture record with the completed M03 backend slice**

  ```bash
  git add docs/architecture/agent-control-plane-v1.md src/harbor-store.ts test/harbor-store.test.ts
  git commit -m "feat(agents): add governed harbor registration"
  ```

### Task 1: Governed Agent Definition in AI Harbor

**Files:**
- Modify: `src/harbor-store.ts: HarborAgentSchema, HarborSnapshotSchema validation, createAgent(), defaultSnapshot(), readSnapshotFile()`
- Modify: `test/harbor-store.test.ts`

**Interfaces:**
- Produces `AgentRegistration` on every `HarborAgent`:
  `code: string`, `type: 'hub' | 'master' | 'specialist' | 'tool'`, `ownerOrg: string`, `domain: string`, `lifecycle: 'draft' | 'active' | 'suspended' | 'retired'`, `allowedRuntimeCapabilities: string[]`.
- Consumes existing `HarborRuntime.capabilities` and `parentAgentId`.
- `HarborStore.createAgent(input)` accepts the six registration inputs in addition to its current fields; its existing `status` continues to describe runtime activity only.

- [ ] **Step 1: Write failing store tests for legacy migration and the new registration defaults**

  Create a legacy snapshot without `registration`; load it; assert that the AEOS Hub root becomes code `aeos-hub`, type `hub`, lifecycle `active`, hierarchy `L0`, and that a legacy non-root record receives deterministic non-empty ownership/domain metadata and a safe empty allowlist.

- [ ] **Step 2: Run the focused legacy test to verify it fails**

  Run: `npm run test:harbor -- --test-name-pattern="legacy.*registration"`

  Expected: FAIL because `registration` is absent.

- [ ] **Step 3: Add `AgentRegistrationSchema` and legacy snapshot normalization in `src/harbor-store.ts`**

  Add registration to `HarborAgentSchema`; normalize missing legacy registration before Zod parsing. Use the exact lifecycle values above. Keep the normalized data in memory until the next normal store write; a read-only load must not rewrite the user’s file.

- [ ] **Step 4: Write failing validation tests for codes, tree shape, cycles, and capability allowlists**

  Cover: duplicate codes differing only by case; Hub with a parent or non-`L0` level; master not directly under Hub; specialist not directly under a master; tool not directly under a specialist; a two-node parent cycle in persisted data; capability not present in its selected Runtime; and an allowlist on an Agent without a Runtime.

- [ ] **Step 5: Implement cross-record validation and creation handling**

  Enforce these type/level relationships: `hub/L0` has no parent; `master/L1` has a `hub` parent; `specialist/L2` has a `master` parent; `tool/L3` has a `specialist` parent. Enforce case-insensitive code uniqueness and detect all parent cycles. For an Agent with a Runtime, require every `allowedRuntimeCapabilities` entry to match that Runtime’s declared capability; without a Runtime the list must be empty. Add the registration keys to the strict create-input allowlist and make new non-Hub Agents start in lifecycle `draft` unless explicitly supplied.

- [ ] **Step 6: Run focused store tests and type checking**

  Run: `npm run test:harbor && npm run test:security && npm run check:types`

  Expected: PASS.

- [ ] **Step 7: Hand the completed backend slice to Task 0 for its shared commit**

### Task 2: Safe Agent Creation Form

**Files:**
- Modify: `public/app.js: agent form renderer and submit preparation`
- Create or Modify: `test/harbor-agent-registry-ui.test.ts` (or a focused extracted helper test)

**Interfaces:**
- Consumes the `AgentRegistration` fields from Task 1 and existing `harbor.agents`/`harbor.runtimes`.
- Produces a valid `POST /api/harbor/agents` body: code, type, ownerOrg, domain, lifecycle, parentAgentId, hierarchyLevel, runtimeId, and comma-split `allowedRuntimeCapabilities`.

- [ ] **Step 1: Write a failing test for creation payload normalization**

  Assert that comma-separated allowed capabilities are trimmed and deduplicated, the selected Agent type fixes the matching hierarchy level, and the payload rejects/does not construct an invalid parent type before it reaches the server.

- [ ] **Step 2: Run the focused form/helper test to verify it fails**

  Run the exact Node test command selected by the implementation in Step 1.

  Expected: FAIL because the registration form/payload helper does not yet exist.

- [ ] **Step 3: Extend only the existing “新增智能体” form**

  Add fields with clear Chinese labels: Agent 编码, Agent 类型, 所属组织, 业务域, 生命周期, and Runtime 能力白名单. Derive the hierarchy level from type and only offer eligible parent Agents: Hub root is not user-creatable; master selects the Hub; specialist selects a master; tool selects a specialist. Show the selected Runtime’s declared capabilities beside the allowlist input. Do not add editing, deletion changes, new list pages, or routing behavior.

- [ ] **Step 4: Run the focused UI/helper test and full affected checks**

  Run: `npm run test:harbor && npm run test:security && npm run check:types`

  Expected: PASS.

- [ ] **Step 5: Perform a local authenticated smoke check without creating persistent business data**

  Open the existing AI Harbor page, confirm the new-Agent form shows the governance fields and only valid parent options. Do not submit a production Agent record during this check.

- [ ] **Step 6: Commit the form slice**

  ```bash
  git add public/app.js test/harbor-agent-registry-ui.test.ts
  git commit -m "feat(agents): guide governed agent registration"
  ```

## Self-Review

- **Spec coverage:** This plan covers the present prerequisite from the architecture: Agent Definition ownership, type, lifecycle, hierarchy, capability binding, and lifecycle-safe local persistence. It deliberately defers immutable Agent Version, directed invocation graph, capability contract publishing, connections, policies, workflows, approvals, and routing because those are independent control-plane subsystems.
- **Step scan:** Each task has a single independently reviewable deliverable: governed persistence, then the one existing creation form.
- **Type consistency:** Task 2 sends the exact `AgentRegistration` field names defined by Task 1; `hierarchyLevel` and `parentAgentId` stay existing Harbor fields.
- **Review focus:** Each listed failure mode is assigned to a Task 1 or Task 2 test.
- **Proportion:** The plan changes one data model and one existing form; it does not prescribe a second Agent platform or a broad management console.
