import { questionDateKey, selectDailyQuestions } from './daily-questions.js';

/* AEOS 中枢系统前端：服务端认证壳 + 管理者工作区 + WebSocket 中枢能力。 */
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STORAGE = {
  profile: 'aeos-hub-profile-v1',
  onboarding: 'aeos-hub-onboarding-v1',
  dailyQuestionRotation: 'aeos-hub-daily-question-rotation-v1',
};

const els = {
  loginStage: $('#login-stage'), loginForm: $('#login-form'), loginAccount: $('#login-account'),
  loginPassword: $('#login-password'), loginError: $('#login-error'), loginSubmit: $('#login-submit'),
  togglePassword: $('#toggle-password'), loginTransition: $('#login-transition'),
  welcomeStage: $('#welcome-stage'), welcomeStep: $('#welcome-step'), welcomeBack: $('#welcome-back'),
  welcomeExit: $('#welcome-exit'), app: $('#app'), workspaceContent: $('#workspace-content'),
  breadcrumb: $('#breadcrumb-current'), userMenu: $('#user-menu'), logout: $('#logout'),
  sidebarUser: $('#sidebar-user'), sidebarAvatar: $('#sidebar-avatar'), sidebarUserName: $('#sidebar-user-name'),
  sidebarUserRole: $('#sidebar-user-role'), headerAvatar: $('#header-avatar'), menuUserName: $('#menu-user-name'),
  menuUserRole: $('#menu-user-role'), commandTrigger: $('#command-trigger'), commandPalette: $('#command-palette'),
  commandInput: $('#command-input'), commandResults: $('#command-results'), headerAgent: $('#header-agent'),
  headerAttention: $('#header-attention'), headerAttentionDot: $('#header-attention-dot'),
  navAttentionCount: $('#nav-attention-count'), btnAttentionRefresh: $('#btn-attention-refresh'),
  attentionL4Count: $('#attention-l4-count'), attentionL3Count: $('#attention-l3-count'),
  attentionL2Count: $('#attention-l2-count'), attentionDataStatus: $('#attention-data-status'),
  attentionTable: $('#attention-table'), attentionSearch: $('#attention-search'), attentionLiveCheck: $('#attention-live-check'), attentionSearchStatus: $('#attention-search-status'), attentionSearchResults: $('#attention-search-results'), attentionSearchCaption: $('#attention-search-caption'), attentionResultAttention: $('#attention-result-attention'), attentionResultLive: $('#attention-result-live'), attentionResultHistory: $('#attention-result-history'), attentionSourceFilter: $('#attention-source-filter'),
  attentionStateFilter: $('#attention-state-filter'), attentionLevelFilter: $('#attention-level-filter'), attentionFilterCount: $('#attention-filter-count'),
  navInboxCount: $('#nav-inbox-count'), caseOpenCount: $('#case-open-count'), caseReviewCount: $('#case-review-count'),
  caseApprovalCount: $('#case-approval-count'), caseInboxCount: $('#case-inbox-count'), caseList: $('#case-list'),
  btnCasesRefresh: $('#btn-cases-refresh'), inboxList: $('#inbox-list'),
  inboxUnreadCount: $('#inbox-unread-count'), btnInboxRefresh: $('#btn-inbox-refresh'), btnInboxReadAll: $('#btn-inbox-read-all'), inboxSearch: $('#inbox-search'), inboxFilter: $('#inbox-filter'),
  inboxUnreadMetric: $('#inbox-unread-metric'), inboxDecisionMetric: $('#inbox-decision-metric'), inboxTodayMetric: $('#inbox-today-metric'),
  inboxDetailModal: $('#inbox-detail-modal'), inboxDetailTitle: $('#inbox-detail-title'), inboxDetailMeta: $('#inbox-detail-meta'), inboxDetailBody: $('#inbox-detail-body'), inboxDetailStatus: $('#inbox-detail-status'), inboxDetailClose: $('#inbox-detail-close'), inboxDetailCancel: $('#inbox-detail-cancel'), inboxDetailRead: $('#inbox-detail-read'),

  dailyQuestionTitle: $('#daily-question-title'), dailyQuestionCaption: $('#daily-question-caption'),
  dailyQuestionList: $('#daily-question-list'), dailyQuestionShuffle: $('#daily-question-shuffle'),
  dailyQuestionConfigure: $('#daily-question-configure'), dailyQuestionModal: $('#daily-question-modal'),
  dailyQuestionModalClose: $('#daily-question-modal-close'), dailyQuestionForm: $('#daily-question-form'),
  dailyQuestionCount: $('#daily-question-count'), dailyQuestionAdd: $('#daily-question-add'),
  dailyQuestionEditor: $('#daily-question-editor'), dailyQuestionFormStatus: $('#daily-question-form-status'),
  dailyQuestionFormReload: $('#daily-question-form-reload'), dailyQuestionFormCancel: $('#daily-question-form-cancel'),
  dailyQuestionFormSave: $('#daily-question-form-save'),

  convList: $('#conv-list'), convSearch: $('#conv-search'), messages: $('#messages'), empty: $('#empty-state'), turnbar: $('#turnbar'),
  turnStatus: $('#turn-status'), btnStop: $('#btn-stop'), input: $('#input'), btnSend: $('#btn-send'),
  btnNew: $('#btn-new'), modelSelect: $('#model-select'), chatViewTitle: $('#chat-view-title'), chatViewDesc: $('#chat-view-desc'),
  conversationScopeLabel: $('#conversation-scope-label'), chatScopeBack: $('#chat-scope-back'),
  parallelTaskPanel: $('#parallel-task-panel'), parallelTaskCount: $('#parallel-task-count'), parallelTaskList: $('#parallel-task-list'),

  guardBar: $('#guard-bar'), guardTitle: $('#guard-title'), guardDesc: $('#guard-desc'),
  guardAllow: $('#guard-allow'), guardDeny: $('#guard-deny'), guardPending: $('#guard-pending-count'),
  capabilityPromptChips: $('#capability-prompt-chips'),

  cfgProvider: $('#cfg-provider'), cfgModel: $('#cfg-model'), cfgProviderHint: $('#cfg-provider-hint'),
  providers: $('#providers'), btnAddProvider: $('#btn-add-provider'), btnSaveConfig: $('#btn-save-config'),
  cfgStatus: $('#cfg-status'), infoHome: $('#info-home'), infoConfig: $('#info-config'),
  infoMcp: $('#info-mcp'), infoKeys: $('#info-keys'),

  evList: $('#evidence-list'), evRefresh: $('#btn-evidence-refresh'), evidenceTotal: $('#evidence-total'),
  evidenceToday: $('#evidence-today'), evidencePath: $('#evidence-path'), metricEvidence: $('#metric-evidence'), evidenceSearch: $('#evidence-search'), evidenceSourceFilter: $('#evidence-source-filter'), evidenceFilterCount: $('#evidence-filter-count'),
  metricConversations: $('#metric-conversations'), toasts: $('#toasts'),

  dashboardDataCaption: $('#dashboard-data-caption'), metricCapabilities: $('#metric-capabilities'),
  metricCapabilitiesCaption: $('#metric-capabilities-caption'), metricHighRisks: $('#metric-high-risks'),
  metricHighRisksCaption: $('#metric-high-risks-caption'), metricAttention: $('#metric-attention'),
  metricAttentionCaption: $('#metric-attention-caption'), dashboardRiskCaption: $('#dashboard-risk-caption'),
  dashboardFutureCaption: $('#dashboard-future-caption'), dashboardFutureTable: $('#dashboard-future-table'), dashboardOrderMetrics: $('#dashboard-order-metrics'), dashboardRiskTable: $('#dashboard-risk-table'), dashboardKittingCaption: $('#dashboard-kitting-caption'),
  dashboardKittingMetrics: $('#dashboard-kitting-metrics'), dashboardKittingTable: $('#dashboard-kitting-table'), dashboardDecisionList: $('#dashboard-decision-list'),
  dashboardQualityCaption: $('#dashboard-quality-caption'), dashboardQualityMetrics: $('#dashboard-quality-metrics'),
  dashboardQualityTable: $('#dashboard-quality-table'),
  dashboardProductionCaption: $('#dashboard-production-caption'), dashboardProductionMetrics: $('#dashboard-production-metrics'),
  dashboardProductionTable: $('#dashboard-production-table'),
  dashboardPulseList: $('#dashboard-pulse-list'), dashboardDataQuality: $('#dashboard-data-quality'),
  dashboardRiskModal: $('#dashboard-risk-modal'), dashboardRiskModalTitle: $('#dashboard-risk-modal-title'),
  dashboardRiskModalDesc: $('#dashboard-risk-modal-desc'), dashboardRiskModalBody: $('#dashboard-risk-modal-body'),
  dashboardRiskModalStatus: $('#dashboard-risk-modal-status'), dashboardRiskModalClose: $('#dashboard-risk-modal-close'),
  dashboardRiskModalCancel: $('#dashboard-risk-modal-cancel'), dashboardRiskDispatch: $('#dashboard-risk-dispatch'), dashboardRiskCreateCase: $('#dashboard-risk-create-case'),
  dashboardOrderAgent: $('#dashboard-order-agent'), dashboardKittingAgent: $('#dashboard-kitting-agent'), dashboardQualityAgent: $('#dashboard-quality-agent'), dashboardProductionAgent: $('#dashboard-production-agent'),

  registryRefresh: $('#btn-registry-refresh'), registryStatus: $('#registry-status'),
  registrySystemCaption: $('#registry-system-caption'), registrySystemCount: $('#registry-system-count'),
  registrySystemGrid: $('#registry-system-grid'), registryCapabilityCaption: $('#registry-capability-caption'),
  registryCapabilityCount: $('#registry-capability-count'), registryCapabilityTable: $('#registry-capability-table'), registrySearch: $('#registry-search'), registrySourceFilter: $('#registry-source-filter'), registryStateFilter: $('#registry-state-filter'), registryFilterCount: $('#registry-filter-count'),

  harborAgentCount: $('#harbor-agent-count'), harborAgentActive: $('#harbor-agent-active'),
  harborRuntimeCount: $('#harbor-runtime-count'), harborRuntimeOnline: $('#harbor-runtime-online'),
  harborProjectCount: $('#harbor-project-count'), harborProjectActive: $('#harbor-project-active'),
  harborRunCount: $('#harbor-run-count'), harborRunActive: $('#harbor-run-active'),
  harborRuntimeBoundaryStatus: $('#harbor-runtime-boundary-status'), harborUpdated: $('#harbor-updated'),
  harborAgentList: $('#harbor-agent-list'), harborRuntimeList: $('#harbor-runtime-list'), harborProjectList: $('#harbor-project-list'),
  harborModelList: $('#harbor-model-list'), harborModelCount: $('#harbor-model-count'), harborModelActiveCount: $('#harbor-model-active-count'),
  harborCostMonth: $('#harbor-cost-month'), harborCostMonthNote: $('#harbor-cost-month-note'),
  harborUsageMetrics: $('#harbor-usage-metrics'), harborUsageAgentList: $('#harbor-usage-agent-list'),
  harborUsageModelList: $('#harbor-usage-model-list'), harborUsageRecent: $('#harbor-usage-recent'),
  harborUsageMonth: $('#harbor-usage-month'), harborUsageAgentFilter: $('#harbor-usage-agent-filter'), harborUsageRefresh: $('#harbor-usage-refresh'),
  harborAgentSearch: $('#harbor-agent-search'), harborAgentLevelFilter: $('#harbor-agent-level-filter'), harborAgentStatusFilter: $('#harbor-agent-status-filter'), harborAgentSquadFilter: $('#harbor-agent-squad-filter'), harborAgentFilterClear: $('#harbor-agent-filter-clear'),
  btnAddAgent: $('#btn-add-agent'), btnAddRuntime: $('#btn-add-runtime'),
  harborModal: $('#harbor-modal'), harborModalKicker: $('#harbor-modal-kicker'), harborModalTitle: $('#harbor-modal-title'),
  harborModalDesc: $('#harbor-modal-desc'), harborModalClose: $('#harbor-modal-close'), harborForm: $('#harbor-form'),
  harborFormFields: $('#harbor-form-fields'), harborFormStatus: $('#harbor-form-status'),
  harborFormCancel: $('#harbor-form-cancel'), harborFormSubmit: $('#harbor-form-submit'),
  squadLeadName: $('#squad-lead-name'), squadLeadModel: $('#squad-lead-model'), squadMemberCount: $('#squad-member-count'),
  squadWorkingCount: $('#squad-working-count'), squadMemoryCount: $('#squad-memory-count'), squadMessageCount: $('#squad-message-count'),
  squadMemberList: $('#squad-member-list'), squadMemberDetail: $('#squad-member-detail'), squadAddMember: $('#squad-add-member'),
  squadProjectSelect: $('#squad-project-select'), squadProjectSave: $('#squad-project-save'), squadProjectStatus: $('#squad-project-status'),
  squadModal: $('#squad-modal'), squadModalClose: $('#squad-modal-close'), squadMemberForm: $('#squad-member-form'),
  squadFormStatus: $('#squad-form-status'), squadFormCancel: $('#squad-form-cancel'),
};

let ws = null;
let reconnectTimer = null;
let authenticated = false;
let convs = [];
let curConvId = null;
let busy = false;
let pendingText = null;
let pendingChoice = null;
let modelOptions = [];
let presets = {};
let providerRows = [];
let guard = null;
let guardQueue = [];
let currentView = 'dashboard';
let commandIndex = 0;
let commandMatches = [];
let welcomeState = { step: 0, name: '管理者', role: '决策责任人', defaultView: 'dashboard', avatar: '' };
let harbor = { version: 1, agents: [], runtimes: [], projects: [], runs: [] };
let harborAgentFilter = { query: '', level: 'all', status: 'all', squad: 'all' };
let harborModalType = null;
let harborModalEditId = null;
let modelRegistry = { version: 1, revision: 0, models: [] };
let usageSummary = null;
let usageMonth = localMonthKey();
let squad = { version: 1, lead: null, subSquads: [], squadMemories: [], squadActivities: [], members: [], memories: [], activities: [], messages: [] };
let selectedSquadMemberId = null;
let selectedBusinessSquadId = 'business-squad-orders';
let selectedSquadView = 'business';
let chatScope = { type: 'hub', agentId: null, squadId: null, label: '中枢会话' };
let evidenceRows = [];
let conversationQuery = '';
let attentionFilter = { query: '', source: 'all', state: 'all', level: 'all' };
let attentionLiveResult = null;
let attentionLiveSearchBusy = false;
let registryFilter = { query: '', source: 'all', state: 'all' };
// AI 港湾仅改变浏览层级；子 Agent 的身份、记忆、动作和绑定关系仍各自独立。
const expandedHarborBusinessSquadIds = new Set();
// Agent 小队树默认收起子 Agent；展开仅影响展示，不影响选中项或协作数据。
const expandedSquadBusinessIds = new Set();
let dailyQuestionConfig = null;
let operatingCenterState = { cases: [], decisions: [], inbox: [], unreadInboxCount: 0 };
let selectedInboxItemId = null;
let editingDailyQuestionConfig = null;
let latestDailyQuestionConflictConfig = null;
const dailyQuestionGenerationKeys = new Set();
let loadedDailyQuestionAudienceKey = '';
let dashboardLoading = false;
let dashboardSnapshot = null;
let registrySnapshot = null;
let selectedDashboardRisk = null;
const DASHBOARD_LIVE_REFRESH_MS = 60_000;
let dashboardLiveRefreshTimer = null;
let pendingRiskAgentDispatch = null;
const riskAgentDispatches = new Map();
// 不同 Agent / 不同会话允许并行；同一会话仍由服务端串行，避免上下文交叉。
const MAX_PARALLEL_SPECIALIST_DISPATCHES = 3;
const runningConversationIds = new Set();
const choiceOf = new Map();
const ATTENTION_STORAGE = 'aeos.attention.v1';
const ATTENTION_TIMELINE_STORAGE = 'aeos.attention.timeline.v1';
const REGISTRY_STORAGE = 'aeos.registry.v1';
function createTurnState(scope = {}) {
  return {
    convId: scope.convId || null,
    sessionId: scope.sessionId || null,
    turnId: scope.turnId || null,
    runtimeInstanceId: scope.runtimeInstanceId || null,
    started: false,
    ended: false,
    agentNode: null,
    agentText: '',
    agentItemId: null,
    agentNodes: new Map(),
    agentTexts: new Map(),
    toolHost: null,
    thinkingNode: null,
    thinkingText: '',
    thinkingItemId: null,
    thinkingNodes: new Map(),
    thinkingTexts: new Map(),
    tools: new Map(),
    toolOutputs: new Map(),
    startedItems: new Set(),
    completedItems: new Set(),
    completedItemTexts: new Map(),
    summaryNodes: new Map(),
    imageKeys: new Set(),
    seenSequences: new Set(),
    seenEventIds: new Set(),
    lastDeltaByItem: new Map(),
  };
}

let turn = createTurnState();
let lastRuntimeSequence = 0;
const MAX_STREAM_OUTPUT = 4 * 1024 * 1024;
const MAX_IMAGE_BASE64 = 16 * 1024 * 1024;

const commands = [
  { view: 'dashboard', label: '管理者首页', desc: '目标、风险、TOP 决策与治理脉冲', icon: 'layout-dashboard', group: '经营总览' },
  { view: 'chat', label: '中枢 Agent', desc: '跨域经营分析与 Capability 调用', icon: 'bot', group: '自治运行' },
  { view: 'attention', label: 'Attention 中心', desc: '需要责任人介入的例外事项', icon: 'list-checks', group: '自治运行' },
  { view: 'cases', label: '经营事项', desc: '风险建档、人工决策与闭环验证', icon: 'clipboard-list', group: '经营闭环' },
  { view: 'inbox', label: 'Inbox', desc: '待确认事项、扫描结果与决策留痕', icon: 'inbox', group: '经营闭环' },
  { view: 'harbor', label: 'AI 港湾', desc: '智能体、运行节点与人机协作项目', icon: 'waypoints', group: 'AI 资源协作' },
  { view: 'squad', label: 'Agent 小队', desc: '主 Agent 编排、子 Agent 记忆与协作消息', icon: 'users-round', group: 'AI 资源协作' },
  { view: 'evidence', label: 'Evidence 证据中心', desc: '事实、工具、审批与结果事件流', icon: 'file-search', group: '治理与证据' },
  { view: 'registry', label: 'Capability Registry', desc: '系统与业务能力注册表', icon: 'boxes', group: '治理与证据' },
  { view: 'config', label: '系统配置', desc: '模型提供商与隔离运行时', icon: 'settings', group: '系统' },
];

// Local experience review: keep the operating-center implementation intact
// while temporarily removing its routes from the decision-maker interface.
const LOCALLY_HIDDEN_VIEWS = new Set(['cases', 'inbox']);
const VIEW_TITLES = Object.fromEntries(commands.map((item) => [item.view, item.label]));
const SPLIT = '::';

function refreshIcons(root = document) {
  if (!window.lucide?.createIcons) return;
  window.lucide.createIcons({ root, attrs: { 'aria-hidden': 'true' } });
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function parseStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; }
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function localMonthKey(date = new Date()) {
  return localDateKey(date).slice(0, 7);
}

function formatTokenCount(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('zh-CN');
}

function formatCostAmounts(cost) {
  const entries = Object.entries(cost || {}).filter(([, amount]) => amount > 0);
  if (!entries.length) return null;
  const symbols = { CNY: '¥', USD: '$' };
  return entries.map(([currency, amount]) => `${symbols[currency] || currency}${amount < 0.01 && amount > 0 ? amount.toFixed(4) : amount.toFixed(2)}`).join(' + ');
}

function toast(message, isError = false) {
  const node = document.createElement('div');
  node.className = `toast${isError ? ' err' : ''}`;
  node.textContent = message;
  els.toasts.appendChild(node);
  window.setTimeout(() => node.remove(), 4500);
}

function setLoginBusy(state) {
  els.loginAccount.disabled = state;
  els.loginPassword.disabled = state;
  els.loginSubmit.disabled = state;
  els.loginSubmit.innerHTML = state
    ? '<i data-lucide="loader-circle"></i><span>验证中...</span>'
    : '<i data-lucide="arrow-right"></i><span>继续进入工作区</span>';
  refreshIcons(els.loginSubmit);
  const loader = $('svg', els.loginSubmit);
  if (state && loader) loader.style.animation = 'spin .75s linear infinite';
}

function showLoginError(message) {
  $('span', els.loginError).textContent = message;
  els.loginError.classList.remove('hidden');
}

function beginLoginTransition(next) {
  els.loginError.classList.add('hidden');
  els.loginTransition.classList.remove('hidden');
  const delay = prefersReducedMotion() ? 10 : 980;
  window.setTimeout(() => {
    els.loginStage.classList.add('hidden');
    els.loginTransition.classList.add('hidden');
    next();
  }, delay);
}

async function handleLogin(event) {
  event.preventDefault();
  els.loginError.classList.add('hidden');
  const account = els.loginAccount.value.trim();
  const password = els.loginPassword.value;
  if (!account || !password) {
    showLoginError('请输入账号和密码');
    return;
  }
  setLoginBusy(true);
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ account, password }),
    });
    if (!response.ok) {
      setLoginBusy(false);
      showLoginError('账号或密码错误');
      return;
    }
    authenticated = true;
    // Remove the old client-only marker so it cannot restore a workspace view.
    localStorage.removeItem('aeos-hub-session-v1');
    localStorage.removeItem(STORAGE.profile);
    localStorage.removeItem(STORAGE.onboarding);
    els.loginSubmit.innerHTML = '<i data-lucide="check"></i><span>已验证，正在进入</span>';
    refreshIcons(els.loginSubmit);
    beginLoginTransition(() => {
      setLoginBusy(false);
      showWelcome();
    });
  } catch {
    setLoginBusy(false);
    showLoginError('无法连接登录服务，请检查 AEOS 是否正在运行');
  }
}

function renderWelcome() {
  const { step } = welcomeState;
  els.welcomeBack.classList.toggle('hidden', step === 0);
  $$('.welcome-progress span').forEach((node, index) => node.classList.toggle('active', index <= step));

  if (step === 0) {
    els.welcomeStep.innerHTML = `
      <h1>设置你的资料</h1>
      <p>选择你在 AEOS 企业自治中枢中的显示方式</p>
      <div class="welcome-field">
        <label for="welcome-name">名称与头像</label>
        <div class="welcome-profile-row">
          <label class="welcome-avatar-pick" title="选择头像">
            ${welcomeState.avatar ? `<img src="${esc(welcomeState.avatar)}" alt="" />` : '<i data-lucide="user-round"></i>'}
            <input id="welcome-avatar" class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" />
          </label>
          <input id="welcome-name" value="${esc(welcomeState.name)}" placeholder="输入你的名称" />
        </div>
      </div>
      <div class="welcome-field"><label for="welcome-role">工作角色</label><input id="welcome-role" value="${esc(welcomeState.role)}" placeholder="例如：决策责任人" /></div>
      <button id="welcome-next" class="btn welcome-next" type="button"><span>继续</span><i data-lucide="arrow-right"></i></button>`;
  } else if (step === 1) {
    const options = [
      ['dashboard', 'layout-dashboard', '管理者首页', '目标、风险与 TOP 决策'],
      ['chat', 'bot', '中枢 Agent', '直接进入跨域经营对话'],
      ['attention', 'list-checks', 'Attention 中心', '先处理需要人介入的事项'],
    ];
    els.welcomeStep.innerHTML = `
      <h1>选择默认视图</h1>
      <p>以后登录时，AEOS 会优先恢复到这里</p>
      <div class="welcome-options">${options.map(([view, icon, label, desc]) => `
        <button class="welcome-option${welcomeState.defaultView === view ? ' active' : ''}" type="button" data-welcome-view="${view}">
          <i data-lucide="${icon}"></i><div><strong>${label}</strong><small>${desc}</small></div><i data-lucide="check"></i>
        </button>`).join('')}</div>
      <button id="welcome-next" class="btn welcome-next" type="button"><span>继续</span><i data-lucide="arrow-right"></i></button>`;
  } else {
    els.welcomeStep.innerHTML = `
      <h1>工作区已准备就绪</h1>
      <p>AEOS 将以只读试点边界连接中枢 Agent、Capability、Evidence 与 Guard</p>
      <div class="welcome-summary">
        <div><span>显示名称</span><strong>${esc(welcomeState.name || '管理者')}</strong></div>
        <div><span>工作角色</span><strong>${esc(welcomeState.role || '决策责任人')}</strong></div>
        <div><span>默认视图</span><strong>${esc(VIEW_TITLES[welcomeState.defaultView])}</strong></div>
        <div><span>自治边界</span><strong>A1/A2 · 只读建议</strong></div>
      </div>
      <button id="welcome-next" class="btn welcome-next" type="button"><span>进入 AEOS</span><i data-lucide="arrow-right"></i></button>`;
  }

  refreshIcons(els.welcomeStep);
  bindWelcomeStep();
}

function bindWelcomeStep() {
  const name = $('#welcome-name');
  const role = $('#welcome-role');
  if (name) name.addEventListener('input', () => { welcomeState.name = name.value; });
  if (role) role.addEventListener('input', () => { welcomeState.role = role.value; });
  const avatarInput = $('#welcome-avatar');
  if (avatarInput) avatarInput.addEventListener('change', () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { welcomeState.avatar = typeof reader.result === 'string' ? reader.result : ''; renderWelcome(); };
    reader.readAsDataURL(file);
  });
  $$('[data-welcome-view]').forEach((button) => button.addEventListener('click', () => {
    welcomeState.defaultView = button.dataset.welcomeView;
    renderWelcome();
  }));
  $('#welcome-next')?.addEventListener('click', () => {
    if (welcomeState.step === 0 && !welcomeState.name.trim()) {
      toast('请先填写显示名称', true);
      return;
    }
    if (welcomeState.step < 2) {
      welcomeState.step += 1;
      renderWelcome();
      return;
    }
    finishWelcome();
  });
}

function showWelcome() {
  const profile = parseStored(STORAGE.profile, {});
  welcomeState = { step: 0, name: profile.name || '管理者', role: profile.role || '决策责任人', defaultView: 'dashboard', avatar: profile.avatar || '' };
  els.welcomeStage.classList.remove('hidden');
  renderWelcome();
}

function finishWelcome() {
  const profile = { name: welcomeState.name.trim() || '管理者', role: welcomeState.role.trim() || '决策责任人', avatar: welcomeState.avatar || '' };
  localStorage.setItem(STORAGE.profile, JSON.stringify(profile));
  localStorage.setItem(STORAGE.onboarding, JSON.stringify({ defaultView: welcomeState.defaultView, completedAt: new Date().toISOString() }));
  els.welcomeExit.classList.remove('hidden');
  const delay = prefersReducedMotion() ? 10 : 900;
  window.setTimeout(() => {
    els.welcomeStage.classList.add('hidden');
    els.welcomeExit.classList.add('hidden');
    showWorkspace(true, welcomeState.defaultView);
  }, delay);
}

function initials(name) {
  const cleaned = String(name || '管理者').trim();
  return cleaned.slice(0, 1) || '管';
}

function applyProfile() {
  const profile = parseStored(STORAGE.profile, { name: '管理者', role: '决策责任人', avatar: '' });
  els.sidebarUserName.textContent = profile.name || '管理者';
  els.sidebarUserRole.textContent = profile.role || '决策责任人';
  els.menuUserName.textContent = profile.name || '管理者';
  els.menuUserRole.textContent = profile.role || '决策责任人';
  const label = initials(profile.name);
  [els.sidebarAvatar, els.headerAvatar].forEach((avatar) => {
    avatar.textContent = profile.avatar ? '' : label;
    avatar.style.backgroundImage = profile.avatar ? `url("${String(profile.avatar).replace(/"/g, '%22')}")` : '';
    avatar.style.backgroundSize = 'cover';
    avatar.style.backgroundPosition = 'center';
  });
}

