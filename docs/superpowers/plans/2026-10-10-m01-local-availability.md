# M01 Local Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the locally verified M01 version of AEOS Hub reliably start and stop on this Windows PC through safe PowerShell commands, without adding a second database or exposing it to the LAN.

**Architecture:** Keep Keycloak, PostgreSQL, and Caddy in the existing isolated `deploy/m01` Docker Compose stack; PostgreSQL remains Keycloak's only identity database. Start the M01 Hub as its existing host-side Node process on `127.0.0.1:8790`, using a child PowerShell process that reads secrets only from the ignored `deploy/m01/.env` file. Docker container restart policies make the identity stack recover after Docker restarts; a future Windows Task Scheduler registration remains an explicit, separate user-approved action.

**Tech Stack:** Windows PowerShell 5.1+, Docker Desktop Compose, Node.js, existing Keycloak/PostgreSQL/Caddy stack.

**Spec:** `docs/auth/m01-handover.md`, `docs/auth/m01-local-acceptance.md`, and the user's requirement that the M01 Hub be conveniently available locally like the existing 8787 service.

## Global Constraints

- Do not create a desktop database or a user-password table; Keycloak PostgreSQL remains the sole identity store.
- Do not modify root `docker-compose.yml`, business routes, MCP, dashboards, task code, evidence code, or M01 authentication semantics.
- Do not read, print, commit, copy outside the project, or embed values from `deploy/m01/.env`; it is the only local secret source.
- Do not modify the tracked `deploy/m01/.env.example` file, whose current worktree-only CRLF status must remain untouched.
- Keep all services bound to the existing local-only topology: Hub `127.0.0.1:8790`, Keycloak TLS endpoint `127.0.0.1:9443`; do not implement LAN exposure or firewall changes.
- Do not create a Windows Scheduled Task or change Docker Desktop startup settings in this implementation; provide an explicit preview/installation guide only, pending separate user consent.
- Stop only the Hub process positively identified as this project's `node src/server.ts` process listening on port 8790; never terminate an unknown process on that port.

## Review Focus

- Missing, sentinel, malformed, or unreadable `deploy/m01/.env` must stop before Compose or Node starts, without echoing any secret; tested in Task 1.
- A running unrelated process on port 8790 must not be terminated by the stop command; tested in Task 2.
- Existing M01 Hub should not be duplicated when the start command runs twice; tested in Task 1.
- Docker/Keycloak not being ready must time out with a sanitized diagnostic and leave no secret in console output; tested in Task 1.
- The future autostart instructions must make clear that creating a persistent Windows scheduled task is optional and requires explicit user action; reviewed in Task 3.

---

## File Structure

- Create: `scripts/start-m01-demo.ps1` — validates prerequisites, starts the existing M01 Compose stack, waits for its HTTPS discovery endpoint, and launches the Hub wrapper only if this Hub is not already listening.
- Create: `scripts/run-m01-hub.ps1` — private child-process entrypoint that loads ignored `.env`, constructs only the existing M01 environment values, and runs `npm run web` on port 8790.
- Create: `scripts/stop-m01-demo.ps1` — stops only the positively identified M01 Node process and then stops (not removes) the M01 Compose services.
- Create: `scripts/test-m01-demo.ps1` — dry-run/status command that checks Docker, Compose, expected ports, and discovery without creating resources or reading secret values into output.
- Create: `test/m01-local-scripts.test.mjs` — static Node tests proving script safety contracts and no tracked secret/template access.
- Create: `docs/auth/m01-local-startup.md` — local start/stop/recovery instructions and a separate, non-executing Windows Task Scheduler preview.
- Modify: `package.json` — add a `test:m01-local-scripts` script and include it in the existing authentication test command.

### Task 1: Safe M01 Local Startup

**Files:**
- Create: `scripts/start-m01-demo.ps1`
- Create: `scripts/run-m01-hub.ps1`
- Create: `scripts/test-m01-demo.ps1`
- Create: `test/m01-local-scripts.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: ignored `deploy/m01/.env`, `deploy/m01/docker-compose.yml`, `deploy/m01/caddy-root.crt`, Docker Compose, and the existing Hub `npm run web` command.
- Produces: `start-m01-demo.ps1 [-NoBrowser] [-WhatIf]`, `test-m01-demo.ps1`, and a hidden child Hub process only after readiness succeeds.

- [ ] **Step 1: Write failing static tests for startup safety**

Assert that scripts use `.env` and never `.env.example`; never use `Get-Content`/Write-Host to print secret values; use `docker compose --env-file deploy/m01/.env`; set the exact existing M01 environment keys; bind Hub to `127.0.0.1:8790`; and provide `-WhatIf` without invoking Compose or Node.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/m01-local-scripts.test.mjs`

Expected: FAIL because the scripts and test command do not exist.

