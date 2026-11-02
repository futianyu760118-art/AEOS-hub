import { createHash, createHmac } from 'node:crypto';

export const M01_AGENT_REGISTRATION_STATES = ['not_configured', 'pending', 'active', 'rejected', 'revoked'] as const;
export type M01AgentRegistrationState = typeof M01_AGENT_REGISTRATION_STATES[number];

export interface M01AgentBridgeConfig {
  url: string;
  secret: string;
  tenantId: string;
  ownerPersonId: string;
  timeoutMs?: number;
}

export interface M01AgentBridgeConfigResult {
  configured: boolean;
  config: M01AgentBridgeConfig | null;
  reason?: string;
}

export interface M01RegistrationAgent {
  id: string;
  parentAgentId: string | null;
  skills: string[];
  m01Registration?: { effectiveScopes?: string[] };
}

export interface M01AgentRegistrationResult {
  state: M01AgentRegistrationState;
  eventId: string | null;
  agentId: string;
  requestedScopes: string[];
  effectiveScopes: string[];
  clampedScopes: string[];
  reason: string | null;
  idempotent?: boolean;
}

export function isM01AgentDispatchable(agent: { m01Registration?: { state?: string } }): boolean {
  return agent.m01Registration?.state === 'active';
}

type BridgeFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueScopes(values: unknown): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(values) ? values : []) {
    const scope = clean(value);
    if (!scope || seen.has(scope)) continue;
    seen.add(scope);
    result.push(scope);
  }
  return result;
}

function authorizationScopes(values: unknown): string[] {
  const scopes = uniqueScopes(values).filter((scope) => /^[A-Za-z][A-Za-z0-9._-]*:[A-Za-z][A-Za-z0-9._-]*$/.test(scope));
  return scopes.length ? scopes : ['task:execute'];
}

export function loadM01AgentBridgeConfig(env: NodeJS.ProcessEnv = process.env): M01AgentBridgeConfigResult {
  const url = clean(env.M01_AGENT_REGISTRATION_URL);
  const secret = clean(env.M01_AGENT_REGISTRATION_SECRET || env.M13_WEBHOOK_SECRET);
  const tenantId = clean(env.M01_AGENT_TENANT_ID || 'TENANT_A');
  const ownerPersonId = clean(env.M01_AGENT_OWNER_PERSON_ID || 'P_OWNER');
  if (!url || !secret || !tenantId || !ownerPersonId) {
    return { configured: false, config: null, reason: 'M01 Agent 注册未配置完整' };
  }
  try {
    new URL(url);
  } catch {
    return { configured: false, config: null, reason: 'M01_AGENT_REGISTRATION_URL 无效' };
  }
  return {
    configured: true,
    config: {
      url,
      secret,
      tenantId,
      ownerPersonId,
      timeoutMs: Math.max(1000, Math.min(Number(env.M01_AGENT_REGISTRATION_TIMEOUT_MS || 8000), 30_000)),
    },
  };
}

export function stableM01RegistrationEventId(tenantId: string, agentId: string, type: string): string {
  const digest = createHash('sha256').update(`${tenantId}|${type}|${agentId}`).digest('hex');
  return `hub-m01-${digest}`;
}

function resultFor(
  state: M01AgentRegistrationState,
  agentId: string,
  eventId: string | null,
  requestedScopes: string[],
  effectiveScopes: string[],
  clampedScopes: string[],
  reason: string | null,
  extra: Partial<Pick<M01AgentRegistrationResult, 'idempotent'>> = {},
): M01AgentRegistrationResult {
  return { state, eventId, agentId, requestedScopes, effectiveScopes, clampedScopes, reason, ...extra };
}

export async function registerAgentWithM01(
  agent: M01RegistrationAgent,
  config: M01AgentBridgeConfig | null,
  transport: BridgeFetch = fetch,
): Promise<M01AgentRegistrationResult> {
  const agentId = clean(agent.id);
  const requestedScopes = authorizationScopes(agent.skills);
  if (!config) {
    return resultFor('not_configured', agentId, null, requestedScopes, [], [], 'M01 Agent 注册未配置');
  }

  const eventId = stableM01RegistrationEventId(config.tenantId, agentId, 'agent.registered');
  const body = JSON.stringify({
    event_id: eventId,
    tenant_id: config.tenantId,
    type: 'agent.registered',
    agent_id: agentId,
    owner_person_id: config.ownerPersonId,
    parent_agent_id: agent.parentAgentId || null,
    scopes: requestedScopes,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 8000);
  try {
    const signature = createHmac('sha256', config.secret).update(body).digest('hex');
    const response = await transport(config.url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-m01-signature': `sha256=${signature}`,
      },
      body,
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(raw || '{}') as Record<string, unknown>;
    } catch {
      payload = {};
    }
    if (!response.ok) {
      return resultFor('rejected', agentId, eventId, requestedScopes, [], [], clean(payload.error) || `M01 返回 HTTP ${response.status}`);
    }
    const m01Agent = payload.agent && typeof payload.agent === 'object' ? payload.agent as Record<string, unknown> : {};
    const responseScopes = uniqueScopes(m01Agent.scopes);
    const effectiveScopes = responseScopes.length
      ? responseScopes
      : payload.idempotent === true
        ? uniqueScopes(agent.m01Registration?.effectiveScopes).length
          ? uniqueScopes(agent.m01Registration?.effectiveScopes)
          : requestedScopes
        : [];
    const clampedScopes = uniqueScopes(payload.clamped_scopes);
    return resultFor('active', agentId, eventId, requestedScopes, effectiveScopes, clampedScopes, null, {
      idempotent: payload.idempotent === true,
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? 'M01 Agent 注册超时，可重试' : 'M01 Agent 注册通道不可用，可重试';
    return resultFor('pending', agentId, eventId, requestedScopes, [], [], reason);
  } finally {
    clearTimeout(timeout);
  }
}
