/* Read-only presentation policy for M05 Agent task-candidate decisions. */
'use strict';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function text(value, fallback = '未提供') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function candidateState(raw, forceBlocked) {
  const candidate = raw && typeof raw.candidate === 'object' && raw.candidate ? raw.candidate : {};
  const reasons = Array.isArray(raw?.reasons) ? raw.reasons.filter((item) => typeof item === 'string' && item.trim()) : [];
  const eligible = raw?.eligible === true && !forceBlocked;
  return {
    agentId: text(candidate.agentId, 'unknown-agent'),
    name: text(candidate.name),
    role: text(candidate.role),
    lifecycle: text(candidate.lifecycle),
    status: text(candidate.status),
    runtime: candidate.runtime && typeof candidate.runtime === 'object' ? candidate.runtime : null,
    eligible,
    reasons: forceBlocked ? ['候选接口状态异常，已按不可派发处理。', ...reasons] : reasons,
  };
}

/**
 * The browser treats the server result as advisory only. No representation from
 * this module can enable dispatch, execution, or business-result verification.
 */
export function agentCandidateDisplayState(payload) {
  const responseIsReadOnly = payload?.dispatchEnabled === false;
  const rawCandidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const candidates = rawCandidates.map((item) => candidateState(item, !responseIsReadOnly));
  return {
    canDispatch: false,
    responseIsReadOnly,
    eligible: candidates.filter((candidate) => candidate.eligible),
    blocked: candidates.filter((candidate) => !candidate.eligible),
  };
}

function candidateLine(candidate) {
  const runtime = candidate.runtime;
  const health = runtime?.lastVerification?.status === 'healthy'
    ? `健康已验证 · ${text(runtime.lastVerification.checkedAt)}`
    : runtime ? `Runtime ${text(runtime.status)}` : '未绑定 Runtime';
  return `<article class="task-agent-candidate ${candidate.eligible ? 'is-eligible' : 'is-blocked'}">
    <div><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(candidate.role)} · 生命周期：${escapeHtml(candidate.lifecycle)} · 状态：${escapeHtml(candidate.status)}</small></div>
    <p>${escapeHtml(health)}</p>
    ${candidate.eligible
      ? '<em>可作为后续人工派单候选；本阶段不会自动派发或执行。</em>'
      : `<ul>${candidate.reasons.length ? candidate.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('') : '<li>当前不满足接手条件。</li>'}</ul>`}
  </article>`;
}

export function renderAgentCandidatePanel(payload) {
  const state = agentCandidateDisplayState(payload);
  const interfaceWarning = state.responseIsReadOnly ? '' : '<p class="task-agent-warning">候选接口状态异常，已按不可派发处理。</p>';
  const eligible = state.eligible.length
    ? `<div class="task-agent-candidate-group"><h4>符合条件的候选</h4>${state.eligible.map(candidateLine).join('')}</div>`
    : '';
  const blocked = state.blocked.length
    ? `<div class="task-agent-candidate-group"><h4>暂不符合条件</h4>${state.blocked.map(candidateLine).join('')}</div>`
    : '';
  return `<section class="task-agent-eligibility" aria-live="polite">
    <div class="task-agent-eligibility-head"><i data-lucide="shield-check"></i><div><strong>Agent 接手条件</strong><small>仅展示治理资格；当前任务仍由责任角色负责。</small></div></div>
    ${interfaceWarning}
    ${[eligible, blocked].filter(Boolean).join('') || '<p class="task-agent-empty">当前租户没有登记的 Agent 候选。</p>'}
  </section>`;
}