- [ ] **Step 3: Implement startup and health/status scripts**

`start-m01-demo.ps1` must validate Docker availability, `.env` existence, and absence of sentinel values without outputting values. It starts Compose only after validation, waits with a finite timeout for the configured HTTPS discovery URL, checks whether the project Hub already owns port 8790, and otherwise starts `run-m01-hub.ps1` as a hidden child process. `run-m01-hub.ps1` may read `.env` but must parse it in memory, set child environment variables, and never echo them. `test-m01-demo.ps1` is read-only/dry-run status only.

- [ ] **Step 4: Run focused verification**

Run: `node --test test/m01-local-scripts.test.mjs && npm run check:types && powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-m01-demo.ps1 -WhatIf`

Expected: static tests and type check PASS; dry-run reports only redacted readiness/status information and starts nothing.

- [ ] **Step 5: Commit the startup tooling**

```bash
git add scripts/start-m01-demo.ps1 scripts/run-m01-hub.ps1 scripts/test-m01-demo.ps1 test/m01-local-scripts.test.mjs package.json
git commit -m "feat(ops): add local M01 startup tooling"
```

### Task 2: Safe M01 Local Shutdown

**Files:**
- Create: `scripts/stop-m01-demo.ps1`
- Modify: `test/m01-local-scripts.test.mjs`

**Interfaces:**
- Consumes: port 8790 process metadata and existing Compose project.
- Produces: `stop-m01-demo.ps1 [-KeepIdentityStack] [-WhatIf]`, with the default preserving Docker volumes.

- [ ] **Step 1: Write failing shutdown safety tests**

Assert that the stop script identifies the process by port plus command-line ownership, refuses unknown listeners, has a `-WhatIf` mode, uses `docker compose stop` rather than `down -v`, and never references `.env.example` for runtime values.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/m01-local-scripts.test.mjs`

Expected: FAIL because the shutdown script does not exist.

- [ ] **Step 3: Implement `stop-m01-demo.ps1`**

Resolve the process listening on `127.0.0.1:8790`, inspect only its command line, and terminate it only if it is the repository's `node src/server.ts` process. Stop Compose services with `docker compose stop` by default; preserve named volumes and Caddy CA data. `-KeepIdentityStack` skips Compose stop and only stops Hub.

- [ ] **Step 4: Run focused verification**

Run: `node --test test/m01-local-scripts.test.mjs && powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-m01-demo.ps1 -WhatIf`

Expected: PASS; the dry run names actions but neither stops the Hub nor Docker services.

- [ ] **Step 5: Commit the shutdown tooling**

```bash
git add scripts/stop-m01-demo.ps1 test/m01-local-scripts.test.mjs
git commit -m "feat(ops): add safe M01 shutdown tooling"
```

### Task 3: Document Local Availability and Autostart Preview

**Files:**
- Create: `docs/auth/m01-local-startup.md`

**Interfaces:**
- Consumes: the scripts from Tasks 1–2 and the existing M01 acceptance documentation.
- Produces: copyable local start, stop, status, recovery, and opt-in Task Scheduler preview commands.

- [ ] **Step 1: Write the local operation guide**

Document prerequisites, `-WhatIf` validation, normal start/stop commands, recovery from a stopped Docker Desktop service, and the warning that `docker compose down -v` destroys Keycloak data and Caddy's local CA. Include the current local URLs and state that this does not enable LAN access.

- [ ] **Step 2: Add a non-executing autostart preview**

Show the exact task name, trigger (`At log on`), execution command, working directory, and highest-privilege requirements for a future scheduled task. State that registration is not performed by these scripts and requires explicit user approval.

- [ ] **Step 3: Verify documentation references actual commands**

Run: `rg -n "start-m01-demo|stop-m01-demo|test-m01-demo|Scheduled Task|down -v" docs/auth/m01-local-startup.md`

Expected: every documented command corresponds to a script and all recovery warnings are present.

- [ ] **Step 4: Commit documentation**

```bash
git add docs/auth/m01-local-startup.md
git commit -m "docs(ops): document local M01 availability"
```

## Self-Review

- **Spec coverage:** The plan provides local availability through safe start/stop/status scripts and a future autostart preview, without inventing another password database or exposing the M01 stack to the LAN.
- **Scope control:** Only new operations scripts, their tests, a targeted package test command, and one operations document change. Existing M01 code, Compose definitions, tracked template, and business features remain untouched.
- **Type consistency:** Script names, flags, URLs, Compose file, `.env` source, and port 8790 are defined once and reused consistently across tasks.
- **Review focus:** Each operational failure mode has a named Task 1 or Task 2 static/dry-run test; scheduler persistence is deliberately deferred to Task 3 documentation and separate consent.
- **Proportion:** The plan fixes local availability only. LAN sharing, a database redesign, and Windows scheduled-task registration are outside this implementation.
