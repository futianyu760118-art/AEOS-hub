# M01 Startup Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the M01 startup command report success only after the public HTTPS session endpoint confirms `authMode=m01`.

**Architecture:** Keep the existing Docker and host-process startup flow. Add a bounded readiness probe after the hidden Hub process starts, verify the complete Caddy-to-Hub path, and fail clearly when the child exits or readiness times out.

**Tech Stack:** Windows PowerShell, Node.js test runner

**Spec:** User request dated 2026-10-15 and `docs/superpowers/plans/2026-10-12-m01-lan-demo.md`

## Global Constraints

- Modify only the M01 startup script and its focused regression test.
- Do not expose secrets in output or process arguments.
- Preserve the existing 120-second bounded startup behavior.
- Treat only `authMode=m01` from the public `9444` path as ready.

## Review Focus

- Caddy starts before the host Hub and temporarily returns 502: keep polling.
- The hidden Hub process exits before readiness: fail early with an actionable message.
- A local-development Hub occupies port 8790: do not report it as an M01 Hub.
- The public endpoint responds but reports another auth mode: do not report success.
- Readiness never arrives: stop waiting after two minutes.

---

### Task 1: Gate M01 startup success on public authentication readiness

**Files:**
- Modify: `scripts/start-m01-demo.ps1`
- Test: `test/m01-local-scripts.test.mjs`

**Interfaces:**
- Consumes: `deploy/m01/.env` host and port settings and `/api/auth/session` JSON.
- Produces: a startup command that returns success only after `authMode` equals `m01`.

- [x] **Step 1: Write the failing regression test**

Assert that the startup script probes `/api/auth/session`, requires `authMode` to equal `m01`, captures the child process, uses a 120-second deadline, and no longer prints the premature “is starting” success message.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/m01-local-scripts.test.mjs`

Expected: FAIL on the new readiness assertions.

- [x] **Step 3: Implement the bounded readiness gate**

Add a reusable public-session probe, validate an already-running Hub through the same probe, start the hidden Hub with `-PassThru`, poll every two seconds, fail early if the child exits, and report the HTTPS URL only after the probe succeeds.

- [x] **Step 4: Run focused and authentication tests**

Run: `node --test test/m01-local-scripts.test.mjs`

Run: `npm run test:auth`

Expected: all tests pass.

- [x] **Step 5: Run syntax and diff checks**

Run: `npm run check:types`

Run: `git diff --check`

Expected: both pass.
