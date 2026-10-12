import type { EvidenceInput } from './evidence.ts';
import {
  G0DecisionRecordInputSchema,
  type G0DecisionRegisterStore,
  type G0DecisionSnapshot,
} from './g0-decision-register.ts';

export type G0DecisionApiActor = {
  actorId: string;
  actorType: 'human' | 'service' | 'agent' | 'system';
  tenantId: string;
  organizationId?: string;
  roles: readonly string[];
};

export type G0DecisionApiResponse = { status: number; body: Record<string, unknown> };
export type G0DecisionApiRequest = {
  method: string | undefined;
  pathname: string;
  actor: G0DecisionApiActor | null;
  body?: Record<string, unknown>;
  /** Set only by the server when this route's JSON body could not be parsed. */
  bodyParseFailed?: boolean;
};

type G0DecisionApiDependencies = {
  store: Pick<G0DecisionRegisterStore, 'load' | 'record'>;
  appendEvidence: (input: EvidenceInput) => unknown;
};

const G0_DECISION_PATH = '/api/governance/g0-decisions';
const G0_DECISION_OBJECT_REF = 'hub://governance/g0-decisions';

/**
 * HTTP-neutral boundary for G0 governance decisions. Identity is deliberately
 * supplied only by the server's authenticated session; browser body identity
 * fields are never parsed or copied into the register or audit log.
 */
export class G0DecisionApi {
  private readonly dependencies: G0DecisionApiDependencies;

  constructor(dependencies: G0DecisionApiDependencies) {
    this.dependencies = dependencies;
  }

  handle(request: G0DecisionApiRequest): G0DecisionApiResponse | null {
    if (request.pathname !== G0_DECISION_PATH) return null;
    if (request.method === 'GET') {
      if (!request.actor) return { status: 401, body: { error: 'authentication required' } };
      const snapshot = this.dependencies.store.load();
      if (!this.isWithinRecordedTenant(request.actor, snapshot)) {
        return this.denialResponse(403, 'governance scope denied', this.auditDenied(request.actor, 'tenant_scope_mismatch', 'g0_decision_access_denied'));
      }
      return this.snapshotResponse(snapshot);
    }
    if (request.method !== 'PUT') return { status: 405, body: { error: 'method not allowed' } };
    if (!request.actor) {
      return this.denialResponse(401, 'authentication required', this.auditDenied(null, 'authentication_required'));
    }
    if (request.actor.actorType !== 'human' || !request.actor.roles.includes('manager')) {
      return this.denialResponse(403, 'manager role required', this.auditDenied(request.actor, 'manager_role_required'));
    }

    try {
      const current = this.dependencies.store.load();
      if (!this.isWithinRecordedTenant(request.actor, current)) {
        return this.denialResponse(403, 'governance scope denied', this.auditDenied(request.actor, 'tenant_scope_mismatch'));
      }
      if (request.bodyParseFailed) {
        return this.denialResponse(400, 'invalid governance request', this.auditDenied(request.actor, 'invalid_request'));
      }
      const body = request.body ?? {};
      // Rebuild the input from a short allowlist. This intentionally ignores
      // actorId, tenantId, roles, and every other browser-provided top-level key.
      const input = G0DecisionRecordInputSchema.parse({
        actor: { actorId: request.actor.actorId, tenantId: request.actor.tenantId },
        patch: body.patch,
        note: body.note,
      });
      if ((!current.decisions.scope && !input.patch.scope)
        || (input.patch.scope && (input.patch.scope.demoTenantId !== request.actor.tenantId
          || input.patch.scope.organizationScope !== (request.actor.organizationId ?? '')))) {
        return this.denialResponse(403, 'governance scope denied', this.auditDenied(request.actor, 'tenant_scope_mismatch'));
      }
      const snapshot = this.dependencies.store.record(input);
      try {
        this.auditAccepted(request.actor, snapshot, Object.keys(input.patch));
        return this.snapshotResponse(snapshot);
      } catch {
        // The governance choice is already atomically persisted. Do not
        // misclassify it as a rejected request, and do not claim its Evidence
        // event was recorded when the configured sink failed.
        return this.snapshotResponse(snapshot, 'failed');
      }
    } catch (error) {
      return this.denialResponse(400, 'invalid governance request', this.auditDenied(request.actor, 'invalid_request'));
    }
  }

  private snapshotResponse(snapshot: G0DecisionSnapshot, auditStatus: 'recorded' | 'failed' = 'recorded'): G0DecisionApiResponse {
    return {
      status: 200,
      body: {
        snapshot,
        readyForG1: snapshot.readyForG1,
        committed: true,
        auditStatus,
        ...(auditStatus === 'failed' ? { warning: 'decision recorded but audit event was not appended' } : {}),
      },
    };
  }

  private denialResponse(status: 400 | 401 | 403, error: string, auditStatus: 'recorded' | 'failed'): G0DecisionApiResponse {
    return {
      status,
      body: { error, ...(auditStatus === 'failed' ? { auditStatus: 'failed' } : {}) },
    };
  }

  private isWithinRecordedTenant(actor: G0DecisionApiActor, snapshot: G0DecisionSnapshot): boolean {
    const recordedTenantId = snapshot.decisions.scope?.value.demoTenantId;
    return !recordedTenantId || recordedTenantId === actor.tenantId;
  }

  private auditAccepted(actor: G0DecisionApiActor, snapshot: G0DecisionSnapshot, decisionFields: string[]): void {
    this.dependencies.appendEvidence({
      kind: 'app_event',
      actor_id: actor.actorId,
      actor_type: actor.actorType,
      tenant_id: actor.tenantId,
      object_ref: G0_DECISION_OBJECT_REF,
      correlation_id: `g0-decision-revision-${snapshot.revision}`,
      summary: 'g0 decision recorded',
      payload: {
        action: 'g0_decision_recorded',
        revision: snapshot.revision,
        readyForG1: snapshot.readyForG1,
        decisionFields,
      },
    });
  }

  private auditDenied(
    actor: G0DecisionApiActor | null,
    reason: 'authentication_required' | 'manager_role_required' | 'tenant_scope_mismatch' | 'invalid_request',
    action: 'g0_decision_change_denied' | 'g0_decision_access_denied' = 'g0_decision_change_denied',
  ): 'recorded' | 'failed' {
    try {
      this.dependencies.appendEvidence({
        kind: 'app_event',
        ...(actor ? { actor_id: actor.actorId, actor_type: actor.actorType, tenant_id: actor.tenantId } : {}),
        object_ref: G0_DECISION_OBJECT_REF,
        correlation_id: 'g0-decision-change-denied',
        summary: 'g0 decision change denied',
        payload: { action, reason },
      });
      return 'recorded';
    } catch {
      return 'failed';
    }
  }
}
