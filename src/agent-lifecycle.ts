import type { HarborAgent, HarborRuntime } from './harbor-store.ts';

export const LIFECYCLE_TRANSITIONS = {
  draft: ['testing'],
  testing: ['active'],
  active: ['suspended', 'retired'],
  suspended: ['active', 'retired'],
  retired: [],
} as const;

export type AgentLifecycle = keyof typeof LIFECYCLE_TRANSITIONS;

export type LifecycleTransitionDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

export type ActivationGateDecision =
  | { allowed: true }
  | { allowed: false; reasons: string[] };

export function validateLifecycleTransition(from: string, to: string): LifecycleTransitionDecision {
  const targets = (LIFECYCLE_TRANSITIONS as Record<string, readonly string[] | undefined>)[from];
  if (!targets || !targets.includes(to)) return { allowed: false, reason: `不允许从 ${from} 流转到 ${to}` };
  return { allowed: true };
}

/**
 * Release gate before an Agent may become `active`. It only checks the persisted
 * registration and runtime health; it never probes a Runtime or calls a model.
 */
export function validateActivationGate(agent: HarborAgent, runtime: HarborRuntime | null): ActivationGateDecision {
  const reasons: string[] = [];
  const profile = agent.registration.taskServiceProfile;
  if (!profile.businessOwner || profile.businessOwner === 'unassigned') reasons.push('缺少业务 Owner');
  if (!profile.technicalOwner || profile.technicalOwner === 'unassigned') reasons.push('缺少技术 Owner');
  if (!profile.tenantIds.length) reasons.push('未声明租户范围');
  if (!profile.supportedTaskTypes.length) reasons.push('未声明任务类型');
  if (!profile.inputSchemaVersion || profile.inputSchemaVersion === '0.0.0') reasons.push('输入 Schema 版本未配置');
  if (!profile.outputSchemaVersion || profile.outputSchemaVersion === '0.0.0') reasons.push('输出 Schema 版本未配置');
  if (profile.accessMode !== 'read_only') reasons.push('必须为只读');
  if (!agent.runtimeId) reasons.push('未绑定 Runtime');
  else if (!runtime || runtime.id !== agent.runtimeId) reasons.push('绑定的 Runtime 不存在');
  else if (!runtime.lastVerification || runtime.lastVerification.status !== 'healthy') reasons.push('Runtime 健康验证未通过');

  return reasons.length === 0 ? { allowed: true } : { allowed: false, reasons };
}
