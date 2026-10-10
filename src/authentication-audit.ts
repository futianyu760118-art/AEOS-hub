import type { ActorContext } from './auth/actor-context.ts';
import { appendEvidence, type EvidenceEntry, type EvidenceInput } from './evidence.ts';

/** Terminal M01 browser-authentication outcomes safe to persist as audit Evidence. */
export type AuthenticationAuditEvent =
  | { type: 'login_succeeded'; authMode: 'm01'; actor: ActorContext }
  | { type: 'authentication_failed'; authMode: 'm01' }
  | { type: 'admission_denied'; authMode: 'm01'; actor: ActorContext };

export type AuthenticationEvidenceAppender = (input: EvidenceInput) => EvidenceEntry;

function safeActor(actor: ActorContext): { actorId: string; actorType: ActorContext['actorType']; tenantId: string; roles: string[] } {
  return { actorId: actor.actorId, actorType: actor.actorType, tenantId: actor.tenantId, roles: [...actor.roles] };
}

function outcomeSummary(event: AuthenticationAuditEvent): string {
  if (event.type === 'login_succeeded') return 'M01 login succeeded';
  if (event.type === 'admission_denied') return 'M01 role admission denied';
  return 'M01 authentication failed';
}

/**
 * Maps an M01 terminal outcome to the pilot Evidence contract. It intentionally
 * never accepts raw OIDC data, cookies, sessions, credentials, or errors.
 */
export function appendAuthenticationAuditEvidence(
  event: AuthenticationAuditEvent,
  append: AuthenticationEvidenceAppender = appendEvidence,
): EvidenceEntry {
  const actor = event.type === 'authentication_failed' ? undefined : safeActor(event.actor);
  return append({
    kind: 'authentication_audit',
    summary: outcomeSummary(event),
    ...(actor ? {
      tenant_id: actor.tenantId,
      object_ref: `hub://identity/m01/${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.actorId)}`,
      actor_id: actor.actorId,
      actor_type: actor.actorType,
    } : { object_ref: 'hub://identity/m01' }),
    payload: { outcome: event.type, authMode: event.authMode, ...(actor ? { actor } : {}) },
  });
}
