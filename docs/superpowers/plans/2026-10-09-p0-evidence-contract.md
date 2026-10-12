# P0 Evidence Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Hub boundary, data ownership, and a validated Evidence contract without expanding business execution.

**Architecture:** Keep JSONL as the pilot persistence adapter, but make every Evidence entry conform to a versioned contract. Create architecture documents that define Hub ownership and external system boundaries. Existing callers continue using `appendEvidence`, while a small normalization layer adds safe Hub defaults and validates the resulting entry.

**Tech Stack:** TypeScript, Node.js test runner, Zod, JSON Schema.

**Spec:** `AEOS设计思路.md`; `architecture/AEOSHUB_BOUNDARY_V1.md`; `architecture/DATA_OWNERSHIP.md`.

## Global Constraints

- The pilot remains read-only for business systems.
- Hub must not become an authoritative store for orders, BOMs, quality, customers, or other business master data.
- Evidence must retain `evidence_refs` and distinguish missing or stale source data from a negative business conclusion.
- Do not modify unrelated UI, dashboard, Agent, or `server.ts` behavior.

## Review Focus

- A record without a tenant or business object must be rejected before persistence.
- A system-only record must use the Hub runtime object reference, not a fabricated business object.
- A large payload must retain a content hash after archival.
- Existing MCP read-only Guard evidence must remain writable through the same API.
- A malformed Evidence JSONL line must not make recent-evidence reads fail.

---

### Task 1: Freeze the Hub boundary and data ownership

**Files:**
- Create: `architecture/AEOSHUB_BOUNDARY_V1.md`
- Create: `architecture/DATA_OWNERSHIP.md`

**Interfaces:**
- Produces: the ownership rules used by the Evidence contract and future M01/M02 adapters.

- [x] **Step 1: Document Hub responsibilities and prohibitions**

State that Hub is a portal and Agent control plane; it may orchestrate approved read-only capabilities, coordination and approvals, but may not own business master data or directly write other business databases.

- [x] **Step 2: Document the ownership matrix**

Record M01 as identity/organization authority, M02 as Event/Result/Evidence/Audit authority, professional systems as business-object authorities, and Hub as owner only of preferences, navigation and temporary runtime state.

- [x] **Step 3: Review documents against `AGENTS.md`**

Expected: no documented action permits the pilot to modify a business system.

### Task 2: Add versioned Evidence contract and validation

**Files:**
- Create: `contracts/evidence/evidence.schema.json`
- Create: `src/evidence-contract.ts`
- Create: `test/evidence-contract.test.ts`
- Modify: `src/evidence.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `normalizeEvidenceEntry(partial) -> EvidenceEntry` and `validateEvidenceEntry(entry) -> EvidenceEntry`.
- Consumes: current `appendEvidence(partial, file?)` call sites without requiring unrelated feature rewrites.

- [x] **Step 1: Write contract tests for complete, missing, and oversized payload evidence**

Assert a valid entry includes `tenant_id`, `object_ref`, `source_system`, `correlation_id`, `version`, `evidence_refs`, and `payload_hash`; assert missing required context is rejected; assert archived payloads keep the SHA-256 hash.

- [x] **Step 2: Run the new tests and confirm they fail**

Run: `node --test test/evidence-contract.test.ts`

Expected: FAIL because the contract module and required fields do not yet exist.

- [x] **Step 3: Add `contracts/evidence/evidence.schema.json` and `src/evidence-contract.ts`**

Define the versioned wire contract. Permit `object_ref` values such as `hub://runtime/<id>` for non-business operational evidence; do not invent business-object references.

- [x] **Step 4: Extend `EvidenceEntry` and `appendEvidence` in `src/evidence.ts`**

Add the contract fields, use safe Hub defaults only for `source_system` and system-object references, calculate `payload_hash` before replacing large payloads, and validate before writing JSONL.

- [x] **Step 5: Run the new tests and existing Guard tests**

Run: `node --test test/evidence-contract.test.ts test/mcp-access-gateway.test.ts`

Expected: PASS.

- [x] **Step 6: Add `test:evidence-contract` to `package.json` and include it in `test`**

Expected: the normal test command executes contract coverage.

### Task 3: Verify only the affected type and test surfaces

**Files:**
- Verify: `src/evidence.ts`
- Verify: `src/evidence-contract.ts`
- Verify: `test/evidence-contract.test.ts`

- [x] **Step 1: Run TypeScript validation**

Run: `npm run check:types`

Expected: PASS.

- [x] **Step 2: Run the affected test suite**

Run: `npm run test:mcp-policy && npm run test:security && npm run test:evidence-contract`

Expected: PASS.

- [x] **Step 3: Inspect the diff**

Run: `git diff -- architecture contracts src/evidence.ts src/evidence-contract.ts test/evidence-contract.test.ts package.json`

Expected: only boundary, ownership, contract, evidence, and test files changed.
