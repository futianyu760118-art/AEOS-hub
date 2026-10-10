import assert from 'node:assert/strict';
import test from 'node:test';
import { agentCandidateDisplayState, renderAgentCandidatePanel } from '../public/task-agent-eligibility.js';

test('labels eligible Agents as recommendation-only candidates and lists blocked reasons', () => {
  const payload = {
    dispatchEnabled: false,
    candidates: [
      {
        eligible: true,
        reasonCodes: [],
        reasons: [],
        candidate: { agentId: 'agent-ready', name: '订单分析 Agent', role: '订单风险分析', lifecycle: 'active', status: 'idle', profile: { supportedTaskTypes: ['operating-case-analysis'] }, runtime: { name: '本机 Runtime', status: 'online', lastVerification: { status: 'healthy', checkedAt: '2026-10-10T01:00:00.000Z' } } },
      },
      {
        eligible: false,
        reasonCodes: ['RUNTIME_HEALTH_UNVERIFIED'],
        reasons: ['Runtime 尚未完成健康验证。'],
        candidate: { agentId: 'agent-blocked', name: '质量分析 Agent', role: '质量异常分析', lifecycle: 'active', status: 'idle', profile: { supportedTaskTypes: ['operating-case-analysis'] }, runtime: { name: '质量 Runtime', status: 'online', lastVerification: null } },
      },
    ],
  };

  const state = agentCandidateDisplayState(payload);
  const html = renderAgentCandidatePanel(payload);

  assert.equal(state.canDispatch, false);
  assert.equal(state.eligible.length, 1);
  assert.equal(state.blocked.length, 1);
  assert.match(html, /可作为后续人工派单候选；本阶段不会自动派发或执行。/);
  assert.match(html, /Runtime 尚未完成健康验证。/);
  assert.doesNotMatch(html, /<button|data-task-action|业务核验/);
});

test('fails closed in the display when no candidate is eligible or dispatch is incorrectly enabled', () => {
  const payload = {
    dispatchEnabled: true,
    candidates: [{
      eligible: true, reasonCodes: [], reasons: [],
      candidate: { agentId: 'agent-unsafe', name: '<unsafe>', role: '测试', lifecycle: 'active', status: 'idle', profile: { supportedTaskTypes: [] }, runtime: null },
    }],
  };

  const state = agentCandidateDisplayState(payload);
  const html = renderAgentCandidatePanel(payload);

  assert.equal(state.canDispatch, false);
  assert.equal(state.eligible.length, 0);
  assert.match(html, /候选接口状态异常，已按不可派发处理。/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /<unsafe>/);
});
