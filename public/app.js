/* AEOS 中枢系统前端：本地认证壳 + 管理者工作区 + WebSocket 中枢能力。 */
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STORAGE = {
  session: 'aeos-hub-session-v1',
  profile: 'aeos-hub-profile-v1',
  onboarding: 'aeos-hub-onboarding-v1',
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
  headerAttention: $('#header-attention'),

  convList: $('#conv-list'), messages: $('#messages'), empty: $('#empty-state'), turnbar: $('#turnbar'),
  turnStatus: $('#turn-status'), btnStop: $('#btn-stop'), input: $('#input'), btnSend: $('#btn-send'),
  btnNew: $('#btn-new'), modelSelect: $('#model-select'),

  guardBar: $('#guard-bar'), guardTitle: $('#guard-title'), guardDesc: $('#guard-desc'),
  guardAllow: $('#guard-allow'), guardDeny: $('#guard-deny'), guardPending: $('#guard-pending-count'),

  cfgProvider: $('#cfg-provider'), cfgModel: $('#cfg-model'), cfgProviderHint: $('#cfg-provider-hint'),
  providers: $('#providers'), btnAddProvider: $('#btn-add-provider'), btnSaveConfig: $('#btn-save-config'),
  cfgStatus: $('#cfg-status'), infoHome: $('#info-home'), infoConfig: $('#info-config'),
  infoMcp: $('#info-mcp'), infoKeys: $('#info-keys'),

  evList: $('#evidence-list'), evRefresh: $('#btn-evidence-refresh'), evidenceTotal: $('#evidence-total'),
  evidenceToday: $('#evidence-today'), evidencePath: $('#evidence-path'), metricEvidence: $('#metric-evidence'),
  metricConversations: $('#metric-conversations'), toasts: $('#toasts'),

  harborAgentCount: $('#harbor-agent-count'), harborAgentActive: $('#harbor-agent-active'),
  harborRuntimeCount: $('#harbor-runtime-count'), harborRuntimeOnline: $('#harbor-runtime-online'),
  harborProjectCount: $('#harbor-project-count'), harborProjectActive: $('#harbor-project-active'),
  harborRunCount: $('#harbor-run-count'), harborRunActive: $('#harbor-run-active'),
  harborRuntimeBoundaryStatus: $('#harbor-runtime-boundary-status'), harborUpdated: $('#harbor-updated'),
  harborAgentList: $('#harbor-agent-list'), harborRuntimeList: $('#harbor-runtime-list'), harborProjectList: $('#harbor-project-list'),
  btnAddAgent: $('#btn-add-agent'), btnAddRuntime: $('#btn-add-runtime'),
  harborModal: $('#harbor-modal'), harborModalKicker: $('#harbor-modal-kicker'), harborModalTitle: $('#harbor-modal-title'),
  harborModalDesc: $('#harbor-modal-desc'), harborModalClose: $('#harbor-modal-close'), harborForm: $('#harbor-form'),
  harborFormFields: $('#harbor-form-fields'), harborFormStatus: $('#harbor-form-status'),
  harborFormCancel: $('#harbor-form-cancel'), harborFormSubmit: $('#harbor-form-submit'),
};

let ws = null;
let reconnectTimer = null;
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
let harborModalType = null;
const choiceOf = new Map();
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
  { view: 'harbor', label: 'AI 港湾', desc: '智能体、运行节点与人机协作项目', icon: 'waypoints', group: 'AI 资源协作' },
  { view: 'evidence', label: 'Evidence 证据中心', desc: '事实、工具、审批与结果事件流', icon: 'file-search', group: '治理与证据' },
  { view: 'registry', label: 'Capability Registry', desc: '系统与业务能力注册表', icon: 'boxes', group: '治理与证据' },
  { view: 'config', label: '系统配置', desc: '模型提供商与隔离运行时', icon: 'settings', group: '系统' },
];

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

function handleLogin(event) {
  event.preventDefault();
  els.loginError.classList.add('hidden');
  const account = els.loginAccount.value.trim();
  const password = els.loginPassword.value;
  if (!account || !password) {
    showLoginError('请输入账号和密码');
    return;
  }
  setLoginBusy(true);
  window.setTimeout(() => {
    if (account !== 'demo' || password !== 'demo') {
      setLoginBusy(false);
      showLoginError('账号或密码错误，演示账号与密码均为 demo');
      return;
    }
    localStorage.setItem(STORAGE.session, JSON.stringify({ account, signedInAt: new Date().toISOString() }));
    // 演示账号：每次登录重置全部客户端流程状态（引导/档案），保证演示从第一步开始。
    // 注意：只重置流程状态，不清空会话与证据数据（那些是服务端事实）。
    localStorage.removeItem(STORAGE.profile);
    localStorage.removeItem(STORAGE.onboarding);
    els.loginSubmit.innerHTML = '<i data-lucide="check"></i><span>已验证，正在进入</span>';
    refreshIcons(els.loginSubmit);
    beginLoginTransition(() => {
      setLoginBusy(false);
      showWelcome();
    });
  }, 260);
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
  loadHarbor({ silent: true });
  window.setTimeout(() => els.app.classList.remove('workspace-enter'), 900);
}