function showWorkspace(entering = false, forcedView = null) {
  els.loginStage.classList.add('hidden');
  els.welcomeStage.classList.add('hidden');
  els.app.classList.remove('hidden');
  els.app.classList.toggle('workspace-enter', entering && !prefersReducedMotion());
  applyProfile();
  $$('.nav-item').forEach((node, index) => node.style.setProperty('--nav-order', String(index)));
  const onboarding = parseStored(STORAGE.onboarding, { defaultView: 'dashboard' });
  const hashView = location.hash.replace(/^#/, '');
  const initialView = forcedView || (VIEW_TITLES[hashView] ? hashView : onboarding.defaultView) || 'dashboard';
  showView(initialView, { updateHash: true, animate: !entering });
  connect();
  loadEvidence();
  loadOperatingCenter({ silent: true });
  loadHarbor({ silent: true });
  loadDailyQuestions({ silent: true, generate: true });
  window.setTimeout(() => els.app.classList.remove('workspace-enter'), 900);
}

function savedMap(key) { return parseStored(key, {}); }
function saveMap(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

/** Native DnD wrapper shared by the three workbench boards. */
function bindKanbanDrag(root, onMove) {
  let dragging = null;
  $$('[draggable="true"]', root).forEach((card) => {
    card.addEventListener('dragstart', (event) => { dragging = card; card.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('dragend', () => { card.classList.remove('is-dragging'); dragging = null; });
  });
  $$('[data-kanban-column]', root).forEach((column) => {
    column.addEventListener('dragover', (event) => { event.preventDefault(); column.classList.add('is-drop-target'); event.dataTransfer.dropEffect = 'move'; });
    column.addEventListener('dragleave', () => column.classList.remove('is-drop-target'));
    column.addEventListener('drop', (event) => {
      event.preventDefault(); column.classList.remove('is-drop-target');
      if (!dragging) return;
      onMove(dragging.dataset.cardId, column.dataset.kanbanColumn);
    });
  });
}

async function logout() {
  // Exit the browser workspace first. A stalled network request must never
  // make the user appear to remain logged in.
  authenticated = false;
  localStorage.removeItem('aeos-hub-session-v1');
  window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (ws) {
    ws.close(1000, 'Signed out');
    ws = null;
  }
  els.userMenu.classList.add('hidden');
  els.app.classList.add('hidden');
  els.welcomeStage.classList.add('hidden');
  els.welcomeExit.classList.add('hidden');
  els.loginTransition.classList.add('hidden');
  els.loginStage.classList.remove('hidden');
  els.loginPassword.value = '';
  els.loginError.classList.add('hidden');
  setLoginBusy(false);
  window.clearInterval(dashboardLiveRefreshTimer);
  dashboardLiveRefreshTimer = null;
  history.replaceState(null, '', location.pathname);
  window.setTimeout(() => els.loginAccount.focus(), 30);

  try {
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) showLoginError('本地已退出；服务端会话未能确认失效，请恢复网络后重新打开页面。');
  } catch {
    showLoginError('本地已退出；服务端会话未能确认失效，请恢复网络后重新打开页面。');
  }
}

function showView(view, options = {}) {
  if (!VIEW_TITLES[view]) view = 'dashboard';
  if (LOCALLY_HIDDEN_VIEWS.has(view)) view = 'dashboard';
  currentView = view;
  $$('.app-view').forEach((node) => node.classList.add('hidden'));
  const target = $(`#view-${view}`);
  target.classList.remove('hidden');
  if (options.animate !== false) {
    target.classList.remove('view-enter');
    void target.offsetWidth;
    target.classList.add('view-enter');
  }
  $$('.nav-item').forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  els.app.dataset.activeView = view;
  els.breadcrumb.textContent = VIEW_TITLES[view];
  if (options.updateHash !== false && location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  els.workspaceContent.scrollTop = 0;
  if (view === 'config') loadConfig();
  if (view === 'evidence' || view === 'dashboard' || view === 'attention') loadEvidence();
  if (view === 'dashboard' || view === 'attention') loadDashboard({ silent: true });
  if (view === 'cases') loadOperatingCenter();
  if (view === 'inbox') loadInbox();
  if (view === 'registry' || view === 'chat') loadCapabilityRegistry({ silent: view === 'chat' });
  if (view === 'harbor') loadHarbor();
  if (view === 'squad') { loadHarbor({ silent: true }); loadSquad(); }
  if (view === 'attention') loadSquad({ silent: true });
  if (view === 'chat' && curConvId) send({ type: 'view', conversationId: curConvId });
  syncDashboardLiveRefresh();
}

function syncDashboardLiveRefresh() {
  window.clearInterval(dashboardLiveRefreshTimer);
  dashboardLiveRefreshTimer = null;
  if (!['dashboard', 'attention'].includes(currentView) || els.app.classList.contains('hidden')) return;
  dashboardLiveRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') loadDashboard({ silent: true, force: true });
  }, DASHBOARD_LIVE_REFRESH_MS);
}

function openPrompt(prompt) {
  // Generic prompt actions (briefing, registry, daily questions) belong to
  // the central Agent. Module records use openDashboardRiskDetail instead and
  // dispatch to their own specialist Agent from the modal.
  openHubConversationSpace();
  showView('chat');
  els.input.value = prompt;
  resizeComposer();
  doSend(prompt);
}

function openProductionCoordinationPrompt(orderNo, workOrderNo) {
  const order = orderNo && orderNo !== '待回传' ? orderNo : '待回传';
  const workOrder = workOrderNo && workOrderNo !== '待回传' ? workOrderNo : '待回传';
  openPrompt(`请由生产协同 Agent 分析生产对象：生产工单 ${workOrder}，销售订单 ${order}。仅使用 company-control 的 production_work_orders_list、production_operations_list、production_order_links_list、production_reports_list 和 production_capacity_list；工序必须以 order_no 锚定，报工必须以 work_order_no 锚定。输出事项、evidence_refs、工单/工序/订单关联/报工/产能影响、建议动作、责任角色、时限和数据置信度；空结果、过期或低置信度数据必须明确说明，不得修改业务数据。`);
}

function dailyQuestionRole() {
  const profile = parseStored(STORAGE.profile, { role: '决策责任人' });
  return String(profile.role || '决策责任人').trim();
}

function dailyQuestionRotation() {
  const dateKey = questionDateKey();
  const stored = parseStored(STORAGE.dailyQuestionRotation, {});
  return stored.dateKey === dateKey ? Math.max(0, Number(stored.offset) || 0) : 0;
}

function setDailyQuestionRotation(offset) {
  localStorage.setItem(STORAGE.dailyQuestionRotation, JSON.stringify({ dateKey: questionDateKey(), offset }));
}

function dailyQuestionCountLabel(count) {
  const labels = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  return labels[count] || String(count);
}

function dailyQuestionGenerationKey(dateKey = questionDateKey(), role = dailyQuestionRole()) {
  return `${dateKey}\u0000${role}`;
}

function hasDailyQuestionGeneration(config, dateKey = questionDateKey(), role = dailyQuestionRole()) {
  return (config?.generatedBatches || []).some((batch) => batch.dateKey === dateKey && batch.role === role);
}

function dailyQuestionDomain(question) {
  const content = `${question?.title || ''} ${question?.prompt || ''}`;
  if (/质量|异常|追溯|检验|缺陷/.test(content)) return { label: '异常与质量小队', tone: 'quality', icon: 'shield-check' };
  if (/齐套|缺料|物料|库存|供应|交期/.test(content)) return { label: '物料齐套小队', tone: 'kitting', icon: 'boxes' };
  if (/订单|交付|客户|出货|履约/.test(content)) return { label: '订单小队', tone: 'order', icon: 'package-check' };
  return { label: '中枢协调', tone: 'hub', icon: 'waypoints' };
}

function renderDailyQuestions() {
  if (!dailyQuestionConfig) return;
  const role = dailyQuestionRole();
  const dateKey = questionDateKey();
  const questions = selectDailyQuestions(dailyQuestionConfig, { dateKey, role, offset: dailyQuestionRotation() });
  els.dailyQuestionTitle.textContent = `每日经营${dailyQuestionCountLabel(questions.length)}问`;
  const generationKey = dailyQuestionGenerationKey(dateKey, role);
  const sourceLabel = dailyQuestionGenerationKeys.has(generationKey)
    ? 'AI 正在生成…'
    : hasDailyQuestionGeneration(dailyQuestionConfig, dateKey, role) ? 'AI 每日生成' : '人工问题池兜底';
  els.dailyQuestionCaption.textContent = `${dateKey} · ${role} · ${sourceLabel}`;
  els.dailyQuestionList.innerHTML = '';
  questions.forEach((question, index) => {
    const domain = dailyQuestionDomain(question);
    const button = document.createElement('button');
    button.className = `prompt-action daily-question-card ${domain.tone}`;
    button.type = 'button';
    button.dataset.prompt = question.prompt;
    button.setAttribute('title', `交给中枢分析，自动协调${domain.label}`);
    button.innerHTML = `<span class="daily-question-index">${String(index + 1).padStart(2, '0')}</span><span class="daily-question-copy"><strong>${esc(question.title)}</strong><small><i data-lucide="${domain.icon}"></i>${esc(domain.label)} · 点击交给中枢分析</small></span><i class="daily-question-arrow" data-lucide="arrow-up-right"></i>`;
    button.addEventListener('click', () => openPrompt(question.prompt));
    els.dailyQuestionList.appendChild(button);
  });
  if (!questions.length) els.dailyQuestionList.innerHTML = '<div class="question-loading">暂无启用的经营问题</div>';
  refreshIcons(els.dailyQuestionList);
}

async function loadDailyQuestions(options = {}) {
  try {
    const response = await fetch('/api/daily-questions', { headers: { accept: 'application/json' } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    dailyQuestionConfig = payload;
    loadedDailyQuestionAudienceKey = dailyQuestionGenerationKey();
    renderDailyQuestions();
    if (options.generate) void ensureDailyQuestionGeneration({ silent: options.silent });
    return payload;
  } catch (error) {
    els.dailyQuestionList.innerHTML = '<div class="question-loading">经营问题加载失败</div>';
    if (!options.silent) toast(`经营问题加载失败：${error.message}`, true);
    return null;
  }
}

function refreshDailyQuestionsOnAudienceChange() {
  if (!authenticated || els.app.classList.contains('hidden')) return;
  const currentKey = dailyQuestionGenerationKey();
  if (currentKey === loadedDailyQuestionAudienceKey) return;
  setDailyQuestionRotation(0);
  void loadDailyQuestions({ silent: true, generate: true });
}

async function ensureDailyQuestionGeneration(options = {}) {
  if (!dailyQuestionConfig) return;
  const dateKey = questionDateKey();
  const role = dailyQuestionRole();
  if (hasDailyQuestionGeneration(dailyQuestionConfig, dateKey, role)) return;
  const key = dailyQuestionGenerationKey(dateKey, role);
  if (dailyQuestionGenerationKeys.has(key)) return;

  dailyQuestionGenerationKeys.add(key);
  renderDailyQuestions();
  try {
    const response = await fetch('/api/daily-questions/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ dateKey, role }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (!dailyQuestionConfig || Number(payload.config?.revision) >= Number(dailyQuestionConfig.revision)) {
      dailyQuestionConfig = payload.config;
      setDailyQuestionRotation(0);
    }
  } catch (error) {
    if (!options.silent) toast(`AI 每日问题生成失败，已使用人工问题池：${error.message}`, true);
  } finally {
    dailyQuestionGenerationKeys.delete(key);
    renderDailyQuestions();
  }
}

function renderDailyQuestionEditor() {
  if (!editingDailyQuestionConfig) return;
  els.dailyQuestionCount.value = String(editingDailyQuestionConfig.displayCount);
  els.dailyQuestionEditor.innerHTML = '<div class="daily-question-edit-labels"><span></span><span>显示问题</span><span>发送给 Agent 的 prompt</span><span>适用角色</span><span>优先级</span><span>状态</span><span></span></div>';
  editingDailyQuestionConfig.questions.forEach((question, index) => {
    const row = document.createElement('div');
    row.className = 'daily-question-edit-row';
    row.dataset.questionId = question.id;
    row.dataset.questionSource = question.source || 'manual';
    row.dataset.generatedDate = question.generatedDate || '';
    row.dataset.generatedRole = question.generatedRole || '';
    const sourceLabel = question.source === 'generated' ? 'AI' : String(index + 1).padStart(2, '0');
    row.innerHTML = `
      <span class="drag-index${question.source === 'generated' ? ' generated' : ''}" title="${question.source === 'generated' ? '大模型生成' : '人工问题池'}">${sourceLabel}</span>
      <input class="question-title" type="text" maxlength="80" value="${esc(question.title)}" aria-label="显示问题" />
      <input class="question-prompt" type="text" maxlength="1200" value="${esc(question.prompt)}" aria-label="发送给 Agent 的 prompt" />
      <input class="question-roles" type="text" maxlength="300" value="${esc((question.roles || []).join(', '))}" placeholder="全部角色" aria-label="适用角色" />
      <input class="question-priority" type="number" min="0" max="100" value="${Number(question.priority)}" aria-label="优先级" />
      <label class="enabled-field"><input class="question-enabled" type="checkbox" ${question.enabled ? 'checked' : ''} />启用</label>
      <button class="question-remove" type="button" title="删除问题" aria-label="删除问题"><i data-lucide="trash-2"></i></button>`;
    $('.question-remove', row).addEventListener('click', () => {
      const current = syncDailyQuestionEditor();
      current.questions = current.questions.filter((item) => item.id !== question.id);
      renderDailyQuestionEditor();
    });
    els.dailyQuestionEditor.appendChild(row);
  });
  refreshIcons(els.dailyQuestionEditor);
}

function openDailyQuestionModal() {
  if (!dailyQuestionConfig) {
    toast('问题池尚未加载，请稍后重试', true);
    return;
  }
  editingDailyQuestionConfig = structuredClone(dailyQuestionConfig);
  latestDailyQuestionConflictConfig = null;
  els.dailyQuestionFormStatus.textContent = '';
  els.dailyQuestionFormReload.classList.add('hidden');
  els.dailyQuestionFormSave.disabled = false;
  renderDailyQuestionEditor();
  els.dailyQuestionModal.classList.remove('hidden');
}

function closeDailyQuestionModal() {
  els.dailyQuestionModal.classList.add('hidden');
  editingDailyQuestionConfig = null;
  latestDailyQuestionConflictConfig = null;
  els.dailyQuestionFormReload.classList.add('hidden');
}

function collectDailyQuestionConfig() {
  const questions = $$('.daily-question-edit-row', els.dailyQuestionEditor).map((row) => ({
    id: row.dataset.questionId,
    title: $('.question-title', row).value.trim(),
    prompt: $('.question-prompt', row).value.trim(),
    roles: $('.question-roles', row).value.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
    priority: Number($('.question-priority', row).value),
    enabled: $('.question-enabled', row).checked,
    source: row.dataset.questionSource || 'manual',
    generatedDate: row.dataset.generatedDate || null,
    generatedRole: row.dataset.generatedRole || null,
  }));
  return {
    version: 1,
    revision: editingDailyQuestionConfig.revision,
    displayCount: Number(els.dailyQuestionCount.value),
    questions,
    generatedBatches: editingDailyQuestionConfig.generatedBatches || [],
  };
}

function syncDailyQuestionEditor() {
  if (!editingDailyQuestionConfig) return null;
  editingDailyQuestionConfig = collectDailyQuestionConfig();
  return editingDailyQuestionConfig;
}

function reloadLatestDailyQuestionConfig() {
  if (!latestDailyQuestionConflictConfig) return;
  editingDailyQuestionConfig = structuredClone(latestDailyQuestionConflictConfig);
  latestDailyQuestionConflictConfig = null;
  renderDailyQuestionEditor();
  els.dailyQuestionFormStatus.textContent = '已载入最新版本，请重新确认修改后保存。';
  els.dailyQuestionFormReload.classList.add('hidden');
  els.dailyQuestionFormSave.disabled = false;
}

async function saveDailyQuestions(event) {
  event.preventDefault();
  const payload = collectDailyQuestionConfig();
  els.dailyQuestionFormStatus.textContent = '保存中…';
  els.dailyQuestionFormSave.disabled = true;
  try {
    const response = await fetch('/api/daily-questions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const saved = await response.json();
    if (response.status === 409) {
      const latest = await loadDailyQuestions({ silent: true });
      if (latest) {
        latestDailyQuestionConflictConfig = latest;
        els.dailyQuestionFormStatus.textContent = '配置已被其他管理者更新。当前编辑仍保留，请载入最新版本后重新修改。';
        els.dailyQuestionFormReload.classList.remove('hidden');
        els.dailyQuestionFormSave.disabled = true;
      } else {
        els.dailyQuestionFormStatus.textContent = '配置已更新，但最新版本加载失败，请稍后重试。';
        els.dailyQuestionFormSave.disabled = false;
      }
      return;
    }
    if (!response.ok) throw new Error(saved.error || `HTTP ${response.status}`);
    dailyQuestionConfig = saved;
    latestDailyQuestionConflictConfig = null;
    setDailyQuestionRotation(0);
    renderDailyQuestions();
    closeDailyQuestionModal();
    toast('每日经营问题池已保存');
  } catch (error) {
    els.dailyQuestionFormStatus.textContent = error.message;
    els.dailyQuestionFormSave.disabled = false;
  }
}

function addDailyQuestionEditorRow() {
  if (!editingDailyQuestionConfig || editingDailyQuestionConfig.questions.length >= 100) return;
  syncDailyQuestionEditor();
  editingDailyQuestionConfig.questions.push({
    id: `custom-${Date.now().toString(36)}-${editingDailyQuestionConfig.questions.length + 1}`,
    title: '新的经营问题',
    prompt: '请基于当前可用数据分析该经营问题，并引用 evidence_refs。',
    roles: [],
    priority: 50,
    enabled: true,
    source: 'manual',
    generatedDate: null,
    generatedRole: null,
  });
  renderDailyQuestionEditor();
  els.dailyQuestionEditor.scrollTop = els.dailyQuestionEditor.scrollHeight;
}

function openCommandPalette() {
  commandIndex = 0;
  els.commandInput.value = '';
  renderCommandResults();
  els.commandPalette.classList.remove('hidden');
  window.setTimeout(() => els.commandInput.focus(), 20);
}

function closeCommandPalette() {
  els.commandPalette.classList.add('hidden');
}

function renderCommandResults() {
  const query = els.commandInput.value.trim().toLowerCase();
  commandMatches = commands.filter((item) => !LOCALLY_HIDDEN_VIEWS.has(item.view) && (!query || `${item.label} ${item.desc} ${item.group}`.toLowerCase().includes(query)));
  if (commandIndex >= commandMatches.length) commandIndex = Math.max(0, commandMatches.length - 1);
  els.commandResults.innerHTML = commandMatches.length ? commandMatches.map((item, index) => `
    <button class="command-item${index === commandIndex ? ' active' : ''}" type="button" data-command-view="${item.view}">
      <span><i data-lucide="${item.icon}"></i></span><div><strong>${item.label}</strong><small>${item.desc}</small></div><span>${item.group}</span>
    </button>`).join('') : '<div class="evidence-empty">没有匹配的页面</div>';
  refreshIcons(els.commandResults);
  $$('[data-command-view]', els.commandResults).forEach((button) => button.addEventListener('click', () => {
    showView(button.dataset.commandView);
    closeCommandPalette();
  }));
}

function md(text) {
  return String(text ?? '').split('\n').map((line) => {
    let out = esc(line);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    if (/^###\s+/.test(out)) return `<b class="h3">${out.slice(4)}</b>`;
    if (/^##\s+/.test(out)) return `<b class="h2">${out.slice(3)}</b>`;
    if (/^#\s+/.test(out)) return `<b class="h1">${out.slice(2)}</b>`;
    if (/^[-*]\s+/.test(out)) return `&nbsp;&nbsp;• ${out.slice(2)}`;
    if (/^\s*---+\s*$/.test(out)) return '<hr style="border:0;border-top:1px solid var(--line);margin:7px 0" />';
    return out;
  }).join('\n');
}

function send(payload) {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function choiceKey(choice) {
  return `${choice.provider || 'openai'}${SPLIT}${choice.model || ''}`;
}

function fillModelSelect(selected) {
  const defaultOption = modelOptions.find((option) => option.provider === 'deepseek' && option.model === 'deepseek-v4-flash')
    || modelOptions.find((option) => option.provider === 'deepseek')
    || modelOptions[0];
  const key = choiceKey(selected || defaultOption || { provider: 'openai', model: '' });
  els.modelSelect.innerHTML = '';
  for (const option of modelOptions) {
    const node = document.createElement('option');
    node.value = choiceKey(option);
    node.textContent = option.label;
    if (node.value === key) node.selected = true;
    els.modelSelect.appendChild(node);
  }
}

function currentChoice() {
  const value = els.modelSelect.value.split(SPLIT);
  return { provider: value[0] || 'openai', model: value[1] || '' };
}

function rememberChoice(convId) {
  choiceOf.set(convId, currentChoice());
}

let showArchived = false;

function formatConvTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function convProviderTag(conv) {
  if (!conv.lastChoice || (conv.lastChoice.provider || 'openai') === 'openai') return '';
  return `${conv.lastChoice.provider}${conv.lastChoice.model ? '/' + conv.lastChoice.model : ''}`;
}

function convNode(conv, { archivedSection = false } = {}) {
  const node = document.createElement('div');
  node.className = `conv-item${conv.id === curConvId && !archivedSection ? ' active' : ''}`;
  node.title = conv.title || '空对话';

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'conv-main';
  const title = document.createElement('span');
  title.className = 't';
  title.textContent = conv.title || '空对话';
  const meta = document.createElement('span');
  meta.className = 'm';
  const tag = convProviderTag(conv);
  meta.textContent = `${tag ? tag + ' · ' : ''}${formatConvTime(conv.updatedAt)}`;
  main.append(title, meta);
  main.addEventListener('click', () => selectConv(conv.id));

  const actions = document.createElement('div');
  actions.className = 'conv-actions';
  if (archivedSection) {
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'conv-act';
    restore.title = '恢复会话';
    restore.innerHTML = '<i data-lucide="archive-restore"></i>';
    restore.addEventListener('click', (e) => { e.stopPropagation(); send({ type: 'conversation:archive', conversationId: conv.id, archived: false }); });
    actions.appendChild(restore);
  } else {
    const archive = document.createElement('button');
    archive.type = 'button';
    archive.className = 'conv-act';
    archive.title = '归档';
    archive.innerHTML = '<i data-lucide="archive"></i>';
    archive.addEventListener('click', (e) => { e.stopPropagation(); send({ type: 'conversation:archive', conversationId: conv.id, archived: true }); });
    actions.appendChild(archive);
  }
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'conv-act danger';
  del.title = '删除';
  del.innerHTML = '<i data-lucide="trash-2"></i>';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!window.confirm(`删除会话「${conv.title || '空对话'}」？\n本地记录与 codex 线程将一并删除，历史证据保留在 Evidence 中。`)) return;
    send({ type: 'conversation:delete', conversationId: conv.id });
  });
  actions.appendChild(del);

  node.append(main, actions);
  return node;
}

function renderConvs() {
  els.convList.innerHTML = '';
  const scoped = chatScope.type === 'agent'
    ? convs.filter((conv) => conv.scope === 'agent' && conv.agentId === chatScope.agentId)
    : chatScope.type === 'squad'
      ? convs.filter((conv) => conv.scope === 'agent' && conv.squadId === chatScope.squadId)
      : convs.filter((conv) => conv.scope !== 'agent');
  const query = String(conversationQuery || '').trim().toLowerCase();
  const filtered = query ? scoped.filter((conv) => `${conv.title || ''} ${conv.scope || ''} ${conv.agentId || ''}`.toLowerCase().includes(query)) : scoped;
  const sorted = [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const active = sorted.filter((conv) => !conv.archived);
  const archived = sorted.filter((conv) => conv.archived);
  els.metricConversations.textContent = String(convs.filter((conv) => conv.scope !== 'agent' && !conv.archived).length);
  if (!active.length && !archived.length) {
    els.convList.innerHTML = `<div class="conv-empty">${query ? '没有匹配的会话<br />请调整搜索关键词' : '还没有会话<br />点击右上角新建'}</div>`;
    return;
  }
  for (const conv of active) els.convList.appendChild(convNode(conv));
  if (archived.length) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'conv-archived-toggle';
    toggle.innerHTML = `<i data-lucide="${showArchived ? 'chevron-down' : 'chevron-right'}"></i><span>已归档</span><b>${archived.length}</b>`;
    toggle.addEventListener('click', () => { showArchived = !showArchived; renderConvs(); });
    els.convList.appendChild(toggle);
    if (showArchived) {
      for (const conv of archived) els.convList.appendChild(convNode(conv, { archivedSection: true }));
    }
  }
  if (typeof window.lucide !== 'undefined') window.lucide.createIcons();
}

function selectConv(id) {
  curConvId = id;
  renderConvs();
  els.messages.innerHTML = '';
  els.empty.classList.remove('hidden');
  resetTurn();
  syncCurrentConversationBusy();
  const conv = convs.find((item) => item.id === id);
  fillModelSelect(conv?.threadId
    ? (conv.lastChoice || { provider: 'openai', model: '' })
    : null);
  send({ type: 'view', conversationId: id });
}

function newConversation() {
  setBusy(false);
  const agentScope = pendingRiskAgentDispatch
    ? { scope: 'agent', agentId: pendingRiskAgentDispatch.memberId, squadId: pendingRiskAgentDispatch.squadId }
    : chatScope.type === 'agent' ? { scope: 'agent', agentId: chatScope.agentId, squadId: chatScope.squadId } : {};
  return send({ type: 'new', ...agentScope });
}

function openAgentConversationSpace(member, conversationId = null) {
  chatScope = { type: 'agent', agentId: member.id, squadId: member.squadId || '', label: `${member.name} · 专属会话` };
  els.chatViewTitle.textContent = `${member.name} · 专属会话`;
  els.chatViewDesc.textContent = '该子 Agent 的独立会话，仅在所属 Agent / 小队中展示，不进入中枢会话列表。';
  els.conversationScopeLabel.textContent = chatScope.label;
  els.chatScopeBack.classList.remove('hidden');
  els.btnNew.disabled = false;
  curConvId = conversationId || convs.filter((conv) => conv.scope === 'agent' && conv.agentId === member.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id || null;
  showView('chat');
  renderConvs();
  syncCurrentConversationBusy();
  if (curConvId) send({ type: 'view', conversationId: curConvId });
}

function openHarborAgentConversationSpace(harborAgentId) {
  const member = (squad.members || []).find((item) => item.harborAgentId === harborAgentId);
  if (!member) {
    toast('该 Agent 尚未加入 Agent 小队；请先建立小队归属后再开启独立会话', true);
    return;
  }
  openAgentConversationSpace(member);
}

function openSquadConversationSpace(businessSquad) {
  chatScope = { type: 'squad', agentId: null, squadId: businessSquad.id, label: `${businessSquad.name} · 小队会话` };
  els.chatViewTitle.textContent = `${businessSquad.name} · 小队会话`;
  els.chatViewDesc.textContent = '聚合查看下辖 Agent 的已分发会话；请选择具体 Agent 后才能新建或继续派发。';
  els.conversationScopeLabel.textContent = chatScope.label;
  els.chatScopeBack.classList.remove('hidden');
  els.btnNew.disabled = true;
  curConvId = convs.filter((conv) => conv.scope === 'agent' && conv.squadId === businessSquad.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id || null;
  showView('chat');
  renderConvs();
  syncCurrentConversationBusy();
  if (curConvId) send({ type: 'view', conversationId: curConvId });
}

function openHubConversationSpace() {
  chatScope = { type: 'hub', agentId: null, squadId: null, label: '中枢会话' };
  els.chatViewTitle.textContent = '中枢 Agent';
  els.chatViewDesc.textContent = '跨域经营分析、Capability 调用、Evidence 引用与 Guard 审批';
  els.conversationScopeLabel.textContent = '中枢会话';
  els.chatScopeBack.classList.add('hidden');
  els.btnNew.disabled = false;
  curConvId = convs.filter((conv) => conv.scope !== 'agent').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id || null;
  renderConvs();
  syncCurrentConversationBusy();
  if (curConvId) send({ type: 'view', conversationId: curConvId });
}

function renderParallelTaskPanel() {
  if (!els.parallelTaskPanel || !els.parallelTaskList) return;
  const tasks = [...riskAgentDispatches.entries()];
  els.parallelTaskPanel.classList.toggle('hidden', tasks.length === 0);
  if (els.parallelTaskCount) els.parallelTaskCount.textContent = `${tasks.length} 个运行中`;
  els.parallelTaskList.innerHTML = tasks.map(([convId, task]) => {
    const member = (squad.members || []).find((item) => item.id === task.memberId);
    const status = runningConversationIds.has(convId) ? '执行中' : '正在启动';
    const statusClass = runningConversationIds.has(convId) ? 'info' : 'neutral';
    return `<button class="parallel-task-row" type="button" data-parallel-conversation="${esc(convId)}"><span class="parallel-task-icon"><i data-lucide="${runningConversationIds.has(convId) ? 'loader-circle' : 'clock-3'}"></i></span><span class="parallel-task-copy"><strong>${esc(task.agentLabel || member?.name || '专业 Agent')}</strong><small>${esc(task.taskType === 'kitting' ? '物料齐套' : task.taskType === 'quality' ? '异常与质量' : '订单交付')} · ${esc(task.orderNo || '任务待识别')}</small></span><span class="status-pill ${statusClass}">${status}</span><i data-lucide="chevron-right"></i></button>`;
  }).join('');
  $$('[data-parallel-conversation]', els.parallelTaskList).forEach((button) => button.addEventListener('click', () => {
    const convId = button.dataset.parallelConversation;
    const task = riskAgentDispatches.get(convId);
    const member = task && (squad.members || []).find((item) => item.id === task.memberId);
    if (member) openAgentConversationSpace(member, convId);
  }));
  refreshIcons(els.parallelTaskPanel);
}

function scrollBottom() {
  const node = els.messages;
  const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 180;
  if (nearBottom) node.scrollTop = node.scrollHeight;
}

function appendMsg(kind, text, extraClass) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${kind}`;
  const bubble = document.createElement('div');
  bubble.className = `bubble${extraClass ? ` ${extraClass}` : ''}`;
  bubble.textContent = text;
  wrap.appendChild(bubble);
  els.messages.appendChild(wrap);
  els.empty.classList.add('hidden');
  scrollBottom();
  return wrap;
}

function msgMeta(text) {
  const node = document.createElement('div');
  node.className = 'meta';
  node.textContent = text;
  return node;
}

function resetTurn(scope = {}) {
  // Live reasoning is the only transient DOM node owned by a turn. Completed
  // agent messages stay in the transcript when a new turn starts.
  const thinkingNodes = turn.thinkingNodes instanceof Map ? turn.thinkingNodes.values() : [];
  for (const node of thinkingNodes) node.remove();
  turn.thinkingNode?.remove();
  turn = createTurnState({ convId: curConvId, ...scope });
  els.turnbar.classList.add('hidden');
  els.turnbar.classList.remove('fail');
}

function setBusy(state) {
  busy = state;
  els.btnSend.disabled = state;
  if (state) {
    els.turnStatus.textContent = 'Agent 执行中...';
    els.turnbar.classList.remove('fail', 'hidden');
  } else {
    els.turnbar.classList.add('hidden');
  }
}

function ensureAgentNode(itemId = null) {
  const key = String(itemId || turn.agentItemId || 'agent:default');
  const existing = turn.agentNodes.get(key);
  if (existing) {
    turn.agentNode = existing;
    turn.agentItemId = key;
    return existing;
  }
  const wrap = document.createElement('div');
  wrap.className = 'msg agent';
  wrap.dataset.itemId = key;
  turn.agentNode = wrap;
  turn.agentItemId = key;
  turn.agentNodes.set(key, wrap);
  els.messages.appendChild(wrap);
  els.empty.classList.add('hidden');
  return wrap;
}

function thinkingVisible(itemId = null) {
  const key = String(itemId || turn.thinkingItemId || 'reasoning:default');
  let node = turn.thinkingNodes.get(key);
  if (!node) {
    node = document.createElement('div');
    node.className = 'thinking';
    node.dataset.itemId = key;
    turn.thinkingNodes.set(key, node);
    els.messages.appendChild(node);
  }
  turn.thinkingNode = node;
  turn.thinkingItemId = key;
  const text = turn.thinkingTexts.get(key) || turn.thinkingText || '';
  node.textContent = text ? `正在分析：${text.slice(-260)}` : '正在分析...';
  scrollBottom();
}

function finishThinking(itemId = null) {
  if (itemId) {
    const key = String(itemId);
    turn.thinkingNodes.get(key)?.remove();
    turn.thinkingNodes.delete(key);
    turn.thinkingTexts.delete(key);
    if (turn.thinkingItemId === key) {
      turn.thinkingNode = null;
      turn.thinkingItemId = null;
      turn.thinkingText = '';
    }
    return;
  }
  for (const node of turn.thinkingNodes.values()) node.remove();
  turn.thinkingNodes.clear();
  turn.thinkingNode = null;
  turn.thinkingItemId = null;
  turn.thinkingTexts.clear();
  turn.thinkingText = '';
}

function renderAgent(text, streaming, itemId = null, phase = null) {
  const key = String(itemId || turn.agentItemId || 'agent:default');
  const host = ensureAgentNode(key);
  if (phase) {
    host.dataset.phase = phase;
    host.classList.toggle('commentary', phase === 'commentary');
    host.classList.toggle('final-answer', phase === 'final_answer' || phase === 'final');
  }
  turn.agentTexts.set(key, String(text ?? ''));
  if (key === turn.agentItemId) turn.agentText = String(text ?? '');
  let bubble = $('.bubble', host);
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.className = 'bubble';
    host.prepend(bubble);
  }
  bubble.innerHTML = md(text);
  bubble.classList.toggle('cursor', Boolean(streaming));
  scrollBottom();
}

function ensureToolsBox() {
  let host = turn.toolHost;
  if (!host) {
    host = document.createElement('div');
    host.className = 'msg runtime-events';
    host.dataset.turnId = turn.turnId || '';
    const box = document.createElement('div');
    box.className = 'tools';
    host.appendChild(box);
    els.messages.appendChild(host);
    turn.toolHost = host;
    els.empty.classList.add('hidden');
  }
  let box = $('.tools', host);
  if (!box) {
    box = document.createElement('div');
    box.className = 'tools';
    host.appendChild(box);
  }
  return box;
}

function toolChip(itemId, label, icon = 'wrench') {
  const key = String(itemId || `tool:${turn.tools.size + 1}`);
  const existing = turn.tools.get(key);
  if (existing) return existing;
  const chip = document.createElement('div');
  chip.className = 'toolchip run';
  chip.dataset.itemId = key;
  chip.innerHTML = `<span class="st"><i data-lucide="loader-circle"></i></span><span>${esc(label)}</span>`;
  const svgHost = $('.st', chip);
  svgHost.dataset.icon = icon;
  ensureToolsBox().appendChild(chip);
  turn.tools.set(key, chip);
  refreshIcons(chip);
  const loader = $('svg', chip);
  if (loader) { loader.style.width = '12px'; loader.style.height = '12px'; loader.style.animation = 'spin .75s linear infinite'; }
  return chip;
}

function setChip(itemId, status, statusClass) {
  const chip = turn.tools.get(String(itemId));
  if (!chip) return;
  chip.classList.remove('run');
  if (statusClass) chip.classList.add(statusClass);
  const node = $('.st', chip);
  if (node) node.textContent = status;
}

function asEventRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function eventContext(method, params, envelope = {}) {
  const payload = asEventRecord(params);
  const item = asEventRecord(payload.item);
  const turnInfo = asEventRecord(payload.turn);
  const sessionId = String(envelope.sessionId || payload.threadId || payload.sessionId || asEventRecord(payload.thread).id || turnInfo.threadId || item.threadId || '') || null;
  const runId = String(envelope.runId || payload.turnId || turnInfo.id || item.turnId || '') || null;
  const convId = envelope.convId ? String(envelope.convId) : null;
  const itemId = String(payload.itemId || item.id || '') || null;
  const phase = String(payload.phase || item.phase || '') || null;
  return { method, payload, item, sessionId, runId, convId, itemId, phase };
}

function currentSessionId() {
  return convs.find((conv) => conv.id === curConvId)?.threadId || null;
}

function acceptsEvent(ctx) {
  if (ctx.convId && ctx.convId !== curConvId) return false;
  if (turn.ended && ctx.method !== 'turn/started') return false;
  const sessionId = currentSessionId();
  if (ctx.sessionId && sessionId && ctx.sessionId !== sessionId) return false;
  if (ctx.runId && turn.turnId && ctx.runId !== turn.turnId) return false;
  if (ctx.runId && !turn.turnId && !busy && ctx.method !== 'turn/started') return false;
  if (ctx.sessionId && !turn.sessionId) turn.sessionId = ctx.sessionId;
  if (ctx.runId && !turn.turnId && ctx.method !== 'turn/started') turn.turnId = ctx.runId;
  return true;
}

function eventKey(ctx, envelope = {}) {
  const explicit = envelope.eventId || envelope.event_id || ctx.payload.eventId || ctx.payload.event_id;
  if (explicit) return `id:${String(explicit)}`;
  const sequence = envelope.sequence ?? ctx.payload.sequence;
  if (sequence !== undefined && sequence !== null && sequence !== '') return `seq:${String(sequence)}`;
  return null;
}

function markEventSeen(ctx, envelope = {}) {
  const runtimeId = envelope.runtimeInstanceId || null;
  if (runtimeId && turn.runtimeInstanceId !== runtimeId) {
    turn.runtimeInstanceId = runtimeId;
    turn.seenSequences.clear();
    lastRuntimeSequence = 0;
  }
  const sequenceValue = envelope.sequence ?? ctx.payload.sequence;
  const sequence = Number(sequenceValue);
  if (Number.isFinite(sequence)) {
    if (turn.seenSequences.has(sequence)) return false;
    turn.seenSequences.add(sequence);
    if (sequence <= lastRuntimeSequence) return false;
    lastRuntimeSequence = Math.max(lastRuntimeSequence, sequence);
  }
  const key = eventKey(ctx, envelope);
  if (key) {
    if (turn.seenEventIds.has(key)) return false;
    turn.seenEventIds.add(key);
  }
  return true;
}

function appendStreamDelta(kind, itemId, delta, ctx, envelope = {}) {
  const text = typeof delta === 'string' ? delta : String(delta ?? '');
  if (!text) return '';
  const key = `${kind}:${String(itemId || 'default')}`;
  const explicitIdentity = eventKey(ctx, envelope);
  const previous = turn.lastDeltaByItem.get(key);
  const now = Date.now();
  // Older servers did not expose a sequence. Suppress only an immediate exact
  // retransmission; repeated natural language chunks remain intact.
  if (previous && previous.text === text && now - previous.at < 300) return '';
  turn.lastDeltaByItem.set(key, { text, at: now });
  return text;
}

function outputText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function imageDataUrl(value) {
  const text = outputText(value).trim().replace(/\\(["'])/g, '$1');
  if (!text) return null;
  const dataMatch = text.match(/data:image\/(png|jpeg|jpg|gif|webp);base64,([a-z0-9+/=\s]+)/i);
  if (dataMatch) {
    const body = dataMatch[2].replace(/\s+/g, '');
    if (body.length >= 128 && body.length <= MAX_IMAGE_BASE64) return `data:image/${dataMatch[1].toLowerCase()};base64,${body}`;
  }

  // Command output can contain a short log prefix or a JSON/string wrapper.
  // Start at a known image signature and stop at the first non-base64 byte.
  const signatures = [
    ['iVBORw0KGgo', 'png'],
    ['/9j/', 'jpeg'],
    ['R0lGOD', 'gif'],
    ['UklGR', 'webp'],
  ];
  for (const [signature, mime] of signatures) {
    const start = text.search(new RegExp(signature, 'i'));
    if (start < 0) continue;
    const candidate = text.slice(start).match(/^[a-z0-9+/=\s]+/i)?.[0]?.replace(/\s+/g, '') || '';
    if (candidate.length >= 128 && candidate.length <= MAX_IMAGE_BASE64) return `data:image/${mime};base64,${candidate}`;
  }
  return null;
}

function imagePathUrl(value) {
  const raw = outputText(value).trim().replace(/^file:\/\//i, '');
  if (!raw || raw.length > 4096 || !/\.(?:png|jpe?g|gif|webp)$/i.test(raw)) return null;
  if (/^(?:https?:|blob:|data:)/i.test(raw)) return raw;
  if (/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(raw)) return `/api/runtime-image?path=${encodeURIComponent(raw)}`;
  return null;
}

function findImagePayload(value) {
  const direct = imageDataUrl(value);
  if (direct) return direct;
  const pathUrl = imagePathUrl(value);
  if (pathUrl) return pathUrl;
  const record = asEventRecord(value);
  for (const key of ['dataUrl', 'data_url', 'image', 'imageData', 'image_data', 'base64', 'content', 'output', 'result', 'savedPath', 'saved_path', 'path']) {
    const candidate = record[key];
    const found = imageDataUrl(candidate);
    if (found) return found;
    const candidatePath = imagePathUrl(candidate);
    if (candidatePath) return candidatePath;
  }
  if (typeof value === 'string' && /^[{[]/.test(value.trim())) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && parsed !== value) return findImagePayload(parsed);
    } catch { /* Plain command output, not JSON. */ }
  }
  return null;
}

function toolOutputDetails(chip, label = '查看输出') {
  let details = $('.tool-output', chip);
  if (!details) {
    details = document.createElement('details');
    details.className = 'tool-output';
    const summary = document.createElement('summary');
    summary.textContent = label;
    const body = document.createElement('div');
    body.className = 'tool-output-body';
    details.append(summary, body);
    chip.appendChild(details);
  }
  return { details, body: $('.tool-output-body', details) };
}

function hasRenderedImage(image) {
  if (!image) return false;
  return [...document.querySelectorAll('#messages img.tool-image')].some((node) => (
    node.getAttribute('src') === image || node.src === image
  ));
}

function renderToolOutput(itemId, value, label = '查看输出') {
  const chip = turn.tools.get(String(itemId));
  if (!chip) return;
  const raw = outputText(value);
  if (!raw) return;
  const { body } = toolOutputDetails(chip, label);
  const image = findImagePayload(value) || imageDataUrl(raw);
  body.innerHTML = '';
  if (image) {
    if (hasRenderedImage(image) && !body.querySelector('img.tool-image')) return;
    const img = document.createElement('img');
    img.className = 'tool-image';
    img.alt = '运行时生成的图片';
    img.loading = 'lazy';
    img.src = image;
    body.appendChild(img);
    return;
  }
  const pre = document.createElement('pre');
  const clipped = raw.length > 5000 ? `${raw.slice(0, 5000)}\n…（输出已截断）` : raw;
  pre.textContent = clipped;
  body.appendChild(pre);
}

function bufferToolOutput(itemId, delta, ctx, envelope = {}) {
  const key = String(itemId || 'tool:default');
  const accepted = appendStreamDelta('tool-output', key, delta, ctx, envelope);
  if (!accepted) return;
  const previous = turn.toolOutputs.get(key) || { text: '', truncated: false };
  if (previous.text.length < MAX_STREAM_OUTPUT) {
    const room = MAX_STREAM_OUTPUT - previous.text.length;
    previous.text += accepted.slice(0, room);
    if (accepted.length > room) previous.truncated = true;
  } else {
    previous.truncated = true;
  }
  turn.toolOutputs.set(key, previous);
  const chip = turn.tools.get(key);
  if (chip) {
    chip.dataset.outputBytes = String(previous.text.length);
    if (imageDataUrl(previous.text.slice(0, Math.min(previous.text.length, 512)))) {
      chip.dataset.outputKind = 'image';
    }
  }
}

function renderImageEvent(value, label = '查看图片') {
  const image = findImagePayload(value);
  if (!image) return false;
  const host = turn.toolHost || ensureToolsBox().parentElement;
  const key = `image:${image.slice(0, 96)}`;
  if (hasRenderedImage(image)) {
    turn.imageKeys.add(key);
    return true;
  }
  if (turn.imageKeys.has(key)) return true;
  turn.imageKeys.add(key);
  const chip = document.createElement('div');
  chip.className = 'toolchip ok image-chip';
  chip.dataset.imageKey = key;
  chip.innerHTML = `<span class="st">✓</span><span>${esc(label)}</span>`;
  const details = document.createElement('details');
  details.className = 'tool-output';
  const summary = document.createElement('summary');
  summary.textContent = label;
  const body = document.createElement('div');
  body.className = 'tool-output-body';
  const img = document.createElement('img');
  img.className = 'tool-image';
  img.alt = '运行时生成的图片';
  img.loading = 'lazy';
  img.src = image;
  body.appendChild(img);
  details.append(summary, body);
  chip.appendChild(details);
  ensureToolsBox().appendChild(chip);
  return true;
}

function renderReasoningSummary(itemId, summary) {
  const key = String(itemId || 'reasoning:default');
  const host = turn.agentNode || ensureAgentNode();
  let details = turn.summaryNodes.get(key);
  if (!details) {
    details = document.createElement('details');
    details.className = 'thinking-box';
    details.dataset.itemId = key;
    const summaryNode = document.createElement('summary');
    summaryNode.textContent = '思考摘要';
    const pre = document.createElement('pre');
    details.append(summaryNode, pre);
    host.appendChild(details);
    turn.summaryNodes.set(key, details);
  }
  const pre = $('pre', details);
  if (pre) pre.textContent = outputText(summary).slice(0, 2400);
}

function handleEvt(method, params, envelope = {}) {
  const ctx = eventContext(method, params, envelope);
  // 执行状态按会话记录。非当前窗口的 Agent 可以继续并行运行，切回时仍能
  // 正确显示该会话的忙碌状态，而不会阻塞其他 Agent 的派发。
  if (ctx.convId && method === 'turn/started') { runningConversationIds.add(ctx.convId); renderParallelTaskPanel(); }
  if (ctx.convId && method === 'turn/completed') { runningConversationIds.delete(ctx.convId); renderParallelTaskPanel(); }
  if (ctx.convId && ctx.convId !== curConvId) return;

  if (method === 'turn/started') {
    const sameTurn = turn.started && (!ctx.runId || !turn.turnId || ctx.runId === turn.turnId);
    if (turn.started && ctx.runId && turn.turnId && ctx.runId !== turn.turnId) {
      if (busy && !turn.ended) return;
      resetTurn({ sessionId: ctx.sessionId, turnId: ctx.runId });
    } else if (!sameTurn) {
      resetTurn({ sessionId: ctx.sessionId, turnId: ctx.runId });
    }
    if (!markEventSeen(ctx, envelope)) return;
    turn.started = true;
    turn.ended = false;
    if (ctx.sessionId) turn.sessionId = ctx.sessionId;
    if (ctx.runId) turn.turnId = ctx.runId;
    setBusy(true);
    return;
  }

  if (!acceptsEvent(ctx) || !markEventSeen(ctx, envelope)) return;

  switch (method) {
    case 'turn/completed':
      turn.ended = true;
      setBusy(false);
      finishThinking();
      break;
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta': {
      const itemId = ctx.itemId || turn.thinkingItemId || 'reasoning:default';
      const delta = appendStreamDelta('reasoning', itemId, ctx.payload.delta, ctx, envelope);
      if (!delta) break;
      const text = `${turn.thinkingTexts.get(itemId) || ''}${delta}`.slice(-1200);
      turn.thinkingTexts.set(itemId, text);
      turn.thinkingText = text;
      turn.thinkingItemId = itemId;
      thinkingVisible(itemId);
      break;
    }
    case 'item/reasoning/summaryPartAdded': {
      const itemId = ctx.itemId || 'reasoning:default';
      const part = ctx.payload.summaryPart ?? ctx.payload.part ?? ctx.payload.delta;
      const delta = appendStreamDelta('reasoning', itemId, outputText(part), ctx, envelope);
      if (!delta) break;
      const text = `${turn.thinkingTexts.get(itemId) || ''}${delta}`.slice(-1200);
      turn.thinkingTexts.set(itemId, text);
      turn.thinkingText = text;
      thinkingVisible(itemId);
      break;
    }
    case 'item/agentMessage/delta': {
      const itemId = ctx.itemId || turn.agentItemId || 'agent:default';
      const delta = appendStreamDelta('agent', itemId, ctx.payload.delta, ctx, envelope);
      if (!delta) break;
      finishThinking();
      const text = `${turn.agentTexts.get(itemId) || ''}${delta}`;
      turn.agentTexts.set(itemId, text);
      turn.agentText = text;
      turn.agentItemId = itemId;
      renderAgent(text, true, itemId, ctx.phase);
      break;
    }
    case 'item/commandExecution/outputDelta':
    case 'command/exec/outputDelta':
    case 'process/outputDelta':
    case 'item/fileChange/outputDelta':
      bufferToolOutput(ctx.itemId, ctx.payload.delta ?? ctx.payload.output ?? '', ctx, envelope);
      break;
    case 'item/commandExecution/terminalInteraction':
    case 'item/mcpToolCall/progress': {
      const itemId = ctx.itemId || 'tool:default';
      const item = ctx.item;
      if (!turn.tools.has(itemId)) {
        toolChip(itemId, item.type === 'mcpToolCall' ? `${item.server || '?'}/${item.tool || '?'}` : '命令执行', item.type === 'mcpToolCall' ? 'plug-zap' : 'square-terminal');
      }
      const progress = ctx.payload.message ?? ctx.payload.output ?? ctx.payload.progress ?? ctx.payload.delta;
      if (progress !== undefined) {
        const chip = turn.tools.get(itemId);
        if (chip) chip.dataset.progress = outputText(progress).slice(-240);
      }
      break;
    }
    case 'item/plan/delta':
    case 'turn/plan/updated': {
      const itemId = ctx.itemId || 'plan:default';
      const delta = ctx.payload.delta ?? ctx.payload.plan ?? ctx.payload.steps;
      if (delta !== undefined) {
        if (!turn.tools.has(itemId)) toolChip(itemId, '执行计划', 'list-tree');
        bufferToolOutput(itemId, outputText(delta), ctx, envelope);
      }
      break;
    }
    case 'imageView':
    case 'image/view':
    case 'imageGeneration':
    case 'image/generation':
    case 'item/imageView/updated':
      renderImageEvent(ctx.payload, '运行时图片');
      break;
    case 'item/started': {
      const item = ctx.item;
      const itemId = ctx.itemId || String(item.id || `item:${turn.startedItems.size + 1}`);
      if (turn.startedItems.has(itemId)) break;
      turn.startedItems.add(itemId);
      if (item.type === 'agentMessage') {
        finishThinking();
        turn.agentItemId = itemId;
        renderAgent(turn.agentTexts.get(itemId) || '', true, itemId, ctx.phase || item.phase || null);
      } else if (item.type === 'mcpToolCall') {
        toolChip(itemId, `${item.server || '?'}/${item.tool || '?'}`, 'plug-zap');
      } else if (item.type === 'commandExecution') {
        toolChip(itemId, item.command || '命令执行', 'square-terminal');
      } else if (item.type === 'fileChange') {
        toolChip(itemId, '文件变更', 'file-pen-line');
      }
      break;
    }
    case 'item/completed': {
      const item = ctx.item;
      const itemId = ctx.itemId || String(item.id || '');
      if (turn.completedItems.has(itemId)) {
        if (item.type === 'agentMessage' && item.text && turn.completedItemTexts.get(itemId) !== item.text) {
          turn.completedItemTexts.set(itemId, item.text);
          turn.agentTexts.set(itemId, item.text);
          renderAgent(item.text, false, itemId, item.phase || ctx.phase || null);
        }
        break;
      }
      turn.completedItems.add(itemId);
      if (item.type === 'agentMessage') {
        finishThinking();
        const text = item.text || turn.agentTexts.get(itemId) || (itemId === 'agent:default' ? turn.agentText : '') || '';
        turn.agentTexts.set(itemId, text);
        turn.completedItemTexts.set(itemId, text);
        turn.agentText = text;
        turn.agentItemId = itemId;
        renderAgent(text, false, itemId, item.phase || ctx.phase || null);
      } else if (item.type === 'mcpToolCall') {
        const ok = item.status === 'completed';
        const declined = item.status === 'declined';
        if (!turn.tools.has(itemId)) toolChip(itemId, `${item.server || '?'}/${item.tool || '?'}`, 'plug-zap');
        setChip(itemId, ok ? '✓' : declined ? '—' : '×', ok ? 'ok' : declined ? 'declined' : 'fail');
        if (ok || item.error || item.result !== undefined) renderToolOutput(itemId, ok ? item.result : item.error || '未知错误', ok ? '查看结果' : '查看错误');
      } else if (item.type === 'commandExecution') {
        const ok = item.status === 'completed';
        if (!turn.tools.has(itemId)) toolChip(itemId, item.command || '命令执行', 'square-terminal');
        setChip(itemId, ok ? '✓' : item.status === 'declined' ? '—' : '×', ok ? 'ok' : 'fail');
        const explicitOutput = item.aggregatedOutput ?? item.output ?? item.result ?? item.stdout ?? item.stderr;
        const buffered = turn.toolOutputs.get(itemId)?.text || '';
        const raw = outputText(explicitOutput);
        // Prefer the completed aggregate when it is present; otherwise use the
        // loss-bounded stream buffer. Never put a large base64 blob in a <pre>.
        if (raw && (!buffered || raw.length >= buffered.length)) renderToolOutput(itemId, raw, '查看命令输出');
        else if (buffered) renderToolOutput(itemId, buffered, '查看命令输出');
        renderImageEvent(item, '运行时图片');
      } else if (item.type === 'reasoning' && item.summary) {
        renderReasoningSummary(itemId, item.summary);
      }
      break;
    }
    case 'mcpServer/startupStatus/updated':
      if (ctx.payload.status === 'failed') {
        const name = String(ctx.payload.name || '');
        const detail = ctx.payload.error || ctx.payload.failureReason || '未知错误';
        // Codex may auto-attach the optional remote codex_apps MCP. Its
        // network failure must not mask the local AEOS demo-ERP capability.
        if (name === 'codex_apps') toast('可选远程 MCP 暂不可用，本地 demo-ERP 仍可使用');
        else toast(`MCP 服务器 ${name} 启动失败：${detail}`, true);
      }
      break;
    case 'error':
      toast(`运行时错误：${ctx.payload.error?.message || JSON.stringify(ctx.payload)}`, true);
      break;
    case 'warning':
    case 'configWarning':
      if (ctx.payload.summary || ctx.payload.message) toast(ctx.payload.summary || ctx.payload.message);
      break;
    default:
      break;
  }
  scrollBottom();
}

function updateGuardCount() {
  const total = (guard ? 1 : 0) + guardQueue.length;
  els.guardPending.textContent = String(total);
}

function showGuard(data) {
  if (guard) {
    guardQueue.push(data);
    updateGuardCount();
    return;
  }
  guard = data;
  const params = data.params || {};
  const meta = params._meta || {};
  const isElicitation = data.method === 'mcpServer/elicitation/request';
  const toolTitle = meta.tool_title || params.serverName || '';
  els.guardTitle.textContent = isElicitation ? `MCP 工具授权请求${toolTitle ? ` · ${toolTitle}` : ''}` : '执行审批请求';
  let description = params.message || JSON.stringify(params).slice(0, 300);
  if (meta.tool_params_display?.length) {
    description += ` · ${meta.tool_params_display.map((item) => `${item.display_name || item.name}=${JSON.stringify(item.value)}`).join(', ')}`;
  }
  els.guardDesc.textContent = description;
  els.guardAllow.disabled = false;
  els.guardDeny.disabled = false;
  els.guardBar.classList.remove('hidden');
  updateGuardCount();
}

function decideGuard(decision) {
  if (!guard) return;
  els.guardAllow.disabled = true;
  els.guardDeny.disabled = true;
  send({ type: 'decision', reqId: guard.id, decision });
  guard = null;
  els.guardBar.classList.add('hidden');
  if (guardQueue.length) showGuard(guardQueue.shift());
  else updateGuardCount();
}

function hintFor(providerId) {
  if (providerId === 'openai') return '内置 OpenAI：使用隔离目录中的 ChatGPT 登录凭证或 OPENAI_API_KEY。';
  return '自定义网关：密钥读取隔离目录 .codex-home/.env 中对应 env_key，接口需兼容 OpenAI Responses API。';
}

function renderProviderSelect(current) {
  els.cfgProvider.innerHTML = '';
  const add = (id, label) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    option.selected = id === (current || 'openai');
    els.cfgProvider.appendChild(option);
  };
  add('openai', 'openai（内置 · ChatGPT / API key）');
  providerRows.forEach((row) => add(row.id, row.id));
  els.cfgProviderHint.textContent = hintFor(els.cfgProvider.value);
}

function renderProviders() {
  els.providers.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'prow hint-row';
  head.innerHTML = '<span>ID</span><span>base_url</span><span>env_key</span><span>wire_api</span><span>密钥值</span><span>可切换模型</span><span></span>';
  els.providers.appendChild(head);
  providerRows.forEach((row, index) => {
    const node = document.createElement('div');
    node.className = 'prow';
    const models = (presets[row.id] || []).join(',');
    node.innerHTML = `
      <input class="f-id" value="${esc(row.id)}" aria-label="提供商 ID" />
      <input class="f-url" placeholder="https://api.deepseek.com/v1" value="${esc(row.base_url || '')}" aria-label="网关地址" />
      <input class="f-env" placeholder="DEEPSEEK_API_KEY" value="${esc(row.env_key || '')}" aria-label="环境变量名" />
      <select class="f-wire" aria-label="接口类型"><option value="responses" ${row.wire_api !== 'chat' ? 'selected' : ''}>responses</option><option value="chat" disabled ${row.wire_api === 'chat' ? 'selected' : ''}>chat（当前运行时不支持）</option></select>
      <input class="f-secret" type="password" placeholder="留空不改动" data-key="${esc(row.env_key || '')}" aria-label="密钥值" />
      <input class="f-models" placeholder="deepseek-chat,deepseek-reasoner" value="${esc(models)}" aria-label="可切换模型" />
      <button class="del" type="button" title="删除提供商" aria-label="删除提供商">×</button>`;
    $('.del', node).addEventListener('click', () => { providerRows.splice(index, 1); renderProviders(); });
    els.providers.appendChild(node);
  });
  const keys = els.infoKeys.textContent.split(',').map((item) => item.trim()).filter(Boolean);
  $$('.f-secret', els.providers).forEach((input) => {
    if (input.dataset.key && keys.includes(input.dataset.key)) input.classList.add('has');
  });
}

function fillConfig(payload) {
  providerRows = (payload.providers || []).filter((provider) => provider.id !== 'openai');
  presets = payload.presets || {};
  els.cfgModel.value = payload.model || '';
  els.infoHome.textContent = payload.codexHome || '';
  els.infoConfig.textContent = payload.configFile || '';
  els.infoMcp.textContent = (payload.mcpServers || []).join(', ') || '无';
  const keys = payload.envKeys || [];
  els.infoKeys.textContent = keys.join(', ') || '无';
  renderProviders();
  renderProviderSelect(payload.modelProvider || 'openai');
  els.cfgStatus.textContent = '';
}

function saveConfig() {
  const providers = [];
  const secrets = {};
  const nextPresets = {};
  for (const row of $$('.prow:not(.hint-row)', els.providers)) {
    const get = (selector) => $(selector, row);
    const id = get('.f-id').value.trim();
    const envKey = get('.f-env').value.trim();
    const secret = get('.f-secret').value;
    if (id) {
      providers.push({ id, base_url: get('.f-url').value.trim(), env_key: envKey, wire_api: get('.f-wire').value });
      const models = get('.f-models').value.split(',').map((item) => item.trim()).filter(Boolean);
      if (models.length) nextPresets[id] = models;
    }
    if (envKey && secret) secrets[envKey] = secret;
  }
  els.cfgStatus.textContent = '保存中...';
  els.btnSaveConfig.disabled = true;
  send({ type: 'config:save', payload: { model: els.cfgModel.value.trim(), modelProvider: els.cfgProvider.value, providers, presets: nextPresets, secrets } });
}

function loadConfig() {
  send({ type: 'config:get' });
}

async function loadEvidence() {
  try {
    const response = await fetch('/api/evidence?limit=80');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const rows = Array.isArray(data.rows) ? data.rows : [];
    evidenceRows = rows;
    const today = localDateKey();
    els.evidenceTotal.textContent = String(data.total || 0);
    els.metricEvidence.textContent = String(data.total || 0);
    els.evidenceToday.textContent = String(rows.filter((row) => String(row.occurred_at || '').startsWith(today)).length);
    els.evidencePath.textContent = els.evidencePath.dataset.path || 'data/evidence.jsonl';
    renderEvidenceRows();
  } catch (error) {
    els.evList.innerHTML = '<div class="evidence-empty">证据流暂时不可用</div>';
    toast(`加载证据失败：${error.message}`, true);
  }
}

function syncCurrentConversationBusy() {
  setBusy(Boolean(curConvId && runningConversationIds.has(curConvId)));
}

function evidenceSource(row) {
  if (String(row.method || row.item_type || '').toLowerCase().includes('mcp')) return ['mcp', 'MCP / 数据中台'];
  if (row.kind === 'notification' || row.thread_id || row.turn_id) return ['runtime', 'Codex Runtime'];
  return ['hub', 'AEOS Hub'];
}

function renderEvidenceRows() {
  const query = (els.evidenceSearch?.value || '').trim().toLowerCase();
  const source = els.evidenceSourceFilter?.value || 'all';
  const rows = evidenceRows.filter((row) => {
    const [sourceId] = evidenceSource(row);
    if (source !== 'all' && sourceId !== source) return false;
    if (!query) return true;
    return `${row.event_id || ''} ${row.kind || ''} ${row.method || ''} ${row.summary || ''} ${JSON.stringify(row.payload || '')}`.toLowerCase().includes(query);
  });
  if (els.evidenceFilterCount) els.evidenceFilterCount.textContent = `显示 ${rows.length}/${evidenceRows.length} 条`;
  els.evList.innerHTML = '';
  if (!rows.length) {
    els.evList.innerHTML = '<div class="evidence-empty">没有匹配的证据事件</div>';
    return;
  }
  for (const row of [...rows].reverse()) {
      const node = document.createElement('div');
      node.className = 'ev-row';
      const time = document.createElement('span');
      time.className = 't';
      const occurredAt = row.occurred_at ? new Date(row.occurred_at) : null;
      const ageHours = occurredAt && !Number.isNaN(occurredAt.valueOf()) ? (Date.now() - occurredAt.valueOf()) / 3_600_000 : Number.POSITIVE_INFINITY;
      const freshness = ageHours < 1 ? ['刚刚', 'fresh'] : ageHours < 24 ? ['今日', 'today'] : ['历史', 'old'];
      time.innerHTML = `<span>${esc(occurredAt && !Number.isNaN(occurredAt.valueOf()) ? occurredAt.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '未知时间')}</span><b class="evidence-freshness ${freshness[1]}">${freshness[0]}</b>`;
      const kind = document.createElement('span');
      kind.className = 'k';
      const [sourceId, sourceLabel] = evidenceSource(row);
      const kindLabel = row.kind === 'notification' ? (row.method || row.item_type || 'notification') : (row.kind || 'event');
      kind.innerHTML = `<b class="evidence-source-badge evidence-source-${esc(sourceId)}">${esc(sourceLabel)}</b><span>${esc(kindLabel)}</span>`;
      const summary = document.createElement('span');
      summary.className = 's';
      summary.textContent = row.summary || (row.payload ? JSON.stringify(row.payload).slice(0, 220) : '');
      node.append(time, kind, summary);
      els.evList.appendChild(node);
  }
}

function dashboardCurrency(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '待核实';
  const amount = Math.max(0, Number(value) || 0);
  if (amount >= 10_000) {
    const wan = amount / 10_000;
    return `¥${Number.isInteger(wan) ? wan : wan.toFixed(1)}万`;
  }
  return `¥${amount.toLocaleString('zh-CN')}`;
}

function dashboardDate(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.slice(5) : text || '—';
}

function dashboardQuantity(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function dashboardOrderStatus(value) {
  const text = String(value || '').trim();
  return text || '状态待回传';
}

function dashboardOrderStatusTone(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['已取消', 'cancelled', 'canceled', 'deleted', 'void'].includes(normalized)) return 'critical';
  if (['未审核', '部分关闭'].includes(normalized)) return 'warning';
  if (['已审核', '进行中', '已完成', 'open', 'in_progress', 'processing', 'closed', 'completed', 'complete'].includes(normalized)) return 'running';
  return '';
}

function kittingStatusTone(value) {
  const status = String(value || '').trim().toUpperCase();
  if (status === 'BLOCKED') return 'danger';
  if (status === 'SHORTAGE') return 'warn';
  if (status === 'PARTIAL' || status === 'PENDING') return 'info';
  return 'neutral';
}

function kittingStatusLabel(value) {
  const status = String(value || '').trim().toUpperCase();
  const labels = { BLOCKED: '阻塞', SHORTAGE: '缺料', PARTIAL: '部分齐套', PENDING: '待核算', FULL: '已齐套' };
  return labels[status] || status || '状态待回传';
}

function qualityStatusTone(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'open') return 'danger';
  if (status === 'in_progress') return 'warn';
  if (status === 'closed') return 'neutral';
  return 'info';
}

function qualityStatusLabel(value) {
  const status = String(value || '').trim().toLowerCase();
  const labels = { open: '待处理', in_progress: '处理中', closed: '已关闭' };
  return labels[status] || status || '状态待回传';
}

function attentionLevel(risk) {
  if (risk?.probability !== null && risk?.probability !== undefined && Number.isFinite(Number(risk.probability))) {
    const value = Number(risk.probability);
    if (value >= 0.7) return 'L4';
    if (value >= 0.4) return 'L3';
  }
  if (risk?.riskLevel === '高风险') return 'L4';
  if (risk?.riskLevel === '需关注') return 'L3';
  return 'L2';
}

function attentionOwner(risk) {
  const text = `${risk.summary || ''} ${risk.prompt || ''}`;
  if (/缺料|物料|采购|供应/.test(text)) return '采购 / 计划 Owner';
  if (/ECN|图纸|研发|设计/i.test(text)) return '研发 / 交付 Owner';
  if (/产能|排程|车间|生产/.test(text)) return '计划 / 生产 Owner';
  if (/质量|测试|放行/.test(text)) return '质量 / 交付 Owner';
  return '业务 / 交付 Owner';
}

const attentionStateLabels = { new: '待研判', review: '分析中', owner: '待责任人', closed: '已闭环' };

function recordAttentionTransition(cardId, from, to, reason = '人工拖拽') {
  if (!cardId || from === to) return;
  const timeline = savedMap(ATTENTION_TIMELINE_STORAGE);
  const entries = Array.isArray(timeline[cardId]) ? timeline[cardId] : [];
  entries.push({ from, to, reason, at: new Date().toISOString() });
  timeline[cardId] = entries.slice(-12);
  saveMap(ATTENTION_TIMELINE_STORAGE, timeline);
}

function attentionTimeline(cardId) {
  const timeline = savedMap(ATTENTION_TIMELINE_STORAGE);
  return Array.isArray(timeline[cardId]) ? timeline[cardId] : [];
}

function attentionShouldAutoClose(risk) {
  const status = String(risk?.orderStatus || '').trim().toLowerCase();
  if (risk?.source === 'quality') return ['closed', 'resolved', 'completed', '已关闭', '已解决', '已完成'].includes(status);
  if (risk?.source === 'kitting') return ['full', '已齐套', '齐套完成'].includes(status);
  return ['completed', 'cancelled', 'closed', 'complete', '已完成', '已取消', '已关闭'].includes(status);
}

function dashboardCompletenessText(snapshot) {
  const data = snapshot.dataCompleteness || {};
  const total = Number(data.activeOrderCount) || 0;
  if (!total) return '<span class="dashboard-quality-title">数据完整度</span><span>当前没有可核对的在途订单</span>';
  const risks = Array.isArray(snapshot.risks) ? snapshot.risks : [];
  const item = (label, value, denominator = total) => `<span class="dashboard-quality-item ${Number(value) < denominator ? 'is-gap' : 'is-ok'}"><b>${esc(label)}</b> ${Number(value) || 0}/${denominator}</span>`;
  return `<span class="dashboard-quality-title"><i data-lucide="badge-check"></i>数据完整度</span><span class="dashboard-quality-meta">在途 ${total} 条</span>${item('风险信号', data.riskSignalCount)}${item('真实概率', data.probabilityCount)}${item('风险等级', data.riskLevelCount)}${item('负责人', data.ownerCount)}${item('合同交期', data.dueDateCount)}${item('出货计划', data.shippingPlanCount)}${item('Evidence', data.evidenceRefCount, risks.length || 1)}`;
}

function evidenceStatus(evidenceRef) {
  return evidenceRef ? '证据已关联' : '证据待补充';
}

function riskMissingFields(risk) {
  const missing = [];
  if (risk.source === 'quality') {
    if (!risk.issueNo) missing.push('异常编号未回传');
    if (!risk.defectType) missing.push('缺陷类型未回传');
    if (!risk.owner) missing.push('责任人未回传');
    if (!risk.inspectionResult) missing.push('检验结果未回传');
    if (!risk.evidenceRef) missing.push('evidence_ref 未返回');
    return missing;
  }
  if (risk.source === 'kitting') {
    if (risk.kitRateByItem === null || risk.kitRateByItem === undefined) missing.push('齐套率未回传');
    if (risk.shortageItemCount === null || risk.shortageItemCount === undefined) missing.push('缺料项数未回传');
    if (!risk.estimatedFullKitDate) missing.push('预计齐套日期未回传');
    if (!risk.owner) missing.push('责任人未回传');
    if (!risk.evidenceRef) missing.push('evidence_ref 未返回');
    return missing;
  }
  if (risk.source === 'production') {
    if (!risk.workOrderNo) missing.push('生产工单号未回传');
    if (!risk.orderNo) missing.push('销售订单号未回传');
    if (!risk.orderStatus || risk.orderStatus === 'unknown') missing.push('工单状态未回传或无法识别');
    if (!risk.dueDate) missing.push('计划完工日期未回传');
    if (!risk.evidenceRef) missing.push('evidence_ref 未返回');
    return missing;
  }
  const probabilityKnown = risk.probability !== null && risk.probability !== undefined && Number.isFinite(Number(risk.probability));
  if (!probabilityKnown) missing.push('真实 risk_probability 未回传，当前按风险等级识别');
  if (!risk.riskLevel || risk.riskLevel === '风险等级未知') missing.push('risk_level 未回传或无法识别');
  if (!risk.owner) missing.push('负责人未回传');
  if (!risk.dueDate) missing.push('合同交期未回传');
  if (!risk.shippingPlan) missing.push('出货计划未回传');
  if (!risk.evidenceRef) missing.push('evidence_ref 未返回');
  return missing;
}

function dashboardRiskEntityId(risk) {
  if (risk?.source === 'quality') return String(risk.issueNo || risk.orderNo || '');
  return risk?.source === 'kitting' && risk.demandLineNo ? `${risk.orderNo}:${risk.demandLineNo}` : String(risk?.orderNo || '');
}

function attentionCardId(risk) {
  return `${risk?.source || 'order'}:${risk?.issueNo || risk?.orderNo || ''}`;
}

function riskLinkageHtml(risk) {
  // Production uses work_order_no as its specialist dispatch key while the
  // cross-domain linkage still follows the returned sales order number.
  const orderNo = String((risk.source === 'production' ? risk.salesOrderNo : risk.orderNo) || '').trim();
  if (!orderNo || !dashboardSnapshot) return '';
  const related = (items) => (Array.isArray(items) ? items : []).filter((item) => item && item.orderNo === orderNo && item !== risk);
  const kitting = related(dashboardSnapshot.kittingRisks);
  const quality = related(dashboardSnapshot.qualityRisks);
  const order = related(dashboardSnapshot.risks);
  const entityId = dashboardRiskEntityId(risk);
  const cases = (operatingCenterState.cases || []).filter((item) => item.entityId === orderNo || item.entityId === entityId || item.entityId.startsWith(`${orderNo}:`) || item.evidenceRefs?.includes(risk.evidenceRef));
  const caseIds = new Set(cases.map((item) => item.id));
  const decisions = (operatingCenterState.decisions || []).filter((item) => caseIds.has(item.caseId));
  const attentionHistory = attentionTimeline(attentionCardId(risk) || '');
  const riskItem = (item, icon, label) => `<li><i data-lucide="${icon}"></i><span><b>${esc(label)}</b>${esc(item.summary || item.defectType || item.orderStatus || '风险待研判')}</span><small>${esc(evidenceStatus(item.evidenceRef))}</small></li>`;
  const event = (time, title, detail, ref = '') => `<li><time>${esc(formatHarborTime(time))}</time><span><b>${esc(title)}</b><small>${esc(detail)}</small>${ref ? `<small>${esc(evidenceStatus(ref))}</small>` : ''}</span></li>`;
  const timeline = [
    { time: dashboardSnapshot.generatedAt, title: '风险已同步', detail: `${risk.source === 'order' ? '订单交付' : risk.source === 'kitting' ? '物料齐套' : risk.source === 'production' ? '生产协同' : '异常与质量'}风险进入经营看板`, ref: risk.evidenceRef },
    ...kitting.map((item) => ({ time: item.estimatedFullKitDate || item.dueDate || dashboardSnapshot.generatedAt, title: '关联齐套风险', detail: `${item.orderStatus || '齐套状态待回传'} · 缺料 ${dashboardQuantity(item.shortageItemCount)} 项`, ref: item.evidenceRef })),
    ...quality.map((item) => ({ time: item.occurredAt || dashboardSnapshot.generatedAt, title: '关联质量异常', detail: `${item.issueNo || '异常编号待回传'} · ${item.defectType || item.summary || '异常待研判'}`, ref: item.evidenceRef })),
    ...cases.map((item) => ({ time: item.updatedAt, title: `经营事项：${item.status === 'closed' ? '已闭环' : '处理中'}`, detail: `${item.ownerRole} · 时限 ${item.dueAt}`, ref: item.evidenceRefs?.[0] })),
    ...decisions.map((item) => ({ time: item.createdAt, title: '人工决策已留痕', detail: `${item.actor} · ${item.action}`, ref: '' })),
    ...attentionHistory.map((item) => ({ time: item.at, title: `Attention：${attentionStateLabels[item.to] || item.to}`, detail: item.reason || `${attentionStateLabels[item.from] || item.from} → ${attentionStateLabels[item.to] || item.to}`, ref: '' })),
  ].sort((left, right) => String(right.time || '').localeCompare(String(left.time || ''))).slice(0, 8);
  return `<section class="risk-linkage"><div class="risk-linkage-head"><div><b><i data-lucide="git-merge"></i>关联研判</b><small>按订单号关联当前看板、经营事项与决策记录</small></div><span class="status-pill info">${kitting.length + quality.length + cases.length} 项关联</span></div>
    <div class="risk-linkage-grid"><section><h3>关联齐套与质量</h3><ul>${kitting.slice(0, 3).map((item) => riskItem(item, 'boxes', '齐套')).join('')}${quality.slice(0, 3).map((item) => riskItem(item, 'shield-alert', '质量')).join('')}${order.length && risk.source !== 'order' ? order.slice(0, 2).map((item) => riskItem(item, 'truck', '订单')).join('') : ''}${!kitting.length && !quality.length && !(order.length && risk.source !== 'order') ? '<li class="risk-linkage-empty">当前看板未发现同订单的其他领域风险</li>' : ''}</ul></section><section><h3>Evidence / 事项时间线</h3><ol>${timeline.map((item) => event(item.time, item.title, item.detail, item.ref)).join('') || '<li class="risk-linkage-empty">尚无可关联的事项或证据记录</li>'}</ol></section></div></section>`;
}

function closeDashboardRiskDetail() {
  els.dashboardRiskModal.classList.add('hidden');
  selectedDashboardRisk = null;
  els.dashboardRiskModalStatus.textContent = '';
}

/**
 * Module headers follow the same interaction contract as the quality modal:
 * choose a concrete returned record first, then let the user review its
 * fields/evidence before dispatching to that module's specialist Agent.
 */
function openModuleAgentDetail(source) {
  if (!dashboardSnapshot) {
    toast('经营数据尚未完成同步，请稍后重试', true);
    return;
  }
  if (source === 'production') {
    const row = dashboardSnapshot.productionAssessment?.workOrders?.[0];
    if (row) openDashboardRiskDetail(productionRiskFromRow(row, dashboardSnapshot.productionAssessment, 0));
    else toast('当前没有可派发的生产工单', true);
    return;
  }
  const rows = source === 'order' ? dashboardSnapshot.risks : source === 'kitting' ? dashboardSnapshot.kittingRisks : dashboardSnapshot.qualityRisks;
  if (rows?.[0]) openDashboardRiskDetail(rows[0]);
  else toast(`当前没有可派发的${source === 'order' ? '订单风险' : source === 'kitting' ? '物料齐套异常' : '质量异常'}`, true);
}

function openDashboardRiskDetail(risk) {
  if (!risk) return;
  selectedDashboardRisk = risk;
  const probabilityKnown = risk.probability !== null && risk.probability !== undefined && Number.isFinite(Number(risk.probability));
  const missing = riskMissingFields(risk);
  const field = (label, value, className = '') => `<div class="risk-detail-field ${className}"><span>${esc(label)}</span><strong>${esc(value || '待回传')}</strong></div>`;
  const isKitting = risk.source === 'kitting';
  const isQuality = risk.source === 'quality';
  const isProduction = risk.source === 'production';
  const kicker = $('.modal-head > div > span', els.dashboardRiskModal);
  if (kicker) kicker.textContent = isProduction ? '生产协同详情' : isQuality ? '异常与质量详情' : isKitting ? '物料齐套详情' : '订单风险详情';
  els.dashboardRiskModalTitle.textContent = `${isQuality ? (risk.issueNo || risk.orderNo) : isProduction ? (risk.workOrderNo || risk.orderNo) : risk.orderNo} · ${risk.summary}`;
  els.dashboardRiskModalDesc.textContent = isProduction ? '生产协同中台返回字段与 Evidence 依据；缺失值不会补造。' : isKitting ? '物料齐套中台返回字段与 Evidence 依据；缺失值不会补造。' : isQuality ? '异常与质量中台返回字段与 Evidence 依据；缺失值不会补造。' : '仅展示 company-control 返回字段；缺失值不会补造。';
  els.dashboardRiskDispatch.innerHTML = isProduction
    ? '<i data-lucide="bot-message-square"></i><span>交给生产协同 Agent 分析</span>'
    : isKitting
    ? '<i data-lucide="bot-message-square"></i><span>交给物料齐套 Agent 分析</span>'
    : isQuality
      ? '<i data-lucide="bot-message-square"></i><span>交给异常与质量 Agent 分析</span>'
      : '<i data-lucide="bot-message-square"></i><span>交给风险交付Agent分析</span>';
  const detailFields = isProduction ? `
    ${field('生产工单号', risk.workOrderNo || risk.orderNo, 'mono')}
    ${field('销售订单 / 产品', [risk.salesOrderNo || risk.orderNo, risk.product].filter(Boolean).join(' / ') || '待回传')}
    ${field('工单状态 / 原始状态', [risk.orderStatus, risk.statusRaw].filter(Boolean).join(' / ') || '待回传')}
    ${field('计划完工日期', risk.dueDate || '待回传', 'mono')}
    ${field('车间 / 责任字段', [risk.workshop, risk.owner].filter(Boolean).join(' / ') || '待回传')}
    ${field('工序 / 订单关联', `${risk.operationCount ?? '待回传'} / ${risk.linkedCount ?? '待回传'} 条`)}
    ${field('报工 / 产能', `${risk.reportCount ?? '待回传'} / ${risk.capacityCount ?? '待回传'} 条`)}
    ${field('数据置信度', risk.productionConfidence || '待回传')}` : isQuality ? `
    ${field('异常编号', risk.issueNo || risk.orderNo, 'mono')}
    ${field('关联订单 / 产品', [risk.orderNo, risk.product].filter(Boolean).join(' / ') || '待回传')}
    ${field('缺陷类型 / 提交部门', [risk.defectType, risk.submitDept].filter(Boolean).join(' / ') || '待回传')}
    ${field('严重度 / 检验结果', [risk.riskLevel, risk.inspectionResult].filter(Boolean).join(' / ') || '待回传')}
    ${field('发生时间', risk.occurredAt || '待回传', 'mono')}
    ${field('责任人 / 组织', [risk.owner, risk.ownerOrg].filter(Boolean).join(' / ') || '待指定')}
    ${field('异常状态', qualityStatusLabel(risk.orderStatus))}
    ${field('阻塞标识', risk.blocking === true ? '是' : risk.blocking === false ? '否' : '待回传')}` : `
    ${field('客户 / 产品', [risk.customer, risk.product].filter(Boolean).join(' / ') || '待回传')}
    ${field(isKitting ? '需求数量' : '订单数量', `${dashboardQuantity(risk.orderQty)}${isKitting ? '' : ` · 已完成 ${dashboardQuantity(risk.completedQty)}`}`)}
    ${field('影响金额', dashboardCurrency(risk.amountCny), 'mono')}
    ${field(isKitting ? '齐套率 / 缺料项' : '概率 / 等级', isKitting ? `${dashboardQuantity(risk.kitRateByItem)}% · ${dashboardQuantity(risk.shortageItemCount)} 项` : `${probabilityKnown ? `${Math.round(Number(risk.probability) * 100)}%` : '概率待提供'} · ${risk.riskLevel || '等级待提供'}${risk.riskScore !== null && risk.riskScore !== undefined ? ` · 评分 ${dashboardQuantity(risk.riskScore)}` : ''}`)}
    ${field(isKitting ? '需求日期' : '合同交期', risk.dueDate || '待回传', 'mono')}
    ${field(isKitting ? '预计齐套日期' : '出货计划', isKitting ? (risk.estimatedFullKitDate || '待回传') : (risk.shippingPlan || '待回传'), 'mono')}
    ${field('负责人', risk.owner || '待指定')}
    ${field(isKitting ? '齐套状态' : '订单状态', isKitting ? kittingStatusLabel(risk.orderStatus) : (risk.orderStatus || '状态待回传'))}`;
  els.dashboardRiskModalBody.innerHTML = `<div class="risk-detail-grid">${detailFields}</div>
  <section class="risk-detail-evidence"><div><b>证据状态</b><strong>${esc(evidenceStatus(risk.evidenceRef))}</strong></div><p>${esc(risk.prompt)}</p></section>
  ${riskLinkageHtml(risk)}
  <section class="risk-detail-gaps"><b><i data-lucide="triangle-alert"></i>字段缺失提示</b>${missing.length ? `<ul>${missing.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : '<p>当前展示字段均已回传；仍应以本次工具调用的 evidence_refs 为准。</p>'}</section>`;
  els.dashboardRiskModalStatus.textContent = '';
  els.dashboardRiskDispatch.disabled = false;
  els.dashboardRiskCreateCase.disabled = !risk.evidenceRef;
  els.dashboardRiskModal.classList.remove('hidden');
  refreshIcons(els.dashboardRiskModal);
}

function riskAgentPrompt(risk, agent) {
  const probability = risk.probability !== null && risk.probability !== undefined && Number.isFinite(Number(risk.probability))
    ? `${Math.round(Number(risk.probability) * 100)}%`
    : '中台未提供';
  return `你现在以“${agent.name}”（${agent.role}）身份执行一项只读订单风险分析任务。严格遵循该 Agent 的既有职责边界：仅调用 company-control 的只读能力，不得调用 demo-erp，不得编造或写入业务数据。\n\n任务订单：${risk.orderNo}\n风险事项：${risk.summary}\n影响金额：${dashboardCurrency(risk.amountCny)}\n真实风险概率：${probability}\n风险等级：${risk.riskLevel || '待提供'}\n合同交期：${risk.dueDate || '待回传'}\n出货计划：${risk.shippingPlan || '待回传'}\n负责人：${risk.owner || '待指定'}\nEvidence 线索：${risk.evidenceRef || '工具调用时必须自行返回 evidence_refs'}\n\n请核查并输出：1. 事项；2. evidence_refs 依据；3. 风险/时间/金额影响；4. 建议动作、责任角色与时限；5. 数据置信度。数据缺失时必须明确“数据置信度不足”。`;
}

function kittingAgentProfile(risk) {
  const status = String(risk.orderStatus || '').toUpperCase();
  if (status === 'PENDING') return { pattern: /供给核查/, label: '供给核查 Agent', task: '供给与预计齐套日期核查' };
  if (status === 'BLOCKED' || status === 'SHORTAGE') return { pattern: /缺料处置/, label: '缺料处置 Agent', task: '缺料与库存处置核查' };
  return { pattern: /齐套研判/, label: '齐套研判 Agent', task: '齐套状态研判' };
}

function kittingAgentPrompt(risk, agent) {
  return `你现在以“${agent.name}”（${agent.role}）身份执行一项只读物料齐套分析任务。严格遵循该 Agent 的既有职责边界，仅调用 company-control 的只读能力，不得编造或写入业务数据。\n\n需求对象：${risk.orderNo}\n需求类型：${risk.demandType || '待回传'}\n需求行：${risk.demandLineNo || '待回传'}\n齐套状态：${risk.orderStatus || '待回传'}\n需求日期：${risk.dueDate || '待回传'}\n齐套率：${dashboardQuantity(risk.kitRateByItem)}%\n缺料项数：${dashboardQuantity(risk.shortageItemCount)}\n影响金额：${dashboardCurrency(risk.amountCny)}\n预计齐套日期：${risk.estimatedFullKitDate || '待回传'}\nEvidence 线索：${risk.evidenceRef || '工具调用时必须自行返回 evidence_refs'}\n\n请核查并输出：1. 事项；2. evidence_refs 依据；3. 齐套缺口、库存与供给影响；4. 建议动作、责任角色与时限；5. 数据置信度。涉及金额、采购、替代料或承诺的建议必须标注需人工确认；数据缺失时必须明确数据置信度不足。`;
}

function qualityAgentProfile(risk) {
  if (!risk.owner || !risk.ownerOrg) return { pattern: /质量协同|责任部门/, label: '质量协同 Agent', task: '质量异常责任协同' };
  if (String(risk.orderStatus || '').toLowerCase() === 'in_progress' && (risk.orderNo || risk.product)) return { pattern: /质量追溯/, label: '质量追溯 Agent', task: '异常关联链路追溯' };
  return { pattern: /质量异常研判/, label: '质量异常研判 Agent', task: '质量异常研判' };
}

function qualityAgentPrompt(risk, agent) {
  return `你现在以“${agent.name}”（${agent.role}）身份执行一项只读异常与质量分析任务。严格遵循该 Agent 的既有职责边界，仅调用 company-control 的 quality_issues_list 和 quality_trace，不得编造或写入业务数据。\n\n异常编号：${risk.issueNo || risk.orderNo}\n异常状态：${risk.orderStatus || '待回传'}\n关联订单：${risk.orderNo || '待回传'}\n产品编码：${risk.product || '待回传'}\n缺陷类型：${risk.defectType || '待回传'}\n提交部门：${risk.submitDept || '待回传'}\n发生时间：${risk.occurredAt || '待回传'}\n责任人 / 组织：${[risk.owner, risk.ownerOrg].filter(Boolean).join(' / ') || '待指定'}\nEvidence 线索：${risk.evidenceRef || '工具调用时必须自行返回 evidence_refs'}\n\n请核查并输出：1. 事项；2. evidence_refs 依据；3. 异常影响与关联链路；4. 建议动作、责任角色与时限；5. 数据置信度。涉及质量放行、承诺、金额或法律判断的建议必须标注需人工确认；字段缺失或数据过期时必须明确“数据置信度不足”。`;
}

function productionAgentProfile(risk) {
  const summary = `${risk.summary || ''} ${risk.orderStatus || ''}`;
  if (/工序|进度|阻塞/.test(summary)) return { pattern: /生产进度|生产关联/, label: '生产进度 Agent', task: '生产进度研判' };
  if (/报工|产能|排产/.test(summary)) return { pattern: /报工产能/, label: '报工产能 Agent', task: '报工产能核查' };
  return { pattern: /生产关联|生产证据/, label: '生产证据 Agent', task: '生产证据审阅' };
}

function productionAgentPrompt(risk, agent) {
  return `你现在以“${agent.name}”（${agent.role}）身份执行一项只读生产协同分析任务。仅调用 company-control 的 production_work_orders_list、production_operations_list、production_order_links_list、production_reports_list 和 production_capacity_list，不得修改工单、工序、报工或产能。\n\n生产工单：${risk.workOrderNo || risk.orderNo || '待回传'}\n销售订单：${risk.salesOrderNo || '待回传'}\n事项：${risk.summary || '待回传'}\nEvidence 线索：${risk.evidenceRef || '工具调用时必须自行返回 evidence_refs'}\n\n请输出：1. 事项；2. evidence_refs 依据；3. 工单、工序、订单关联、报工或产能影响；4. 建议动作、责任角色与时限；5. 数据置信度。工序必须以 order_no 为锚点；关联缺失、空结果、过期或低置信度数据必须明确说明。`;
}

function productionRiskFromRow(row, assessment = {}, index = 0) {
  const workOrderNo = String(row.work_order_no || row.work_order_id || '待回传');
  const salesOrderNo = String(row.order_no || '待回传');
  // The specialist dispatch contract uses orderNo as the server-side entity
  // key. Production rows are keyed by work_order_no; retain the sales order
  // separately for the detail card and prompt.
  const orderNo = workOrderNo;
  const status = String(row.status || row.status_raw || 'unknown');
  const evidenceRef = String(row.evidence_ref || (Array.isArray(row.evidence_refs) ? row.evidence_refs[0] || '' : '') || assessment.evidenceRefs?.[index] || assessment.evidenceRefs?.[0] || '');
  return {
    source: 'production', workOrderNo, orderNo, salesOrderNo,
    summary: '生产工单链路核查', customer: '', product: String(row.product_name || row.product_code || ''),
    orderQty: null, completedQty: null, amountCny: null, probability: null, riskScore: null,
    dueDate: String(row.planned_end || row.planned_end_date || ''), shippingPlan: '', owner: String(row.owner || row.responsible_org || ''),
    orderStatus: status, statusRaw: String(row.status_raw || ''), workshop: String(row.workshop || ''), riskLevel: '数据待研判',
    evidenceRef, prompt: `请由生产协同 Agent 分析生产工单 ${workOrderNo}（销售订单 ${salesOrderNo}），核查工单、工序、订单关联、报工和产能，并引用 evidence_refs。`,
    kitRateByItem: null, shortageItemCount: null, shortageQty: null, estimatedFullKitDate: '',
    operationCount: assessment.operationCount, linkedCount: assessment.linkedCount, reportCount: assessment.reportCount,
    capacityCount: assessment.capacityCount, productionConfidence: assessment.confidence,
  };
}

async function dispatchDashboardRiskToAgent() {
  const risk = selectedDashboardRisk;
  if (!risk) return;
  const activeDispatches = riskAgentDispatches.size + (pendingRiskAgentDispatch ? 1 : 0);
  if (activeDispatches >= MAX_PARALLEL_SPECIALIST_DISPATCHES || ws?.readyState !== WebSocket.OPEN) {
    toast(activeDispatches >= MAX_PARALLEL_SPECIALIST_DISPATCHES
      ? `当前已有 ${MAX_PARALLEL_SPECIALIST_DISPATCHES} 个专业 Agent 并行研判，请等待任一任务完成后再派发`
      : '中枢连接未就绪，请稍后重试', true);
    if (!ws || ws.readyState !== WebSocket.OPEN) connect();
    return;
  }
  els.dashboardRiskDispatch.disabled = true;
  const isKitting = risk.source === 'kitting';
  const isQuality = risk.source === 'quality';
  const isProduction = risk.source === 'production';
  const profile = isKitting ? kittingAgentProfile(risk) : isQuality ? qualityAgentProfile(risk) : isProduction ? productionAgentProfile(risk) : { pattern: /订单交付风险/, label: '风险交付Agent', task: '订单风险分析' };
  els.dashboardRiskModalStatus.textContent = `正在定位${profile.label}…`;
  try {
    await Promise.all([loadSquad({ silent: true }), loadHarbor({ silent: true })]);
    const harborAgent = (harbor.agents || []).find((agent) => profile.pattern.test(`${agent.name || ''} ${agent.role || ''}`));
    const member = harborAgent && (squad.members || []).find((item) => item.harborAgentId === harborAgent.id);
    if (!harborAgent || !member) throw new Error(`${profile.label}尚未与 Agent 小队绑定，无法派发`);
    await postSquad('/api/agent-squad/activities', {
      agentId: member.id,
      title: `已接收${profile.task}任务`,
      detail: `${isKitting ? '需求对象' : isQuality ? '质量异常' : isProduction ? '生产对象' : '订单'} ${isQuality ? (risk.issueNo || risk.orderNo) : risk.orderNo} 已由首页派发；Evidence 线索：${risk.evidenceRef || '待运行时核对 evidence_refs'}。`,
    });
    pendingRiskAgentDispatch = {
      harborAgentId: harborAgent.id,
      memberId: member.id,
      squadId: member.squadId,
      orderNo: isQuality ? (risk.issueNo || risk.orderNo) : risk.orderNo,
      evidenceRef: risk.evidenceRef || '',
      taskType: isKitting ? 'kitting' : isQuality ? 'quality' : isProduction ? 'production' : 'order',
      attentionCardId: attentionCardId(risk),
      agentLabel: profile.label,
      prompt: isKitting ? kittingAgentPrompt(risk, harborAgent) : isQuality ? qualityAgentPrompt(risk, harborAgent) : isProduction ? productionAgentPrompt(risk, harborAgent) : riskAgentPrompt(risk, harborAgent),
      choice: { provider: harborAgent.provider, model: harborAgent.model },
    };
    const attentionStates = savedMap(ATTENTION_STORAGE);
    const previousAttentionState = attentionStates[pendingRiskAgentDispatch.attentionCardId] || 'new';
    attentionStates[pendingRiskAgentDispatch.attentionCardId] = 'review';
    saveMap(ATTENTION_STORAGE, attentionStates);
    recordAttentionTransition(pendingRiskAgentDispatch.attentionCardId, previousAttentionState, 'review', '已派发专业 Agent 研判');
    if (dashboardSnapshot) renderAttention(dashboardSnapshot);
    closeDashboardRiskDetail();
    chatScope = { type: 'agent', agentId: member.id, squadId: member.squadId || '', label: `${harborAgent.name} · 专属会话` };
    els.chatViewTitle.textContent = `${harborAgent.name} · 专属会话`;
    els.chatViewDesc.textContent = '由中枢分发的任务会话，只在该 Agent 与所属小队中呈现。';
    els.conversationScopeLabel.textContent = chatScope.label;
    els.chatScopeBack.classList.remove('hidden');
    showView('chat');
    curConvId = null;
    pendingText = pendingRiskAgentDispatch.prompt;
    pendingChoice = pendingRiskAgentDispatch.choice;
    if (!newConversation()) throw new Error('无法创建风险分析会话');
    toast(`已派发 ${isQuality ? (risk.issueNo || risk.orderNo) : risk.orderNo} 给${profile.label}；可继续派发其他 Agent（最多 ${MAX_PARALLEL_SPECIALIST_DISPATCHES} 个并行）`);
  } catch (error) {
    els.dashboardRiskModalStatus.textContent = error.message;
    els.dashboardRiskDispatch.disabled = false;
    toast(`派发${profile.label}失败：${error.message}`, true);
  }
}

function attentionSearchMatch(query, ...values) {
  const needle = String(query || '').trim().toLocaleLowerCase('zh-CN');
  return Boolean(needle) && values.some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(needle));
}

function attentionSearchRiskRows(snapshot) {
  const active = Array.isArray(snapshot?.attentionRisks) ? snapshot.attentionRisks : (Array.isArray(snapshot?.risks) ? snapshot.risks : []);
  const closed = Array.isArray(snapshot?.closedAttentionRisks) ? snapshot.closedAttentionRisks : [];
  const activeIds = new Set(active.map((risk) => attentionCardId(risk)));
  return [...active.slice(0, 50), ...closed.filter((risk) => !activeIds.has(attentionCardId(risk))).slice(0, 50)];
}

function attentionSearchGroup(title, caption, items, emptyText) {
  return `<section class="attention-search-result-section"><header><div><strong>${esc(title)}</strong><small>${esc(caption)}</small></div><b>${items.length}</b></header>${items.length ? `<div class="attention-search-result-list">${items.join('')}</div>` : `<p class="attention-search-empty">${esc(emptyText)}</p>`}</section>`;
}

function attentionLiveCompletionLabel(item) {
  const status = String(item?.risk?.orderStatus || '').trim();
  if (!status) return '<span class="status-pill warn">状态待回传</span>';
  return attentionShouldAutoClose(item.risk)
    ? '<span class="status-pill ok">已完成</span>'
    : '<span class="status-pill info">未完成</span>';
}

function attentionExpandableText(value) {
  const text = String(value || '');
  if (text.length <= 240) return `<strong>${esc(text)}</strong>`;
  return `<strong class="attention-expandable-text">${esc(text)}</strong><button type="button" class="attention-expand-toggle" data-attention-expand-toggle="true" aria-expanded="false">展开完整内容</button>`;
}

function bindAttentionExpandableEntries(scope) {
  $$('[data-attention-expand-toggle]', scope).forEach((button) => button.addEventListener('click', () => {
    const content = button.previousElementSibling;
    const expanded = content?.classList.toggle('is-expanded');
    button.setAttribute('aria-expanded', String(Boolean(expanded)));
    button.textContent = expanded ? '收起内容' : '展开完整内容';
  }));
}

function renderAttentionSearchResults(snapshot) {
  const query = String(attentionFilter.query || '').trim();
  if (!els.attentionSearchResults || !els.attentionResultAttention || !els.attentionResultLive || !els.attentionResultHistory) return;
  if (!query) {
    els.attentionSearchResults.classList.add('hidden');
    els.attentionSearchStatus.textContent = '本地搜索';
    return;
  }
  const risks = attentionSearchRiskRows(snapshot).filter((risk) => attentionSearchMatch(query, risk.orderNo, risk.issueNo, risk.summary, risk.owner, risk.customer, risk.product, risk.evidenceRef, risk.orderStatus));
  const riskCards = risks.slice(0, 20).map((risk, index) => `<article class="attention-search-result-card"><span class="status-pill ${attentionShouldAutoClose(risk) ? 'ok' : 'info'}">${esc(risk.source === 'kitting' ? '物料齐套' : risk.source === 'quality' ? '异常与质量' : '订单交付')}</span><strong>${esc(risk.issueNo || risk.orderNo)} · ${esc(risk.summary)}</strong><small>${esc(risk.orderStatus || '状态待回传')} · ${esc(evidenceStatus(risk.evidenceRef))}</small><button type="button" class="btn ghost compact" data-attention-search-risk-index="${index}">查看详情</button></article>`);
  els.attentionResultAttention.innerHTML = attentionSearchGroup('已关注事项', '当前 Attention 队列及中台已回传的近期闭环事项', riskCards, '没有匹配的 Attention 事项');

  const live = attentionLiveResult?.live;
  const liveCards = Array.isArray(live?.items) ? live.items.map((item, index) => `<article class="attention-search-result-card"><div class="attention-live-result-tags"><span class="status-pill ${item.confidence === 'high' ? 'ok' : 'warn'}">${esc(item.source === 'kitting' ? '物料齐套' : item.source === 'quality' ? '异常与质量' : item.source === 'production' ? '生产协同' : '订单交付')} · ${esc(item.confidence || 'unknown')}</span>${attentionLiveCompletionLabel(item)}</div><strong>${esc(item.title)}</strong><small>${esc(item.summary)}${item.evidenceRefs?.length ? ` · ${esc(item.evidenceRefs.join('、'))}` : ' · 证据待补'}</small><button type="button" class="btn ghost compact" data-attention-live-risk-index="${index}">查看详情</button></article>`) : [];
  const liveCaption = live ? (live.status === 'complete' ? '本次读取完成' : live.status === 'partial' ? `部分完成：${(live.warnings || []).join('；')}` : `暂不可用：${(live.warnings || []).join('；')}`) : '打开“实时核查中台”后按 Enter 发起新的只读查询';
  els.attentionResultLive.innerHTML = attentionSearchGroup('实时中台核查', liveCaption, liveCards, live ? '本次核查未命中；这不代表中台没有其它数据，请调整关键词或查询范围。' : '尚未发起实时核查');

  const historyRows = [
    ...(evidenceRows || []).map((row) => ({ type: 'Evidence', title: row.summary || row.kind || '证据事件', detail: `${row.occurred_at || ''} ${row.item_type || ''}`, action: 'evidence' })),
    ...(squad.squadActivities || []).map((row) => ({ type: '小队动作', title: row.title, detail: `${row.detail || ''} ${row.createdAt || ''}`, action: 'squad' })),
    ...(squad.activities || []).map((row) => ({ type: 'Agent 动作', title: row.title, detail: `${row.detail || ''} ${row.createdAt || ''}`, action: 'squad' })),
    ...(squad.squadMemories || []).map((row) => ({ type: '小队记忆', title: row.content, detail: row.createdAt || '', action: 'squad' })),
    ...(squad.memories || []).map((row) => ({ type: 'Agent 记忆', title: row.content, detail: row.createdAt || '', action: 'squad' })),
  ].filter((row) => attentionSearchMatch(query, row.type, row.title, row.detail)).slice(0, 30);
  const historyCards = historyRows.map((row) => `<article class="attention-search-result-card"><span class="status-pill info">${esc(row.type)}</span>${attentionExpandableText(row.title)}<small>${esc(row.detail)}</small><button type="button" class="btn ghost compact" data-attention-search-target="${esc(row.action)}">查看来源</button></article>`);
  els.attentionResultHistory.innerHTML = attentionSearchGroup('Evidence 与 Agent 动作', '最近证据、专业小队活动与独立记忆', historyCards, '没有匹配的 Evidence 或 Agent 动作');
  els.attentionSearchCaption.textContent = `“${query}”的聚合结果；实时核查仅在手动开启后按 Enter 执行。`;
  els.attentionSearchResults.classList.remove('hidden');

  $$('[data-attention-search-risk-index]', els.attentionResultAttention).forEach((button) => button.addEventListener('click', () => openDashboardRiskDetail(risks[Number(button.dataset.attentionSearchRiskIndex)])));
  $$('[data-attention-live-risk-index]', els.attentionResultLive).forEach((button) => button.addEventListener('click', () => openDashboardRiskDetail(live?.items?.[Number(button.dataset.attentionLiveRiskIndex)]?.risk)));
  $$('[data-attention-search-target]', els.attentionResultHistory).forEach((button) => button.addEventListener('click', () => showView(button.dataset.attentionSearchTarget)));
  bindAttentionExpandableEntries(els.attentionResultHistory);
}

function renderAttention(snapshot) {
  const activeRisks = Array.isArray(snapshot.attentionRisks) ? snapshot.attentionRisks.slice(0, 50) : (Array.isArray(snapshot.risks) ? snapshot.risks.slice(0, 50) : []);
  const closedRisks = Array.isArray(snapshot.closedAttentionRisks) ? snapshot.closedAttentionRisks.slice(0, 50) : [];
  const activeIds = new Set(activeRisks.map((risk) => attentionCardId(risk)));
  const allRisks = [...activeRisks, ...closedRisks.filter((risk) => !activeIds.has(attentionCardId(risk)))];
  const query = String(attentionFilter.query || '').trim().toLowerCase();
  const states = savedMap(ATTENTION_STORAGE);
  let autoClosed = false;
  allRisks.forEach((risk, index) => {
    if (!closedRisks.some((closed) => attentionCardId(closed) === attentionCardId(risk)) && !attentionShouldAutoClose(risk)) return;
    const cardId = attentionCardId(risk) || `${risk.source || 'risk'}:${index}`;
    if (states[cardId] === 'closed') return;
    const previous = states[cardId] || 'new';
    states[cardId] = 'closed';
    recordAttentionTransition(cardId, previous, 'closed', '中台状态已闭环，自动归档');
    autoClosed = true;
  });
  if (autoClosed) saveMap(ATTENTION_STORAGE, states);
  const risks = allRisks.filter((risk, index) => {
    const source = risk.source || 'order';
    const level = attentionLevel(risk);
    const state = states[attentionCardId(risk) || `${source}:${index}`] || 'new';
    if (attentionFilter.source !== 'all' && source !== attentionFilter.source) return false;
    if (attentionFilter.level !== 'all' && level !== attentionFilter.level) return false;
    if (attentionFilter.state !== 'all' && state !== attentionFilter.state) return false;
    if (!query) return true;
    return `${risk.orderNo || ''} ${risk.summary || ''} ${risk.owner || ''}`.toLowerCase().includes(query);
  });
  const warnings = Array.isArray(snapshot.warnings) ? [...snapshot.warnings] : [];
  const domainNames = { order: '订单', kitting: '齐套', quality: '质量', shortage: '缺料' };
  for (const [name, domain] of Object.entries(snapshot.domains || {})) {
    const scope = Object.entries(domain.queryScope || {}).map(([key, value]) => key + '=' + value).join('，');
    warnings.push((domainNames[name] || name) + '：已读取 ' + domain.loaded + '/' + (domain.total ?? '未知') + ' 条' + (domain.partial ? '（部分数据）' : '') + '，数据时间 ' + (domain.dataAsOf || '未知') + (scope ? '，查询范围 ' + scope : ''));
  }
  const riskAssessment = snapshot.riskAssessment || { available: true };
  const kittingAssessment = snapshot.kittingAssessment || { available: false };
  const qualityAssessment = snapshot.qualityAssessment || { available: false };
  const attentionAvailable = Boolean(riskAssessment.available || kittingAssessment.available || qualityAssessment.available);
  const counts = activeRisks.reduce((result, risk) => {
    result[attentionLevel(risk)] += 1;
    return result;
  }, { L4: 0, L3: 0, L2: 0 });
  els.attentionL4Count.textContent = attentionAvailable ? String(counts.L4) : '—';
  els.attentionL3Count.textContent = attentionAvailable ? String(counts.L3) : '—';
  els.attentionL2Count.textContent = attentionAvailable ? String(counts.L2) : '—';
  els.navAttentionCount.textContent = attentionAvailable ? String(snapshot.metrics?.attentionCount ?? activeRisks.length) : '—';
  els.headerAttentionDot.classList.toggle('hidden', risks.length === 0 || !attentionAvailable);
  els.attentionDataStatus.textContent = attentionAvailable ? (warnings.length ? '置信度不足' : `${snapshot.source || 'MCP'} 实时`) : '风险未评估';
  els.attentionDataStatus.className = `status-pill ${attentionAvailable && !warnings.length ? 'ok' : 'warn'}`;

  const columns = [
    ['new', '待研判', 'inbox'], ['review', '分析中', 'scan-search'], ['owner', '待责任人', 'user-round-check'], ['closed', '已闭环', 'circle-check'],
  ];
  const cards = risks.map((risk, index) => {
    const level = attentionLevel(risk);
    const severity = level === 'L4' ? 'high' : level === 'L3' ? 'medium' : 'low';
    const sourceLabel = risk.source === 'kitting' ? '物料齐套' : risk.source === 'quality' ? '异常与质量' : '订单风险';
    const title = `【${sourceLabel}】${risk.orderNo} · ${risk.summary}`;
    const id = attentionCardId(risk) || `${risk.source || 'risk'}:${index}`;
    const state = states[id] || 'new';
    const latestTransition = attentionTimeline(id).at(-1);
    const historyLabel = latestTransition ? `${attentionStateLabels[latestTransition.from] || latestTransition.from} → ${attentionStateLabels[latestTransition.to] || latestTransition.to} · ${formatHarborTime(latestTransition.at)}` : '尚无状态流转记录';
    return { id, state, html: `<article class="kanban-card attention-card" draggable="true" data-card-id="${esc(id)}"><div><b class="severity ${severity}">${level}</b><span>${esc(sourceLabel)}</span></div><strong>${esc(title)}</strong><p>责任：${esc(attentionOwner(risk))} · 时限：${esc(dashboardDate(risk.source === 'quality' ? risk.occurredAt : risk.dueDate))}</p><small>${esc(evidenceStatus(risk.evidenceRef))}</small><small class="attention-card-history"><i data-lucide="history"></i>${esc(historyLabel)}</small><button class="btn secondary compact" type="button" data-attention-risk-index="${index}">查看 / 派发研判</button></article>` };
  });
  if (els.attentionFilterCount) els.attentionFilterCount.textContent = `显示 ${risks.length}/${allRisks.length} 项`;
  els.attentionTable.innerHTML = cards.length ? columns.map(([id, label, icon]) => `<section class="kanban-column" data-kanban-column="${id}"><header><span><i data-lucide="${icon}"></i>${label}</span><b>${cards.filter((card) => card.state === id).length}</b></header><div class="kanban-card-list">${cards.filter((card) => card.state === id).map((card) => card.html).join('')}</div></section>`).join('') : `<div class="dashboard-loading">${esc(allRisks.length && attentionAvailable ? '没有匹配的事项，请调整筛选条件' : (attentionAvailable ? '当前没有需要人工介入的 MCP 风险事项' : (riskAssessment.message || kittingAssessment.message || qualityAssessment.message || '经营风险尚未评估，不能把 0 项当作结论')))}</div>`;
  bindKanbanDrag(els.attentionTable, (cardId, state) => { const next = savedMap(ATTENTION_STORAGE); const previous = next[cardId] || 'new'; next[cardId] = state; saveMap(ATTENTION_STORAGE, next); recordAttentionTransition(cardId, previous, state); renderAttention(snapshot); toast(`事项状态已更新为“${columns.find((item) => item[0] === state)?.[1]}”`); });
  $$('[data-attention-risk-index]', els.attentionTable).forEach((button) => button.addEventListener('click', () => openDashboardRiskDetail(risks[Number(button.dataset.attentionRiskIndex)])));
  renderAttentionSearchResults(snapshot);
  refreshIcons($('#view-attention'));
}

function operatingSourceLabel(source) {
  return source === 'quality' ? '异常与质量' : source === 'kitting' ? '物料齐套' : '订单交付';
}

function operatingStatusLabel(status) {
  return ({ open: ['待确认', 'warn'], in_review: ['分析中', 'info'], awaiting_approval: ['待补充依据', 'warn'], closed: ['已闭环', 'ok'] })[status] || ['未知', 'neutral'];
}

function renderOperatingCenter() {
  const state = operatingCenterState;
  const cases = Array.isArray(state.cases) ? state.cases : [];
  const inbox = Array.isArray(state.inbox) ? state.inbox : [];
  const open = cases.filter((item) => item.status !== 'closed');
  const review = cases.filter((item) => item.status === 'in_review');
  const pending = cases.filter((item) => item.status === 'awaiting_approval');
  const unread = inbox.filter((item) => item.state === 'unread').length;
  els.caseOpenCount.textContent = String(open.length);
  els.caseReviewCount.textContent = String(review.length);
  els.caseApprovalCount.textContent = String(pending.length);
  els.caseInboxCount.textContent = String(unread);
  els.navInboxCount.textContent = String(unread);
  els.navInboxCount.classList.toggle('hidden', unread === 0);

  const sorted = [...cases].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  els.caseList.innerHTML = sorted.length ? sorted.map((item) => {
    const [statusLabel, tone] = operatingStatusLabel(item.status);
    return `<article class="case-card">
      <div class="case-card-top"><span class="case-source ${esc(item.source)}">${esc(operatingSourceLabel(item.source))}</span><span class="case-id mono">${esc(item.entityId)}</span><span class="case-spacer"></span><b class="status-pill ${tone}">${statusLabel}</b></div>
      <strong>${esc(item.title)}</strong><p>${esc(item.summary)}</p>
      <div class="case-meta"><span>责任：${esc(item.ownerRole)}</span><span>时限：${esc(item.dueAt)}</span><span>${esc(evidenceStatus(item.evidenceRefs[0]))}</span></div>
      <div class="case-actions"><button class="btn ghost compact" type="button" data-case-edit="${esc(item.id)}"><i data-lucide="user-pen"></i>更新责任</button>${item.status === 'open' ? '<button class="btn secondary compact" type="button" data-case-decision="acknowledge" data-case-id="' + esc(item.id) + '"><i data-lucide="check"></i>确认受理</button>' : ''}${item.status !== 'closed' ? '<button class="btn secondary compact" type="button" data-case-decision="request_evidence" data-case-id="' + esc(item.id) + '"><i data-lucide="file-search"></i>补充依据</button><button class="btn primary compact" type="button" data-case-decision="approve_analysis" data-case-id="' + esc(item.id) + '"><i data-lucide="scan-search"></i>批准只读分析</button><button class="btn ghost compact" type="button" data-case-decision="close" data-case-id="' + esc(item.id) + '"><i data-lucide="circle-check"></i>人工闭环</button>' : ''}</div>
    </article>`;
  }).join('') : '<div class="dashboard-loading">暂无经营事项。可从风险详情“纳入经营事项”。</div>';
  renderInbox();
  refreshIcons($('#view-cases'));
}

function renderInbox() {
  const inbox = Array.isArray(operatingCenterState.inbox) ? operatingCenterState.inbox.filter((item) => item.kind !== 'autopilot_result') : [];
  const unread = inbox.filter((item) => item.state === 'unread').length;
  const today = localDateKey();
  const decisionCount = inbox.filter((item) => item.kind === 'decision_required').length;
  const todayCount = inbox.filter((item) => String(item.updatedAt || '').startsWith(today)).length;
  const query = (els.inboxSearch?.value || '').trim().toLowerCase();
  const filter = els.inboxFilter?.value || 'all';
  const visible = inbox.filter((item) => {
    if (filter === 'unread' && item.state !== 'unread') return false;
    if (filter === 'decision_required' && item.kind !== filter) return false;
    return !query || `${item.title || ''} ${item.detail || ''} ${item.caseId || ''}`.toLowerCase().includes(query);
  });
  if (els.inboxUnreadMetric) els.inboxUnreadMetric.textContent = String(unread);
  if (els.inboxDecisionMetric) els.inboxDecisionMetric.textContent = String(decisionCount);
  if (els.inboxTodayMetric) els.inboxTodayMetric.textContent = String(todayCount);
  els.inboxUnreadCount.textContent = `${unread} 条未读`;
  els.inboxUnreadCount.className = `status-pill ${unread ? 'warn' : 'ok'}`;
  els.inboxList.innerHTML = visible.length ? [...visible].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map((item) => `<article class="inbox-item ${item.state === 'unread' ? 'unread' : ''}" data-inbox-detail="${esc(item.id)}"><span class="inbox-icon ${esc(item.kind || 'message')}"><i data-lucide="${item.kind === 'decision_required' ? 'shield-alert' : 'clipboard-check'}"></i></span><div><div class="inbox-item-title"><strong>${esc(item.title)}</strong>${item.kind === 'decision_required' ? '<span class="status-pill warn">需决策</span>' : ''}</div><p>${esc(item.detail)}</p><small><i data-lucide="clock-3"></i>${esc(formatHarborTime(item.updatedAt))}${item.caseId ? ` <b>·</b> 事项 ${esc(item.caseId.slice(-8))}` : ''}</small></div><span class="inbox-item-action"><button class="btn ghost compact" type="button" data-inbox-open="${esc(item.id)}">详情</button>${item.state === 'unread' ? `<button class="btn secondary compact" type="button" data-inbox-read="${esc(item.id)}">标记已读</button>` : '<span class="status-pill neutral">已读</span>'}</span></article>`).join('') : `<div class="dashboard-loading">${inbox.length ? '没有匹配的工作消息' : 'Inbox 暂无待办消息'}</div>`;
  refreshIcons($('#view-inbox'));
}

async function loadOperatingCenter(options = {}) {
  try {
    const response = await fetch('/api/operating-center', { headers: { accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    operatingCenterState = data;
    renderOperatingCenter();
    return data;
  } catch (error) {
    els.caseList.innerHTML = `<div class="dashboard-loading">经营事项加载失败：${esc(error.message)}</div>`;
    if (!options.silent) toast(`经营事项加载失败：${error.message}`, true);
    return null;
  }
}

async function loadInbox(options = {}) {
  const data = await loadOperatingCenter({ silent: true });
  if (!data && !options.silent) toast('Inbox 加载失败，请稍后重试', true);
}

async function createOperatingCaseFromRisk() {
  const risk = selectedDashboardRisk;
  if (!risk) return;
  els.dashboardRiskCreateCase.disabled = true;
  try {
    const entityId = risk.source === 'quality' ? (risk.issueNo || risk.orderNo) : risk.source === 'kitting' && risk.demandLineNo ? `${risk.orderNo}:${risk.demandLineNo}` : risk.orderNo;
    const response = await fetch('/api/operating-cases/from-dashboard', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ source: risk.source, entityId, evidenceRef: risk.evidenceRef }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    operatingCenterState = data.snapshot;
    renderOperatingCenter();
    closeDashboardRiskDetail();
    showView('cases');
    toast(data.created?.length ? '已创建待人工确认的经营事项' : '该风险已有未闭环经营事项');
  } catch (error) { els.dashboardRiskModalStatus.textContent = error.message; toast(`纳入经营事项失败：${error.message}`, true); }
  finally { els.dashboardRiskCreateCase.disabled = false; }
}

async function decideOperatingCase(caseId, action) {
  const labels = { acknowledge: '确认受理', request_evidence: '请求补充依据', approve_analysis: '批准只读分析', close: '人工闭环' };
  const note = window.prompt(`${labels[action]}说明（将写入 Evidence；不会执行任何业务操作）：`, action === 'close' ? '已由责任人核实并人工闭环，业务处置另行留档。' : '已由责任人确认，后续业务处置需另行审批。');
  if (!note?.trim()) return;
  const response = await fetch(`/api/operating-cases/${encodeURIComponent(caseId)}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ action, note, actor: dailyQuestionRole() }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  operatingCenterState = data.snapshot; renderOperatingCenter(); toast('人工决策已留痕');
}

async function editOperatingCase(caseId) {
  const item = (operatingCenterState.cases || []).find((candidate) => candidate.id === caseId);
  if (!item) return;
  const ownerRole = window.prompt('责任角色：', item.ownerRole);
  if (ownerRole === null) return;
  const dueAt = window.prompt('处理时限（YYYY-MM-DD）：', item.dueAt);
  if (dueAt === null) return;
  const response = await fetch(`/api/operating-cases/${encodeURIComponent(caseId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ ownerRole, dueAt }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  operatingCenterState = data.snapshot; renderOperatingCenter(); toast('责任与时限已更新');
}

async function markInboxRead(id) {
  const response = await fetch(`/api/inbox/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ state: 'read' }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  operatingCenterState = data.snapshot; renderOperatingCenter();
}

function openInboxDetail(id) {
  const item = (operatingCenterState.inbox || []).find((candidate) => candidate.id === id);
  if (!item || !els.inboxDetailModal) return;
  selectedInboxItemId = item.id;
  els.inboxDetailTitle.textContent = item.title || 'Inbox 工作消息';
  els.inboxDetailMeta.textContent = `${item.kind === 'decision_required' ? '需要人工决策' : '工作消息'} · ${formatHarborTime(item.updatedAt)}${item.caseId ? ` · 事项 ${item.caseId}` : ''}`;
  els.inboxDetailBody.innerHTML = `<div class="inbox-detail-callout ${item.state === 'unread' ? 'unread' : ''}"><i data-lucide="${item.kind === 'decision_required' ? 'shield-alert' : 'inbox'}"></i><span>${item.state === 'unread' ? '尚未阅读' : '已读'} · 个人工作台状态</span></div><div class="inbox-detail-section"><b>消息内容</b><p>${esc(item.detail || '未提供详细说明')}</p></div>${item.caseId ? `<div class="inbox-detail-section"><b>关联经营事项</b><code>${esc(item.caseId)}</code><small>可前往“经营事项”查看责任人、依据与决策时间线。</small></div>` : ''}${item.evidenceRef ? `<div class="inbox-detail-section"><b>Evidence</b><strong>${esc(evidenceStatus(item.evidenceRef))}</strong></div>` : ''}`;
  els.inboxDetailStatus.textContent = item.state === 'unread' ? '标记已读不会改变业务事项状态' : '该消息已完成阅读';
  els.inboxDetailRead.classList.toggle('hidden', item.state !== 'unread');
  els.inboxDetailModal.classList.remove('hidden');
  refreshIcons(els.inboxDetailModal);
}

function closeInboxDetail() {
  selectedInboxItemId = null;
  els.inboxDetailModal?.classList.add('hidden');
}

async function markAllInboxRead() {
  const unread = (operatingCenterState.inbox || []).filter((item) => item.state === 'unread');
  if (!unread.length) { toast('Inbox 当前没有未读消息'); return; }
  els.btnInboxReadAll.disabled = true;
  try {
    for (const item of unread) await markInboxRead(item.id);
    toast(`已标记 ${unread.length} 条消息为已读`);
  } catch (error) {
    toast(`批量标记已读失败：${error.message}`, true);
  } finally {
    els.btnInboxReadAll.disabled = false;
  }
}

function renderDashboard(snapshot) {
  dashboardSnapshot = snapshot;
  const metrics = snapshot.metrics || {};
  const risks = Array.isArray(snapshot.risks) ? snapshot.risks : [];
  const futureRisks = Array.isArray(snapshot.attentionRisks) ? snapshot.attentionRisks : risks;
  const kittingRisks = Array.isArray(snapshot.kittingRisks) ? snapshot.kittingRisks : [];
  const qualityRisks = Array.isArray(snapshot.qualityRisks) ? snapshot.qualityRisks : [];
  const productionAssessment = snapshot.productionAssessment || { available: false, workOrderCount: 0, inProgressCount: 0, operationCount: 0, linkedCount: 0, reportCount: 0, capacityCount: 0, workOrders: [] };
  const decisions = Array.isArray(snapshot.decisions) ? snapshot.decisions : [];
  const mcpServers = Array.isArray(snapshot.mcpServers) ? snapshot.mcpServers : [];
  const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
  const riskAssessment = snapshot.riskAssessment || { available: true };
  const attentionAvailable = Boolean(riskAssessment.available || snapshot.kittingAssessment?.available || snapshot.qualityAssessment?.available || productionAssessment.available);
  const domainLabels = { order: '订单', shortage: '缺料', kitting: '齐套', quality: '质量', production: '生产协同' };
  const domainAsOf = Object.entries(snapshot.domains || {})
    .map(([name, domain]) => `${domainLabels[name] || name} ${domain?.dataAsOf ? formatHarborTime(domain.dataAsOf) : '未回传'}`)
    .join(' · ');
  const refreshedAt = snapshot.refreshedAt ? formatHarborTime(snapshot.refreshedAt) : (snapshot.generatedAt ? formatHarborTime(snapshot.generatedAt) : '刚刚');
  const asOf = snapshot.dataAsOf ? formatHarborTime(snapshot.dataAsOf) : '数据基准未回传';
  els.dashboardDataCaption.textContent = `AEOS V7.2 · 服务主动刷新 · 刷新 ${refreshedAt} · 中控数据基准 ${domainAsOf || '未回传'}${snapshot.businessData?.confidence !== 'high' ? ' · 数据置信度需关注' : ''}`;
  els.metricCapabilities.textContent = String(metrics.capabilityCount ?? 0);
  els.metricCapabilitiesCaption.textContent = `项 · ${metrics.mcpServerCount ?? 0} 个 MCP Server`;
  els.metricHighRisks.textContent = riskAssessment.available ? String(metrics.highRiskCount ?? 0) : '—';
  els.metricHighRisksCaption.textContent = riskAssessment.available ? `项 · ${snapshot.source || 'MCP'} 实时结果` : '风险未评估 · 缺少风险字段';
  els.metricAttention.textContent = attentionAvailable ? String(metrics.attentionCount ?? 0) : '—';
  const hasUnknownProbability = risks.some((risk) => risk.probability === null || risk.probability === undefined);
  els.metricAttentionCaption.textContent = attentionAvailable
    ? `风险事件 · 涉及 ${snapshot.attentionSummary?.businessObjects ?? '—'} 个业务对象`
    : '风险未评估 · 不显示 0 项结论';
  els.dashboardRiskCaption.textContent = `未来 60 天 · 仅订单交付风险 · ${snapshot.source || 'MCP Runtime'} · ${asOf}`;
  els.dashboardDataQuality.innerHTML = dashboardCompletenessText(snapshot);

  els.dashboardFutureCaption.textContent = `订单交付、物料齐套与质量异常 · ${futureRisks.length} 项待关注 · ${snapshot.source || 'MCP Runtime'} · ${asOf}`;
  const futureHead = '<div class="future-window-row future-window-head"><span>来源 / 风险事项</span><span>需求对象</span><span>影响金额</span><span>风险信号</span><span>交期 / 需求日期</span><span>责任人</span></div>';
  const futureRows = futureRisks.slice(0, 5).map((risk, index) => {
    const isKitting = risk.source === 'kitting';
    const isQuality = risk.source === 'quality';
    const sourceLabel = isKitting ? '物料齐套' : isQuality ? '异常与质量' : '订单交付';
    const signal = isKitting ? kittingStatusLabel(risk.orderStatus) : isQuality ? qualityStatusLabel(risk.orderStatus) : (risk.riskLevel || '风险待评估');
    const tone = isKitting ? kittingStatusTone(risk.orderStatus) : isQuality ? qualityStatusTone(risk.orderStatus) : (attentionLevel(risk) === 'L4' ? 'danger' : 'warn');
    return `<button class="future-window-row" type="button" data-dashboard-future-index="${index}" title="查看风险字段、Evidence 依据与对应 Agent 派发入口">
      <span><small class="status-pill ${tone}">${esc(sourceLabel)}</small><b>${esc(risk.summary)}</b></span>
      <span><b>${esc(isQuality ? (risk.issueNo || risk.orderNo) : risk.orderNo)}</b><small>${esc(isKitting ? '物料齐套需求' : isQuality ? ([risk.orderNo, risk.product].filter(Boolean).join(' / ') || '质量异常') : (risk.customer || '订单交付需求'))}</small></span>
      <span class="mono">${dashboardCurrency(risk.amountCny)}</span>
      <span><b>${esc(signal)}</b><small>${isKitting ? `齐套率 ${dashboardQuantity(risk.kitRateByItem)}%` : isQuality ? (risk.defectType || '缺陷类型待回传') : (risk.probability === null || risk.probability === undefined ? '概率待提供' : `概率 ${Math.round(Number(risk.probability) * 100)}%`)}</small></span>
      <span class="mono">${esc(dashboardDate(isQuality ? risk.occurredAt : risk.dueDate))}</span>
      <span>${esc(risk.owner || attentionOwner(risk))}</span>
    </button>`;
  }).join('');
  els.dashboardFutureTable.innerHTML = futureHead + (futureRows || `<div class="dashboard-loading">${esc(attentionAvailable ? '当前暂无订单交付、物料齐套或质量异常' : '经营风险尚未完成评估')}</div>`);

  const orderHighRiskCount = risks.filter((risk) => attentionLevel(risk) === 'L4').length;
  const orderAffectedAmount = risks.length && risks.every((risk) => risk.amountCny !== null && risk.amountCny !== undefined) ? risks.reduce((total, risk) => total + Number(risk.amountCny), 0) : null;
  const probabilityKnownCount = risks.filter((risk) => risk.probability !== null && risk.probability !== undefined && Number.isFinite(Number(risk.probability))).length;
  els.dashboardOrderMetrics.innerHTML = riskAssessment.available
    ? `<div class="order-risk-metric ${orderHighRiskCount ? 'danger' : ''}"><span>高风险订单</span><strong>${orderHighRiskCount}</strong><small>L4 风险等级</small></div>
       <div class="order-risk-metric ${risks.length ? 'warn' : ''}"><span>交付风险订单</span><strong>${risks.length}</strong><small>仅在途订单</small></div>
       <div class="order-risk-metric ${orderAffectedAmount ? 'danger' : ''}"><span>受影响金额</span><strong>${dashboardCurrency(orderAffectedAmount)}</strong><small>订单金额非预计损失；缺值不求和</small></div>
       <div class="order-risk-metric"><span>真实概率覆盖</span><strong>${probabilityKnownCount}/${risks.length}</strong><small>${risks.length ? '中控 risk_probability 回传' : '当前无风险订单'}</small></div>`
    : `<div class="order-risk-metric"><span>订单风险数据</span><strong>—</strong><small>${esc(riskAssessment.message || '尚未完成评估')}</small></div>`;

  const riskHead = '<div class="table-row table-head"><span>风险事项</span><span>客户 / 产品</span><span>订单数量</span><span>影响金额</span><span>概率 / 等级</span><span>合同交期 / 出货计划</span><span>负责人</span><span>订单状态</span></div>';
  const riskRows = risks.slice(0, 5).map((risk, index) => {
    const probabilityKnown = risk.probability !== null && risk.probability !== undefined && Number.isFinite(Number(risk.probability));
    const high = attentionLevel(risk) === 'L4';
    const probabilityText = probabilityKnown ? `${Math.round(Number(risk.probability) * 100)}%` : '待提供';
    const riskDetail = [risk.riskLevel, risk.riskScore !== null && risk.riskScore !== undefined ? `评分 ${dashboardQuantity(risk.riskScore)}` : ''].filter(Boolean).join(' · ');
    const statusTone = dashboardOrderStatusTone(risk.orderStatus);
    return `<button class="table-row" type="button" data-dashboard-risk-index="${index}" title="查看订单字段、Evidence 依据与缺失提示">
      <span><b>${esc(risk.orderNo)}</b><small>${esc(risk.summary)}</small></span>
      <span class="risk-customer-product"><b>${esc(risk.customer || '—')}</b><small>${esc(risk.product || '—')}</small></span>
      <span class="risk-quantity mono"><b>${esc(dashboardQuantity(risk.orderQty))}</b><small>已完成 ${esc(dashboardQuantity(risk.completedQty))}</small></span>
      <span class="mono">${dashboardCurrency(risk.amountCny)}</span>
      <span class="risk-signal mono ${high ? 'danger-text' : 'warning-text'}"><b>${esc(probabilityText)}</b><small>${esc(riskDetail)}</small></span>
      <span class="risk-dates mono"><b>${esc(dashboardDate(risk.dueDate))}</b><small>出货计划 ${esc(dashboardDate(risk.shippingPlan))}</small></span>
      <span>${esc(risk.owner || '待指定')}</span>
      <span><i class="status-dot ${statusTone}"></i>${esc(dashboardOrderStatus(risk.orderStatus))}</span>
    </button>`;
  }).join('');
  els.dashboardRiskTable.innerHTML = riskHead + (riskRows || `<div class="dashboard-loading">${esc(riskAssessment.message || (riskAssessment.available ? '当前窗口没有返回风险订单' : '订单风险尚未评估'))}</div>`);

  const kittingAssessment = snapshot.kittingAssessment || { available: false, shortageCount: 0 };
  const blockedCount = kittingRisks.filter((risk) => String(risk.orderStatus).toUpperCase() === 'BLOCKED').length;
  const shortageCount = kittingRisks.filter((risk) => ['BLOCKED', 'SHORTAGE'].includes(String(risk.orderStatus).toUpperCase())).length;
  const shortageItems = kittingRisks.reduce((total, risk) => total + Math.max(0, Number(risk.shortageItemCount) || 0), 0);
  // An order amount may repeat across demand lines: avoid summing it as independent loss.
  const affectedAmount = null;
  els.dashboardKittingMetrics.innerHTML = kittingAssessment.available
    ? `<div class="kitting-metric ${blockedCount ? 'danger' : ''}"><span>阻塞需求</span><strong>${blockedCount}</strong><small>BLOCKED 状态</small></div>
       <div class="kitting-metric ${shortageCount ? 'warn' : ''}"><span>缺料异常</span><strong>${shortageCount}</strong><small>BLOCKED / SHORTAGE</small></div>
       <div class="kitting-metric ${shortageItems ? 'warn' : ''}"><span>缺料项数</span><strong>${shortageItems || '—'}</strong><small>${shortageItems ? '中控已回传' : '待中控回传'}</small></div>
       <div class="kitting-metric ${affectedAmount ? 'danger' : ''}"><span>受影响金额</span><strong>${dashboardCurrency(affectedAmount)}</strong><small>跨需求行金额需人工核定</small></div>`
    : `<div class="kitting-metric"><span>齐套数据</span><strong>—</strong><small>${esc(kittingAssessment.message || '尚未完成评估')}</small></div>`;
  els.dashboardKittingCaption.textContent = kittingAssessment.available
    ? `当前查询窗口 · ${kittingRisks.length} 项非 FULL 齐套结果 · ${snapshot.source || 'MCP Runtime'} · ${asOf}`
    : (kittingAssessment.message || '齐套数据尚未完成评估');
  const kittingHead = '<div class="kitting-row kitting-head"><span>需求对象 / 齐套状态</span><span>需求日期 / 预计齐套</span><span>齐套率 / 缺料项</span><span>影响金额</span><span>责任人</span><span>证据状态</span></div>';
  const kittingRows = kittingRisks.slice(0, 5).map((risk, index) => `<button class="kitting-row" type="button" data-dashboard-kitting-index="${index}" title="查看齐套异常字段、Evidence 依据与缺失提示">
      <span><b>${esc(risk.orderNo)}</b><small class="status-pill ${kittingStatusTone(risk.orderStatus)} kitting-status">${esc(kittingStatusLabel(risk.orderStatus))}</small></span>
      <span class="mono"><b>${esc(dashboardDate(risk.dueDate))}</b><small>预计 ${esc(dashboardDate(risk.estimatedFullKitDate))}</small></span>
      <span class="mono"><b>${esc(dashboardQuantity(risk.kitRateByItem))}%</b><small>缺料 ${esc(dashboardQuantity(risk.shortageItemCount))} 项</small></span>
      <span class="mono">${dashboardCurrency(risk.amountCny)}</span>
      <span>${esc(risk.owner || '待指定')}</span>
      <span><small>${esc(evidenceStatus(risk.evidenceRef))}</small></span>
    </button>`).join('');
  const kittingEmpty = kittingAssessment.available
    ? '当前查询窗口没有非 FULL 的物料齐套结果'
    : (kittingAssessment.message || '齐套数据尚未完成评估');
  els.dashboardKittingTable.innerHTML = kittingHead + (kittingRows || `<div class="dashboard-loading">${esc(kittingEmpty)}</div>`);

  const qualityAssessment = snapshot.qualityAssessment || { available: false, openCount: 0 };
  const openQualityCount = qualityRisks.filter((risk) => String(risk.orderStatus).toLowerCase() === 'open').length;
  const inProgressQualityCount = qualityRisks.filter((risk) => String(risk.orderStatus).toLowerCase() === 'in_progress').length;
  const qualityOwnerCount = qualityRisks.filter((risk) => risk.owner || risk.ownerOrg).length;
  const qualityEvidenceCount = qualityRisks.filter((risk) => risk.evidenceRef).length;
  els.dashboardQualityMetrics.innerHTML = qualityAssessment.available
    ? `<div class="quality-metric ${openQualityCount ? 'danger' : ''}"><span>待处理异常</span><strong>${openQualityCount}</strong><small>OPEN 状态</small></div>
       <div class="quality-metric ${inProgressQualityCount ? 'warn' : ''}"><span>处理中异常</span><strong>${inProgressQualityCount}</strong><small>IN_PROGRESS 状态</small></div>
       <div class="quality-metric"><span>责任覆盖</span><strong>${qualityOwnerCount}/${qualityRisks.length}</strong><small>责任人或责任组织已回传</small></div>
       <div class="quality-metric"><span>Evidence 覆盖</span><strong>${qualityEvidenceCount}/${qualityRisks.length}</strong><small>可穿透证据链</small></div>`
    : `<div class="quality-metric"><span>质量异常数据</span><strong>—</strong><small>${esc(qualityAssessment.message || '尚未完成评估')}</small></div>`;
  els.dashboardQualityCaption.textContent = qualityAssessment.available
    ? `当前查询窗口 · ${qualityRisks.length} 项未关闭质量异常 · ${snapshot.source || 'MCP Runtime'} · ${asOf}`
    : (qualityAssessment.message || '异常与质量数据尚未完成评估');
  const qualityHead = '<div class="quality-row quality-head"><span>异常编号 / 状态</span><span>关联订单 / 产品</span><span>缺陷类型 / 提交部门</span><span>发生时间</span><span>责任人 / 组织</span><span>证据状态</span></div>';
  const qualityRows = qualityRisks.slice(0, 5).map((risk, index) => `<button class="quality-row" type="button" data-dashboard-quality-index="${index}" title="查看质量异常字段、Evidence 依据与对应 Agent 派发入口">
      <span><b>${esc(risk.issueNo || risk.orderNo)}</b><small class="status-pill ${qualityStatusTone(risk.orderStatus)} kitting-status">${esc(qualityStatusLabel(risk.orderStatus))}</small></span>
      <span><b>${esc(risk.orderNo || '—')}</b><small>${esc(risk.product || '产品待回传')}</small></span>
      <span><b>${esc(risk.defectType || '待回传')}</b><small>${esc(risk.submitDept || '提交部门待回传')}</small></span>
      <span class="mono">${esc(dashboardDate(risk.occurredAt))}</span>
      <span><b>${esc(risk.owner || '待指定')}</b><small>${esc(risk.ownerOrg || '责任组织待回传')}</small></span>
      <span><small>${esc(evidenceStatus(risk.evidenceRef))}</small></span>
    </button>`).join('');
  const qualityEmpty = qualityAssessment.available
    ? '当前查询窗口没有未关闭的质量异常'
    : (qualityAssessment.message || '异常与质量数据尚未完成评估');
  els.dashboardQualityTable.innerHTML = qualityHead + (qualityRows || `<div class="dashboard-loading">${esc(qualityEmpty)}</div>`);

  const productionConfidence = productionAssessment.confidence || 'unknown';
  const productionTone = productionConfidence === 'high' ? '' : productionConfidence === 'medium' ? 'warn' : 'danger';
  els.dashboardProductionMetrics.innerHTML = productionAssessment.available
    ? `<div class="quality-metric ${productionAssessment.inProgressCount ? 'warn' : ''}"><span>进行中工单</span><strong>${productionAssessment.inProgressCount}</strong><small>工单总数 ${productionAssessment.workOrderCount}</small></div>
       <div class="quality-metric"><span>工序记录</span><strong>${productionAssessment.operationCount}</strong><small>按订单号锚定</small></div>
       <div class="quality-metric"><span>订单关联</span><strong>${productionAssessment.linkedCount}</strong><small>工单 / 销售订单</small></div>
       <div class="quality-metric ${productionTone}"><span>报工 / 产能</span><strong>${productionAssessment.reportCount} / ${productionAssessment.capacityCount}</strong><small>置信度 ${esc(productionConfidence)}</small></div>`
    : `<div class="quality-metric"><span>生产协同数据</span><strong>—</strong><small>${esc(productionAssessment.message || '尚未完成评估')}</small></div>`;
  els.dashboardProductionCaption.textContent = productionAssessment.available
    ? `工单 ${productionAssessment.workOrderCount} 条 · 工序 ${productionAssessment.operationCount} 条 · 关联 ${productionAssessment.linkedCount} 条 · ${snapshot.source || 'MCP Runtime'} · ${productionAssessment.dataAsOf ? formatHarborTime(productionAssessment.dataAsOf) : '时效待回传'}`
    : (productionAssessment.message || '生产协同数据尚未完成评估');
  const productionHead = '<div class="quality-row quality-head"><span>工单号 / 状态</span><span>销售订单 / 产品</span><span>计划完工</span><span>车间</span><span>责任字段</span><span>证据状态</span></div>';
  const productionRows = (Array.isArray(productionAssessment.workOrders) ? productionAssessment.workOrders : []).slice(0, 5).map((row, index) => {
    const workOrderNo = String(row.work_order_no || row.work_order_id || '待回传');
    const status = String(row.status || row.status_raw || 'unknown');
    const orderNo = String(row.order_no || '待回传');
    const evidence = String(row.evidence_ref || (Array.isArray(row.evidence_refs) ? row.evidence_refs[0] || '' : '') || productionAssessment.evidenceRefs?.[index] || productionAssessment.evidenceRefs?.[0] || '');
    return `<button class="quality-row production-row" type="button" data-production-index="${index}" title="查看生产协同详情并交给生产协同 Agent 分析"><span><b>${esc(workOrderNo)}</b><small class="status-pill ${status.toLowerCase() === 'in_progress' ? 'warn' : 'info'} kitting-status">${esc(status)}</small></span><span><b>${esc(orderNo)}</b><small>${esc(row.product_name || row.product_code || '产品待回传')}</small></span><span class="mono">${esc(row.planned_end || row.planned_end_date || '待回传')}</span><span>${esc(row.workshop || '待回传')}</span><span>${esc(row.owner || row.responsible_org || '待回传')}</span><span><small>${esc(evidenceStatus(evidence))}</small></span></button>`;
  }).join('');
  els.dashboardProductionTable.innerHTML = productionHead + (productionRows || `<div class="dashboard-loading">${esc(productionAssessment.available ? '当前查询窗口没有生产工单结果' : (productionAssessment.message || '生产协同数据尚未完成评估'))}</div>`);

  els.dashboardDecisionList.innerHTML = decisions.map((decision) => `
    <button class="decision-row" type="button" data-dashboard-prompt="${esc(decision.prompt)}">
      <span class="severity ${decision.level === 'L4' ? 'high' : 'medium'}">${esc(decision.level)}</span>
      <div><strong>${esc(decision.title)}</strong><small>${esc(decision.detail)}</small></div>
      <code>${decision.probability === null || decision.probability === undefined ? '概率待提供' : `${Math.round(Number(decision.probability) * 100)}%`}</code><i data-lucide="chevron-right"></i>
    </button>`).join('') || `<div class="dashboard-loading">${esc(riskAssessment.available ? '当前没有需要升级的 TOP 决策' : '风险未评估，暂不生成 TOP 决策')}</div>`;

  const connectedServers = mcpServers.filter((server) => server.statusTone === 'ok').length;
  const serverNames = mcpServers.map((server) => `${server.name}(${server.capabilityCount})`).join(' · ') || '尚未注册 MCP';
  const mcpTone = connectedServers === mcpServers.length && mcpServers.length ? 'ok' : 'warn';
  els.dashboardPulseList.innerHTML = `
    <div><span class="pulse-icon"><i data-lucide="bot"></i></span><span><strong>Agent Runtime</strong><small>会话、推理、工具调用与 Trace</small></span><b class="status-pill ok">运行中</b></div>
    <div><span class="pulse-icon"><i data-lucide="shield-check"></i></span><span><strong>AEOS Guard</strong><small>审批、只读边界与 Evidence 落库</small></span><b class="status-pill ok">已启用</b></div>
    <div><span class="pulse-icon"><i data-lucide="database"></i></span><span><strong>Evidence Store</strong><small>JSONL 试点存储 · 后续对接 EDP</small></span><b class="status-pill info">试点</b></div>
    <div><span class="pulse-icon"><i data-lucide="plug-zap"></i></span><span><strong>MCP Capability</strong><small>${esc(serverNames)}</small></span><b class="status-pill ${mcpTone}">${connectedServers}/${mcpServers.length} 在线</b></div>`;
  refreshIcons($('#view-dashboard'));
  renderAttention(snapshot);
}

async function loadDashboard(options = {}) {
  if (dashboardLoading) return;
  dashboardLoading = true;
  try {
    const response = await fetch(`/api/dashboard${options.force ? '?refresh=1' : ''}`, { headers: { accept: 'application/json' } });
    const snapshot = await response.json();
    if (!response.ok) throw new Error(snapshot.error || `HTTP ${response.status}`);
    renderDashboard(snapshot);
  } catch (error) {
    els.dashboardDataCaption.textContent = `AEOS V7.2 · 经营数据同步失败：${error.message}`;
    els.attentionDataStatus.textContent = '同步失败';
    els.attentionDataStatus.className = 'status-pill danger';
    if (!options.silent) toast(`经营数据加载失败：${error.message}`, true);
  } finally {
    dashboardLoading = false;
  }
}

function registryStatusIcon(system) {
  if (system.kind === 'mcp') return 'server-cog';
  if (system.id === 'aeos-hub') return 'orbit';
  if (system.id === 'codex-runtime') return 'square-terminal';
  return 'database';
}

function registryDotClass(tone) {
  if (tone === 'ok') return 'running';
  if (tone === 'danger') return 'critical';
  return 'warning';
}

function renderCapabilityPrompts(snapshot) {
  const capabilities = Array.isArray(snapshot.capabilities) ? snapshot.capabilities : [];
  const servers = new Set(capabilities.map((capability) => capability.server));
  const businessData = snapshot.businessData || {};
  const riskAssessment = snapshot.riskAssessment || {};
  const prompts = [];
  if (servers.has('company-control')) {
    prompts.push({
      label: businessData.available && riskAssessment.available ? '中控经营风险核查' : '中控数据可用性核查',
      prompt: businessData.available && riskAssessment.available
        ? '使用 company-control 的只读能力核查当前订单、订单明细、BOM、物料、供应商、齐套结果、缺料、库存可用量和未来供给。只基于返回的 evidence_refs 输出结论；数据过期或 UPSTREAM_UNAVAILABLE 不得解读为没有风险或没有缺料。'
        : '调用 company-control/get_system_health，说明中控平台当前业务数据端点和订单风险字段是否可用、缺少哪些数据；不要调用 demo-erp，不要编造订单、物料或风险结论。',
    });
  }
  if (!servers.has('company-control') && servers.has('demo-erp')) {
    prompts.push({
      label: '演示订单风险',
      prompt: '调用 demo-erp/list_order_risks 扫描演示订单风险。请明确标注这是演示数据，不可作为真实经营结论。',
    });
  }
  prompts.push({
    label: '能力与数据边界',
    prompt: '简要说明当前可调用的业务系统能力、哪些能力仅为已注册、哪些能够提供真实业务数据，并说明 evidence_refs 与数据置信度要求。',
  });
  els.capabilityPromptChips.innerHTML = prompts.map((item) => `
    <button class="chip" type="button" data-capability-prompt="${esc(item.prompt)}">${esc(item.label)}<i data-lucide="arrow-up-right"></i></button>`).join('');
  $$('[data-capability-prompt]', els.capabilityPromptChips).forEach((button) => button.addEventListener('click', () => doSend(button.dataset.capabilityPrompt)));
  refreshIcons(els.capabilityPromptChips);
}

function renderCapabilityRegistry(snapshot) {
  const systems = Array.isArray(snapshot.systems) ? snapshot.systems : [];
  const capabilities = Array.isArray(snapshot.capabilities) ? snapshot.capabilities : [];
  const businessData = snapshot.businessData || null;
  const riskAssessment = snapshot.riskAssessment || null;
  const mcpCount = systems.filter((system) => system.kind === 'mcp').length;
  els.registrySystemCount.textContent = `${systems.length} 个单元`;
  els.registrySystemCount.className = 'status-pill ok';
  els.registrySystemCaption.textContent = `${mcpCount} 个 MCP Server · ${snapshot.generatedAt ? formatHarborTime(snapshot.generatedAt) : '刚刚更新'}`;
  els.registrySystemGrid.innerHTML = systems.length ? systems.map((system) => {
    const businessBoundary = system.name === 'company-control' && businessData
      ? ` · ${businessData.available ? '真实业务数据可用' : '真实业务数据暂不可用'}${riskAssessment ? ` · ${riskAssessment.available ? '订单风险已评估' : '订单风险未评估'}` : ''}`
      : system.name === 'demo-erp' ? ' · 演示数据源（不参与首页与 Attention）' : '';
    return `
    <article>
      <span class="system-icon"><i data-lucide="${registryStatusIcon(system)}"></i></span>
      <div><strong>${esc(system.name)}</strong><small>${esc(system.description)}${system.version ? ` · v${esc(system.version)}` : ''}${esc(businessBoundary)}</small></div>
      <b class="status-pill ${esc(system.statusTone || 'neutral')}">${esc(system.status || '未知')}</b>
    </article>`;
  }).join('') : '<div class="registry-loading">暂无已注册系统</div>';

  els.registryCapabilityCount.textContent = `${capabilities.length} 项`;
  els.registryCapabilityCount.className = `status-pill ${capabilities.length ? 'ok' : 'info'}`;
  els.registryCapabilityCaption.textContent = capabilities.length ? `来自 ${new Set(capabilities.map((item) => item.server)).size} 个 MCP Server` : '尚未从 Runtime 获取到 tools/list';
  const stages = [['registered', '已登记', 'bookmark'], ['verified', '已验证', 'badge-check'], ['available', '可调用', 'zap'], ['paused', '待治理', 'shield-alert']];
  const states = savedMap(REGISTRY_STORAGE);
  if (els.registrySourceFilter) {
    const previousSource = registryFilter.source || 'all';
    const sourceOptions = [...new Set(capabilities.map((item) => item.server).filter(Boolean))].sort();
    els.registrySourceFilter.innerHTML = `<option value="all">全部来源</option>${sourceOptions.map((source) => `<option value="${esc(source)}">${esc(source)}</option>`).join('')}`;
    els.registrySourceFilter.value = sourceOptions.includes(previousSource) ? previousSource : 'all';
    registryFilter.source = els.registrySourceFilter.value;
  }
  const query = String(registryFilter.query || '').trim().toLowerCase();
  const visibleCapabilities = capabilities.filter((capability) => {
    const id = capability.id || `${capability.server}:${capability.name}`;
    const defaultState = capability.statusTone === 'ok' ? 'available' : capability.statusTone === 'danger' ? 'paused' : 'verified';
    const state = states[id] || defaultState;
    if (registryFilter.source !== 'all' && capability.server !== registryFilter.source) return false;
    if (registryFilter.state !== 'all' && state !== registryFilter.state) return false;
    if (!query) return true;
    return `${capability.name || ''} ${capability.title || ''} ${capability.description || ''} ${capability.server || ''}`.toLowerCase().includes(query);
  });
  if (els.registryFilterCount) els.registryFilterCount.textContent = `显示 ${visibleCapabilities.length}/${capabilities.length} 项`;
  els.registryCapabilityCount.textContent = capabilities.length ? `${visibleCapabilities.length}/${capabilities.length} 项` : '0 项';
  const cards = visibleCapabilities.map((capability) => {
    const defaultState = capability.statusTone === 'ok' ? 'available' : capability.statusTone === 'danger' ? 'paused' : 'verified';
    return {
      id: capability.id || `${capability.server}:${capability.name}`,
      state: states[capability.id || `${capability.server}:${capability.name}`] || defaultState,
      html: `<article class="kanban-card registry-card" draggable="true" data-card-id="${esc(capability.id || `${capability.server}:${capability.name}`)}"><div><b class="status-pill ${capability.readOnly ? 'info' : 'warn'}">${capability.readOnly ? 'READ_ONLY' : '需审查'}</b><span>${esc(capability.server)}</span></div><strong>${esc(capability.name)}</strong><p>${esc(capability.title || capability.description || capability.id)}</p><code>${capability.inputs?.length ? esc(capability.inputs.join(', ')) : '{}'} → MCP result${capability.readOnly ? ' + evidence_refs' : ''}</code><button class="btn secondary compact" type="button" data-registry-prompt="${esc(`调用 ${capability.server} 的 ${capability.name}，基于真实数据执行并说明输入输出契约、evidence_refs 和数据置信度。`)}">查看能力边界</button></article>`,
    };
  });
  els.registryCapabilityTable.innerHTML = cards.length ? stages.map(([id, label, icon]) => `<section class="kanban-column" data-kanban-column="${id}"><header><span><i data-lucide="${icon}"></i>${label}</span><b>${cards.filter((card) => card.state === id).length}</b></header><div class="kanban-card-list">${cards.filter((card) => card.state === id).map((card) => card.html).join('')}</div></section>`).join('') : `<div class="registry-loading">${capabilities.length ? '没有匹配的 Capability，请调整筛选条件' : 'Runtime 尚未返回可调用 Capability'}</div>`;
  bindKanbanDrag(els.registryCapabilityTable, (cardId, state) => { const next = savedMap(REGISTRY_STORAGE); next[cardId] = state; saveMap(REGISTRY_STORAGE, next); renderCapabilityRegistry(snapshot); toast(`Capability 生命周期已更新为“${stages.find((item) => item[0] === state)?.[1]}”`); });
  $$('[data-registry-prompt]', els.registryCapabilityTable).forEach((button) => button.addEventListener('click', () => openPrompt(button.dataset.registryPrompt)));

  const statusText = snapshot.warning
    ? `Runtime 实时清单暂不可用，当前展示配置注册结果：${snapshot.warning}`
    : `已从 MCP Runtime 实时同步 ${mcpCount} 个服务、${capabilities.length} 项能力。${businessData ? ` ${businessData.source}：${businessData.available ? '真实业务数据可用' : `真实业务数据暂不可用${businessData.message ? `（${businessData.message}）` : ''}`}${riskAssessment && !riskAssessment.available ? `；${riskAssessment.message || '订单风险未评估'}` : ''}` : ''}`;
  $('span', els.registryStatus).textContent = statusText;
  els.registryStatus.classList.toggle('warning', Boolean(snapshot.warning || (businessData && !businessData.available) || (riskAssessment && !riskAssessment.available)));
  renderCapabilityPrompts(snapshot);
  refreshIcons(els.registrySystemGrid);
  refreshIcons(els.registryCapabilityTable);
}

async function loadCapabilityRegistry(options = {}) {
  els.registryRefresh.disabled = true;
  els.registrySystemCount.textContent = '加载中';
  els.registryCapabilityCount.textContent = '加载中';
  try {
    const response = await fetch('/api/capability-registry', { headers: { accept: 'application/json' } });
    const snapshot = await response.json();
    if (!response.ok) throw new Error(snapshot.error || `HTTP ${response.status}`);
    registrySnapshot = snapshot;
    renderCapabilityRegistry(snapshot);
  } catch (error) {
    $('span', els.registryStatus).textContent = `Capability Registry 加载失败：${error.message}`;
    els.registryStatus.classList.add('warning');
    if (!options.silent) toast(`Capability Registry 加载失败：${error.message}`, true);
  } finally {
    els.registryRefresh.disabled = false;
  }
}

function harborStatus(kind, value) {
  const maps = {
    agent: {
      draft: ['草稿', 'neutral'], idle: ['可调度', 'ok'], working: ['执行中', 'info'],
      offline: ['离线', 'neutral'], archived: ['已归档', 'neutral'],
    },
    runtime: {
      ready: ['待命', 'info'], online: ['在线', 'ok'], busy: ['执行中', 'warn'],
      offline: ['待连接', 'neutral'], unstable: ['异常', 'danger'],
    },
    project: {
      planned: ['规划中', 'neutral'], in_progress: ['进行中', 'ok'], paused: ['已暂停', 'warn'],
      completed: ['已完成', 'info'], cancelled: ['已取消', 'neutral'],
    },
    model: {
      active: ['可用', 'ok'], inactive: ['已停用', 'neutral'],
    },
  };
  return maps[kind]?.[value] || [String(value || '未知'), 'neutral'];
}

function statusPill(kind, value) {
  const [label, tone] = harborStatus(kind, value);
  return `<b class="status-pill ${tone}">${esc(label)}</b>`;
}

function formatHarborTime(value) {
  if (!value) return '尚未收到';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function harborVerificationLabel(value) {
  const labels = {
    healthy: '已验证健康',
    degraded: '可连接但需关注',
    unhealthy: '验证失败',
    stopped: '运行时未启动',
    starting: '正在启动',
    unverified: '尚未验证',
  };
  return labels[value] || '尚未验证';
}

function harborTags(values, emptyText = '未配置') {
  const list = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!list.length) return `<span class="subtle">${esc(emptyText)}</span>`;
  const visible = list.slice(0, 2).map((item) => `<span class="tag">${esc(item)}</span>`);
  if (list.length > 2) visible.push(`<span class="tag">+${list.length - 2}</span>`);
  return `<span class="tag-list">${visible.join('')}</span>`;
}

function harborEmpty(icon, title, detail) {
  return `<div class="harbor-empty"><i data-lucide="${icon}"></i><strong>${esc(title)}</strong><small>${esc(detail)}</small></div>`;
}

function harborAgentActivity(agent) {
  const linkedMember = (squad.members || []).find((member) => member.harborAgentId === agent.id);
  const agentIds = [linkedMember?.id, squad.lead?.harborAgentId === agent.id ? squad.lead?.id : null].filter(Boolean);
  const activity = (squad.activities || []).filter((item) => agentIds.includes(item.agentId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!activity) return { title: '暂无已沉淀任务', detail: '等待中枢 Agent 按业务边界派发' };
  return { title: activity.title || '任务活动', detail: activity.detail || '未返回任务说明' };
}

function renderHarborAgentRow(agent, runtimeById, autonomyLabels, accessLabels, hierarchy = {}) {
  const runtime = agent.runtimeId ? runtimeById.get(agent.runtimeId) : null;
  const linkedMember = (squad.members || []).find((member) => member.harborAgentId === agent.id);
  const recent = harborAgentActivity(agent);
  const hierarchyLabels = { L0: '中枢编排', L1: '业务编队', L2: '专项执行', L3: '任务执行' };
  const tier = hierarchy.tier || `${agent.hierarchyLevel || 'L2'} · ${hierarchyLabels[agent.hierarchyLevel] || '专项执行'}`;
  const parent = hierarchy.parent || (agent.parentAgentId ? `上级：${(harbor.agents || []).find((item) => item.id === agent.parentAgentId)?.name || '未找到'}` : (linkedMember ? '已关联业务小队' : '待关联业务小队'));
  return `<div class="harbor-row">
    <div class="harbor-identity"><span class="harbor-avatar"><i data-lucide="bot"></i></span><span class="harbor-primary"><strong>${esc(agent.name)}</strong><small><b class="harbor-tier">${esc(tier)}</b>${esc(parent)} · ${esc(agent.role || agent.description || '未定义角色')}</small></span></div>
    <span><b class="status-pill info">${esc(agent.autonomyLevel)} ${esc(autonomyLabels[agent.autonomyLevel] || '')}</b></span>
    <span class="harbor-cell"><strong>${esc(runtime?.name || '未绑定 Runtime')}</strong><small>${esc(agent.provider)} · ${esc(agent.model)}</small></span>
    <span>${harborTags(agent.skills, '尚未配置 Skill')}</span>
    <span>${esc(accessLabels[agent.access] || agent.access)}</span>
    <span class="harbor-cell harbor-agent-recent"><strong>${esc(recent.title)}</strong><small title="${esc(recent.detail)}">${esc(recent.detail)}</small></span>
    <span class="harbor-agent-actions">${statusPill('agent', agent.status)}${linkedMember
      ? `<button class="btn secondary compact harbor-open-conversation" type="button" data-harbor-open-conversation="${esc(agent.id)}"><i data-lucide="messages-square"></i>进入会话</button>`
      : `<button class="btn secondary compact harbor-add-to-squad" type="button" data-harbor-agent-id="${esc(agent.id)}">加入小队</button>`}<button class="icon-btn harbor-delete-agent" type="button" title="删除 ${esc(agent.name)}" aria-label="删除 ${esc(agent.name)}" data-harbor-delete-agent-id="${esc(agent.id)}"><i data-lucide="trash-2"></i></button></span>
  </div>`;
}

function renderHarborRootAgent(agent, runtimeById, autonomyLabels, accessLabels) {
  if (!agent) return '';
  return `<section class="harbor-agent-root">
    <div class="harbor-agent-root-head"><span class="harbor-agent-root-icon"><i data-lucide="crown"></i></span><span><strong>L0 · 中枢 Agent</strong><small>负责跨小队编排、任务路由与治理门禁</small></span><b class="status-pill ok">根节点</b></div>
    <div class="harbor-agent-root-member">${renderHarborAgentRow(agent, runtimeById, autonomyLabels, accessLabels, { tier: 'L0 · 中枢 Agent', parent: 'AI 港湾根节点' })}</div>
  </section>`;
}

function renderHarborBusinessSquadGroup(businessSquad, agents, runtimeById, autonomyLabels, accessLabels) {
  const expanded = expandedHarborBusinessSquadIds.has(businessSquad.id);
  const members = (squad.members || []).filter((member) => member.squadId === businessSquad.id);
  const linkedCount = members.filter((member) => member.harborAgentId && agents.some((agent) => agent.id === member.harborAgentId)).length;
  const workingCount = agents.filter((agent) => agent.status === 'working').length;
  const standbyCount = agents.filter((agent) => ['idle', 'starting'].includes(agent.status)).length;
  return `<section class="harbor-agent-group ${expanded ? 'is-expanded' : ''}">
    <button class="harbor-agent-group-toggle" type="button" data-harbor-business-squad-id="${esc(businessSquad.id)}" aria-expanded="${expanded}">
      <span class="harbor-agent-group-icon"><i data-lucide="layers"></i></span>
      <span class="harbor-agent-group-copy"><strong>L1 · ${esc(businessSquad.name)}</strong><small>${esc(businessSquad.description || '业务 Agent 协作单元')} · ${linkedCount}/${members.length} 已接入 AI 港湾</small></span>
      <span class="harbor-agent-group-note">${workingCount ? `${workingCount} 个执行中` : `${standbyCount} 个待命`} · ${linkedCount === members.length ? '链路就绪' : '有待绑定'}</span>
      <i class="harbor-agent-group-chevron" data-lucide="chevron-right"></i>
    </button>
    <div class="harbor-agent-group-members">${agents.length ? agents.map((agent) => renderHarborAgentRow(agent, runtimeById, autonomyLabels, accessLabels, { tier: 'L2 · 专项 Agent', parent: businessSquad.name })).join('') : '<div class="harbor-agent-group-empty">暂无已接入的专项 Agent</div>'}</div>
  </section>`;
}

function renderHarbor() {
  const agents = Array.isArray(harbor.agents) ? harbor.agents : [];
  const runtimes = Array.isArray(harbor.runtimes) ? harbor.runtimes : [];
  const projects = Array.isArray(harbor.projects) ? harbor.projects : [];
  const runs = Array.isArray(harbor.runs) ? harbor.runs : [];
  const runtimeById = new Map(runtimes.map((item) => [item.id, item]));
  const agentById = new Map(agents.map((item) => [item.id, item]));
  const schedulableAgents = agents.filter((item) => ['idle', 'working'].includes(item.status)).length;
  const onlineRuntimes = runtimes.filter((item) => ['online', 'busy'].includes(item.status)).length;
  const readyRuntimes = runtimes.filter((item) => ['ready', 'online', 'busy'].includes(item.status)).length;
  const activeProjects = projects.filter((item) => item.status === 'in_progress').length;
  const activeRuns = runs.filter((item) => ['queued', 'running', 'waiting_approval'].includes(item.status)).length;

  els.harborAgentCount.textContent = String(agents.length);
  els.harborAgentActive.textContent = `${schedulableAgents} 个可调度`;
  els.harborRuntimeCount.textContent = String(runtimes.length);
  els.harborRuntimeOnline.textContent = `${onlineRuntimes} 个在线 · ${readyRuntimes} 个可用`;
  els.harborProjectCount.textContent = String(projects.length);
  els.harborProjectActive.textContent = `${activeProjects} 个进行中`;
  els.harborRunCount.textContent = String(runs.length);
  els.harborRunActive.textContent = `${activeRuns} 个待处理/执行中`;
  els.harborRuntimeBoundaryStatus.textContent = `${readyRuntimes} 个待命`;
  els.harborUpdated.textContent = `最近同步 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  const autonomyLabels = { A0: '观察', A1: '建议', A2: '编排', A3: '低风险自治', A4: '经营自治', A5: '例外管理' };
  const accessLabels = { private: '仅自己', workspace: '工作区', selected: '指定成员' };
  const businessSquads = Array.isArray(squad.subSquads) ? squad.subSquads : [];
  const businessSquadById = new Map(businessSquads.map((item) => [item.id, item]));
  const memberByHarborAgentId = new Map((squad.members || []).filter((item) => item.harborAgentId).map((item) => [item.harborAgentId, item]));
  const leadHarborAgentId = squad.lead?.harborAgentId || 'agent-aeos-hub';
  if (els.harborAgentSquadFilter) {
    const previous = harborAgentFilter.squad || 'all';
    els.harborAgentSquadFilter.innerHTML = `<option value="all">全部小队</option>${businessSquads.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}`;
    els.harborAgentSquadFilter.value = businessSquadById.has(previous) ? previous : 'all';
    harborAgentFilter.squad = els.harborAgentSquadFilter.value;
  }
  const query = String(harborAgentFilter.query || '').trim().toLowerCase();
  const visibleAgents = agents.filter((agent) => {
    const member = memberByHarborAgentId.get(agent.id);
    const parentName = agent.parentAgentId ? agents.find((item) => item.id === agent.parentAgentId)?.name || '' : '';
    if (harborAgentFilter.level !== 'all' && (agent.hierarchyLevel || 'L2') !== harborAgentFilter.level) return false;
    if (harborAgentFilter.status !== 'all' && (agent.status || 'draft') !== harborAgentFilter.status) return false;
    if (harborAgentFilter.squad !== 'all' && (member?.squadId || '') !== harborAgentFilter.squad) return false;
    if (!query) return true;
    return `${agent.name || ''} ${agent.role || ''} ${agent.description || ''} ${parentName}`.toLowerCase().includes(query);
  });
  const rootAgent = visibleAgents.find((agent) => agent.id === leadHarborAgentId) || null;
  const groupedAgents = new Map(businessSquads.map((item) => [item.id, []]));
  const standaloneAgents = [];
  for (const agent of visibleAgents) {
    if (agent.id === rootAgent?.id) continue;
    const member = memberByHarborAgentId.get(agent.id);
    if (member?.squadId && businessSquadById.has(member.squadId)) groupedAgents.get(member.squadId).push(agent);
    else standaloneAgents.push(agent);
  }
  const agentRows = standaloneAgents.map((agent) => renderHarborAgentRow(agent, runtimeById, autonomyLabels, accessLabels, { tier: 'L1 · 待归属 Agent', parent: '尚未加入业务小队' }));
  const groupedRows = businessSquads
    .map((businessSquad) => renderHarborBusinessSquadGroup(businessSquad, groupedAgents.get(businessSquad.id), runtimeById, autonomyLabels, accessLabels));
  const unassigned = agentRows.length ? `<section class="harbor-agent-unassigned"><div class="harbor-agent-unassigned-head"><i data-lucide="git-branch"></i><span><strong>L1 · 待归属业务小队</strong><small>这些 Agent 尚未建立小队派发关系</small></span><b class="status-pill warn">${agentRows.length} 个待归属</b></div>${agentRows.join('')}</section>` : '';
  els.harborAgentList.innerHTML = visibleAgents.length ? [renderHarborRootAgent(rootAgent, runtimeById, autonomyLabels, accessLabels), ...groupedRows, unassigned].join('') : harborEmpty('search-x', agents.length ? '没有匹配的 Agent' : '暂无智能体', agents.length ? '请调整层级、状态、小队或关键字筛选' : '新增智能体后可绑定 Runtime 与 Capability');

  const runtimeKinds = {
    'codex-app-server': 'Codex App Server', 'openai-responses': 'OpenAI Responses',
    'mcp-agent': 'MCP Agent', 'custom-cli': 'Custom CLI',
  };
  els.harborRuntimeList.innerHTML = runtimes.length ? runtimes.map((runtime) => `<div class="harbor-row">
    <div class="harbor-identity"><span class="harbor-avatar runtime"><i data-lucide="server"></i></span><span class="harbor-primary"><strong>${esc(runtime.name)}</strong><small>${esc(runtime.owner || '未指定 Owner')}</small></span></div>
    <span>${esc(runtimeKinds[runtime.kind] || runtime.kind)}</span>
    <span class="harbor-cell"><code>${esc(runtime.endpoint || '尚未配置 endpoint')}</code><small>${esc(runtime.workdir || '未指定工作目录')}</small></span>
    <span>${harborTags(runtime.capabilities, '未声明能力')}</span>
    <span class="harbor-cell"><strong>${esc(formatHarborTime(runtime.lastSeenAt))}</strong><small>${runtime.lastVerification ? '健康信号' : '等待 Runtime 心跳'}</small></span>
    <span class="harbor-runtime-status"><span>${statusPill('runtime', runtime.status)}</span><small class="harbor-verification-note">${esc(runtime.lastVerification ? harborVerificationLabel(runtime.lastVerification.status) : '尚未验证')}</small><button class="icon-btn harbor-verify" type="button" data-runtime-id="${esc(runtime.id)}" title="验证 Runtime 健康" aria-label="验证 ${esc(runtime.name)} 健康"><i data-lucide="refresh-cw"></i></button></span>
  </div>`).join('') : harborEmpty('server-off', '暂无 Runtime', '登记企业内网或本机执行节点');

  const priorityMeta = {
    urgent: ['紧急', 'danger'], high: ['高', 'warn'], medium: ['中', 'info'], low: ['低', 'neutral'], none: ['无', 'neutral'],
  };
  els.harborProjectList.innerHTML = projects.length ? projects.map((project) => {
    const lead = project.leadType === 'agent' ? agentById.get(project.leadId)?.name || '未知智能体' : project.leadId || 'workspace-owner';
    const teamNames = (project.agentIds || []).map((id) => agentById.get(id)?.name).filter(Boolean);
    const progress = Math.max(0, Math.min(100, Number(project.progress) || 0));
    const [priorityLabel, priorityTone] = priorityMeta[project.priority] || priorityMeta.none;
    return `<div class="harbor-row">
      <div class="harbor-identity"><span class="harbor-avatar project"><i data-lucide="folder-kanban"></i></span><span class="harbor-primary"><strong>${esc(project.key)} · ${esc(project.name)}</strong><small>${esc(project.objective)}</small></span></div>
      <span><b class="status-pill ${priorityTone}">${priorityLabel}</b></span>
      <span class="harbor-cell"><strong>${esc(lead)}</strong><small>${project.leadType === 'agent' ? 'Agent Lead' : 'Human Owner'}</small></span>
      <span>${teamNames.length ? `${teamNames.length} 个智能体` : '仅人工团队'}</span>
      <span class="harbor-progress"><span><i style="width:${progress}%"></i></span><code>${progress}%</code></span>
      <span>${statusPill('project', project.status)}</span>
    </div>`;
  }).join('') : harborEmpty('folder-plus', '暂无协作项目', '以目标、Owner 和验收证据组织人机协作');

  refreshIcons($('#view-harbor'));
}

async function loadHarbor(options = {}) {
  try {
    const [response, squadResponse, modelsResponse] = await Promise.all([
      fetch('/api/harbor', { headers: { accept: 'application/json' } }),
      fetch('/api/agent-squad', { headers: { accept: 'application/json' } }),
      fetch('/api/models', { headers: { accept: 'application/json' } }),
    ]);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    harbor = data;
    if (squadResponse.ok) squad = await squadResponse.json();
    if (modelsResponse.ok) modelRegistry = await modelsResponse.json();
    renderHarbor();
    renderModels();
    renderModelDatalists();
    refreshUsageAgentFilter();
    void loadUsage({ silent: true });
    if (!$('#view-squad').classList.contains('hidden')) renderSquad();
  } catch (error) {
    if (!options.silent) toast(`加载 AI 港湾失败：${error.message}`, true);
    [els.harborAgentList, els.harborRuntimeList, els.harborProjectList].forEach((node) => {
      node.innerHTML = harborEmpty('cloud-off', 'AI 港湾数据暂不可用', '请检查本机服务后重试');
      refreshIcons(node);
    });
  }
}

// ---------- 模型中心 ----------

function modelPricingLabel(model) {
  if (!model.pricing) return '<span class="subtle">未配置（只计用量）</span>';
  const symbol = model.pricing.currency === 'USD' ? '$' : '¥';
  return `<div class="harbor-cell"><code>输入 ${symbol}${model.pricing.inputPerMTok} / 缓存 ${symbol}${model.pricing.cachedInputPerMTok} / 输出 ${symbol}${model.pricing.outputPerMTok}</code><small>每百万 token · ${model.pricing.currency}</small></div>`;
}

function renderModels() {
  const models = Array.isArray(modelRegistry.models) ? modelRegistry.models : [];
  if (els.harborModelCount) els.harborModelCount.textContent = String(models.length);
  if (els.harborModelActiveCount) els.harborModelActiveCount.textContent = `${models.filter((item) => item.status === 'active').length} 个可用`;
  if (!els.harborModelList) return;
  els.harborModelList.innerHTML = models.length ? models.map((model) => `<div class="harbor-row">
    <div class="harbor-identity"><span class="harbor-avatar runtime"><i data-lucide="cpu"></i></span><span class="harbor-primary"><strong>${esc(model.name)}</strong><small><code>${esc(model.provider)} / ${esc(model.model)}</code></small></span></div>
    <span>${harborTags(model.capabilities, '未标注能力')}</span>
    <span class="harbor-cell"><strong>${model.contextWindow ? esc(formatTokenCount(model.contextWindow)) : '—'}</strong><small>上下文 token</small></span>
    <span>${modelPricingLabel(model)}</span>
    <span>${statusPill('model', model.status)}</span>
    <span class="harbor-model-actions">
      <button class="btn secondary compact" type="button" data-model-edit-id="${esc(model.id)}"><i data-lucide="pencil"></i>编辑</button>
      <button class="icon-btn" type="button" title="删除 ${esc(model.name)}" aria-label="删除 ${esc(model.name)}" data-model-delete-id="${esc(model.id)}"><i data-lucide="trash-2"></i></button>
    </span>
  </div>`).join('') : harborEmpty('cpu', '暂无登记模型', '登记模型能力与单价后，智能体选型和费用估算将使用这里的口径');
  refreshIcons(els.harborModelList);
}

function renderModelDatalists() {
  const models = Array.isArray(modelRegistry.models) ? modelRegistry.models : [];
  const modelOptions = $('#model-registry-options');
  const providerOptions = $('#model-provider-options');
  if (modelOptions) {
    modelOptions.innerHTML = models.map((model) => `<option value="${esc(model.model)}">${esc(model.provider)} · ${esc(model.name)}</option>`).join('');
  }
  if (providerOptions) {
    const providers = [...new Set(models.map((model) => model.provider))];
    providerOptions.innerHTML = providers.map((provider) => `<option value="${esc(provider)}"></option>`).join('');
  }
}

async function loadModels(options = {}) {
  try {
    const response = await fetch('/api/models', { headers: { accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    modelRegistry = data;
    renderModels();
    renderModelDatalists();
  } catch (error) {
    if (!options.silent) toast(`加载模型中心失败：${error.message}`, true);
  }
}

async function deleteModelEntry(modelId) {
  const model = (modelRegistry.models || []).find((item) => item.id === modelId);
  if (!model) return;
  if (!window.confirm(`删除模型“${model.name}”吗？\n\n删除后新的用量不再计费；历史费用记录保持不变。`)) return;
  const response = await fetch(`/api/models/${encodeURIComponent(modelId)}`, { method: 'DELETE', headers: { accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  await loadModels({ silent: true });
  toast(`已删除模型“${model.name}”`);
}

// ---------- 费用用量 ----------

function usageMonthRange(month) {
  const [year, mon] = String(month || localMonthKey()).split('-').map(Number);
  const from = `${String(year).padStart(4, '0')}-${String(mon).padStart(2, '0')}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const today = localDateKey();
  const to = `${from.slice(0, 8)}${String(lastDay).padStart(2, '0')}` > today || month === localMonthKey() ? today : `${from.slice(0, 8)}${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

function refreshUsageAgentFilter() {
  if (!els.harborUsageAgentFilter) return;
  const agents = [...(harbor.agents || [])];
  const previous = els.harborUsageAgentFilter.value;
  const known = new Set(agents.map((agent) => agent.id));
  const extra = [...new Set((usageSummary?.byAgent || []).map((row) => row.agentId).filter((id) => !known.has(id)))];
  els.harborUsageAgentFilter.innerHTML = `<option value="">全部智能体</option>${agents.map((agent) => `<option value="${esc(agent.id)}">${esc(agent.name)}</option>`).join('')}${extra.map((id) => {
    const row = (usageSummary?.byAgent || []).find((item) => item.agentId === id);
    return `<option value="${esc(id)}">${esc(row?.agentName || id)}（未登记）</option>`;
  }).join('')}`;
  els.harborUsageAgentFilter.value = [...els.harborUsageAgentFilter.options].some((option) => option.value === previous) ? previous : '';
}

async function loadUsage(options = {}) {
  try {
    const { from, to } = usageMonthRange(usageMonth);
    const agentId = els.harborUsageAgentFilter?.value || '';
    const params = new URLSearchParams({ from, to });
    if (agentId) params.set('agentId', agentId);
    const response = await fetch(`/api/usage/summary?${params.toString()}`, { headers: { accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    usageSummary = data;
    renderUsage();
    refreshUsageAgentFilter();
    void loadMonthCostCard();
  } catch (error) {
    if (!options.silent) toast(`加载费用用量失败：${error.message}`, true);
  }
}

async function loadMonthCostCard() {
  if (!els.harborCostMonth) return;
  try {
    const month = localMonthKey();
    const { from, to } = usageMonthRange(month);
    const response = await fetch(`/api/usage/summary?${new URLSearchParams({ from, to })}`, { headers: { accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const cost = formatCostAmounts(data.totals?.cost);
    els.harborCostMonth.textContent = cost || '¥0.00';
    els.harborCostMonthNote.textContent = data.totals?.records
      ? `${data.totals.records} 次记账 · ${formatTokenCount(data.totals.totalTokens)} tokens`
      : '暂无记账';
  } catch {
    els.harborCostMonth.textContent = '--';
    els.harborCostMonthNote.textContent = '费用数据暂不可用';
  }
}

function usageCostCell(bucket) {
  const cost = formatCostAmounts(bucket.cost);
  if (cost) return `<strong>${esc(cost)}</strong>${bucket.unpricedRecords ? `<small>${bucket.unpricedRecords} 次未计费</small>` : ''}`;
  return `<span class="subtle">${bucket.records ? '未配置单价' : '—'}</span>`;
}

function renderUsage() {
  if (!els.harborUsageMetrics) return;
  const summary = usageSummary;
  if (!summary) {
    els.harborUsageMetrics.innerHTML = '';
    els.harborUsageAgentList.innerHTML = harborEmpty('coins', '暂无费用数据', '发起对话后，Runtime 上报的 token 用量会自动记账');
    els.harborUsageModelList.innerHTML = '';
    els.harborUsageRecent.innerHTML = '';
    refreshIcons($('#harbor-panel-usage'));
    return;
  }
  const cost = formatCostAmounts(summary.totals.cost);
  els.harborUsageMetrics.innerHTML = `
    <div><span>估算费用</span><strong>${esc(cost || '¥0.00')}</strong><small>依据模型中心参考单价</small></div>
    <div><span>记账次数</span><strong>${summary.totals.records}</strong><small>token 用量增量</small></div>
    <div><span>Tokens 总量</span><strong>${esc(formatTokenCount(summary.totals.totalTokens))}</strong><small>入 ${esc(formatTokenCount(summary.totals.inputTokens))} · 出 ${esc(formatTokenCount(summary.totals.outputTokens))}</small></div>
    <div><span>未计费次数</span><strong>${summary.totals.unpricedRecords}</strong><small>模型未配置单价</small></div>`;

  els.harborUsageAgentList.innerHTML = summary.byAgent.length ? summary.byAgent.map((row) => `<div class="harbor-row">
    <div class="harbor-identity"><span class="harbor-avatar"><i data-lucide="bot"></i></span><span class="harbor-primary"><strong>${esc(row.agentName)}</strong><small>${esc(row.agentId)}</small></span></div>
    <span>${row.records}</span>
    <span class="harbor-cell"><strong>${esc(formatTokenCount(row.totalTokens))}</strong><small>入 ${esc(formatTokenCount(row.inputTokens))} · 出 ${esc(formatTokenCount(row.outputTokens))}</small></span>
    <span>${usageCostCell(row)}</span>
  </div>`).join('') : harborEmpty('coin-off', '该区间暂无智能体用量', '发起对话或调整月份后查看');

  els.harborUsageModelList.innerHTML = summary.byModel.length ? summary.byModel.map((row) => `<div class="harbor-row">
    <div class="harbor-primary"><strong>${esc(row.model)}</strong><small>${esc(row.provider)}</small></div>
    <span>${row.records}</span>
    <span class="harbor-cell"><strong>${esc(formatTokenCount(row.totalTokens))}</strong><small>入 ${esc(formatTokenCount(row.inputTokens))} · 出 ${esc(formatTokenCount(row.outputTokens))}</small></span>
    <span>${usageCostCell(row)}</span>
  </div>`).join('') : '<div class="harbor-row"><span class="subtle">暂无模型用量</span></div>';

  els.harborUsageRecent.innerHTML = summary.recent.length ? summary.recent.map((row) => `<div class="harbor-row">
    <span class="harbor-cell"><strong>${esc(formatHarborTime(row.occurredAt))}</strong><small>${row.runId ? esc(row.runId.slice(0, 12)) : '—'}</small></span>
    <span class="harbor-cell"><strong>${esc(row.agentName)}</strong><small>${row.scope === 'agent' ? '专业会话' : '中枢会话'}</small></span>
    <span class="harbor-cell"><strong>${esc(row.model)}</strong><small>${esc(row.provider)}</small></span>
    <span>${esc(formatTokenCount(row.totalTokens))}</span>
    <span>${row.priced && row.cost !== null ? esc(`${row.currency === 'USD' ? '$' : '¥'}${row.cost < 0.01 ? row.cost.toFixed(4) : row.cost.toFixed(2)}`) : '<span class="subtle">未计费</span>'}</span>
  </div>`).join('') : '<div class="harbor-row"><span class="subtle">暂无运行记录</span></div>';

  refreshIcons($('#harbor-panel-usage'));
}

function squadAgentById(agentId) {
  if (squad.lead?.id === agentId) return squad.lead;
  return (squad.members || []).find((member) => member.id === agentId) || null;
}

function squadAgentName(agentId) {
  return squadAgentById(agentId)?.name || '未知 Agent';
}

function squadTime(value) {
  return formatHarborTime(value);
}

function harborAgentForSquad(agentId) {
  return (harbor.agents || []).find((agent) => agent.id === agentId) || null;
}

function squadRuntimeLabel(harborAgentId) {
  const agent = harborAgentForSquad(harborAgentId);
  if (!agent) return '未绑定 AI 港湾 Agent';
  const runtime = (harbor.runtimes || []).find((item) => item.id === agent.runtimeId);
  return runtime ? `${agent.name} · ${runtime.name}` : `${agent.name} · 未绑定 Runtime`;
}

function squadAvailableHarborAgents(memberId = '') {
  const linked = new Set((squad.members || []).filter((member) => member.id !== memberId).map((member) => member.harborAgentId).filter(Boolean));
  const leadId = squad.lead?.harborAgentId;
  return (harbor.agents || []).filter((agent) => agent.id !== leadId && agent.id !== squad.lead?.id && !linked.has(agent.id));
}

function squadBusinessById(squadId) {
  return (squad.subSquads || []).find((item) => item.id === squadId) || null;
}

/** Build a grouped recipient picker while retaining one regular form value. */
function squadRecipientTree(recipients, businessSquads) {
  const selected = recipients[0];
  if (!selected) return '';
  const groups = businessSquads
    .map((businessSquad) => ({
      id: businessSquad.id,
      name: businessSquad.name,
      recipients: recipients.filter((member) => member.squadId === businessSquad.id),
    }))
    .filter((group) => group.recipients.length);
  const groupedIds = new Set(groups.flatMap((group) => group.recipients.map((member) => member.id)));
  const ungrouped = recipients.filter((member) => !groupedIds.has(member.id));
  if (ungrouped.length) groups.push({ id: 'direct', name: '直属 Agent', recipients: ungrouped });
  const branch = (group) => `<section class="squad-recipient-branch" data-recipient-branch="${esc(group.id)}"><button class="squad-recipient-group" type="button" data-recipient-group="${esc(group.id)}" aria-expanded="true"><i data-lucide="chevron-down"></i><span>${esc(group.name)}</span><b>${group.recipients.length}</b></button><div class="squad-recipient-children">${group.recipients.map((recipient) => `<button class="squad-recipient-option${recipient.id === selected.id ? ' selected' : ''}" type="button" role="treeitem" data-recipient-id="${esc(recipient.id)}" data-recipient-name="${esc(recipient.name)}"><i data-lucide="bot"></i><span><strong>${esc(recipient.name)}</strong><small>${esc(recipient.role)}</small></span><i class="squad-recipient-check" data-lucide="check"></i></button>`).join('')}</div></section>`;
  return `<div class="squad-recipient-tree" data-squad-recipient-tree><input type="hidden" name="toAgentId" value="${esc(selected.id)}" /><button class="squad-recipient-trigger" type="button" data-recipient-trigger aria-expanded="false" aria-haspopup="tree"><span><small>发送给</small><strong data-recipient-label>${esc(selected.name)}</strong></span><i data-lucide="chevron-down"></i></button><div class="squad-recipient-menu hidden" data-recipient-menu role="tree" aria-label="选择接收协作消息的 Agent"><div class="squad-recipient-root"><i data-lucide="network"></i><span>业务 Agent 小队</span></div>${groups.map(branch).join('')}</div></div>`;
}

function bindSquadRecipientTree(root) {
  const tree = $('[data-squad-recipient-tree]', root);
  if (!tree) return;
  const trigger = $('[data-recipient-trigger]', tree);
  const menu = $('[data-recipient-menu]', tree);
  const input = $('input[name="toAgentId"]', tree);
  const label = $('[data-recipient-label]', tree);
  trigger.addEventListener('click', () => {
    const open = menu.classList.toggle('hidden') === false;
    trigger.setAttribute('aria-expanded', String(open));
  });
  $$('[data-recipient-group]', tree).forEach((button) => button.addEventListener('click', () => {
    const branch = button.closest('[data-recipient-branch]');
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    branch.classList.toggle('is-collapsed', !expanded);
    refreshIcons(button);
  }));
  $$('[data-recipient-id]', tree).forEach((option) => option.addEventListener('click', () => {
    input.value = option.dataset.recipientId;
    label.textContent = option.dataset.recipientName;
    $$('[data-recipient-id]', tree).forEach((item) => item.classList.toggle('selected', item === option));
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
  }));
}

function squadMemberButton(member, activities) {
  const latest = activities.filter((activity) => activity.agentId === member.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const active = selectedSquadView === 'agent' && member.id === selectedSquadMemberId;
  const harborAgent = harborAgentForSquad(member.harborAgentId);
  const level = harborAgent?.hierarchyLevel || 'L2';
  const levelLabels = { L0: '中枢编排', L1: '业务编队', L2: '专项执行', L3: '任务执行' };
  return `<button class="squad-member ${active ? 'active' : ''}" type="button" data-squad-member-id="${esc(member.id)}">
    <span class="squad-avatar"><i data-lucide="bot"></i></span><span><strong>${esc(member.name)}</strong><small class="squad-hierarchy">${esc(level)} · ${esc(levelLabels[level] || '专项执行')}</small><small>${esc(member.role)}</small><small class="squad-link-label">${esc(squadRuntimeLabel(member.harborAgentId))}</small><em>${esc(latest ? latest.title : '暂无动作')} · ${esc(squadTime(latest?.createdAt))}</em></span>
    <b class="status-pill ${member.status === 'working' ? 'info' : 'neutral'}">${member.status === 'working' ? '协作中' : '待命'}</b>
  </button>`;
}

function squadExpandableText(content) {
  const text = String(content || '');
  if (text.length <= 220) return `<p>${esc(text)}</p>`;
  return `<p class="squad-expandable-text">${esc(text)}</p><button class="squad-expand-toggle" type="button" data-squad-expand-toggle="true" aria-expanded="false">展开完整内容</button>`;
}

function bindSquadExpandableEntries(scope) {
  $$('[data-squad-expand-toggle]', scope).forEach((button) => button.addEventListener('click', () => {
    const text = button.previousElementSibling;
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    button.textContent = expanded ? '展开完整内容' : '收起内容';
    text?.classList.toggle('is-expanded', !expanded);
  }));
}

function renderBusinessSquadDetail(businessSquad, members, memories, activities, squadMemories, squadActivities) {
  const ownMemories = squadMemories.filter((item) => item.squadId === businessSquad.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 8);
  const ownActivities = squadActivities.filter((item) => item.squadId === businessSquad.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 8);
  const memberIds = new Set(members.map((member) => member.id));
  const childMemories = memories.filter((item) => memberIds.has(item.agentId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 8);
  const childActivities = activities.filter((item) => memberIds.has(item.agentId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 8);
  const sessionCount = convs.filter((conversation) => conversation.scope === 'agent' && conversation.squadId === businessSquad.id && !conversation.archived).length;
  els.squadMemberDetail.innerHTML = `
    <div class="squad-detail-head business-squad-detail-head"><span class="squad-avatar"><i data-lucide="network"></i></span><div><h2>${esc(businessSquad.name)}</h2><p>${esc(businessSquad.description)} · 下辖 ${members.length} 个 Agent</p></div><span class="status-pill info">业务小队</span></div>
    <section class="squad-agent-sessions squad-team-sessions"><div><strong>小队会话</strong><small>汇总下辖 Agent 的分发任务；不会显示中枢会话。</small></div><button class="btn secondary compact" type="button" data-open-squad-sessions="${esc(businessSquad.id)}"><i data-lucide="messages-square"></i>查看 ${sessionCount} 个会话</button><p>新建会话请先选定具体 Agent，以保证任务、记忆和证据归属正确。</p></section>
    <div class="squad-scope-note"><i data-lucide="layers-2"></i><span>以下“小队自身”记录只归属 ${esc(businessSquad.name)}；“下辖 Agent 汇总”仅用于审阅，不会写入或覆盖任何 Agent 的独立记忆与动作。</span></div>
    <div class="squad-detail-grid">
      <section><div class="squad-section-head"><h3>小队自身动作</h3><small>业务级协作与升级记录</small></div><div class="squad-feed">${ownActivities.length ? ownActivities.map((activity) => `<article><b>${esc(activity.title)}</b>${squadExpandableText(activity.detail)}<time>${esc(squadTime(activity.createdAt))}</time></article>`).join('') : '<p class="squad-empty">暂无小队自身动作</p>'}</div><form class="squad-inline-form squad-business-activity-form" data-squad-business-form="activity"><input name="title" maxlength="160" required placeholder="业务小队动作，例如：升级订单风险"/><textarea name="detail" maxlength="1000" required placeholder="记录订单小队层面的结论或协作动作…"></textarea><button class="btn secondary compact" type="submit"><i data-lucide="list-plus"></i>记录动作</button></form></section>
      <section><div class="squad-section-head"><h3>小队自身记忆</h3><small>仅归属业务 Agent 小队</small></div><div class="squad-feed">${ownMemories.length ? ownMemories.map((memory) => `<article>${squadExpandableText(memory.content)}<time>${esc(squadTime(memory.createdAt))}</time></article>`).join('') : '<p class="squad-empty">暂无小队自身记忆</p>'}</div><form class="squad-inline-form" data-squad-business-form="memory"><textarea name="content" maxlength="2000" required placeholder="记录订单小队共享上下文、共识或升级结论…"></textarea><button class="btn secondary compact" type="submit"><i data-lucide="brain"></i>写入小队记忆</button></form></section>
    </div>
    <section class="squad-exchange squad-child-rollup"><div class="squad-section-head"><h3>下辖 Agent 记忆与动作汇总</h3><small>只读汇总，与小队自身记录分开保存</small></div><div class="squad-child-rollup-grid"><div><b>Agent 独立动作</b><div class="squad-feed">${childActivities.length ? childActivities.map((activity) => `<article><b>${esc(squadAgentName(activity.agentId))} · ${esc(activity.title)}</b>${squadExpandableText(activity.detail)}<time>${esc(squadTime(activity.createdAt))}</time></article>`).join('') : '<p class="squad-empty">暂无下辖 Agent 动作</p>'}</div></div><div><b>Agent 独立记忆</b><div class="squad-feed">${childMemories.length ? childMemories.map((memory) => `<article><b>${esc(squadAgentName(memory.agentId))}</b>${squadExpandableText(memory.content)}<time>${esc(squadTime(memory.createdAt))}</time></article>`).join('') : '<p class="squad-empty">暂无下辖 Agent 记忆</p>'}</div></div></div></section>`;
  $('[data-open-squad-sessions]', els.squadMemberDetail)?.addEventListener('click', () => openSquadConversationSpace(businessSquad));
  bindSquadExpandableEntries(els.squadMemberDetail);
  refreshIcons($('#view-squad'));
}

function renderSquad() {
  const members = Array.isArray(squad.members) ? squad.members : [];
  const businessSquads = Array.isArray(squad.subSquads) ? squad.subSquads : [];
  const squadMemories = Array.isArray(squad.squadMemories) ? squad.squadMemories : [];
  const squadActivities = Array.isArray(squad.squadActivities) ? squad.squadActivities : [];
  const memories = Array.isArray(squad.memories) ? squad.memories : [];
  const activities = Array.isArray(squad.activities) ? squad.activities : [];
  const messages = Array.isArray(squad.messages) ? squad.messages : [];
  const lead = squad.lead || { name: 'AEOS 中枢 Agent', model: 'deepseek-chat' };
  const projects = Array.isArray(harbor.projects) ? harbor.projects : [];
  const linkedProject = projects.find((project) => project.id === squad.projectId) || null;
  const linkedLead = harborAgentForSquad(lead.harborAgentId);
  if (!members.some((member) => member.id === selectedSquadMemberId)) selectedSquadMemberId = members[0]?.id || null;
  if (!businessSquads.some((item) => item.id === selectedBusinessSquadId)) selectedBusinessSquadId = businessSquads[0]?.id || null;
  if (!selectedBusinessSquadId && selectedSquadMemberId) selectedSquadView = 'agent';

  els.squadLeadName.textContent = lead.name;
  els.squadLeadModel.textContent = linkedLead ? `${linkedLead.model} · ${squadRuntimeLabel(linkedLead.id)}` : `${lead.model} · 未绑定 AI 港湾 Agent`;
  els.squadMemberCount.textContent = String(members.length);
  els.squadWorkingCount.textContent = `${members.filter((member) => member.status === 'working').length} 个协作中`;
  els.squadMemoryCount.textContent = String(memories.length);
  els.squadMessageCount.textContent = String(messages.length);
  els.squadProjectSelect.innerHTML = `<option value="">未关联项目</option>${projects.map((project) => `<option value="${esc(project.id)}">${esc(project.key)} · ${esc(project.name)}</option>`).join('')}`;
  els.squadProjectSelect.value = linkedProject?.id || '';
  els.squadProjectStatus.textContent = linkedProject
    ? `已关联 ${linkedProject.key} · ${linkedProject.status === 'in_progress' ? '进行中' : linkedProject.status}`
    : '未关联 AI 港湾项目';
  const grouped = businessSquads.map((businessSquad) => {
    const children = members.filter((member) => member.squadId === businessSquad.id);
    const linkedChildren = children.filter((member) => member.harborAgentId && harborAgentForSquad(member.harborAgentId)).length;
    const active = selectedSquadView === 'business' && selectedBusinessSquadId === businessSquad.id;
    const expanded = expandedSquadBusinessIds.has(businessSquad.id);
    const fullyLinked = children.length > 0 && linkedChildren === children.length;
    return `<section class="business-squad ${active ? 'active' : ''} ${expanded ? 'is-expanded' : ''}"><div class="business-squad-heading"><button class="business-squad-head" type="button" data-business-squad-id="${esc(businessSquad.id)}"><span class="squad-avatar"><i data-lucide="network"></i></span><span><strong>L1 · ${esc(businessSquad.name)}</strong><small>${esc(businessSquad.description)}</small><em>${linkedChildren}/${children.length} 已接入 AI 港湾 · ${squadMemories.filter((item) => item.squadId === businessSquad.id).length} 条小队记忆</em></span><b class="status-pill ${fullyLinked ? 'ok' : 'warn'}">${fullyLinked ? '已联通' : '待绑定'}</b></button><button class="business-squad-fold" type="button" data-business-squad-toggle-id="${esc(businessSquad.id)}" aria-label="${expanded ? '收起' : '展开'} ${esc(businessSquad.name)} 的子 Agent" aria-expanded="${expanded}"><i data-lucide="chevron-right"></i></button></div><div class="business-squad-children">${children.length ? children.map((member) => squadMemberButton(member, activities)).join('') : '<p class="squad-empty">暂无下辖 Agent</p>'}</div></section>`;
  }).join('');
  const ungrouped = members.filter((member) => !member.squadId || !businessSquads.some((item) => item.id === member.squadId));
  els.squadMemberList.innerHTML = `<div class="squad-root-node"><span class="squad-root-mark"><i data-lucide="waypoints"></i></span><div><strong>L0 · ${esc(lead.name)}</strong><small>顶层编排 · 负责跨小队协调与治理门禁</small></div></div>${grouped || ''}${ungrouped.length ? `<section class="business-squad ungrouped"><div class="business-squad-title">L1 · 直属 Agent</div><div class="business-squad-children">${ungrouped.map((member) => squadMemberButton(member, activities)).join('')}</div></section>` : ''}`;

  const businessSquad = selectedSquadView === 'business' ? businessSquads.find((item) => item.id === selectedBusinessSquadId) : null;
  if (businessSquad) {
    renderBusinessSquadDetail(businessSquad, members.filter((member) => member.squadId === businessSquad.id), memories, activities, squadMemories, squadActivities);
    refreshIcons($('#view-squad'));
    return;
  }

  const member = members.find((item) => item.id === selectedSquadMemberId);
  if (!member) {
    els.squadMemberDetail.innerHTML = harborEmpty('users-round', '请选择子 Agent', '查看其独立记忆、最近动作与队内协作消息');
    refreshIcons($('#view-squad'));
    return;
  }
  const memberActivities = activities.filter((activity) => activity.agentId === member.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 8);
  const memberMemories = memories.filter((memory) => memory.agentId === member.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 8);
  const memberMessages = messages.filter((message) => message.fromAgentId === member.id || message.toAgentId === member.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 12);
  const recipients = members.filter((item) => item.id !== member.id);
  const linkedHarborAgent = harborAgentForSquad(member.harborAgentId);
  const availableHarborAgents = squadAvailableHarborAgents(member.id);
  const memberConversations = convs.filter((conversation) => conversation.scope === 'agent' && conversation.agentId === member.id).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 5);
  const binding = linkedHarborAgent
    ? `<div class="squad-binding"><span>AI 港湾关联</span><strong>${esc(squadRuntimeLabel(linkedHarborAgent.id))}</strong><small>身份、模型、Runtime 与能力由 AI 港湾统一管理。</small></div>`
    : availableHarborAgents.length
      ? `<form class="squad-binding squad-inline-form" data-squad-form="bind"><select name="harborAgentId" required><option value="">选择 AI 港湾 Agent</option>${availableHarborAgents.map((agent) => `<option value="${esc(agent.id)}">${esc(agent.name)} · ${esc(agent.role)}</option>`).join('')}</select><button class="btn secondary compact" type="submit"><i data-lucide="link"></i>绑定港湾 Agent</button></form>`
      : '<div class="squad-binding"><span>AI 港湾关联</span><strong>暂无可绑定 Agent</strong><small>请先在 AI 港湾创建 Agent，或解除其他小队成员的绑定。</small></div>';
  els.squadMemberDetail.innerHTML = `
    <div class="squad-detail-head"><span class="squad-avatar"><i data-lucide="bot"></i></span><div><h2>${esc(member.name)}</h2><p>${esc(member.role)} · ${esc(member.model)} · 独立记忆空间</p></div><span class="squad-detail-actions"><b class="status-pill ${member.status === 'working' ? 'info' : 'neutral'}">${member.status === 'working' ? '协作中' : '待命'}</b><button class="btn secondary compact squad-delete-member" type="button" data-squad-member-id="${esc(member.id)}">移出小队</button></span></div>
    ${binding}
    <section class="squad-agent-sessions"><div><strong>专属会话</strong><small>分发给该 Agent 的任务不显示在中枢会话</small></div><button class="btn secondary compact" type="button" data-open-agent-sessions="${esc(member.id)}"><i data-lucide="messages-square"></i>进入会话</button><p>${memberConversations.length ? `最近：${esc(memberConversations[0].title || '新对话')} · ${esc(formatConvTime(memberConversations[0].updatedAt))}` : '尚无分发会话'}</p></section>
    <div class="squad-detail-grid">
      <section><div class="squad-section-head"><h3>最近动作</h3><small>主 Agent 可直接审阅</small></div><div class="squad-feed">${memberActivities.length ? memberActivities.map((activity) => `<article><b>${esc(activity.title)}</b>${squadExpandableText(activity.detail)}<time>${esc(squadTime(activity.createdAt))}</time></article>`).join('') : '<p class="squad-empty">暂无动作记录</p>'}</div></section>
      <section class="squad-agent-memory"><div class="squad-section-head"><div><h3>独立记忆</h3><small>仅归属该子 Agent</small></div><button class="squad-memory-conversation-link" type="button" data-open-agent-sessions="${esc(member.id)}" title="进入 ${esc(member.name)} 的专属会话"><i data-lucide="messages-square"></i><span>点击继续会话</span></button></div><p class="squad-memory-conversation-hint">从这里可随时回到 ${esc(member.name)} 的独立对话，历史会话会一直保留在该 Agent 名下。</p><div class="squad-feed">${memberMemories.length ? memberMemories.map((memory) => `<article>${squadExpandableText(memory.content)}<time>${esc(squadTime(memory.createdAt))}</time></article>`).join('') : '<p class="squad-empty">暂无记忆</p>'}</div><form class="squad-inline-form" data-squad-form="memory"><textarea name="content" maxlength="2000" required placeholder="为该子 Agent 记录任务上下文或结论…"></textarea><button class="btn secondary compact" type="submit"><i data-lucide="brain"></i>写入记忆</button></form></section>
    </div>
    <section class="squad-exchange"><div class="squad-section-head"><h3>队内协作消息</h3><small>由主 Agent 审阅的可追溯消息记录</small></div><div class="squad-message-feed">${memberMessages.length ? memberMessages.map((message) => `<article><span>${esc(squadAgentName(message.fromAgentId))} <i data-lucide="arrow-right"></i> ${esc(squadAgentName(message.toAgentId))}</span>${squadExpandableText(message.content)}<time>${esc(squadTime(message.createdAt))}</time></article>`).join('') : '<p class="squad-empty">暂无队内消息</p>'}</div>${recipients.length ? `<form class="squad-inline-form squad-message-form" data-squad-form="message">${squadRecipientTree(recipients, businessSquads)}<textarea name="content" maxlength="2000" required placeholder="记录 ${esc(member.name)} 发给队友的协作消息…"></textarea><button class="btn primary compact" type="submit"><i data-lucide="send"></i>发送协作消息</button></form>` : '<p class="squad-empty">至少需要两个子 Agent 才可登记相互协作消息</p>'}</section>`;
  $$('[data-open-agent-sessions]', els.squadMemberDetail).forEach((button) => button.addEventListener('click', () => openAgentConversationSpace(member)));
  bindSquadRecipientTree(els.squadMemberDetail);
  bindSquadExpandableEntries(els.squadMemberDetail);
  refreshIcons($('#view-squad'));
}

async function loadSquad(options = {}) {
  try {
    const response = await fetch('/api/agent-squad', { headers: { accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    squad = data;
    renderSquad();
  } catch (error) {
    if (!options.silent) toast(`加载 Agent 小队失败：${error.message}`, true);
    els.squadMemberList.innerHTML = harborEmpty('cloud-off', 'Agent 小队数据暂不可用', '请检查本机服务后重试');
    els.squadMemberDetail.innerHTML = '';
    refreshIcons($('#view-squad'));
  }
}

async function postSquad(path, payload) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  squad = data.squad || squad;
  renderSquad();
  return data.item;
}

async function deleteSquadMember(agentId) {
  const member = (squad.members || []).find((item) => item.id === agentId);
  if (!member) return;
  const memoryCount = (squad.memories || []).filter((item) => item.agentId === agentId).length;
  const messageCount = (squad.messages || []).filter((item) => item.fromAgentId === agentId || item.toAgentId === agentId).length;
  if (!window.confirm(`确定将“${member.name}”移出 Agent 小队吗？将删除其 ${memoryCount} 条独立记忆和 ${messageCount} 条队内消息；AI 港湾中的 Agent 与 Runtime 不会被删除。`)) return;
  const response = await fetch(`/api/agent-squad/members/${encodeURIComponent(agentId)}`, { method: 'DELETE', headers: { accept: 'application/json' } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  squad = data.squad || squad;
  selectedSquadMemberId = null;
  renderSquad();
  return data.item;
}

function openSquadMemberModal() {
  const availableHarborAgents = squadAvailableHarborAgents();
  if (!availableHarborAgents.length) {
    toast('暂无可加入小队的 AI 港湾 Agent，请先在 AI 港湾创建并配置 Agent', true);
    return;
  }
  els.squadMemberForm.reset();
  const businessSelect = $('select[name="squadId"]', els.squadMemberForm);
  const businessSquads = Array.isArray(squad.subSquads) ? squad.subSquads : [];
  businessSelect.innerHTML = `<option value="">选择业务 Agent 小队</option>${businessSquads.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.description)}</option>`).join('')}`;
  businessSelect.value = selectedBusinessSquadId || businessSquads[0]?.id || '';
  const select = $('select[name="harborAgentId"]', els.squadMemberForm);
  select.innerHTML = `<option value="">选择 AI 港湾 Agent</option>${availableHarborAgents.map((agent) => `<option value="${esc(agent.id)}">${esc(agent.name)} · ${esc(agent.role)}</option>`).join('')}`;
  els.squadFormStatus.textContent = '';
  els.squadModal.classList.remove('hidden');
  refreshIcons(els.squadModal);
  window.setTimeout(() => select?.focus(), 30);
}

function closeSquadMemberModal() {
  els.squadModal.classList.add('hidden');
  els.squadFormStatus.textContent = '';
}

async function submitSquadMember(event) {
  event.preventDefault();
  const form = new FormData(els.squadMemberForm);
  const submit = $('button[type="submit"]', els.squadMemberForm);
  submit.disabled = true;
  els.squadFormStatus.textContent = '创建中…';
  try {
    const member = await postSquad('/api/agent-squad/members', Object.fromEntries(form));
    selectedSquadMemberId = member.id;
    selectedBusinessSquadId = member.squadId || selectedBusinessSquadId;
    selectedSquadView = 'agent';
    renderSquad();
    closeSquadMemberModal();
    toast(`${member.name} 已加入 Agent 小队`);
  } catch (error) {
    els.squadFormStatus.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

async function submitSquadDetail(event) {
  const form = event.target.closest('[data-squad-form]');
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.squadForm;
  const content = new FormData(form).get('content');
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  try {
    if (kind === 'memory') await postSquad('/api/agent-squad/memories', { agentId: selectedSquadMemberId, content });
    if (kind === 'message') await postSquad('/api/agent-squad/messages', { fromAgentId: selectedSquadMemberId, toAgentId: new FormData(form).get('toAgentId'), content });
    if (kind === 'bind') await postSquad('/api/agent-squad/member-links', { agentId: selectedSquadMemberId, harborAgentId: new FormData(form).get('harborAgentId') });
    toast(kind === 'memory' ? '已写入子 Agent 独立记忆' : kind === 'bind' ? '已绑定 AI 港湾 Agent' : '已记录队内协作消息');
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function saveSquadProjectLink() {
  const button = els.squadProjectSave;
  button.disabled = true;
  try {
    await postSquad('/api/agent-squad/project-link', { projectId: els.squadProjectSelect.value });
    toast(els.squadProjectSelect.value ? 'Agent 小队已关联 AI 港湾项目' : '已解除项目关联');
  } catch (error) {
    toast(`保存项目关联失败：${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function submitBusinessSquadDetail(event) {
  const form = event.target.closest('[data-squad-business-form]');
  if (!form) return;
  event.preventDefault();
  const businessSquad = squadBusinessById(selectedBusinessSquadId);
  if (!businessSquad) return;
  const kind = form.dataset.squadBusinessForm;
  const values = Object.fromEntries(new FormData(form));
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  try {
    if (kind === 'memory') await postSquad('/api/agent-squad/business-squads/memories', { squadId: businessSquad.id, content: values.content });
    if (kind === 'activity') await postSquad('/api/agent-squad/business-squads/activities', { squadId: businessSquad.id, title: values.title, detail: values.detail });
    toast(kind === 'memory' ? '已写入业务 Agent 小队独立记忆' : '已记录业务 Agent 小队动作');
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function verifyHarborRuntime(runtimeId, button) {
  if (!runtimeId || button?.disabled) return;
  const runtime = (harbor.runtimes || []).find((item) => item.id === runtimeId);
  if (!runtime) return;
  if (button) {
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-label', `正在验证 ${runtime.name}`);
  }
  try {
    const response = await fetch(`/api/harbor/runtimes/${encodeURIComponent(runtimeId)}/verify`, {
      method: 'POST', headers: { accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    const health = data.health || {};
    if (data.runtime) {
      const index = (harbor.runtimes || []).findIndex((item) => item.id === runtimeId);
      if (index >= 0) harbor.runtimes[index] = data.runtime;
      renderHarbor();
    } else {
      await loadHarbor({ silent: true });
    }
    if (!response.ok && response.status !== 503) throw new Error(data.error || health.message || `HTTP ${response.status}`);
    const label = harborVerificationLabel(health.status);
    toast(`${runtime.name}：${label}${health.message ? ` · ${health.message}` : ''}`, health.status && !['healthy', 'degraded'].includes(health.status));
  } catch (error) {
    toast(`验证 ${runtime.name} 失败：${error.message}`, true);
  } finally {
    if (button && button.isConnected) {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.setAttribute('aria-label', `验证 ${runtime.name} 健康`);
    }
  }
}

function showHarborTab(tab) {
  const selected = ['agents', 'models', 'usage', 'runtimes', 'projects'].includes(tab) ? tab : 'agents';
  $$('[data-harbor-tab]').forEach((button) => {
    const active = button.dataset.harborTab === selected;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  ['agents', 'models', 'usage', 'runtimes', 'projects'].forEach((name) => $(`#harbor-panel-${name}`).classList.toggle('hidden', name !== selected));
  if (selected === 'usage') void loadUsage({ silent: true });
}

function runtimeOptions(selected = '') {
  const options = ['<option value="">暂不绑定 Runtime</option>'];
  for (const runtime of harbor.runtimes || []) {
    options.push(`<option value="${esc(runtime.id)}"${runtime.id === selected ? ' selected' : ''}>${esc(runtime.name)} · ${esc(harborStatus('runtime', runtime.status)[0])}</option>`);
  }
  return options.join('');
}

function agentOptions(selected = '') {
  const options = ['<option value="">由工作区 Owner 负责</option>'];
  for (const agent of harbor.agents || []) {
    options.push(`<option value="${esc(agent.id)}"${agent.id === selected ? ' selected' : ''}>${esc(agent.name)} · ${esc(agent.role)}</option>`);
  }
  return options.join('');
}

function openHarborModal(type, editItem = null) {
  harborModalType = type;
  harborModalEditId = type === 'model' && editItem ? editItem.id : null;
  els.harborFormStatus.textContent = '';
  els.harborForm.reset();
  const definitions = {
    agent: {
      title: '新增智能体', desc: '登记持久身份、模型策略、自治等级和可执行环境。', submit: '创建智能体',
      fields: `<label><span>智能体名称</span><input name="name" maxlength="80" required placeholder="例如：交付风险 Agent" /></label>
        <label><span>组织角色</span><input name="role" maxlength="120" required placeholder="例如：订单交付风险分析" /></label>
        <label><span>模型提供商</span><input name="provider" maxlength="80" required value="openai-codex" list="model-provider-options" /><small class="field-note">建议从模型中心的提供商中选择，便于费用估算。</small></label>
        <label><span>模型</span><input name="model" maxlength="120" value="account-default" list="model-registry-options" /><small class="field-note">选择模型中心已登记的模型可自动估算费用。</small></label>
        <label><span>执行 Runtime</span><select name="runtimeId">${runtimeOptions()}</select></label>
        <label><span>组织层级</span><select name="hierarchyLevel"><option value="L0">L0 · 中枢编排</option><option value="L1">L1 · 业务编队</option><option value="L2" selected>L2 · 专项执行</option><option value="L3">L3 · 任务执行</option></select><small class="field-note">层级用于组织与路由；自治等级仍由 Guard 与 Capability 控制。</small></label>
        <label><span>上级 Agent（可选）</span><select name="parentAgentId"><option value="">不指定上级</option>${(harbor.agents || []).map((agent) => `<option value="${esc(agent.id)}">${esc(agent.hierarchyLevel || 'L2')} · ${esc(agent.name)}</option>`).join('')}</select><small class="field-note">仅显示层级与名称，避免长文本干扰选择。</small></label>
        <label><span>自治等级</span><select name="autonomyLevel"><option>A0</option><option>A1</option><option selected>A2</option><option>A3</option><option>A4</option><option>A5</option></select></label>
        <label><span>访问范围</span><select name="access"><option value="private">仅自己</option><option value="workspace" selected>工作区</option><option value="selected">指定成员</option></select></label>
        <label><span>Skills</span><input name="skills" placeholder="逗号分隔，例如：风险扫描, 交付预测" /></label>
        <label class="wide"><span>职责说明</span><textarea name="description" maxlength="500" placeholder="这个智能体对什么结果负责"></textarea></label>
        <label class="wide"><span>系统指令与边界</span><textarea name="instructions" maxlength="5000" placeholder="明确证据要求、允许动作、禁止动作和升级条件"></textarea><small class="field-note">自治等级只是上限，实际动作仍由 Capability 权限、Policy 与 Guard 共同裁决。</small></label>`,
    },
    runtime: {
      title: '登记 Runtime', desc: '登记执行节点。保存后状态为“待连接”，不会伪装为已连通。', submit: '登记 Runtime',
      fields: `<label><span>Runtime 名称</span><input name="name" maxlength="100" required placeholder="例如：交付中心内网节点" /></label>
        <label><span>适配器类型</span><select name="kind"><option value="codex-app-server">Codex App Server</option><option value="openai-responses">OpenAI Responses</option><option value="mcp-agent">MCP Agent</option><option value="custom-cli" selected>Custom CLI</option></select></label>
        <label><span>责任团队</span><input name="owner" maxlength="120" value="AEOS Platform" /></label>
        <label><span>Capabilities</span><input name="capabilities" placeholder="逗号分隔，例如：coding, data-job" /></label>
        <label class="wide"><span>Endpoint</span><input name="endpoint" maxlength="500" placeholder="例如：wss://runtime.company.internal/agent" /><small class="field-note">推荐执行节点主动出站连接中枢；不要在这里填写密钥。</small></label>
        <label class="wide"><span>隔离工作目录</span><input name="workdir" maxlength="500" placeholder="例如：D:\\AEOS-Runtime\\workspaces" /></label>
        <label class="wide"><span>节点说明</span><textarea name="description" maxlength="500" placeholder="部署位置、隔离方式、允许承载的任务范围"></textarea></label>`,
    },
    project: {
      title: '新建协作项目', desc: '把长期目标、Accountable Owner、智能体编队与业务验收证据放在同一个项目边界内。', submit: '创建项目',
      fields: `<label><span>项目名称</span><input name="name" maxlength="120" required placeholder="例如：订单交付风险闭环" /></label>
        <label><span>项目编号</span><input name="key" maxlength="30" placeholder="留空自动生成" /></label>
        <label><span>优先级</span><select name="priority"><option value="urgent">紧急</option><option value="high" selected>高</option><option value="medium">中</option><option value="low">低</option><option value="none">无</option></select></label>
        <label><span>Accountable Owner / Lead</span><select name="leadId">${agentOptions()}</select></label>
        <label><span>开始日期</span><input name="startDate" type="date" value="${localDateKey()}" /></label>
        <label><span>目标日期</span><input name="targetDate" type="date" /></label>
        <label class="wide"><span>项目目标</span><textarea name="objective" maxlength="1200" required placeholder="定义经营结果、硬约束和可验证完成条件"></textarea></label>
        <fieldset class="wide"><legend>智能体编队</legend><div class="agent-checks">${(harbor.agents || []).length ? harbor.agents.map((agent) => `<label><input name="agentIds" type="checkbox" value="${esc(agent.id)}" /><span>${esc(agent.name)} · ${esc(agent.autonomyLevel)}</span></label>`).join('') : '<small class="field-note">当前没有可选智能体，可先创建项目，后续再组建编队。</small>'}</div></fieldset>
        <label class="wide"><span>资源引用</span><input name="resourceRefs" placeholder="逗号分隔，例如：objective://V7.2, capability://delivery-risk" /></label>`,
    },
    model: (() => {
      const edit = editItem || null;
      const pricing = edit?.pricing;
      return {
        title: edit ? `编辑模型 · ${edit.name}` : '登记模型', desc: '登记大模型的能力与参考单价；智能体选型和费用估算以模型中心为唯一口径。',
        submit: edit ? '保存修改' : '登记模型',
        fields: `<label><span>模型名称</span><input name="name" maxlength="120" required value="${esc(edit?.name || '')}" placeholder="例如：DeepSeek Chat（通用）" /></label>
        <label><span>模型提供商</span><input name="provider" maxlength="80" required value="${esc(edit?.provider || '')}" list="model-provider-options" placeholder="例如：deepseek" /></label>
        <label><span>模型标识</span><input name="model" maxlength="160" required value="${esc(edit?.model || '')}" list="model-registry-options" placeholder="调用时使用的模型 id，例如：deepseek-chat" /></label>
        <label><span>上下文窗口（token）</span><input name="contextWindow" type="number" min="0" step="1000" value="${edit?.contextWindow ?? ''}" placeholder="例如：128000，留空表示未知" /></label>
        <label><span>计价币种</span><select name="pricingCurrency"><option value="none"${!pricing ? ' selected' : ''}>不计价（只统计用量）</option><option value="CNY"${pricing?.currency === 'CNY' ? ' selected' : ''}>人民币 CNY</option><option value="USD"${pricing?.currency === 'USD' ? ' selected' : ''}>美元 USD</option></select></label>
        <label><span>输入单价 / 百万 token</span><input name="inputPerMTok" type="number" min="0" step="0.01" value="${pricing?.inputPerMTok ?? ''}" placeholder="例如：2" /></label>
        <label><span>缓存命中单价 / 百万 token</span><input name="cachedInputPerMTok" type="number" min="0" step="0.01" value="${pricing?.cachedInputPerMTok ?? ''}" placeholder="例如：0.5" /></label>
        <label><span>输出单价 / 百万 token</span><input name="outputPerMTok" type="number" min="0" step="0.01" value="${pricing?.outputPerMTok ?? ''}" placeholder="例如：8" /></label>
        <label><span>状态</span><select name="status"><option value="active"${(edit?.status || 'active') === 'active' ? ' selected' : ''}>可用</option><option value="inactive"${edit?.status === 'inactive' ? ' selected' : ''}>停用</option></select></label>
        <label><span>能力标签</span><input name="capabilities" value="${esc((edit?.capabilities || []).join(', '))}" placeholder="逗号分隔，例如：深度推理, 工具调用, 代码" /></label>
        <label class="wide"><span>备注</span><textarea name="notes" maxlength="500" placeholder="定价来源、适用场景或限制说明">${esc(edit?.notes || '')}</textarea></label>`,
      };
    })(),
  };
  const definition = definitions[type];
  if (!definition) return;
  els.harborModalTitle.textContent = definition.title;
  els.harborModalDesc.textContent = definition.desc;
  els.harborFormFields.innerHTML = definition.fields;
  $('span', els.harborFormSubmit).textContent = definition.submit;
  els.harborModal.classList.remove('hidden');
  refreshIcons(els.harborModal);
  window.setTimeout(() => $('input, select, textarea', els.harborFormFields)?.focus(), 30);
}

function closeHarborModal() {
  harborModalType = null;
  harborModalEditId = null;
  els.harborModal.classList.add('hidden');
  els.harborFormFields.innerHTML = '';
  els.harborFormStatus.textContent = '';
  els.harborFormSubmit.disabled = false;
}

async function submitHarborForm(event) {
  event.preventDefault();
  if (!harborModalType) return;
  const formData = new FormData(els.harborForm);
  const payload = Object.fromEntries(formData.entries());
  if (harborModalType === 'project') payload.agentIds = formData.getAll('agentIds');
  const endpoints = { agent: '/api/harbor/agents', runtime: '/api/harbor/runtimes', project: '/api/harbor/projects', model: '/api/models' };
  const labels = { agent: '智能体已创建', runtime: 'Runtime 已登记，等待真实连接与心跳', project: '协作项目已创建', model: harborModalEditId ? '模型已更新' : '模型已登记' };
  els.harborFormSubmit.disabled = true;
  els.harborFormStatus.textContent = '保存中...';
  try {
    if (harborModalType === 'model') {
      const currency = String(payload.pricingCurrency || 'none');
      delete payload.pricingCurrency;
      if (currency === 'none') {
        payload.pricing = null;
      } else {
        const asPrice = (value) => (String(value ?? '').trim() === '' ? 0 : Number(value));
        const prices = { inputPerMTok: asPrice(payload.inputPerMTok), cachedInputPerMTok: asPrice(payload.cachedInputPerMTok), outputPerMTok: asPrice(payload.outputPerMTok) };
        delete payload.inputPerMTok;
        delete payload.cachedInputPerMTok;
        delete payload.outputPerMTok;
        if (Object.values(prices).some((value) => !Number.isFinite(value) || value < 0)) throw new Error('单价必须是不小于 0 的数字');
        payload.pricing = { currency, ...prices };
      }
      if (String(payload.contextWindow ?? '').trim() === '') delete payload.contextWindow;
    }
    const editing = harborModalType === 'model' && harborModalEditId;
    const response = await fetch(editing ? `${endpoints[harborModalType]}/${encodeURIComponent(harborModalEditId)}` : endpoints[harborModalType], {
      method: editing ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const completedType = harborModalType;
    closeHarborModal();
    await loadHarbor({ silent: true });
    showHarborTab({ agent: 'agents', runtime: 'runtimes', project: 'projects', model: 'models' }[completedType]);
    toast(labels[completedType]);
  } catch (error) {
    els.harborFormStatus.textContent = error.message;
    els.harborFormSubmit.disabled = false;
  }
}

function resizeComposer() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 160)}px`;
}

function doSend(sourceText) {
  const text = (sourceText || els.input.value).trim();
  if (!text) return;
  if (chatScope.type === 'squad') {
    toast('小队会话仅用于查看；请在 Agent 小队中选择具体 Agent 后发起会话', true);
    return;
  }
  if (curConvId && runningConversationIds.has(curConvId)) {
    toast('上一条仍在执行，请等待完成或先停止', true);
    return;
  }
  if (ws?.readyState !== WebSocket.OPEN) {
    toast('中枢连接已断开，正在重连；问题尚未发送', true);
    connect();
    return;
  }
  const currentConversation = convs.find((conv) => conv.id === curConvId);
  const choice = currentConversation?.threadId
    ? (currentConversation.lastChoice || { provider: 'openai', model: '' })
    : currentChoice();
  if (!curConvId) {
    pendingText = text;
    pendingChoice = choice;
    if (!newConversation()) {
      pendingText = null;
      pendingChoice = null;
      toast('新会话创建失败，连接正在重建', true);
      connect();
      return;
    }
    els.input.value = '';
    resizeComposer();
    return;
  }
  choiceOf.set(curConvId, choice);
  fillModelSelect(choice);
  // Start a fresh transient stream before the server emits turn/started. This
  // prevents a lost/late lifecycle event from appending the next answer to the
  // previous turn's bubble.
  resetTurn({ convId: curConvId, sessionId: convs.find((conv) => conv.id === curConvId)?.threadId || null });
  if (!send({ type: 'chat', conversationId: curConvId, text, choice })) {
    toast('问题发送失败，连接正在重建', true);
    connect();
    return;
  }
  els.input.value = '';
  resizeComposer();
}

async function deleteHarborAgent(agentId) {
  const agent = (harbor.agents || []).find((item) => item.id === agentId);
  if (!agent) return;
  if (!window.confirm(`删除智能体“${agent.name}”吗？\n\n只有未关联小队、项目、运行记录或直属子 Agent 的智能体可以删除；删除后不可恢复。`)) return;
  const response = await fetch(`/api/harbor/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE', headers: { accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  await loadHarbor({ silent: true });
  toast(`已删除智能体“${agent.name}”`);
}

function appendLocalUser(text) {
  const wrap = appendMsg('user', text);
  wrap.appendChild(msgMeta(`${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · 你`));
}

function restoreConversationTranscript(messages) {
  const rows = Array.isArray(messages) ? messages.filter((item) => item && typeof item.text === 'string' && ['user', 'assistant'].includes(item.role)) : [];
  els.messages.innerHTML = '';
  resetTurn({ convId: curConvId });
  if (!rows.length) {
    els.empty.classList.remove('hidden');
    return;
  }
  for (const item of rows) {
    const time = item.createdAt ? new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '历史记录';
    if (item.role === 'user') {
      const wrap = appendMsg('user', item.text);
      wrap.appendChild(msgMeta(`${time} · 你`));
      continue;
    }
    const wrap = appendMsg('agent', '');
    if (item.phase) {
      wrap.dataset.phase = item.phase;
      wrap.classList.toggle('commentary', item.phase === 'commentary');
      wrap.classList.toggle('final-answer', item.phase === 'final_answer' || item.phase === 'final');
    }
    const bubble = $('.bubble', wrap);
    bubble.innerHTML = md(item.text);
    wrap.appendChild(msgMeta(`${time} · 中枢 Agent`));
  }
  els.empty.classList.add('hidden');
  els.messages.scrollTop = els.messages.scrollHeight;
}

function connect() {
  if (ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(ws.readyState)) return;
  window.clearTimeout(reconnectTimer);
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}/ws`);
  ws.addEventListener('open', () => {
    // Runtime event sequence numbers are scoped to a process. A reconnect may
    // therefore legitimately start at 1 again.
    lastRuntimeSequence = 0;
    turn.runtimeInstanceId = null;
    toast('中枢运行时已连接');
  });
  ws.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    switch (message.type) {
      case 'hello':
        lastRuntimeSequence = 0;
        turn.runtimeInstanceId = message.runtimeInstanceId || null;
        convs = message.conversations || [];
        modelOptions = message.modelOptions || [{ provider: 'openai', model: '', label: 'openai · 账号默认' }];
        if (message.evidenceFile) {
          els.evidencePath.dataset.path = message.evidenceFile;
          els.evidencePath.textContent = message.evidenceFile;
        }
        const eligibleConvs = chatScope.type === 'agent'
          ? convs.filter((conv) => conv.scope === 'agent' && conv.agentId === chatScope.agentId)
          : chatScope.type === 'squad'
            ? convs.filter((conv) => conv.scope === 'agent' && conv.squadId === chatScope.squadId)
            : convs.filter((conv) => conv.scope !== 'agent');
        if (!eligibleConvs.some((conv) => conv.id === curConvId)) curConvId = null;
        if (eligibleConvs.length && !curConvId) curConvId = [...eligibleConvs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0].id;
        const activeConversation = convs.find((conv) => conv.id === curConvId);
        fillModelSelect(activeConversation?.threadId
          ? (activeConversation.lastChoice || { provider: 'openai', model: '' })
          : null);
        renderConvs();
        if (curConvId) send({ type: 'view', conversationId: curConvId });
        break;
      case 'conversations_updated':
        convs = message.conversations || [];
        renderConvs();
        break;
      case 'conversation_archived':
        if (message.conversationId === curConvId && message.archived) {
          curConvId = null;
          els.messages.innerHTML = '';
          els.empty.classList.remove('hidden');
          resetTurn();
        }
        toast(message.archived ? '会话已归档（可在列表底部“已归档”中恢复）' : '会话已恢复');
        break;
      case 'conversation_deleted':
        if (message.conversationId === curConvId) {
          curConvId = null;
          els.messages.innerHTML = '';
          els.empty.classList.remove('hidden');
          resetTurn();
        }
        toast('会话已删除');
        break;
      case 'model_options':
        modelOptions = message.modelOptions || modelOptions;
        fillModelSelect(choiceOf.get(curConvId) || null);
        break;
      case 'conversation_created': {
        if (!convs.some((conv) => conv.id === message.conversation.id)) convs.unshift(message.conversation);
        curConvId = message.conversation.id;
        renderConvs();
        els.messages.innerHTML = '';
        els.empty.classList.remove('hidden');
        resetTurn({ convId: curConvId });
        send({ type: 'view', conversationId: curConvId });
        fillModelSelect(null);
        if (pendingText) {
          const text = pendingText;
          const choice = pendingChoice;
          const dispatch = pendingRiskAgentDispatch;
          pendingText = null;
          pendingChoice = null;
          pendingRiskAgentDispatch = null;
          rememberChoice(curConvId);
          if (dispatch) riskAgentDispatches.set(curConvId, dispatch);
          renderParallelTaskPanel();
          send({
            type: 'chat', conversationId: curConvId, text, choice,
            ...(dispatch ? { agentId: dispatch.harborAgentId, dispatch: { orderNo: dispatch.orderNo, evidenceRef: dispatch.evidenceRef, taskType: dispatch.taskType } } : {}),
          });
        }
        break;
      }
      case 'conversation_transcript':
        if (message.convId === curConvId) restoreConversationTranscript(message.messages);
        break;
      case 'user_message':
        if (message.convId === curConvId) appendLocalUser(message.text);
        break;
      case 'evt':
        handleEvt(message.method, message.params, message);
        break;
      case 'turn_end': {
        // 派发任务即进入“分析中”；专业 Agent 成功完成研判后，自动转给责任人。
        // 该处理必须在当前页面会话筛选之前执行，以免用户切换页面后状态停滞。
        if (message.convId) runningConversationIds.delete(message.convId);
        const dispatch = message.convId ? riskAgentDispatches.get(message.convId) : null;
        if (dispatch) {
          riskAgentDispatches.delete(message.convId);
          if (message.status === 'completed') {
            const attentionStates = savedMap(ATTENTION_STORAGE);
            const previousAttentionState = attentionStates[dispatch.attentionCardId] || 'review';
            attentionStates[dispatch.attentionCardId] = 'owner';
            saveMap(ATTENTION_STORAGE, attentionStates);
            recordAttentionTransition(dispatch.attentionCardId, previousAttentionState, 'owner', '专业 Agent 研判完成，转责任人确认');
            if (dashboardSnapshot) renderAttention(dashboardSnapshot);
            void loadSquad({ silent: true });
          }
        }
        renderParallelTaskPanel();
        if (message.convId && message.convId !== curConvId) break;
        if (message.runId && turn.turnId && message.runId !== turn.turnId) break;
        turn.ended = true;
        finishThinking();
        setBusy(false);
        if (message.status === 'completed') {
          if (dispatch) {
            toast(`${dispatch.taskType === 'kitting' ? '需求对象' : dispatch.taskType === 'quality' ? '质量异常' : '订单'} ${dispatch.orderNo} 分析完成，已自动流转至“待责任人”，结果已沉淀到${dispatch.agentLabel || '专业 Agent'}的独立记忆`);
          }
          toast('本轮分析完成');
          loadEvidence();
        } else if (message.status === 'interrupted') {
          els.turnbar.classList.remove('fail');
          els.turnbar.classList.add('hidden');
          toast(message.message || '已停止本轮分析');
        } else {
          els.turnbar.classList.add('fail');
          els.turnbar.classList.remove('hidden');
          els.turnStatus.textContent = `执行失败：${message.error || '未知错误'}`;
          toast(`执行失败：${message.error || '未知错误'}`, true);
        }
        break;
      }
      case 'guard':
        showGuard(message);
        break;
      case 'error':
        if (message.convId) {
          runningConversationIds.delete(message.convId);
          riskAgentDispatches.delete(message.convId);
          renderParallelTaskPanel();
        }
        if (message.convId === curConvId) {
          els.turnbar.classList.add('fail');
          els.turnbar.classList.remove('hidden');
          els.turnStatus.textContent = message.message;
          setBusy(false);
        }
        toast(message.message || '未知错误', true);
        break;
      case 'info':
        toast(message.text || message.message);
        break;
      case 'config:data':
        fillConfig(message.payload);
        break;
      case 'config_saved':
        els.cfgStatus.textContent = message.message;
        els.btnSaveConfig.disabled = false;
        toast(message.message);
        break;
      default:
        break;
    }
  });
  ws.addEventListener('close', () => {
    if (!authenticated) return;
    // A Docker restart clears the server's in-memory session. Check it before
    // reconnecting so a stale page returns to the login screen instead of
    // retrying WebSocket connections forever.
    void fetch('/api/auth/session', { credentials: 'same-origin' })
      .then((response) => {
        if (!authenticated) return;
        if (response.ok) reconnectTimer = window.setTimeout(connect, 3000);
        else showLoginRequired('登录会话已结束，请重新输入账号和密码');
      })
      .catch(() => {
        if (authenticated) reconnectTimer = window.setTimeout(connect, 3000);
      });
  });
}

function showLoginRequired(message = '') {
  authenticated = false;
  window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (ws) {
    ws.close(1000, 'Authentication required');
    ws = null;
  }
  els.userMenu.classList.add('hidden');
  els.app.classList.add('hidden');
  els.welcomeStage.classList.add('hidden');
  els.welcomeExit.classList.add('hidden');
  els.loginTransition.classList.add('hidden');
  els.loginStage.classList.remove('hidden');
  els.loginPassword.value = '';
  window.clearInterval(dashboardLiveRefreshTimer);
  dashboardLiveRefreshTimer = null;
  if (message) showLoginError(message);
  else els.loginError.classList.add('hidden');
  window.setTimeout(() => els.loginAccount.focus(), 30);
}

async function bootstrapAuthentication() {
  try {
    const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
    if (response.ok) {
      authenticated = true;
      showWorkspace(false);
      return;
    }
  } catch {
    // The visible login form will surface a precise error if the server stays unavailable.
  }
  showLoginRequired();
}

/* Authentication and profile interactions */
els.loginForm.addEventListener('submit', handleLogin);
els.loginAccount.addEventListener('input', () => els.loginError.classList.add('hidden'));
els.loginPassword.addEventListener('input', () => els.loginError.classList.add('hidden'));
els.togglePassword.addEventListener('click', () => {
  const showing = els.loginPassword.type === 'text';
  els.loginPassword.type = showing ? 'password' : 'text';
  els.togglePassword.title = showing ? '显示密码' : '隐藏密码';
  els.togglePassword.setAttribute('aria-label', els.togglePassword.title);
  els.togglePassword.innerHTML = `<i data-lucide="${showing ? 'eye' : 'eye-off'}"></i>`;
  refreshIcons(els.togglePassword);
});
els.welcomeBack.addEventListener('click', () => { if (welcomeState.step > 0) { welcomeState.step -= 1; renderWelcome(); } });
// Capture the click at the document level. The account menu lives above
// dynamic dashboard controls, so this remains reliable even if a view rerender
// replaces nearby header nodes.
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('#logout') : null;
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  void logout();
}, true);
els.sidebarUser.addEventListener('click', () => els.userMenu.classList.toggle('hidden'));
els.headerAvatar.addEventListener('click', () => els.userMenu.classList.toggle('hidden'));
document.addEventListener('click', (event) => {
  if (!els.userMenu.classList.contains('hidden') && !els.userMenu.contains(event.target) && !els.headerAvatar.contains(event.target) && !els.sidebarUser.contains(event.target)) els.userMenu.classList.add('hidden');
});

/* Navigation and command center */
$$('.nav-item').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
$$('.nav-action, [data-target].metric').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); showView(button.dataset.target); }));
$$('.prompt-action').forEach((button) => button.addEventListener('click', () => openPrompt(button.dataset.prompt)));
els.dailyQuestionShuffle.addEventListener('click', () => {
  if (!dailyQuestionConfig) return;
  const current = dailyQuestionRotation();
  setDailyQuestionRotation(current + dailyQuestionConfig.displayCount);
  renderDailyQuestions();
});
els.dailyQuestionConfigure.addEventListener('click', openDailyQuestionModal);
els.dailyQuestionModalClose.addEventListener('click', closeDailyQuestionModal);
els.dailyQuestionFormReload.addEventListener('click', reloadLatestDailyQuestionConfig);
els.dailyQuestionFormCancel.addEventListener('click', closeDailyQuestionModal);
els.dailyQuestionAdd.addEventListener('click', addDailyQuestionEditorRow);
els.dailyQuestionForm.addEventListener('submit', saveDailyQuestions);
els.dailyQuestionModal.addEventListener('mousedown', (event) => { if (event.target === els.dailyQuestionModal) closeDailyQuestionModal(); });
els.btnCasesRefresh.addEventListener('click', () => loadOperatingCenter());
els.btnInboxRefresh.addEventListener('click', () => loadInbox());
els.btnInboxReadAll?.addEventListener('click', () => { void markAllInboxRead(); });
els.inboxSearch?.addEventListener('input', renderInbox);
els.inboxFilter?.addEventListener('change', renderInbox);
els.caseList.addEventListener('click', (event) => {
  const decision = event.target.closest('[data-case-decision]');
  if (decision) { void decideOperatingCase(decision.dataset.caseId, decision.dataset.caseDecision).catch((error) => toast(`记录决策失败：${error.message}`, true)); return; }
  const edit = event.target.closest('[data-case-edit]');
  if (edit) void editOperatingCase(edit.dataset.caseEdit).catch((error) => toast(`更新事项失败：${error.message}`, true));
});
els.inboxList.addEventListener('click', (event) => {
  const detail = event.target.closest('[data-inbox-open]');
  if (detail) { openInboxDetail(detail.dataset.inboxOpen); return; }
  const button = event.target.closest('[data-inbox-read]');
  if (button) void markInboxRead(button.dataset.inboxRead).catch((error) => toast(`更新 Inbox 失败：${error.message}`, true));
});
els.inboxDetailClose?.addEventListener('click', closeInboxDetail);
els.inboxDetailCancel?.addEventListener('click', closeInboxDetail);
els.inboxDetailRead?.addEventListener('click', () => {
  if (!selectedInboxItemId) return;
  void markInboxRead(selectedInboxItemId).then(closeInboxDetail).catch((error) => toast(`更新 Inbox 失败：${error.message}`, true));
});
els.inboxDetailModal?.addEventListener('mousedown', (event) => { if (event.target === els.inboxDetailModal) closeInboxDetail(); });
els.registryRefresh.addEventListener('click', loadCapabilityRegistry);
els.registrySearch?.addEventListener('input', () => { registryFilter.query = els.registrySearch.value; if (registrySnapshot) renderCapabilityRegistry(registrySnapshot); });
els.registrySourceFilter?.addEventListener('change', () => { registryFilter.source = els.registrySourceFilter.value; if (registrySnapshot) renderCapabilityRegistry(registrySnapshot); });
els.registryStateFilter?.addEventListener('change', () => { registryFilter.state = els.registryStateFilter.value; if (registrySnapshot) renderCapabilityRegistry(registrySnapshot); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDailyQuestionsOnAudienceChange(); });
window.setInterval(refreshDailyQuestionsOnAudienceChange, 60_000);
$('[data-harbor-tab="agents"]')?.classList.add('active');
$$('[data-harbor-tab]').forEach((button) => button.addEventListener('click', () => showHarborTab(button.dataset.harborTab)));
$$('[data-harbor-create]').forEach((button) => button.addEventListener('click', () => openHarborModal(button.dataset.harborCreate)));
els.btnAddAgent.addEventListener('click', () => openHarborModal('agent'));
els.btnAddRuntime.addEventListener('click', () => openHarborModal('runtime'));
els.harborRuntimeList.addEventListener('click', (event) => {
  const button = event.target.closest('.harbor-verify');
  if (button) verifyHarborRuntime(button.dataset.runtimeId, button);
});
els.harborAgentList.addEventListener('click', async (event) => {
  const groupToggle = event.target.closest('[data-harbor-business-squad-id]');
  if (groupToggle) {
    const squadId = groupToggle.dataset.harborBusinessSquadId;
    if (expandedHarborBusinessSquadIds.has(squadId)) expandedHarborBusinessSquadIds.delete(squadId);
    else expandedHarborBusinessSquadIds.add(squadId);
    renderHarbor();
    return;
  }
  const conversationButton = event.target.closest('[data-harbor-open-conversation]');
  if (conversationButton) {
    openHarborAgentConversationSpace(conversationButton.dataset.harborOpenConversation);
    return;
  }
  const deleteButton = event.target.closest('[data-harbor-delete-agent-id]');
  if (deleteButton) {
    try { await deleteHarborAgent(deleteButton.dataset.harborDeleteAgentId); }
    catch (error) { toast(`删除智能体失败：${error.message}`, true); }
    return;
  }
  const button = event.target.closest('.harbor-add-to-squad');
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    const member = await postSquad('/api/agent-squad/members', { harborAgentId: button.dataset.harborAgentId, squadId: selectedBusinessSquadId || 'business-squad-orders' });
    selectedSquadMemberId = member.id;
    selectedBusinessSquadId = member.squadId || selectedBusinessSquadId;
    selectedSquadView = 'agent';
    await loadHarbor({ silent: true });
    toast(`${member.name} 已加入 Agent 小队`);
  } catch (error) {
    toast(`加入 Agent 小队失败：${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});
els.harborAgentSearch?.addEventListener('input', () => { harborAgentFilter.query = els.harborAgentSearch.value; renderHarbor(); });
els.harborAgentLevelFilter?.addEventListener('change', () => { harborAgentFilter.level = els.harborAgentLevelFilter.value; renderHarbor(); });
els.harborAgentStatusFilter?.addEventListener('change', () => { harborAgentFilter.status = els.harborAgentStatusFilter.value; renderHarbor(); });
els.harborAgentSquadFilter?.addEventListener('change', () => { harborAgentFilter.squad = els.harborAgentSquadFilter.value; renderHarbor(); });
els.harborAgentFilterClear?.addEventListener('click', () => {
  harborAgentFilter = { query: '', level: 'all', status: 'all', squad: 'all' };
  if (els.harborAgentSearch) els.harborAgentSearch.value = '';
  if (els.harborAgentLevelFilter) els.harborAgentLevelFilter.value = 'all';
  if (els.harborAgentStatusFilter) els.harborAgentStatusFilter.value = 'all';
  renderHarbor();
});
els.harborModelList?.addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-model-edit-id]');
  if (editButton) {
    const model = (modelRegistry.models || []).find((item) => item.id === editButton.dataset.modelEditId);
    if (model) openHarborModal('model', model);
    return;
  }
  const deleteButton = event.target.closest('[data-model-delete-id]');
  if (deleteButton) {
    try { await deleteModelEntry(deleteButton.dataset.modelDeleteId); }
    catch (error) { toast(`删除模型失败：${error.message}`, true); }
  }
});
els.harborUsageRefresh?.addEventListener('click', () => void loadUsage());
els.harborUsageMonth?.addEventListener('change', () => {
  usageMonth = els.harborUsageMonth.value || localMonthKey();
  void loadUsage();
});
els.harborUsageAgentFilter?.addEventListener('change', () => void loadUsage({ silent: true }));
if (els.harborUsageMonth && !els.harborUsageMonth.value) els.harborUsageMonth.value = usageMonth;
els.harborModalClose.addEventListener('click', closeHarborModal);
els.harborFormCancel.addEventListener('click', closeHarborModal);
els.harborForm.addEventListener('submit', submitHarborForm);
els.harborModal.addEventListener('mousedown', (event) => { if (event.target === els.harborModal) closeHarborModal(); });
els.squadAddMember.addEventListener('click', openSquadMemberModal);
els.squadModalClose.addEventListener('click', closeSquadMemberModal);
els.squadFormCancel.addEventListener('click', closeSquadMemberModal);
els.squadMemberForm.addEventListener('submit', submitSquadMember);
els.squadModal.addEventListener('mousedown', (event) => { if (event.target === els.squadModal) closeSquadMemberModal(); });
els.squadProjectSave.addEventListener('click', saveSquadProjectLink);
els.squadMemberList.addEventListener('click', (event) => {
  const businessSquadToggle = event.target.closest('[data-business-squad-toggle-id]');
  if (businessSquadToggle) {
    const squadId = businessSquadToggle.dataset.businessSquadToggleId;
    if (expandedSquadBusinessIds.has(squadId)) expandedSquadBusinessIds.delete(squadId);
    else expandedSquadBusinessIds.add(squadId);
    renderSquad();
    return;
  }
  const businessSquad = event.target.closest('[data-business-squad-id]');
  if (businessSquad) {
    selectedBusinessSquadId = businessSquad.dataset.businessSquadId;
    selectedSquadView = 'business';
    renderSquad();
    return;
  }
  const member = event.target.closest('[data-squad-member-id]');
  if (!member) return;
  selectedSquadMemberId = member.dataset.squadMemberId;
  selectedSquadView = 'agent';
  renderSquad();
});
els.squadMemberDetail.addEventListener('submit', submitSquadDetail);
els.squadMemberDetail.addEventListener('submit', submitBusinessSquadDetail);
els.squadMemberDetail.addEventListener('click', (event) => {
  const button = event.target.closest('.squad-delete-member');
  if (!button || button.disabled) return;
  button.disabled = true;
  deleteSquadMember(button.dataset.squadMemberId)
    .then((item) => { if (item) toast(`${item.member.name} 已移出 Agent 小队`); })
    .catch((error) => toast(`移出 Agent 小队失败：${error.message}`, true))
    .finally(() => { button.disabled = false; });
});
els.headerAgent.addEventListener('click', () => showView('chat'));
els.headerAttention.addEventListener('click', () => showView('attention'));
els.btnAttentionRefresh.addEventListener('click', () => loadDashboard({ force: true }));
els.attentionSearch?.addEventListener('input', () => {
  attentionFilter.query = els.attentionSearch.value;
  attentionLiveResult = null;
  if (dashboardSnapshot) renderAttention(dashboardSnapshot);
});
els.attentionSearch?.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter' || !els.attentionLiveCheck?.checked) return;
  event.preventDefault();
  const query = String(els.attentionSearch.value || '').trim();
  if (!query || attentionLiveSearchBusy) return;
  attentionLiveSearchBusy = true;
  els.attentionSearchStatus.textContent = '正在读取中台…';
  try {
    const response = await fetch('/api/attention/search', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query, live: true }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    // Only retain the response if it still belongs to the visible query.
    if (String(els.attentionSearch.value || '').trim() === query) {
      attentionLiveResult = data;
      els.attentionSearchStatus.textContent = data.live?.status === 'complete' ? '中台核查完成' : data.live?.status === 'partial' ? '中台部分返回' : '中台暂不可用';
      if (dashboardSnapshot) renderAttention(dashboardSnapshot);
    }
  } catch (error) {
    attentionLiveResult = { live: { status: 'unavailable', items: [], warnings: [(error && error.message) || '中台核查失败'] } };
    els.attentionSearchStatus.textContent = '中台核查失败';
    if (dashboardSnapshot) renderAttention(dashboardSnapshot);
  } finally {
    attentionLiveSearchBusy = false;
  }
});
els.attentionLiveCheck?.addEventListener('change', () => {
  attentionLiveResult = null;
  els.attentionSearchStatus.textContent = els.attentionLiveCheck.checked ? '按 Enter 核查中台' : '本地搜索';
  if (dashboardSnapshot) renderAttention(dashboardSnapshot);
});
els.attentionSourceFilter?.addEventListener('change', () => { attentionFilter.source = els.attentionSourceFilter.value; if (dashboardSnapshot) renderAttention(dashboardSnapshot); });
els.attentionStateFilter?.addEventListener('change', () => { attentionFilter.state = els.attentionStateFilter.value; if (dashboardSnapshot) renderAttention(dashboardSnapshot); });
els.attentionLevelFilter?.addEventListener('change', () => { attentionFilter.level = els.attentionLevelFilter.value; if (dashboardSnapshot) renderAttention(dashboardSnapshot); });
els.dashboardRiskTable.addEventListener('click', (event) => {
  const row = event.target.closest('[data-dashboard-risk-index]');
  if (!row) return;
  openDashboardRiskDetail(dashboardSnapshot?.risks?.[Number(row.dataset.dashboardRiskIndex)]);
});
els.dashboardFutureTable.addEventListener('click', (event) => {
  const row = event.target.closest('[data-dashboard-future-index]');
  if (!row) return;
  openDashboardRiskDetail(dashboardSnapshot?.attentionRisks?.[Number(row.dataset.dashboardFutureIndex)]);
});
els.dashboardKittingTable.addEventListener('click', (event) => {
  const row = event.target.closest('[data-dashboard-kitting-index]');
  if (!row) return;
  openDashboardRiskDetail(dashboardSnapshot?.kittingRisks?.[Number(row.dataset.dashboardKittingIndex)]);
});
els.dashboardQualityTable.addEventListener('click', (event) => {
  const row = event.target.closest('[data-dashboard-quality-index]');
  if (!row) return;
  openDashboardRiskDetail(dashboardSnapshot?.qualityRisks?.[Number(row.dataset.dashboardQualityIndex)]);
});
els.dashboardProductionTable.addEventListener('click', (event) => {
  const row = event.target.closest('[data-production-index]');
  if (!row) return;
  const source = dashboardSnapshot?.productionAssessment?.workOrders?.[Number(row.dataset.productionIndex)];
  if (source) openDashboardRiskDetail(productionRiskFromRow(source, dashboardSnapshot.productionAssessment, Number(row.dataset.productionIndex)));
});
els.dashboardRiskModalClose.addEventListener('click', closeDashboardRiskDetail);
els.dashboardRiskModalCancel.addEventListener('click', closeDashboardRiskDetail);
els.dashboardRiskModal.addEventListener('mousedown', (event) => { if (event.target === els.dashboardRiskModal) closeDashboardRiskDetail(); });
els.dashboardRiskCreateCase.addEventListener('click', createOperatingCaseFromRisk);
els.dashboardRiskDispatch.addEventListener('click', dispatchDashboardRiskToAgent);
els.dashboardOrderAgent?.addEventListener('click', () => openModuleAgentDetail('order'));
els.dashboardKittingAgent?.addEventListener('click', () => openModuleAgentDetail('kitting'));
els.dashboardQualityAgent?.addEventListener('click', () => openModuleAgentDetail('quality'));
els.dashboardProductionAgent?.addEventListener('click', () => openModuleAgentDetail('production'));
els.commandTrigger.addEventListener('click', openCommandPalette);
els.commandInput.addEventListener('input', () => { commandIndex = 0; renderCommandResults(); });
els.commandPalette.addEventListener('mousedown', (event) => { if (event.target === els.commandPalette) closeCommandPalette(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.harborModal.classList.contains('hidden')) {
    closeHarborModal();
    return;
  }
  if (event.key === 'Escape' && !els.squadModal.classList.contains('hidden')) {
    closeSquadMemberModal();
    return;
  }
  if (event.key === 'Escape' && els.inboxDetailModal && !els.inboxDetailModal.classList.contains('hidden')) {
    closeInboxDetail();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (els.commandPalette.classList.contains('hidden')) openCommandPalette();
    else closeCommandPalette();
    return;
  }
  if (!els.commandPalette.classList.contains('hidden')) {
    if (event.key === 'Escape') closeCommandPalette();
    else if (event.key === 'ArrowDown') { event.preventDefault(); commandIndex = Math.min(commandIndex + 1, commandMatches.length - 1); renderCommandResults(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); commandIndex = Math.max(commandIndex - 1, 0); renderCommandResults(); }
    else if (event.key === 'Enter' && commandMatches[commandIndex]) { event.preventDefault(); showView(commandMatches[commandIndex].view); closeCommandPalette(); }
  }
});
window.addEventListener('hashchange', () => {
  const view = location.hash.replace(/^#/, '');
  if (VIEW_TITLES[view] && view !== currentView) showView(view, { updateHash: false });
});

/* Agent, Guard, configuration and evidence controls */
els.btnNew.addEventListener('click', newConversation);
els.convSearch?.addEventListener('input', () => { conversationQuery = els.convSearch.value; renderConvs(); });
els.btnSend.addEventListener('click', () => doSend());
els.btnStop.addEventListener('click', () => send({ type: 'interrupt', conversationId: curConvId }));
els.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    doSend();
  }
});
els.input.addEventListener('input', resizeComposer);
els.guardAllow.addEventListener('click', () => decideGuard('accept'));
els.guardDeny.addEventListener('click', () => decideGuard('decline'));
els.cfgProvider.addEventListener('change', () => { els.cfgProviderHint.textContent = hintFor(els.cfgProvider.value); });
els.btnAddProvider.addEventListener('click', () => { providerRows.push({ id: `provider-${providerRows.length + 1}`, wire_api: 'responses' }); renderProviders(); });
els.btnSaveConfig.addEventListener('click', saveConfig);
els.evRefresh.addEventListener('click', loadEvidence);
els.evidenceSearch?.addEventListener('input', renderEvidenceRows);
els.evidenceSourceFilter?.addEventListener('change', renderEvidenceRows);
els.chatScopeBack?.addEventListener('click', openHubConversationSpace);

refreshIcons();
void bootstrapAuthentication();
