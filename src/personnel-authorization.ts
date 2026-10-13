// Pure policy for Hub personnel administration. This module performs no
// storage, network, audit, or HTTP work so PersonnelApi can uniformly audit
// either outcome at its boundary. It mirrors src/task-authorization.ts.

export const PERSONNEL_PILOT_ROLES = ['manager', 'supervisor', 'operator', 'owner'] as const;
export type PilotRole = (typeof PERSONNEL_PILOT_ROLES)[number];

export const PERSONNEL_ACTIONS = ['list', 'create', 'update', 'delete', 'set_roles', 'reset_password'] as const;
export type PersonnelAction = (typeof PERSONNEL_ACTIONS)[number];

export type PersonnelAuthorizationActor = {
  actorId: string;
  actorType: 'human' | 'service' | 'agent' | 'system';
  tenantId: string;
  organizationId?: string;
  roles: readonly string[];
};

/**
 * The G0 pilot scope as resolved from the decision register. A null value means
 * the governing decision is missing, incomplete, or scoped to a different M01
 * tenant or organization; the policy rejects every action in that state.
 */
export type PersonnelAuthorizationScope = {
  readyForG1: boolean;
  firstScenario?: string | null;
  demoTenantId?: string | null;
  organizationScope?: string | null;
};

export type PersonnelAuthorizationTarget = {
  actorId: string;
  enabled: boolean;
  roles: readonly string[];
};

export type PersonnelAuthorizationInput = {
  action: PersonnelAction;
  actor: PersonnelAuthorizationActor;
  scope: PersonnelAuthorizationScope | null;
  target?: PersonnelAuthorizationTarget | null;
  /** actorIds of the currently enabled managers inside the caller's G0 scope. */
  activeManagerActorIds?: readonly string[];
  /** Pilot roles requested for `create` and `set_roles`. */
  requestedRoles?: readonly string[];
  /** Enabled state requested for `update`. */
  nextEnabled?: boolean;
};

export type PersonnelDenialCode =
  | 'HUMAN_ACTOR_REQUIRED'
  | 'MANAGER_ROLE_REQUIRED'
  | 'G0_SCOPE_REQUIRED'
  | 'ROLES_REQUIRED'
  | 'UNKNOWN_ROLE'
  | 'SELF_DISABLE_DENIED'
  | 'SELF_DELETE_DENIED'
  | 'SELF_MANAGER_REMOVAL_DENIED'
  | 'LAST_ACTIVE_MANAGER_DENIED';

export type PersonnelAuthorizationDecision =
  | { allowed: true; code: 'ALLOWED' }
  | { allowed: false; code: PersonnelDenialCode };

function normalizedRoles(requestedRoles: readonly string[] | undefined): string[] {
  if (!requestedRoles) return [];
  return [...new Set(requestedRoles.filter((role) => typeof role === 'string' && role.trim()).map((role) => role.trim()))];
}

function isPilotRole(role: string): role is PilotRole {
  return (PERSONNEL_PILOT_ROLES as readonly string[]).includes(role);
}

function isHubRoleCode(role: string): boolean {
  return /^[a-z][a-z0-9_]{1,79}$/.test(role);
}

function scopeMatchesActor(actor: PersonnelAuthorizationActor, scope: PersonnelAuthorizationScope | null): boolean {
  if (!scope || scope.readyForG1 !== true || scope.firstScenario !== 'order_delivery_risk') return false;
  if (typeof scope.demoTenantId !== 'string' || !scope.demoTenantId) return false;
  if (typeof scope.organizationScope !== 'string' || !scope.organizationScope) return false;
  if (typeof actor.organizationId !== 'string' || !actor.organizationId) return false;
  return actor.tenantId === scope.demoTenantId && actor.organizationId === scope.organizationScope;
}

/** The target is the only currently active manager in the caller's scope. */
function isLastActiveManager(target: PersonnelAuthorizationTarget, activeManagerActorIds: readonly string[]): boolean {
  if (!target.enabled || !target.roles.includes('manager')) return false;
  if (!activeManagerActorIds.includes(target.actorId)) return false;
  return activeManagerActorIds.filter((actorId) => actorId !== target.actorId).length === 0;
}

export function authorizePersonnelAction(input: PersonnelAuthorizationInput): PersonnelAuthorizationDecision {
  const { action, actor, scope, target } = input;
  if (actor.actorType !== 'human') return { allowed: false, code: 'HUMAN_ACTOR_REQUIRED' };
  if (!actor.roles.includes('manager')) return { allowed: false, code: 'MANAGER_ROLE_REQUIRED' };
  if (!scopeMatchesActor(actor, scope)) return { allowed: false, code: 'G0_SCOPE_REQUIRED' };

  if (action === 'create' || action === 'set_roles') {
    const roles = normalizedRoles(input.requestedRoles);
    if (!roles.length) return { allowed: false, code: 'ROLES_REQUIRED' };
    if (action === 'create' ? !roles.every(isPilotRole) : !roles.every(isHubRoleCode)) return { allowed: false, code: 'UNKNOWN_ROLE' };
    if (action === 'set_roles' && target) {
      if (target.actorId === actor.actorId && target.roles.includes('manager') && !roles.includes('manager')) {
        return { allowed: false, code: 'SELF_MANAGER_REMOVAL_DENIED' };
      }
      if (!roles.includes('manager') && isLastActiveManager(target, input.activeManagerActorIds ?? [])) {
        return { allowed: false, code: 'LAST_ACTIVE_MANAGER_DENIED' };
      }
    }
  }

  if (action === 'update' && target && input.nextEnabled === false) {
    if (target.actorId === actor.actorId) return { allowed: false, code: 'SELF_DISABLE_DENIED' };
    if (isLastActiveManager(target, input.activeManagerActorIds ?? [])) {
      return { allowed: false, code: 'LAST_ACTIVE_MANAGER_DENIED' };
    }
  }

  if (action === 'delete' && target) {
    if (target.actorId === actor.actorId) return { allowed: false, code: 'SELF_DELETE_DENIED' };
    if (isLastActiveManager(target, input.activeManagerActorIds ?? [])) {
      return { allowed: false, code: 'LAST_ACTIVE_MANAGER_DENIED' };
    }
  }

  return { allowed: true, code: 'ALLOWED' };
}

/**
 * First-time onboarding gate. Before G0 is ready there is no registered scope,
 * so a trusted human manager may create G0-needed accounts only inside their
 * own authenticated session scope (never a browser-supplied scope). This is a
 * deliberately narrower admission than normal personnel administration and is
 * only used by the onboarding routes.
 */
export function authorizePersonnelOnboarding(actor: PersonnelAuthorizationActor): PersonnelAuthorizationDecision {
  if (actor.actorType !== 'human') return { allowed: false, code: 'HUMAN_ACTOR_REQUIRED' };
  if (!actor.roles.includes('manager')) return { allowed: false, code: 'MANAGER_ROLE_REQUIRED' };
  if (typeof actor.organizationId !== 'string' || !actor.organizationId) return { allowed: false, code: 'G0_SCOPE_REQUIRED' };
  return { allowed: true, code: 'ALLOWED' };
}