function logout() {
  localStorage.removeItem(STORAGE.session);
  els.userMenu.classList.add('hidden');
  els.app.classList.add('hidden');
  els.loginStage.classList.remove('hidden');
  els.loginPassword.value = '';
  els.loginError.classList.add('hidden');
  setLoginBusy(false);
  history.replaceState(null, '', location.pathname);
  window.setTimeout(() => els.loginAccount.focus(), 30);
}

function showView(view, options = {}) {
  if (!VIEW_TITLES[view]) view = 'dashboard';
  currentView = view;
  $$('.app-view').forEach((node) => node.classList.add('hidden'));
  const target = $(`#view-${view}`);
  target.classList.remove('hidden');
  if (options.animate !== false) {
    target.classList.remove('view-enter');
    void target.offsetWidth;
    target.classList.add('view-enter');
  }
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  els.breadcrumb.textContent = VIEW_TITLES[view];
  if (options.updateHash !== false && location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  els.workspaceContent.scrollTop = 0;
  if (view === 'config') loadConfig();
  if (view === 'evidence' || view === 'dashboard') loadEvidence();
  if (view === 'harbor') loadHarbor();
  if (view === 'chat' && curConvId) send({ type: 'view', conversationId: curConvId });
}

function openPrompt(prompt) {
  showView('chat');
  els.input.value = prompt;
  resizeComposer();
  doSend(prompt);
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
  commandMatches = commands.filter((item) => !query || `${item.label} ${item.desc} ${item.group}`.toLowerCase().includes(query));
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
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
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
  const sorted = [...convs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const active = sorted.filter((conv) => !conv.archived);
  const archived = sorted.filter((conv) => conv.archived);
  els.metricConversations.textContent = String(active.length);
  if (!active.length && !archived.length) {
    els.convList.innerHTML = '<div class="conv-empty">还没有会话<br />点击右上角新建</div>';
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
  const conv = convs.find((item) => item.id === id);
  fillModelSelect(conv?.lastChoice && (conv.lastChoice.provider || 'openai') !== 'openai' ? conv.lastChoice : null);
  send({ type: 'view', conversationId: id });
}

function newConversation() {
  send({ type: 'new' });
  busy = false;
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
      <select class="f-wire" aria-label="接口类型"><option value="responses" ${row.wire_api !== 'chat' ? 'selected' : ''}>responses</option><option value="chat" ${row.wire_api === 'chat' ? 'selected' : ''}>chat</option></select>
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
    const today = localDateKey();
    els.evidenceTotal.textContent = String(data.total || 0);
    els.metricEvidence.textContent = String(data.total || 0);
    els.evidenceToday.textContent = String(rows.filter((row) => String(row.occurred_at || '').startsWith(today)).length);
    els.evidencePath.textContent = els.evidencePath.dataset.path || 'data/evidence.jsonl';
    els.evList.innerHTML = '';
    if (!rows.length) {
      els.evList.innerHTML = '<div class="evidence-empty">暂无运行证据</div>';
      return;
    }
    for (const row of [...rows].reverse()) {
      const node = document.createElement('div');
      node.className = 'ev-row';
      const time = document.createElement('span');
      time.className = 't';
      time.textContent = row.occurred_at ? new Date(row.occurred_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '未知时间';
      const kind = document.createElement('span');
      kind.className = 'k';
      kind.textContent = row.kind === 'notification' ? (row.method || row.item_type || 'notification') : (row.kind || 'event');
      const summary = document.createElement('span');
      summary.className = 's';
      summary.textContent = row.summary || (row.payload ? JSON.stringify(row.payload).slice(0, 220) : '');
      node.append(time, kind, summary);
      els.evList.appendChild(node);
    }
  } catch (error) {
    els.evList.innerHTML = '<div class="evidence-empty">证据流暂时不可用</div>';
    toast(`加载证据失败：${error.message}`, true);
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
  els.harborAgentList.innerHTML = agents.length ? agents.map((agent) => {
    const runtime = agent.runtimeId ? runtimeById.get(agent.runtimeId) : null;
    return `<div class="harbor-row">
      <div class="harbor-identity"><span class="harbor-avatar"><i data-lucide="bot"></i></span><span class="harbor-primary"><strong>${esc(agent.name)}</strong><small>${esc(agent.role || agent.description || '未定义角色')}</small></span></div>
      <span><b class="status-pill info">${esc(agent.autonomyLevel)} ${esc(autonomyLabels[agent.autonomyLevel] || '')}</b></span>
      <span class="harbor-cell"><strong>${esc(runtime?.name || '未绑定 Runtime')}</strong><small>${esc(agent.provider)} · ${esc(agent.model)}</small></span>
      <span>${harborTags(agent.skills, '尚未配置 Skill')}</span>
      <span>${esc(accessLabels[agent.access] || agent.access)}</span>
      <span>${statusPill('agent', agent.status)}</span>
    </div>`;
  }).join('') : harborEmpty('bot', '暂无智能体', '新增智能体后可绑定 Runtime 与 Capability');

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
    const response = await fetch('/api/harbor', { headers: { accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    harbor = data;
    renderHarbor();
  } catch (error) {
    if (!options.silent) toast(`加载 AI 港湾失败：${error.message}`, true);
    [els.harborAgentList, els.harborRuntimeList, els.harborProjectList].forEach((node) => {
      node.innerHTML = harborEmpty('cloud-off', 'AI 港湾数据暂不可用', '请检查本机服务后重试');
      refreshIcons(node);
    });
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
  const selected = ['agents', 'runtimes', 'projects'].includes(tab) ? tab : 'agents';
  $$('[data-harbor-tab]').forEach((button) => {
    const active = button.dataset.harborTab === selected;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  ['agents', 'runtimes', 'projects'].forEach((name) => $(`#harbor-panel-${name}`).classList.toggle('hidden', name !== selected));
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

function openHarborModal(type) {
  harborModalType = type;
  els.harborFormStatus.textContent = '';
  els.harborForm.reset();
  const definitions = {
    agent: {
      title: '新增智能体', desc: '登记持久身份、模型策略、自治等级和可执行环境。', submit: '创建智能体',
      fields: `<label><span>智能体名称</span><input name="name" maxlength="80" required placeholder="例如：交付风险 Agent" /></label>
        <label><span>组织角色</span><input name="role" maxlength="120" required placeholder="例如：订单交付风险分析" /></label>
        <label><span>模型提供商</span><input name="provider" maxlength="80" required value="openai-codex" /></label>
        <label><span>模型</span><input name="model" maxlength="120" value="account-default" /></label>
        <label><span>执行 Runtime</span><select name="runtimeId">${runtimeOptions()}</select></label>
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
  const endpoints = { agent: '/api/harbor/agents', runtime: '/api/harbor/runtimes', project: '/api/harbor/projects' };
  const labels = { agent: '智能体已创建', runtime: 'Runtime 已登记，等待真实连接与心跳', project: '协作项目已创建' };
  els.harborFormSubmit.disabled = true;
  els.harborFormStatus.textContent = '保存中...';
  try {
    const response = await fetch(endpoints[harborModalType], {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const completedType = harborModalType;
    closeHarborModal();
    await loadHarbor({ silent: true });
    showHarborTab({ agent: 'agents', runtime: 'runtimes', project: 'projects' }[completedType]);
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
  if (busy) {
    toast('上一条仍在执行，请等待完成或先停止', true);
    return;
  }
  els.input.value = '';
  resizeComposer();
  const choice = currentChoice();
  if (!curConvId) {
    pendingText = text;
    pendingChoice = choice;
    newConversation();
    return;
  }
  rememberChoice(curConvId);
  // Start a fresh transient stream before the server emits turn/started. This
  // prevents a lost/late lifecycle event from appending the next answer to the
  // previous turn's bubble.
  resetTurn({ convId: curConvId, sessionId: convs.find((conv) => conv.id === curConvId)?.threadId || null });
  send({ type: 'chat', conversationId: curConvId, text, choice });
}

function appendLocalUser(text) {
  const wrap = appendMsg('user', text);
  wrap.appendChild(msgMeta(`${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · 你`));
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
        fillModelSelect(null);
        if (message.evidenceFile) {
          els.evidencePath.dataset.path = message.evidenceFile;
          els.evidencePath.textContent = message.evidenceFile;
        }
        if (convs.length && !curConvId) curConvId = [...convs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0].id;
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
          pendingText = null;
          pendingChoice = null;
          rememberChoice(curConvId);
          send({ type: 'chat', conversationId: curConvId, text, choice });
        }
        break;
      }
      case 'user_message':
        if (message.convId === curConvId) appendLocalUser(message.text);
        break;
      case 'evt':
        handleEvt(message.method, message.params, message);
        break;
      case 'turn_end':
        if (message.convId && message.convId !== curConvId) break;
        if (message.runId && turn.turnId && message.runId !== turn.turnId) break;
        turn.ended = true;
        finishThinking();
        setBusy(false);
        if (message.status === 'completed') {
          toast('本轮分析完成');
          loadEvidence();
        } else {
          els.turnbar.classList.add('fail');
          els.turnbar.classList.remove('hidden');
          els.turnStatus.textContent = `执行失败：${message.error || '未知错误'}`;
          toast(`执行失败：${message.error || '未知错误'}`, true);
        }
        break;
      case 'guard':
        showGuard(message);
        break;
      case 'error':
        if (message.convId === curConvId) {
          els.turnbar.classList.add('fail');
          els.turnbar.classList.remove('hidden');
          els.turnStatus.textContent = message.message;
        }
        toast(message.message || '未知错误', true);
        setBusy(false);
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
    if (!localStorage.getItem(STORAGE.session)) return;
    reconnectTimer = window.setTimeout(connect, 3000);
  });
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
els.logout.addEventListener('click', logout);
els.sidebarUser.addEventListener('click', () => els.userMenu.classList.toggle('hidden'));
els.headerAvatar.addEventListener('click', () => els.userMenu.classList.toggle('hidden'));
document.addEventListener('click', (event) => {
  if (!els.userMenu.classList.contains('hidden') && !els.userMenu.contains(event.target) && !els.headerAvatar.contains(event.target) && !els.sidebarUser.contains(event.target)) els.userMenu.classList.add('hidden');
});

/* Navigation and command center */
$$('.nav-item').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
$$('.nav-action, [data-target].metric').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); showView(button.dataset.target); }));
$$('.prompt-action').forEach((button) => button.addEventListener('click', () => openPrompt(button.dataset.prompt)));
$('[data-harbor-tab="agents"]')?.classList.add('active');
$$('[data-harbor-tab]').forEach((button) => button.addEventListener('click', () => showHarborTab(button.dataset.harborTab)));
$$('[data-harbor-create]').forEach((button) => button.addEventListener('click', () => openHarborModal(button.dataset.harborCreate)));
els.btnAddAgent.addEventListener('click', () => openHarborModal('agent'));
els.btnAddRuntime.addEventListener('click', () => openHarborModal('runtime'));
els.harborRuntimeList.addEventListener('click', (event) => {
  const button = event.target.closest('.harbor-verify');
  if (button) verifyHarborRuntime(button.dataset.runtimeId, button);
});
els.harborModalClose.addEventListener('click', closeHarborModal);
els.harborFormCancel.addEventListener('click', closeHarborModal);
els.harborForm.addEventListener('submit', submitHarborForm);
els.harborModal.addEventListener('mousedown', (event) => { if (event.target === els.harborModal) closeHarborModal(); });
els.headerAgent.addEventListener('click', () => showView('chat'));
els.headerAttention.addEventListener('click', () => showView('attention'));
els.commandTrigger.addEventListener('click', openCommandPalette);
els.commandInput.addEventListener('input', () => { commandIndex = 0; renderCommandResults(); });
els.commandPalette.addEventListener('mousedown', (event) => { if (event.target === els.commandPalette) closeCommandPalette(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.harborModal.classList.contains('hidden')) {
    closeHarborModal();
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
els.btnSend.addEventListener('click', () => doSend());
els.btnStop.addEventListener('click', () => send({ type: 'interrupt', conversationId: curConvId }));
els.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    doSend();
  }
});
els.input.addEventListener('input', resizeComposer);
$$('.chip').forEach((chip) => chip.addEventListener('click', () => doSend(chip.dataset.p)));
els.guardAllow.addEventListener('click', () => decideGuard('accept'));
els.guardDeny.addEventListener('click', () => decideGuard('decline'));
els.cfgProvider.addEventListener('change', () => { els.cfgProviderHint.textContent = hintFor(els.cfgProvider.value); });
els.btnAddProvider.addEventListener('click', () => { providerRows.push({ id: `provider-${providerRows.length + 1}`, wire_api: 'responses' }); renderProviders(); });
els.btnSaveConfig.addEventListener('click', saveConfig);
els.evRefresh.addEventListener('click', loadEvidence);

refreshIcons();
if (localStorage.getItem(STORAGE.session)) showWorkspace(false);
else {
  els.loginStage.classList.remove('hidden');
  window.setTimeout(() => els.loginAccount.focus(), 30);
}
