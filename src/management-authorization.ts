export const HUB_MANAGEMENT_ROLES = ['manager', 'supervisor'] as const;

export function canManageHub(roles: readonly string[] | undefined): boolean {
  return (roles ?? []).some((role) => (HUB_MANAGEMENT_ROLES as readonly string[]).includes(role));
}

export function isHarborManagementRoute(pathname: string): boolean {
  return pathname === '/api/harbor' || pathname.startsWith('/api/harbor/');
}

export function isAgentSquadManagementRoute(pathname: string): boolean {
  return pathname === '/api/agent-squad' || pathname.startsWith('/api/agent-squad/');
}

export function isExecutionManagementRoute(pathname: string): boolean {
  return /^\/api\/execution\/agents\/[^/]+\/(?:dispatch|recall)$/.test(pathname);
}

/** Non-managers may only read Evidence attributed to their own actor identity. */
export function evidenceActorScope(roles: readonly string[] | undefined, actorId: string | null, requestedActorId?: string): { ok: true; actorId: string | null } | { ok: false } {
  if (canManageHub(roles)) return { ok: true, actorId: requestedActorId ?? null };
  if (requestedActorId && requestedActorId !== actorId) return { ok: false };
  return { ok: true, actorId: actorId ?? null };
}
