# Keycloak First-login Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Hub-created employee's first Keycloak sign-in require only replacement of the temporary password, while keeping identity scope attributes administrator-managed.

**Architecture:** The existing, idempotent personnel provisioning command becomes the single owner of the `aeos` realm's user-profile policy. A checked-in Keycloak User Profile document makes standard contact fields optional and administrator-only, and explicitly declares every Hub/OA-owned identity attribute as administrator-only. New personnel records explicitly carry only the password-update required action.

**Tech Stack:** Keycloak 26.8, `kcadm.sh`, Docker Compose, PowerShell, TypeScript, Node test runner.

**Spec:** User request on 2026-10-13 to converge the confusing first-login "Update account information" page.

## Global Constraints

- Do not create users, restart services, or change real Keycloak data while developing this change.
- Keep Keycloak as the authority for accounts, passwords, roles, and scope attributes.
- Employees must not see or edit tenant, organization, department, position, or OA-sync attributes.
- The provisioning command must remain idempotent and never print a secret.

## Review Focus

- An existing realm with previously required `tenant_id`/`organization_id` fields must be converged on provisioning rather than left with an employee-facing form.
- A fresh personnel account must receive exactly `UPDATE_PASSWORD`, never an implicit request to populate profile attributes.
- Admin API/OA synchronization must still be able to write every declared Hub/OA identity attribute after user-profile restrictions are applied.
- The compose container must have read-only access to the checked-in policy file.
- The protected `manager`, `operator`, and `owner` roles must exist before a Hub request can assign one.
- `-WhatIf` must truthfully describe the user-profile reconciliation without changing a real realm.

---

### Task 1: Reconcile the Keycloak User Profile through provisioning

**Files:**
- Create: `deploy/m01/aeos-user-profile.json`
- Modify: `deploy/m01/docker-compose.yml`
- Modify: `deploy/m01/configure-personnel-admin.sh`
- Test: `test/m01-local-scripts.test.mjs`

**Interfaces:**
- Consumes: Keycloak Admin REST `PUT /admin/realms/aeos/users/profile` via `kcadm.sh update users/profile`.
- Produces: a mounted, idempotently applied profile policy with `unmanagedAttributePolicy: ADMIN_EDIT`.

- [ ] Add a read-only profile policy mount to the Keycloak service.
- [ ] Configure optional, administrator-only standard account fields and explicit administrator-only Hub/OA identity attributes.
- [ ] Apply the policy after the personnel service client is reconciled.
- [ ] Reconcile the three protected pilot roles without altering existing membership.
- [ ] Test the mount, policy shape, and provisioning command reference without using Docker.

### Task 2: Keep initial sign-in password-only and document it

**Files:**
- Modify: `src/keycloak-personnel-admin.ts`
- Modify: `test/keycloak-personnel-admin.test.ts`
- Modify: `scripts/provision-m01-personnel-admin.ps1`
- Modify: `docs/auth/hub-personnel-administration.md`
- Modify: `docs/auth/m01-personnel-restart-tutorial.md`
- Modify: `docs/auth/m01-integration.md`

**Interfaces:**
- Consumes: `KeycloakPersonnelAdmin.createUser(scope, input)`.
- Produces: a Keycloak create representation with `requiredActions: ['UPDATE_PASSWORD']` and an operator-facing explanation of the resulting first-login journey.

- [ ] Add the explicit required action and assert its exact request payload.
- [ ] Update provisioning preview and completion copy to include User Profile convergence.
- [ ] Update operational documentation to state that employees change only their temporary password and all scope/OA attributes remain system-managed.
- [ ] Run the focused tests, type check, JavaScript syntax check, and diff whitespace check.
