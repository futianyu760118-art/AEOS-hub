export type ActorContext = {
  actorId: string;
  actorType: 'human' | 'service';
  tenantId: string;
  organizationId?: string;
  roles: string[];
  clientId?: string;
  authSource: 'local-dev' | 'm01';
};

type Claims = Record<string, unknown>;

function claimsRecord(claims: unknown): Claims {
  if (claims === null || typeof claims !== 'object' || Array.isArray(claims)) {
    throw new Error('M01 claims must be an object');
  }
  return claims as Claims;
}

function requiredString(value: unknown, claim: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`M01 claims must contain a non-empty ${claim}`);
  }
  return value.trim();
}

function optionalString(value: unknown, claim: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, claim);
}

function normalizedRoles(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((role) => typeof role !== 'string')) {
    throw new Error('M01 roles must be an array of strings');
  }
  return [...new Set(value.map((role) => role.trim()).filter(Boolean))];
}

export function normalizeActorContext(claims: unknown, source: 'm01'): ActorContext {
  const values = claimsRecord(claims);
  const subject = requiredString(values.sub, 'sub');
  const tenantId = requiredString(values.tenant_id, 'tenant_id');
  const organizationId = optionalString(values.organization_id, 'organization_id');
  const azp = optionalString(values.azp, 'azp');
  const clientId = azp ?? optionalString(values.client_id, 'client_id');
  const isService = clientId !== undefined
    && (values.aeos_actor_type === 'service' || subject.startsWith('service-account-'));
  const actorType = isService ? 'service' : 'human';

  return {
    actorId: actorType === 'service' ? `m01:service:${clientId}` : `m01:user:${subject}`,
    actorType,
    tenantId,
    ...(organizationId ? { organizationId } : {}),
    roles: normalizedRoles(values.roles),
    ...(clientId ? { clientId } : {}),
    authSource: source,
  };
}
