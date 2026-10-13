// Browser-only projection of the personnel-administration policy. This improves
// the System Configuration experience but never replaces the server-side
// authorization boundary. It mirrors src/personnel-authorization.ts.

export const PERSONNEL_PILOT_ROLES = ['manager', 'operator', 'owner'];

export const PERSONNEL_ROLE_LABELS = {
  manager: '管理者',
  operator: '操作员',
  owner: 'Owner',
};

function isHumanSession(session) {
  return session?.actorType === 'human' && typeof session?.actorId === 'string' && session.actorId.trim().length > 0;
}

function hasRole(session, role) {
  return Array.isArray(session?.roles) && session.roles.includes(role);
}

/**
 * G0 establishes the only browser-visible scope for personnel mutations. The
 * server remains authoritative; this gate only hides controls that are known
 * to fail when the governing decision is unavailable, incomplete, or scoped to
 * a different M01 tenant or organization.
 */
export function personnelUiGate(session, snapshot) {
  if (!isHumanSession(session)) return { allowed: false, code: 'HUMAN_ACTOR_REQUIRED' };
  if (!hasRole(session, 'manager')) return { allowed: false, code: 'MANAGER_ROLE_REQUIRED' };
  if (!snapshot || typeof snapshot !== 'object') return { allowed: false, code: 'G0_DECISION_UNAVAILABLE' };
  if (snapshot.readyForG1 !== true) return { allowed: false, code: 'G0_NOT_READY' };
  if (snapshot.decisions?.firstScenario?.value !== 'order_delivery_risk') return { allowed: false, code: 'G0_SCENARIO_MISMATCH' };
  const scope = snapshot.decisions?.scope?.value;
  if (!scope || scope.demoTenantId !== session.tenantId || scope.organizationScope !== session.organizationId) {
    return { allowed: false, code: 'G0_SCOPE_MISMATCH' };
  }
  return { allowed: true, code: 'ALLOWED' };
}

export function personnelConfigEntryVisible(session, snapshot) {
  return personnelUiGate(session, snapshot).allowed;
}

/**
 * First-time onboarding is the inverse gate: a human manager may open it only
 * while the full personnel console is not yet available (G0 not ready or scope
 * not matching). The server remains authoritative for what onboarding can do.
 */
export function onboardingConfigEntryVisible(session, snapshot) {
  return isHumanSession(session) && hasRole(session, 'manager') && !personnelUiGate(session, snapshot).allowed;
}

export function personnelRolesAllowed(roles) {
  if (!Array.isArray(roles)) return false;
  const unique = [...new Set(roles.filter((role) => typeof role === 'string').map((role) => role.trim()))];
  return unique.length > 0 && unique.every((role) => PERSONNEL_PILOT_ROLES.includes(role));
}

/** Keeps browser identity and scope claims out of personnel requests. */
export function buildPersonnelCreateRequest(fields) {
  const username = String(fields?.username ?? '').trim();
  const temporaryPassword = String(fields?.temporaryPassword ?? '');
  const email = String(fields?.email ?? '').trim();
  const firstName = String(fields?.firstName ?? '').trim();
  const lastName = String(fields?.lastName ?? '').trim();
  const roles = Array.isArray(fields?.roles) ? fields.roles : [];
  if (!username) throw new Error('请填写用户名。');
  if (!temporaryPassword) throw new Error('请填写临时密码。');
  if (!personnelRolesAllowed(roles)) throw new Error('只能分配 manager、operator、owner 三种角色。');
  return {
    username,
    temporaryPassword,
    roles,
    ...(email ? { email } : {}),
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
  };
}

export function buildPersonnelRolesRequest(fields) {
  const roles = Array.isArray(fields?.roles) ? [...new Set(fields.roles.map((role) => String(role).trim()).filter(Boolean))] : [];
  if (!roles.length || roles.some((role) => !/^[a-z][a-z0-9_]{1,79}$/.test(role))) throw new Error('请选择至少一个有效角色。');
  return { roles };
}

export function buildPersonnelResetRequest(fields) {
  const temporaryPassword = String(fields?.temporaryPassword ?? '');
  if (!temporaryPassword) throw new Error('请填写临时密码。');
  return { temporaryPassword };
}

export function personnelFailureReason(data, status) {
  const reason = typeof data?.error === 'string' ? data.error.trim() : '';
  return reason || `HTTP ${status}`;
}

export function personnelSaveFeedback(auditStatus) {
  return auditStatus === 'failed'
    ? { status: '操作已提交，但 Evidence 留痕未确认；请联系管理员核查。', toast: '人员操作已提交，Evidence 留痕待核查', isError: true }
    : { status: '操作已提交并记录服务端审计。', toast: '人员操作已保存', isError: false };
}
