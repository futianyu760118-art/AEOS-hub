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

const ROLE_IDENTIFIER_RE = /^[A-Za-z0-9._:@/-]{1,128}$/;
const MAX_M01_ALLOWED_ROLES = 64;
const MAX_M01_ALLOWED_ROLES_LENGTH = 4_096;
const LOCAL_DEVELOPMENT_ENVIRONMENTS = new Set(['development', 'test', 'local']);

/**
 * Both the current NODE_ENV and legacy AEOS_ENV participate in deployment
 * hardening. Missing variables are local only when every provided value is an
 * explicit local-development value; blank, unknown, or strict values fail closed.
 */
export function isLocalDevelopmentEnvironment(environment: NodeJS.ProcessEnv = process.env): boolean {
  return [environment.NODE_ENV, environment.AEOS_ENV]
    .every((deploymentEnvironment) => deploymentEnvironment === undefined || LOCAL_DEVELOPMENT_ENVIRONMENTS.has(deploymentEnvironment));
}

/** Parses the explicit admission roles required before an M01 identity receives a Hub session. */
export function m01AllowedRolesFromEnvironment(environment: NodeJS.ProcessEnv = process.env): string[] {
  const rawRoles = environment.AEOS_M01_ALLOWED_ROLES;
  if (typeof rawRoles !== 'string' || !rawRoles.trim() || rawRoles.length > MAX_M01_ALLOWED_ROLES_LENGTH) {
    throw new Error('AEOS_M01_ALLOWED_ROLES must be a non-empty comma-separated list of safe role identifiers');
  }
  const roles = rawRoles.split(',').map((role) => role.trim());
  if (roles.length > MAX_M01_ALLOWED_ROLES || roles.some((role) => !ROLE_IDENTIFIER_RE.test(role))) {
    throw new Error('AEOS_M01_ALLOWED_ROLES must be a non-empty comma-separated list of safe role identifiers');
  }
  const uniqueRoles = [...new Set(roles)];
  if (!uniqueRoles.length) throw new Error('AEOS_M01_ALLOWED_ROLES must be a non-empty comma-separated list of safe role identifiers');
  return uniqueRoles;
}

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

function normalizedRoles(value: unknown, tenantId: string, organizationId?: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((role) => typeof role !== 'string')) {
    throw new Error('M01 roles must be an array of strings');
  }
  const prefix = organizationId ? `hub__${Buffer.from(tenantId, 'utf8').toString('base64url')}__${Buffer.from(organizationId, 'utf8').toString('base64url')}__` : '';
  return [...new Set(value.map((role) => {
    const normalized = role.trim();
    if (!normalized.startsWith('hub__')) return normalized;
    if (!prefix || !normalized.startsWith(prefix)) return '';
    const scopedCode = normalized.slice(prefix.length);
    return /^[a-z][a-z0-9_]{1,79}$/.test(scopedCode) ? scopedCode : normalized;
  }).filter(Boolean))];
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
    roles: normalizedRoles(values.roles, tenantId, organizationId),
    ...(clientId ? { clientId } : {}),
    authSource: source,
  };
}
