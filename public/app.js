import { questionDateKey, selectDailyQuestions } from './daily-questions.js';
import { buildAgentRegistrationPayload, eligibleParentAgents, registrationRule } from './agent-registration.js';
import { buildCollaborationTaskPayload, buildTaskAssignmentPayload, canCreateTaskFromCase, filterCollaborationTasks, g1TaskUiMutationGate, projectDisplayState, taskDisplayState, taskUiCapabilities } from './task-center.js';
import { describeExecutionQuery, describeExecutionReasoning, parseExecutionQuery, parseExecutionReasoning, parseExecutionQueryByIntent } from './execution-query-intent.js?v=execution-query-intent-v5-20261015';
import { summarizeExecutionResult, summarizeReasoningResult } from './execution-query-summary.js?v=execution-query-summary-v6-20261026';
import { renderAgentCandidatePanel } from './task-agent-eligibility.js';
import { buildPersonnelCreateRequest, buildPersonnelResetRequest, buildPersonnelRolesRequest, personnelConfigEntryVisible, onboardingConfigEntryVisible, personnelFailureReason, PERSONNEL_ROLE_LABELS, personnelSaveFeedback } from './personnel-admin.js';
import { attachBusinessObjectRef, groupExecutionAgentsBySystem, isHighestRiskOrderQuery, isReasoningOnly, requiresBusinessObjectRef, selectExecutionCapabilities } from './execution-agent-routing.js?v=highest-risk-v1';
import { buildCapabilityParams, matchCapabilityTemplate, summarizeCapabilityResult } from './capability-template-intent.js?v=capability-template-intent-v2';
import { localizeDynamicCopy, localizeStaticDocument, localizeUiText } from './ui-localization.js';
import { formatBeijingDate, formatBeijingDateTime, formatBeijingTime, isSameBeijingDay } from './time-format.js?v=beijing-time-v1-20261023';

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
  togglePassword: $('#toggle-password'), loginTransition: $('#login-transition'), localLoginFields: $('#local-login-fields'),
  m01LoginAction: $('#m01-login-action'), m01LoginSubmit: $('#m01-login-submit'), loginMethodNote: $('#login-method-note'), loginFootNote: $('#login-foot-note'),
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
  attentionTable: $('#attention-table'), attentionSearch: $('#attention-search'), attentionLiveQuery: $('#attention-live-query'), attentionSearchStatus: $('#attention-search-status'), attentionSearchResults: $('#attention-search-results'), attentionSearchClose: $('#attention-search-close'), attentionSearchCaption: $('#attention-search-caption'), attentionResultAttention: $('#attention-result-attention'), attentionResultLive: $('#attention-result-live'), attentionResultHistory: $('#attention-result-history'), attentionSourceFilter: $('#attention-source-filter'),
  attentionStateFilter: $('#attention-state-filter'), attentionLevelFilter: $('#attention-level-filter'), attentionFilterCount: $('#attention-filter-count'),
  navInboxCount: $('#nav-inbox-count'), caseOpenCount: $('#case-open-count'), caseReviewCount: $('#case-review-count'),
  caseApprovalCount: $('#case-approval-count'), caseInboxCount: $('#case-inbox-count'), caseList: $('#case-list'),
  btnCasesRefresh: $('#btn-cases-refresh'), inboxList: $('#inbox-list'),
  navTaskCount: $('#nav-task-count'), taskDraftCount: $('#task-draft-count'), taskActiveCount: $('#task-active-count'),
  taskVerifyCount: $('#task-verify-count'), taskAttentionCount: $('#task-attention-count'), taskCaseSelect: $('#task-case-select'),
  taskPriority: $('#task-priority'), taskCreateControls: $('#task-create-controls'), taskCreateHint: $('#task-create-hint'), taskReadonlyNote: $('#task-readonly-note'), btnTaskCreate: $('#btn-task-create'),
  btnTasksRefresh: $('#btn-tasks-refresh'), controlledTaskSection: $('#controlled-task-section'), taskListCount: $('#task-list-count'), taskSearch: $('#task-search'), taskList: $('#task-list'),
  btnTaskManualCreate: $('#btn-task-manual-create'), manualTaskCreatePanel: $('#manual-task-create-panel'), manualTaskForm: $('#manual-task-form'), manualTaskProject: $('#manual-task-project'), taskSearch: $('#task-search'), taskStatusFilter: $('#task-status-filter'), taskProjectFilter: $('#task-project-filter'), taskBoard: $('#task-board'),
  btnProjectsRefresh: $('#btn-projects-refresh'), btnProjectCreate: $('#btn-project-create'), projectCreatePanel: $('#project-create-panel'), projectForm: $('#project-form'), projectSearch: $('#project-search'), projectStatusFilter: $('#project-status-filter'), projectList: $('#project-list'), projectWorkspace: $('#project-workspace'),
  btnG0Refresh: $('#btn-g0-refresh'), g0Readiness: $('#g0-readiness'), g0DecisionStatus: $('#g0-decision-status'),
  g0ConfigEntry: $('#g0-config-entry'), btnOpenG0Governance: $('#btn-open-g0-governance'),
  g0Form: $('#g0-decision-form'), g0FormAccess: $('#g0-form-access'), g0FormStatus: $('#g0-form-status'), btnG0Save: $('#btn-g0-save'),
  g0FirstScenario: $('#g0-first-scenario'), g0BusinessOwner: $('#g0-business-owner'), g0VerifyActor: $('#g0-verify-actor'),
  g0DemoTenant: $('#g0-demo-tenant'), g0OrganizationScope: $('#g0-organization-scope'), g0ManagerActor: $('#g0-manager-actor'),
  g0OperatorActor: $('#g0-operator-actor'), g0OwnerActor: $('#g0-owner-actor'), g0M02Owner: $('#g0-m02-owner'),
  g0TaskStore: $('#g0-task-store'), g0G4Admission: $('#g0-g4-admission'), g0DecisionNote: $('#g0-decision-note'),
  g0HistoryCount: $('#g0-history-count'), g0DecisionHistory: $('#g0-decision-history'), g0HistorySearch: $('#g0-history-search'),
  personnelConfigEntry: $('#personnel-config-entry'), btnOpenPersonnelAdmin: $('#btn-open-personnel-admin'),
  btnPersonnelRefresh: $('#btn-personnel-refresh'), personnelSearch: $('#personnel-search'), btnPersonnelCreate: $('#btn-personnel-create'),
  personnelAccess: $('#personnel-access'), personnelListCount: $('#personnel-list-count'), personnelList: $('#personnel-list'), personnelStatus: $('#personnel-status'),
  personnelCreateModal: $('#personnel-create-modal'), personnelCreateClose: $('#personnel-create-close'), personnelCreateForm: $('#personnel-create-form'),
  personnelCreateUsername: $('#personnel-create-username'), personnelCreatePassword: $('#personnel-create-password'), personnelCreateEmail: $('#personnel-create-email'),
  personnelCreateFirst: $('#personnel-create-first'), personnelCreateLast: $('#personnel-create-last'), personnelCreateRoles: $('#personnel-create-roles'),
  personnelCreateStatus: $('#personnel-create-status'), personnelCreateCancel: $('#personnel-create-cancel'), personnelCreateSubmit: $('#personnel-create-submit'),
  personnelResetModal: $('#personnel-reset-modal'), personnelResetClose: $('#personnel-reset-close'), personnelResetForm: $('#personnel-reset-form'),
  personnelResetTarget: $('#personnel-reset-target'), personnelResetPassword: $('#personnel-reset-password'), personnelResetStatus: $('#personnel-reset-status'),
  personnelResetCancel: $('#personnel-reset-cancel'), personnelResetSubmit: $('#personnel-reset-submit'),
  roleConfigEntry: $('#role-config-entry'), permissionConfigEntry: $('#permission-config-entry'),
  btnOpenRoleAdmin: $('#btn-open-role-admin'), btnOpenPermissionAdmin: $('#btn-open-permission-admin'),
  btnRoleRefresh: $('#btn-role-refresh'), btnRoleCreate: $('#btn-role-create'), roleSearch: $('#role-search'), roleMetrics: $('#role-metrics'), roleList: $('#role-list'), roleStatus: $('#role-status'),
  roleCreateModal: $('#role-create-modal'), roleCreateClose: $('#role-create-close'), roleCreateCancel: $('#role-create-cancel'), roleCreateForm: $('#role-create-form'), roleCreateCode: $('#role-create-code'), roleCreateName: $('#role-create-name'), roleCreateDescription: $('#role-create-description'), roleCreateStatus: $('#role-create-status'),
  rolePermissionModal: $('#role-permission-modal'), rolePermissionClose: $('#role-permission-close'), rolePermissionCancel: $('#role-permission-cancel'), rolePermissionForm: $('#role-permission-form'), rolePermissionTitle: $('#role-permission-title'), rolePermissionGrid: $('#role-permission-grid'), rolePermissionStatus: $('#role-permission-status'),
  btnPermissionRefresh: $('#btn-permission-refresh'), btnPermissionCreate: $('#btn-permission-create'), permissionSummary: $('#permission-summary'), permissionList: $('#permission-list'), permissionStatus: $('#permission-status'),
  permissionEditModal: $('#permission-edit-modal'), permissionEditClose: $('#permission-edit-close'), permissionEditCancel: $('#permission-edit-cancel'), permissionEditForm: $('#permission-edit-form'), permissionEditTitle: $('#permission-edit-title'), permissionEditCode: $('#permission-edit-code'), permissionEditName: $('#permission-edit-name'), permissionEditParent: $('#permission-edit-parent'), permissionEditRoute: $('#permission-edit-route'), permissionEditSort: $('#permission-edit-sort'), permissionEditEnabled: $('#permission-edit-enabled'), permissionEditOperations: $('#permission-edit-operations'), permissionEditStatus: $('#permission-edit-status'),
  onboardingConfigEntry: $('#onboarding-config-entry'), btnOpenPersonnelOnboarding: $('#btn-open-personnel-onboarding'),
  btnOpenPersonnelAdminFromOnboarding: $('#btn-open-personnel-admin-from-onboarding'),
  onboardingCreateForm: $('#onboarding-create-form'), onboardingCreateRows: $('#onboarding-create-rows'), btnOnboardingCreate: $('#btn-onboarding-create'), onboardingCreateStatus: $('#onboarding-create-status'),
  onboardingG0Form: $('#onboarding-g0-form'), obG0BusinessOwner: $('#ob-g0-business-owner'), obG0Verify: $('#ob-g0-verify'), obG0Operator: $('#ob-g0-operator'),
  obG0Manager: $('#ob-g0-manager'), obG0Tenant: $('#ob-g0-tenant'), obG0Organization: $('#ob-g0-organization'), obG0Note: $('#ob-g0-note'),
  onboardingG0Readiness: $('#onboarding-g0-readiness'), btnOnboardingG0Save: $('#btn-onboarding-g0-save'), onboardingG0Status: $('#onboarding-g0-status'),
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
  harborAgentSearch: $('#harbor-agent-search'), harborAgentLevelFilter: $('#harbor-agent-level-filter'), harborAgentStatusFilter: $('#harbor-agent-status-filter'), harborAgentDomainFilter: $('#harbor-agent-domain-filter'), harborAgentFilterClear: $('#harbor-agent-filter-clear'), harborShowHiddenAgents: $('#harbor-show-hidden-agents'), catalogSummary: $('#catalog-summary'),
  btnAddAgent: $('#btn-add-agent'), btnAddRuntime: $('#btn-add-runtime'),
  harborModal: $('#harbor-modal'), harborModalKicker: $('#harbor-modal-kicker'), harborModalTitle: $('#harbor-modal-title'),
  harborModalDesc: $('#harbor-modal-desc'), harborModalClose: $('#harbor-modal-close'), harborForm: $('#harbor-form'),
  harborFormFields: $('#harbor-form-fields'), harborFormStatus: $('#harbor-form-status'),
  harborFormCancel: $('#harbor-form-cancel'), harborFormSubmit: $('#harbor-form-submit'),
};

let ws = null;
let reconnectTimer = null;
let authenticated = false;
let authSession = null;
// 业务视图：默认隐藏技术/管理模块，管理者可一键切到完整视图。
const VIEW_MODE_KEY = 'aeos-hub-view-mode-v1';
const MANAGEMENT_VIEWS = new Set([
  'borrow', 'ai-obs', 'ops', 'config', 'registry', 'evidence', 'harbor',
  'g0-governance', 'personnel-admin', 'role-admin', 'permission-admin', 'personnel-onboarding',
]);
let businessMode = localStorage.getItem(VIEW_MODE_KEY) !== 'full';
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
let harborAgentFilter = { query: '', level: 'all', status: 'all', domain: 'all' };
let showHiddenHarborAgents = false;
let catalogTree = null;
let catalogView = 'ownership';
let catalogExpansionInitialized = false;
let catalogExpandedAgentId = null;
const expandedCatalogSystems = new Set();
const expandedCatalogDomains = new Set();
let harborModalType = null;
let squad = { version: 1, lead: null, members: [], memories: [], activities: [], messages: [] };
let chatScope = { type: 'hub', agentId: null, squadId: null, label: '中枢会话' };
let evidenceRows = [];
let conversationQuery = '';
let attentionFilter = { query: '', source: 'all', state: 'all', level: 'all' };
let attentionLiveResult = null;
let attentionLiveSearchBusy = false;
let attentionResultsDismissed = false;
let registryFilter = { query: '', source: 'all', state: 'all' };
let personnelUsers = [];
let personnelTargetId = null;
let accessRoles = [];
const OPERATION_LABELS = { create: '新增', read: '查看', update: '编辑', delete: '删除' };
const VIEW_RESOURCE = { dashboard: 'dashboard', chat: 'analysis', attention: 'analysis', tasks: 'tasks', projects: 'tasks', harbor: 'agents', evidence: 'evidence', registry: 'system' };
let myGrants = [];
let accessResources = [];
let accessRoleTarget = null;
let accessResourceTarget = null;
const collapsedAccessResources = new Set();
let onboardingUsers = [];
// Agent 小队外壳已退役；AI 港湾与目录树承担归属展示。
let dailyQuestionConfig = null;
let operatingCenterState = { cases: [], decisions: [], inbox: [], unreadInboxCount: 0 };
let taskCenterState = { tasks: [], total: 0 };
let projectCenterState = { projects: [], total: 0 };
let taskBoardView = 'board';
let selectedProjectId = null;
let g0DecisionSnapshot = null;
const taskDetails = new Map();
const projectTaskDetails = new Map();
const taskAgentCandidates = new Map();
let editingTaskAssignmentId = null;
let editingCollaborationAssignmentId = null;
let editingTaskProjectId = null;
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
let executionRefreshTimer = null;
const EXECUTION_LIVE_REFRESH_MS = 2_000;
let borrowRefreshTimer = null;
const BORROW_LIVE_REFRESH_MS = 5_000;
let opsRefreshTimer = null;
const OPS_LIVE_REFRESH_MS = 15_000;
let aiObsRefreshTimer = null;
const AI_OBS_REFRESH_MS = 15_000;
let aiObsTab = 'runs';
let aiRuns = [];
let aiAgents = [];
let aiBorrowByRun = new Map();
let selectedAiRunId = null;
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
let authMode = 'local-dev';
const MAX_STREAM_OUTPUT = 4 * 1024 * 1024;
const MAX_IMAGE_BASE64 = 16 * 1024 * 1024;

const commands = [
  { view: 'dashboard', label: '管理者首页', desc: '目标、风险、TOP 决策与治理脉冲', icon: 'layout-dashboard', group: '经营总览' },
  { view: 'chat', label: '智能助手', desc: '跨域经营分析与能力调用', icon: 'bot', group: '助手与待办' },
  { view: 'attention', label: '待关注事项', desc: '需要责任人介入的例外事项', icon: 'list-checks', group: '助手与待办' },
  { view: 'tasks', label: '任务', desc: '任务看板、责任角色、时限与业务核验闭环', icon: 'list-todo', group: '任务协同' },
  { view: 'projects', label: '项目', desc: '项目目标、成员、进度与关联任务', icon: 'folder-kanban', group: '任务协同' },
  { view: 'cases', label: '经营事项', desc: '风险建档、人工决策与闭环验证', icon: 'clipboard-list', group: '经营闭环' },
  { view: 'inbox', label: 'Inbox', desc: '待确认事项、扫描结果与决策留痕', icon: 'inbox', group: '经营闭环' },
  { view: 'harbor', label: 'AI 资源', desc: '智能体、运行节点与人机协作项目', icon: 'waypoints', group: '成本与资源' },
  { view: 'evidence', label: '证据与审计', desc: '事实、工具、审批与结果事件流', icon: 'file-search', group: '治理与审计' },
  { view: 'registry', label: '能力目录', desc: '系统与业务能力注册表', icon: 'boxes', group: '治理与审计' },
  { view: 'borrow', label: '跨系统查询', desc: '跨系统只读能力借调单与结果回传', icon: 'arrow-left-right', group: '分析与记录' },
  { view: 'trace', label: '处理记录', desc: '一次分析从发起到依据的完整处理记录', icon: 'git-branch', group: '分析与记录' },
  { view: 'ai-obs', label: 'AI 运行观测', desc: 'Hub 派单任务与各系统自有助手的统一观测', icon: 'scan-eye', group: '分析与记录' },
  { view: 'ops', label: '运行状态', desc: '服务健康、模型错误、借调失败率与备份状态', icon: 'activity', group: '系统' },
  { view: 'config', label: '系统配置', desc: '模型提供商与隔离运行时', icon: 'settings', group: '系统' },
  { view: 'writes', label: '写操作', desc: '提交、审批与追踪写操作', icon: 'file-pen-line', group: '系统' },
];

// Local experience review: keep module implementations intact while temporarily
// removing their routes from the decision-maker interface.
// 跨系统查询与 AI 资源：新架构下中枢分析走直接派单、Hub 不再托管域 Agent；页面/API/数据保留，仅从导航与命令面板隐藏。
const LOCALLY_HIDDEN_VIEWS = new Set(['cases', 'inbox', 'tasks', 'projects', 'borrow', 'harbor']);
const VIEW_TITLES = { ...Object.fromEntries(commands.map((item) => [item.view, item.label])), 'g0-governance': 'G0 决策登记', 'personnel-admin': '用户管理', 'role-admin': '角色管理', 'permission-admin': '权限管理', 'personnel-onboarding': '首次人员开通', 'execution': '分析工作台', 'usage': '分析成本' };
const SPLIT = '::';

function refreshIcons(root = document) {
  localizeDynamicCopy(root);
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
  node.textContent = localizeUiText(message);
  els.toasts.appendChild(node);
  window.setTimeout(() => node.remove(), 4500);
}

function setLoginBusy(state) {
  if (authMode === 'm01') return;
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

function setLoginMode(mode) {
  authMode = mode === 'm01' ? 'm01' : 'local-dev';
  const m01 = authMode === 'm01';
  els.localLoginFields.classList.toggle('hidden', m01);
  els.m01LoginAction.classList.toggle('hidden', !m01);
  els.loginMethodNote.textContent = m01 ? '通过企业统一身份认证继续' : '使用你的账号继续';
  els.loginFootNote.textContent = m01 ? '统一登录由企业身份平台提供' : '账号与密码由管理员配置';
  els.loginForm.noValidate = true;
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
  if (authMode === 'm01') return;
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
    const sessionResponse = await fetch('/api/auth/session', { credentials: 'same-origin' });
    authSession = sessionResponse.ok ? await sessionResponse.json().catch(() => null) : null;
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
      ['chat', 'bot', '智能助手', '直接进入跨域经营对话'],
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
      <p>AEOS 将以只读试点边界连接智能助手、能力、证据与治理</p>
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

function m01RoleLabel(session) {
  const roles = Array.isArray(session?.roles) ? session.roles : [];
  for (const role of ['manager', 'supervisor', 'operator', 'owner']) {
    if (roles.includes(role)) return PERSONNEL_ROLE_LABELS[role] || role;
  }
  return '已登录';
}

function applyProfile() {
  const m01 = authSession?.authMode === 'm01';
  const profile = parseStored(STORAGE.profile, { name: '管理者', role: '决策责任人', avatar: '' });
  const name = m01 ? 'M01 用户' : (profile.name || '管理者');
  const role = m01 ? m01RoleLabel(authSession) : (profile.role || '决策责任人');
  const avatarUrl = m01 ? '' : (profile.avatar || '');
  els.sidebarUserName.textContent = name;
  els.sidebarUserRole.textContent = role;
  els.menuUserName.textContent = name;
  els.menuUserRole.textContent = role;
  const label = m01 ? role.slice(0, 1) : initials(profile.name);
  [els.sidebarAvatar, els.headerAvatar].forEach((avatar) => {
    avatar.textContent = avatarUrl ? '' : label;
    avatar.style.backgroundImage = avatarUrl ? `url("${String(avatarUrl).replace(/"/g, '%22')}")` : '';
    avatar.style.backgroundSize = 'cover';
    avatar.style.backgroundPosition = 'center';
  });
}

function viewVisibleForRole(view, session) {
  const roles = Array.isArray(session?.roles) ? session.roles : [];
  if (businessMode && MANAGEMENT_VIEWS.has(view)) return false;
  const managerOnly = ['config', 'personnel-admin', 'role-admin', 'permission-admin', 'personnel-onboarding', 'g0-governance'];
  if (managerOnly.includes(view)) return roles.includes('manager');
  const resource = VIEW_RESOURCE[view];
  if (resource && myGrants.length > 0) {
    return myGrants.some((grant) => grant.resourceCode === resource && Array.isArray(grant.operations) && grant.operations.includes('read'));
  }
  if (roles.includes('manager') || roles.includes('supervisor')) return true;
  return ['chat', 'attention', 'tasks', 'projects', 'evidence', 'usage', 'borrow'].includes(view);
}

function defaultViewForSession(session) {
  const roles = Array.isArray(session?.roles) ? session.roles : [];
  const preferred = (roles.includes('manager') || roles.includes('supervisor')) ? 'dashboard' : 'tasks';
  return LOCALLY_HIDDEN_VIEWS.has(preferred) ? 'chat' : preferred;
}

function applyNavVisibility() {
  syncViewModeControl();
  $$('.nav-item').forEach((item) => {
    const view = item.dataset.view;
    if (view) item.classList.toggle('hidden', LOCALLY_HIDDEN_VIEWS.has(view) || !viewVisibleForRole(view, authSession));
  });
  $$('.nav-group').forEach((group) => {
    const visible = [...group.querySelectorAll('.nav-item')].some((item) => !item.classList.contains('hidden'));
    group.classList.toggle('hidden', !visible);
  });
  $$('.nav-item:not(.hidden)').forEach((node, index) => node.style.setProperty('--nav-order', String(index)));
}

function canToggleViewMode(session) {
  const roles = Array.isArray(session?.roles) ? session.roles : [];
  return roles.some((role) => ['manager', 'supervisor', 'operator', 'owner'].includes(role));
}

function syncViewModeControl() {
  const button = $('#btn-view-mode');
  if (!button) return;
  const canToggle = canToggleViewMode(authSession);
  if (!canToggle) businessMode = true;
  button.classList.toggle('hidden', !canToggle);
  button.textContent = businessMode ? '切换到完整视图' : '切换到业务视图';
}

function showWorkspace(entering = false, forcedView = null) {
  els.loginStage.classList.add('hidden');
  els.welcomeStage.classList.add('hidden');
  els.app.classList.remove('hidden');
  els.app.classList.toggle('workspace-enter', entering && !prefersReducedMotion());
  applyProfile();
  syncG0GovernanceConfigEntry();
  syncPersonnelConfigEntry();
  syncOnboardingConfigEntry();
  applyNavVisibility();
  const onboarding = parseStored(STORAGE.onboarding, { defaultView: 'dashboard' });
  const hashView = location.hash.replace(/^#/, '');
  const initialView = forcedView || (VIEW_TITLES[hashView] ? hashView : onboarding.defaultView) || 'dashboard';
  showView(initialView, { updateHash: true, animate: !entering });
  connect();
  void loadG0DecisionView({ silent: true });
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
  authSession = null;
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
  window.clearInterval(borrowRefreshTimer);
  borrowRefreshTimer = null;
  window.clearInterval(opsRefreshTimer);
  opsRefreshTimer = null;
  window.clearInterval(aiObsRefreshTimer);
  aiObsRefreshTimer = null;
  history.replaceState(null, '', location.pathname);
  window.setTimeout(() => (authMode === 'm01' ? els.m01LoginSubmit : els.loginAccount).focus(), 30);

  try {
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) { showLoginError('本地已退出；服务端会话未能确认失效，请恢复网络后重新打开页面。'); return; }
    // M01 sign-out also ends the IdP session. The Hub hands back that URL instead of
    // issuing a redirect itself, because the IdP sits on a different origin.
    const outcome = await response.json().catch(() => null);
    if (typeof outcome?.redirectTo === 'string' && outcome.redirectTo) window.location.assign(outcome.redirectTo);
  } catch {
    showLoginError('本地已退出；服务端会话未能确认失效，请恢复网络后重新打开页面。');
  }
}

function showView(view, options = {}) {
  if (!VIEW_TITLES[view]) view = 'dashboard';
  if (LOCALLY_HIDDEN_VIEWS.has(view)) view = 'dashboard';
  if (!viewVisibleForRole(view, authSession)) view = defaultViewForSession(authSession);
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
  if (view === 'tasks') loadTasks();
  if (view === 'projects') loadTasks({ silent: true });
  if (view === 'g0-governance') loadG0DecisionView();
  if (view === 'personnel-admin') loadPersonnelAdminView();
  if (view === 'role-admin') loadRoleAdminView();
  if (view === 'permission-admin') loadPermissionAdminView();
  if (view === 'personnel-onboarding') loadPersonnelOnboardingView();
  if (view === 'inbox') loadInbox();
  if (view === 'registry' || view === 'chat') loadCapabilityRegistry({ silent: view === 'chat' });
  if (view === 'harbor') loadHarbor();
  if (view === 'attention') loadSquad({ silent: true });
  if (view === 'chat' && curConvId) send({ type: 'view', conversationId: curConvId });
  if (view === 'execution') loadExecution();
  if (view === 'usage') loadUsage();
  if (view === 'borrow') loadBorrowOrders();
  if (view === 'trace') loadTraceView();
  if (view === 'ai-obs') loadAiObs();
  if (view === 'ops') loadOps();
  if (view === 'writes') loadWrites();
  if (view === 'chat') loadConnectivity();
  syncDashboardLiveRefresh();
  syncConnectivityRefresh();
  syncExecutionRefresh();
  syncBorrowRefresh();
  syncAiObsRefresh();
  syncOpsRefresh();
}

function syncDashboardLiveRefresh() {
  window.clearInterval(dashboardLiveRefreshTimer);
  dashboardLiveRefreshTimer = null;
  if (!['dashboard', 'attention'].includes(currentView) || els.app.classList.contains('hidden')) return;
  dashboardLiveRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') loadDashboard({ silent: true, force: true });
  }, DASHBOARD_LIVE_REFRESH_MS);
}

function syncExecutionRefresh() {
  window.clearInterval(executionRefreshTimer);
  executionRefreshTimer = null;
  if (currentView !== 'execution' || els.app.classList.contains('hidden')) return;
  executionRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') loadExecution();
  }, EXECUTION_LIVE_REFRESH_MS);
}

let executionControlsWired = false;
let selectedExecutionAgent = null;
let executionAgents = [];
let executionRuns = [];
const collapsedExecutionSystems = new Set();
// 每个智能体独立一份聊天窗口（线程）：切换时隐藏当前、显示目标，各自历史与进行中的查询都不丢。
const executionThreads = new Map();

function wireExecutionControls() {
  if (executionControlsWired) return;
  executionControlsWired = true;
  $('#btn-execution-refresh')?.addEventListener('click', () => loadExecution());
  $('#btn-execution-send')?.addEventListener('click', () => sendExecutionQuery());
  $('#btn-execution-agents-toggle')?.addEventListener('click', () => {
    $('.execution-chat-layout')?.classList.toggle('collapsed');
  });
  $('#execution-chat-input')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') sendExecutionQuery(); });
  $('#btn-execution-agent-trace')?.addEventListener('click', () => openLatestTraceForAgent(selectedExecutionAgent));
  $('#btn-execution-agent-usage')?.addEventListener('click', () => {
    const agent = executionAgents.find((item) => item.agentId === selectedExecutionAgent);
    if (selectedExecutionAgent) openUsageForAgent(selectedExecutionAgent, agent?.name);
  });
  $('#execution-agent-list')?.addEventListener('click', (event) => {
    const systemUsage = event.target.closest('[data-execution-system-usage]');
    if (systemUsage) {
      const key = systemUsage.dataset.executionSystemUsage;
      const group = groupExecutionAgentsBySystem(executionAgents).find((item) => item.key === key);
      openUsageForSystem(key, group?.label);
      return;
    }
    const systemToggle = event.target.closest('[data-execution-system-toggle]');
    if (systemToggle) {
      const key = systemToggle.dataset.executionSystemToggle;
      if (collapsedExecutionSystems.has(key)) collapsedExecutionSystems.delete(key);
      else collapsedExecutionSystems.add(key);
      renderExecutionAgentList(executionAgents);
      return;
    }
    const item = event.target.closest('[data-execution-agent]');
    if (item) selectExecutionAgent(item.dataset.executionAgent);
  });
}

function executionConnectionLabel(status) {
  return status === 'online' ? '在线' : status === 'offline' ? '离线' : status;
}

// 打字机式流式输出到指定元素。
function streamTextInto(element, text) {
  let index = 0;
  const chunk = 3;
  const step = () => {
    index = Math.min(index + chunk, text.length);
    element.textContent = text.slice(0, index);
    if (index < text.length) setTimeout(step, 16);
  };
  step();
}

let executionUsageByAgent = new Map();
let executionUsageBySystem = new Map();

async function loadExecution() {
  wireExecutionControls();
  let data;
  let usage = null;
  try {
    const [agentsResponse, usageResponse] = await Promise.all([
      fetch('/api/execution/agents'),
      fetch('/api/usage/summary', { headers: { accept: 'application/json' } }).catch(() => null),
    ]);
    if (!agentsResponse.ok) return;
    data = await agentsResponse.json();
    if (usageResponse?.ok) usage = await usageResponse.json().catch(() => null);
  } catch { return; }
  executionAgents = Array.isArray(data?.agents) ? data.agents.filter((agent) => !agent.deregisteredAt) : [];
  executionRuns = Array.isArray(data?.runs) ? data.runs : [];
  const byAgent = Array.isArray(usage?.byAgent) ? usage.byAgent : [];
  const bySystem = Array.isArray(usage?.bySystem) ? usage.bySystem : [];
  executionUsageByAgent = new Map(byAgent.map((row) => [row.agentId, row]));
  executionUsageBySystem = new Map(bySystem.map((row) => [row.systemId, row]));
  renderExecutionAgentList(executionAgents);
}

function executionUsageText(row) {
  if (!row || !Number(row.events)) return '';
  const when = row.lastAt ? ` · ${formatBeijingTime(row.lastAt)}` : '';
  return `¥${formatUsageCost(row.cost)} · ${formatTokenCount(row.events)} 次${when}`;
}

function renderExecutionAgentItem(agent) {
  const online = agent.connectionStatus === 'online';
  const selected = selectedExecutionAgent === agent.agentId;
  const location = agent.local === true ? '本机' : '远程';
  const sourceText = typeof agent.sourceSystemName === 'string' && agent.sourceSystemName.trim()
    ? agent.sourceSystemName.trim()
    : typeof agent.sourceSystem === 'string' && agent.sourceSystem.trim()
      ? agent.sourceSystem.trim()
      : '来源待补充';
  const gatewayBadge = agent.agentKind === 'system-gateway'
    ? `<span class="execution-agent-identity execution-agent-gateway" title="系统网关${agent.gatewayVersion ? ` · v${esc(agent.gatewayVersion)}` : ''}">网关</span>`
    : '';
  const usageText = executionUsageText(executionUsageByAgent.get(agent.agentId));
  return `<button class="execution-agent-item${selected ? ' selected' : ''}" type="button" data-execution-agent="${esc(agent.agentId)}"${online ? '' : ' disabled'}>
    <span class="execution-agent-title"><span class="execution-agent-name">${esc(agent.name)}</span><span class="execution-agent-identities"><span class="execution-agent-identity execution-agent-location ${agent.local === true ? 'local' : 'remote'}">${location}</span><span class="execution-agent-identity execution-agent-source" title="来源系统：${esc(sourceText)}">来源：${esc(sourceText)}</span>${gatewayBadge}${agent.simulated === true ? '<span class="execution-agent-identity execution-agent-simulated">模拟</span>' : ''}</span>${usageText ? `<span class="execution-agent-usage" title="调用次数与成本">${esc(usageText)}</span>` : ''}</span>
    <b class="status-pill ${online ? 'ok' : 'info'}">${esc(executionConnectionLabel(agent.connectionStatus))}</b>
  </button>`;
}

function renderExecutionAgentList(agents) {
  const root = $('#execution-agent-list');
  if (!root) return;
  if (!agents.length) {
    root.innerHTML = '<div class="harbor-empty"><i data-lucide="radio-tower"></i><strong>暂无执行面在线</strong><small>等执行面（或模拟器）反向连接后这里会显示</small></div>';
    refreshIcons(root);
    return;
  }
  const groups = groupExecutionAgentsBySystem(agents);
  root.innerHTML = groups.map((group) => {
    const collapsed = collapsedExecutionSystems.has(group.key);
    return `<section class="execution-system-group">
      <div class="execution-system-head-row">
        <button class="execution-system-head" type="button" data-execution-system-toggle="${esc(group.key)}" aria-expanded="${!collapsed}">
          <i data-lucide="${collapsed ? 'chevron-right' : 'chevron-down'}"></i>
          <span class="execution-system-name">${esc(group.label)}</span>
          <span class="execution-system-usage">${esc(executionUsageText(executionUsageBySystem.get(group.key)))}</span>
          <span class="execution-system-count">${group.onlineCount}/${group.total} 在线</span>
        </button>
        <button class="execution-system-usage-btn" type="button" data-execution-system-usage="${esc(group.key)}" title="查看该系统成本"><i data-lucide="book-open"></i>成本</button>
      </div>
      <div class="execution-system-agents${collapsed ? ' hidden' : ''}">${group.agents.map(renderExecutionAgentItem).join('')}</div>
    </section>`;
  }).join('');
  refreshIcons(root);
}

let usageSummary = null;
let usageControlsWired = false;
let usageFocus = null;

function openLatestTraceForAgent(agentId) {
  if (!agentId) return;
  const latest = (executionRuns || [])
    .filter((run) => run.agentId === agentId)
    .sort((left, right) => String(right.startedAt || '').localeCompare(String(left.startedAt || '')))[0];
  if (!latest) { toast('该 Agent 还没有执行记录'); return; }
  openTraceFor(latest.traceId || latest.runId);
}

function openUsageForAgent(agentId, label) {
  usageFocus = { kind: 'agent', id: agentId, label: label || usageAgentLabel(agentId) };
  usageTab = 'system';
  showView('usage');
}

function openUsageForSystem(systemId, label) {
  usageFocus = { kind: 'system', id: systemId, label: label || usageSystemLabel(systemId) };
  usageTab = 'system';
  showView('usage');
}

function wireUsageControls() {
  if (usageControlsWired) return;
  usageControlsWired = true;
  $('#btn-usage-refresh')?.addEventListener('click', () => loadUsage());
  $('#usage-focus')?.addEventListener('click', (event) => {
    if (!event.target.closest('[data-usage-focus-clear]')) return;
    usageFocus = null;
    renderUsage();
  });
  $$('.usage-tabs [data-usage-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      usageTab = button.dataset.usageTab === 'caller' ? 'caller' : 'system';
      renderUsage();
    });
  });
}

function formatTokenCount(value) {
  return Number(value ?? 0).toLocaleString('zh-CN');
}

function formatUsageCost(value) {
  const amount = Number(value ?? 0);
  if (amount === 0) return '0.00';
  if (amount < 0.01) return String(parseFloat(amount.toFixed(6)));
  return amount.toFixed(2);
}

/** 把技术错误码翻成业务用户能理解的一句话。 */
const ERROR_HINTS = {
  CAPABILITY_FORBIDDEN: '当前智能助手没有这项权限，请联系管理员开通',
  UPSTREAM_UNAVAILABLE: '中台服务暂时不可用，请稍后重试',
  UPSTREAM_AUTH_FAILED: '中台认证失败，请联系管理员检查配置',
  UPSTREAM_TIMEOUT: '中台分析超时，请稍后重试',
  REASONING_ABORTED: '分析已取消',
  TASK_CANCELLED: '分析已取消',
  TASK_IN_PROGRESS: '同一任务正在处理中，请稍候',
  NOT_FOUND: '没有找到可用数据，这不代表没有风险',
  INVALID_ARGUMENT: '提交的信息不完整，请补充订单号等业务信息后重试',
  DISPATCH_TIMEOUT: '处理超时，请稍后重试',
  RUN_TIMEOUT: '处理超时，请稍后重试',
  EXECUTION_TIMEOUT: '处理超时，请稍后重试',
  AGENT_OFFLINE: '智能助手暂时离线，请稍后重试',
  AGENT_NOT_ALLOWED: '该智能助手未获授权接入',
  PROVIDER_RECALLED: '处理已取消',
  FORBIDDEN: '没有权限执行该操作',
  RATE_LIMITED: '请求过于频繁，请稍后再试',
  INTERNAL_ERROR: '系统内部错误，请联系管理员',
};

function humanizeError(code, message) {
  const hint = ERROR_HINTS[String(code || '').trim()] || '';
  const detail = typeof message === 'string' ? message.trim() : '';
  if (hint) return detail && !detail.includes(hint) ? `${hint}（${detail}）` : hint;
  return detail || '处理失败，请稍后重试';
}

function usageTableHtml(rows, key, emptyText) {
  if (!rows.length) return `<div class="harbor-empty"><i data-lucide="book-open"></i><strong>暂无用量记录</strong><small>${esc(emptyText)}</small></div>`;
  const head = { agentId: 'Agent', systemId: '系统', callerAgentId: '调用方 Agent', callerUserId: '调用方用户' }[key] || key;
  const compact = businessMode;
  const body = rows.map((row) => {
    const raw = row[key];
    const label = key === 'agentId' || key === 'callerAgentId'
      ? usageAgentLabel(raw)
      : key === 'systemId' ? usageSystemLabel(raw) : raw;
    const tokens = (Number(row.tokensIn) || 0) + (Number(row.tokensOut) || 0);
    const queryOnly = (Number(row.events) || 0) > 0
      && Number(row.queryEvents) === Number(row.events)
      && tokens === 0
      && Number(row.cost) === 0;
    const costCell = queryOnly
      ? '<span class="num" title="查询接口不产生模型费用">—</span>'
      : `<span class="num">¥${formatUsageCost(row.cost)}</span>`;
    if (compact) {
      return `<div class="harbor-row"><span title="${esc(raw)}">${esc(label)}</span>${costCell}<span class="num">${formatTokenCount(row.events)}</span></div>`;
    }
    const inputCell = queryOnly
      ? '<span class="num" title="查询接口不经过模型，不产生模型 Token">无模型 Token</span>'
      : `<span class="num">${formatTokenCount(row.tokensIn)}</span>`;
    const outputCell = queryOnly ? '<span class="num">—</span>' : `<span class="num">${formatTokenCount(row.tokensOut)}</span>`;
    return `<div class="harbor-row"><span title="${esc(raw)}">${esc(label)}</span>${inputCell}${outputCell}${costCell}<span class="num">${formatTokenCount(row.events)}</span></div>`;
  }).join('');
  const header = compact
    ? `<div class="harbor-row harbor-head"><span>${head}</span><span class="num">成本（¥）</span><span class="num">次数</span></div>`
    : `<div class="harbor-row harbor-head"><span>${head}</span><span class="num">输入 Token</span><span class="num">输出 Token</span><span class="num">成本（¥）</span><span class="num">调用次数</span></div>`;
  return `<div class="harbor-table usage-table${compact ? ' compact' : ''}">${header}${body}</div>`;
}

const USAGE_AGENT_LABELS = {
  'agent-aeos-hub': 'AEOS 智能助手',
  'control-platform-assistant': '中台助手',
  'gateway-control-platform': '中台分析通道（网关）',
  'runtime-control-platform-agent': '中台执行面（历史）',
  'runtime-control-platform-query': '中台查询（历史）',
  'runtime-control-platform-reasoning': '中台分析（历史）',
  'runtime-control-platform-order': '中台订单（历史）',
  'runtime-execution-query': '恒剑 PLM 执行面智能体',
  'usage-probe-agent': '用量探针（临时）',
};
const EXECUTION_CHANNEL_PREFIXES = ['gateway-', 'runtime-'];
function isExecutionChannelAgent(agentId) {
  const id = String(agentId || '');
  return EXECUTION_CHANNEL_PREFIXES.some((prefix) => id.startsWith(prefix));
}
function isProbeAgent(agentId) {
  return /(probe|demo)/i.test(String(agentId || ''));
}
function isQueryOnlyUsageRow(row) {
  const tokens = (Number(row.tokensIn) || 0) + (Number(row.tokensOut) || 0);
  return (Number(row.events) || 0) > 0
    && Number(row.queryEvents) === Number(row.events)
    && tokens === 0
    && Number(row.cost) === 0;
}

const USAGE_SYSTEM_LABELS = {
  'aeos-hub': 'AEOS Hub',
  'control-platform': '公司中控平台',
  'demo-usage-probe': '用量探针（临时）',
};
let usageAgentNames = new Map();
let usageSimulatedAgentIds = new Set();
let usageAgentSystem = new Map();
let usageTab = 'system';

function usageAgentLabel(agentId) {
  const label = USAGE_AGENT_LABELS[agentId] || usageAgentNames.get(agentId) || agentId;
  return usageSimulatedAgentIds.has(agentId) ? `${label}（模拟）` : label;
}

function usageSystemLabel(systemId) {
  return USAGE_SYSTEM_LABELS[systemId] || systemId;
}

async function loadUsage() {
  wireUsageControls();
  let data;
  try {
    const [usageResponse, agentsResponse] = await Promise.all([
      fetch('/api/usage/summary', { headers: { accept: 'application/json' } }),
      fetch('/api/execution/agents', { headers: { accept: 'application/json' } }),
    ]);
    if (!usageResponse.ok) return;
    data = await usageResponse.json();
    if (agentsResponse.ok) {
      const agentsData = await agentsResponse.json();
      usageAgentNames = new Map((Array.isArray(agentsData?.agents) ? agentsData.agents : [])
        .map((agent) => [agent.agentId, agent.name]));
      usageSimulatedAgentIds = new Set((Array.isArray(agentsData?.agents) ? agentsData.agents : [])
        .filter((agent) => agent.simulated === true)
        .map((agent) => agent.agentId));
      usageAgentSystem = new Map((Array.isArray(agentsData?.agents) ? agentsData.agents : [])
        .map((agent) => [agent.agentId, agent.systemId || agent.sourceSystem || '']));
    }
  } catch { return; }
  usageSummary = data;
  try {
    renderUsage();
  } catch (error) {
    const root = $('#usage-list');
    if (root) root.innerHTML = '<div class="harbor-empty"><i data-lucide="book-open"></i><strong>用量明细加载失败</strong><small>请刷新重试；若持续出现请联系管理员</small></div>';
    console.error('[usage] 渲染失败', error);
  }
}

function usageDisplayAgents(rows) {
  // 业务视图隐藏探针与模拟数据，但保留真实执行通道（中台网关等）的成本。
  return businessMode
    ? rows.filter((row) => !isProbeAgent(row.agentId) && !usageSimulatedAgentIds.has(row.agentId))
    : rows;
}

function usageHierarchyHtml(bySystem, byAgent) {
  const compact = businessMode;
  const agents = usageDisplayAgents(byAgent).slice()
    .sort((left, right) => Number(right.cost || 0) - Number(left.cost || 0));
  const groups = new Map();
  for (const row of agents) {
    const systemId = usageAgentSystem.get(row.agentId)
      || (row.agentId === 'agent-aeos-hub' ? 'aeos-hub' : 'unknown');
    const list = groups.get(systemId) || [];
    list.push(row);
    groups.set(systemId, list);
  }
  const order = [];
  for (const row of bySystem) if (!order.includes(row.systemId)) order.push(row.systemId);
  for (const systemId of groups.keys()) if (!order.includes(systemId)) order.push(systemId);
  const time = (value) => value ? formatDateTimeText(value) : '—';
  const rows = [];
  for (const systemId of order) {
    const system = bySystem.find((row) => row.systemId === systemId);
    if (system) {
      rows.push(compact
        ? `<div class="harbor-row usage-system-row"><span>${esc(usageSystemLabel(systemId))}</span><span class="num">¥${formatUsageCost(system.cost)}</span><span class="num">${formatTokenCount(system.events)}</span></div>`
        : `<div class="harbor-row usage-system-row"><span>${esc(usageSystemLabel(systemId))}</span><span class="num">${formatTokenCount(system.tokensIn)}</span><span class="num">${formatTokenCount(system.tokensOut)}</span><span class="num">¥${formatUsageCost(system.cost)}</span><span class="num">${formatTokenCount(system.events)}</span><span class="num">${esc(time(system.lastAt))}</span></div>`);
    }
    for (const row of groups.get(systemId) || []) {
      const queryOnly = isQueryOnlyUsageRow(row);
      const cost = queryOnly ? '—' : `¥${formatUsageCost(row.cost)}`;
      rows.push(compact
        ? `<div class="harbor-row usage-agent-row"><span>${esc(usageAgentLabel(row.agentId))}</span><span class="num">${cost}</span><span class="num">${formatTokenCount(row.events)}</span></div>`
        : `<div class="harbor-row usage-agent-row"><span>${esc(usageAgentLabel(row.agentId))}</span><span class="num">${queryOnly ? '无模型 Token' : formatTokenCount(row.tokensIn)}</span><span class="num">${queryOnly ? '—' : formatTokenCount(row.tokensOut)}</span><span class="num">${cost}</span><span class="num">${formatTokenCount(row.events)}</span><span class="num">${esc(time(row.lastAt))}</span></div>`);
    }
  }
  if (!rows.length) return '<div class="harbor-empty"><i data-lucide="book-open"></i><strong>暂无用量记录</strong><small>还没有产生分析成本</small></div>';
  const header = compact
    ? '<div class="harbor-row harbor-head"><span>系统 / Agent</span><span class="num">成本（¥）</span><span class="num">次数</span></div>'
    : '<div class="harbor-row harbor-head"><span>系统 / Agent</span><span class="num">输入 Token</span><span class="num">输出 Token</span><span class="num">成本（¥）</span><span class="num">次数</span><span class="num">最近</span></div>';
  return `<div class="harbor-table usage-table usage-hierarchy${compact ? ' compact' : ''}">${header}${rows.join('')}</div>`;
}

function renderUsage() {
  const root = $('#usage-list');
  if (!root) return;
  const byAgent = Array.isArray(usageSummary?.byAgent) ? usageSummary.byAgent : [];
  const bySystem = Array.isArray(usageSummary?.bySystem) ? usageSummary.bySystem : [];
  const byCallerAgent = Array.isArray(usageSummary?.byCallerAgent) ? usageSummary.byCallerAgent : [];
  const byCallerUser = Array.isArray(usageSummary?.byCallerUser) ? usageSummary.byCallerUser : [];
  const displayAgents = usageDisplayAgents(byAgent);
  const focusAgentId = usageFocus?.kind === 'agent' ? usageFocus.id : null;
  const focusSystemId = usageFocus?.kind === 'system' ? usageFocus.id : null;
  const focusedSystemOfAgent = focusAgentId
    ? (usageAgentSystem.get(focusAgentId) || (focusAgentId === 'agent-aeos-hub' ? 'aeos-hub' : null))
    : null;
  const filteredAgents = focusAgentId
    ? displayAgents.filter((row) => row.agentId === focusAgentId)
    : focusSystemId
      ? displayAgents.filter((row) => (usageAgentSystem.get(row.agentId) || (row.agentId === 'agent-aeos-hub' ? 'aeos-hub' : '')) === focusSystemId)
      : displayAgents;
  const filteredSystems = focusAgentId
    ? bySystem.filter((row) => row.systemId === focusedSystemOfAgent)
    : focusSystemId
      ? bySystem.filter((row) => row.systemId === focusSystemId)
      : bySystem;
  const totalCost = byAgent.reduce((sum, row) => sum + (Number(row.cost) || 0), 0);
  const totalTokens = byAgent.reduce((sum, row) => sum + (Number(row.tokensIn) || 0) + (Number(row.tokensOut) || 0), 0);
  const totalEvents = byAgent.reduce((sum, row) => sum + (Number(row.events) || 0), 0);

  const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };
  setText('#usage-total-cost', `¥${formatUsageCost(totalCost)}`);
  setText('#usage-total-events', formatTokenCount(totalEvents));
  setText('#usage-system-count', formatTokenCount(bySystem.length));
  setText('#usage-agent-count', formatTokenCount(displayAgents.length));
  setText('#usage-total-tokens', formatTokenCount(totalTokens));
  $('#usage-token-metric')?.classList.toggle('hidden', businessMode);
  const focusHost = $('#usage-focus');
  if (focusHost) {
    if (usageFocus) {
      focusHost.classList.remove('hidden');
      focusHost.innerHTML = `<span>仅看：<b>${esc(usageFocus.label)}</b></span><button class="btn ghost compact" type="button" data-usage-focus-clear>清除</button>`;
    } else {
      focusHost.classList.add('hidden');
      focusHost.innerHTML = '';
    }
  }
  $$('.usage-tabs [data-usage-tab]').forEach((button) => {
    const active = button.dataset.usageTab === usageTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  if (usageTab === 'caller') {
    root.innerHTML = `<section class="surface usage-block"><div class="surface-head"><div><h2>按调用方用户</h2><p>外部系统用户维度的成本（来自调用方 caller）</p></div></div>${usageTableHtml(byCallerUser, 'callerUserId', '暂无调用方归属：调用尚未携带 caller')}</section><section class="surface usage-block"><div class="surface-head"><div><h2>按调用方 Agent</h2><p>外部系统 Agent 维度的成本（来自调用方 caller）</p></div></div>${usageTableHtml(byCallerAgent, 'callerAgentId', '暂无调用方归属：调用尚未携带 caller')}</section>`;
  } else {
    root.innerHTML = `<section class="surface usage-block"><div class="surface-head"><div><h2>按系统与 Agent</h2><p>系统汇总在前，Agent 明细在后；调用次数与成本来自执行回传</p></div></div>${usageHierarchyHtml(filteredSystems, filteredAgents)}</section>`;
  }
  refreshIcons(root);
}


// ---------- 分析通道连通性（只统计外部系统，不包含本地助手运行时） ----------
let connectivitySummary = null;
let connectivityRefreshTimer = null;

async function loadConnectivity() {
  try {
    const response = await fetch('/api/connectivity', { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    connectivitySummary = await response.json();
    renderConnectivity();
  } catch {
    // 状态读取失败不阻断页面；保留上一次结果，首次失败时给出明确提示。
    if (!connectivitySummary) {
      const label = $('#assistant-connectivity-label');
      if (label) label.textContent = '分析通道 · 状态未知';
    }
  }
}

function renderConnectivity() {
  const label = $('#assistant-connectivity-label');
  const dot = $('#assistant-connectivity-dot');
  const panel = $('#assistant-connectivity-panel');
  const summary = connectivitySummary;
  if (!summary) {
    if (label) label.textContent = '分析通道 · 检查中';
    return;
  }
  const status = summary.summary?.status || 'empty';
  if (label) {
    label.textContent = status === 'empty'
      ? '分析通道 · 暂无系统'
      : `分析通道 · ${summary.summary.online}/${summary.summary.total} 在线`;
  }
  if (dot) dot.className = `live-dot ${status === 'ok' ? 'ok' : status === 'partial' ? 'warn' : status === 'down' ? 'down' : ''}`;
  if (!panel) return;
  if (!Array.isArray(summary.systems) || !summary.systems.length) {
    panel.innerHTML = '<div class="connectivity-empty">暂无外部系统接入</div>';
    return;
  }
  panel.innerHTML = summary.systems.map((system) => (
    `<div class="connectivity-row"><span>${esc(system.name)}</span><b class="status-pill ${system.online === system.total ? 'ok' : system.online > 0 ? 'warn' : 'danger'}">${system.online}/${system.total}</b><small>${system.lastSeenAt ? `最近 ${esc(formatBeijingTime(system.lastSeenAt))}` : '无连接'}</small></div>`
  )).join('') + '<button class="btn ghost compact connectivity-more" type="button" data-open-ops>查看运行状态</button>';
  refreshIcons(panel);
}

function toggleConnectivityPanel() {
  const panel = $('#assistant-connectivity-panel');
  const chip = $('#assistant-connectivity-chip');
  if (!panel) return;
  const hidden = panel.classList.toggle('hidden');
  chip?.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  if (!hidden) void loadConnectivity();
}

function syncConnectivityRefresh() {
  window.clearInterval(connectivityRefreshTimer);
  connectivityRefreshTimer = null;
  if (currentView !== 'chat') return;
  connectivityRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void loadConnectivity();
  }, 30000);
}

// ---------- 写操作（提交 / 审批 / 追踪） ----------
let writeCapabilities = [];
let writeRequests = [];
let writeControlsWired = false;

const WRITE_STATUS_LABELS = {
  pending_approval: '待审批',
  rejected: '已拒绝',
  dispatched: '已派单',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};
const WRITE_STATUS_TONES = {
  pending_approval: 'warn',
  rejected: 'neutral',
  dispatched: 'info',
  completed: 'ok',
  failed: 'danger',
  cancelled: 'neutral',
};
const WRITE_OPERATION_LABELS = {
  'order.update_note': '订单备注',
  'order.update_status': '订单状态',
};

function writeOperationLabel(operation) {
  return WRITE_OPERATION_LABELS[operation] || operation || '写操作';
}

function currentWriteCapability() {
  const select = $('#write-capability-select');
  const index = Number(select?.value);
  return Number.isInteger(index) ? writeCapabilities[index] || null : null;
}

function renderWriteOperations() {
  const operationSelect = $('#write-operation-select');
  if (!operationSelect) return;
  const capability = currentWriteCapability();
  const operations = Array.isArray(capability?.operations) ? capability.operations : [];
  operationSelect.innerHTML = operations.length
    ? operations.map((operation) => `<option value="${esc(operation)}">${esc(writeOperationLabel(operation))}</option>`).join('')
    : '<option value="">无可用操作</option>';
}

function renderWriteCapabilityOptions() {
  const select = $('#write-capability-select');
  const caption = $('#write-capability-caption');
  const submit = $('#btn-write-submit');
  if (!select) return;
  if (!writeCapabilities.length) {
    select.innerHTML = '<option value="">暂无写能力</option>';
    if (caption) caption.textContent = '提供方尚未注册写能力（需要中台在网关注册 write_control_platform）';
    if (submit) submit.disabled = true;
    renderWriteOperations();
    return;
  }
  select.innerHTML = writeCapabilities.map((capability, index) => (
    `<option value="${index}">${esc(capability.systemName)} · ${esc(capability.capability)}</option>`
  )).join('');
  if (caption) caption.textContent = `共 ${writeCapabilities.length} 项写能力；批准后才会派单`;
  if (submit) submit.disabled = false;
  renderWriteOperations();
}

function writeRequestChanges(record) {
  const changes = record?.input?.changes;
  if (!changes || typeof changes !== 'object') return '';
  return Object.entries(changes).map(([key, value]) => `${key}=${String(value)}`).join('，');
}

function writeRequestRow(record, pending) {
  const target = record?.input?.orderNo || record?.input?.target?.orderNo || '—';
  const changes = writeRequestChanges(record);
  const details = [
    record?.requestedBy?.name || record?.requestedBy?.id || '',
    formatDateTimeText(record?.createdAt),
    record?.approval?.by ? `审批人 ${record.approval.by}` : '',
    record?.rejection?.reason ? `拒绝原因 ${record.rejection.reason}` : '',
    record?.error?.code ? `错误 ${record.error.code}` : '',
  ].filter(Boolean).join(' · ');
  const actions = pending
    ? `<span class="write-actions"><button class="btn primary compact" type="button" data-write-approve="${esc(record.id)}">批准</button><button class="btn secondary compact" type="button" data-write-reject="${esc(record.id)}">拒绝</button></span>`
    : '';
  return `<div class="write-row">
    <div class="write-main">
      <strong>${esc(writeOperationLabel(record?.operation))} · ${esc(target)}</strong>
      <small>${esc(record?.capability || '')} · ${esc(record?.systemId || '')}${changes ? ` · ${esc(changes)}` : ''}</small>
      <small>原因：${esc(record?.reason || '—')}</small>
      <small class="write-meta">${esc(details)}</small>
    </div>
    <span class="status-pill ${esc(WRITE_STATUS_TONES[record?.status] || 'neutral')}">${esc(WRITE_STATUS_LABELS[record?.status] || record?.status || '未知')}</span>
    ${actions}
  </div>`;
}

function renderWriteLists() {
  const pending = writeRequests.filter((record) => record.status === 'pending_approval');
  const history = writeRequests.filter((record) => record.status !== 'pending_approval');
  const pendingCount = $('#write-pending-count');
  if (pendingCount) {
    pendingCount.textContent = String(pending.length);
    pendingCount.className = `status-pill ${pending.length ? 'warn' : 'info'}`;
  }
  const pendingHost = $('#write-pending-list');
  if (pendingHost) {
    pendingHost.innerHTML = pending.length
      ? pending.map((record) => writeRequestRow(record, true)).join('')
      : '<div class="harbor-empty"><i data-lucide="check-circle"></i><strong>没有待审批的写操作</strong><small>提交写请求后会出现在这里</small></div>';
  }
  const historyHost = $('#write-history-list');
  if (historyHost) {
    historyHost.innerHTML = history.length
      ? history.map((record) => writeRequestRow(record, false)).join('')
      : '<div class="harbor-empty"><i data-lucide="history"></i><strong>暂无历史</strong><small>审批或执行后的写操作会显示在这里</small></div>';
  }
  refreshIcons(pendingHost || document);
  refreshIcons(historyHost || document);
}

async function loadWrites() {
  wireWriteControls();
  try {
    const [capabilityResponse, listResponse] = await Promise.all([
      fetch('/api/write-requests/capabilities', { headers: { accept: 'application/json' } }),
      fetch('/api/write-requests?limit=100', { headers: { accept: 'application/json' } }),
    ]);
    writeCapabilities = capabilityResponse.ok ? (await capabilityResponse.json())?.capabilities || [] : [];
    writeRequests = listResponse.ok ? (await listResponse.json())?.requests || [] : [];
  } catch {
    writeCapabilities = [];
    writeRequests = [];
  }
  renderWriteCapabilityOptions();
  renderWriteLists();
}

async function submitWriteRequest(event) {
  event.preventDefault();
  const capability = currentWriteCapability();
  if (!capability) { toast('暂无可用的写能力', true); return; }
  const operation = $('#write-operation-select')?.value || '';
  const orderNo = $('#write-order-no')?.value.trim() || '';
  const value = $('#write-change-value')?.value.trim() || '';
  const reason = $('#write-reason')?.value.trim() || '';
  if (!operation || !orderNo || !value || !reason) {
    toast('请填写操作、订单号、变更内容和原因', true);
    return;
  }
  const changes = operation.endsWith('update_note') ? { remark: value } : { status: value };
  const status = $('#write-form-status');
  if (status) status.textContent = '提交中...';
  try {
    const response = await fetch('/api/write-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        capability: capability.capability,
        systemId: capability.systemId,
        input: { operation, orderNo, changes },
        reason,
        idempotencyKey: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `write-${Date.now()}`,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (status) status.textContent = '已提交，等待审批';
    $('#write-request-form')?.reset();
    renderWriteOperations();
    await loadWrites();
    toast('写请求已提交，等待审批');
  } catch (error) {
    if (status) status.textContent = error.message;
    toast(`提交失败：${error.message}`, true);
  }
}

async function decideWriteRequest(id, action) {
  let note = '';
  if (action === 'reject') {
    note = window.prompt('拒绝原因') || '';
    if (!note.trim()) return;
  }
  try {
    const response = await fetch(`/api/write-requests/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(action === 'reject' ? { reason: note } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    toast(action === 'approve' ? '已批准并派单' : '已拒绝');
    await loadWrites();
  } catch (error) {
    toast(`操作失败：${error.message}`, true);
  }
}

function wireWriteControls() {
  if (writeControlsWired) return;
  writeControlsWired = true;
  $('#btn-writes-refresh')?.addEventListener('click', () => loadWrites());
  $('#write-capability-select')?.addEventListener('change', () => renderWriteOperations());
  $('#write-request-form')?.addEventListener('submit', (event) => { void submitWriteRequest(event); });
  $('#write-pending-list')?.addEventListener('click', (event) => {
    const approve = event.target.closest('[data-write-approve]');
    if (approve) { void decideWriteRequest(approve.getAttribute('data-write-approve') || '', 'approve'); return; }
    const reject = event.target.closest('[data-write-reject]');
    if (reject) { void decideWriteRequest(reject.getAttribute('data-write-reject') || '', 'reject'); }
  });
}

// ---------- 跨系统借调（只读监控） ----------
const BORROW_STATUS_LABELS = {
  pending: '待派单', dispatched: '已派单', running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消',
};
const BORROW_STATUS_TONES = {
  pending: 'info', dispatched: 'info', running: 'warn', completed: 'ok', failed: 'danger', cancelled: 'neutral',
};
let borrowOrders = [];
let borrowCounts = null;
let selectedBorrowOrderId = null;
let borrowDetail = null;
let borrowControlsWired = false;

function borrowStatusPill(status) {
  const tone = BORROW_STATUS_TONES[status] || 'neutral';
  const label = BORROW_STATUS_LABELS[status] || status || '未知';
  return `<b class="status-pill ${tone}">${esc(label)}</b>`;
}

function borrowTime(value) {
  if (!value) return '—';
  return esc(formatBeijingDateTime(value));
}

function wireBorrowControls() {
  if (borrowControlsWired) return;
  borrowControlsWired = true;
  $('#btn-borrow-refresh')?.addEventListener('click', () => loadBorrowOrders());
  $('#borrow-status-filter')?.addEventListener('change', () => loadBorrowOrders());
  $('#btn-borrow-collapse')?.addEventListener('click', clearBorrowSelection);
  $('#borrow-list')?.addEventListener('click', (event) => {
    const target = event.target.closest('[data-borrow-order]');
    const orderId = target?.getAttribute('data-borrow-order');
    if (!orderId) return;
    // 再次点击同一张单 = 收起详情。
    if (orderId === selectedBorrowOrderId) clearBorrowSelection();
    else loadBorrowOrderDetail(orderId);
  });
}

function clearBorrowSelection() {
  selectedBorrowOrderId = null;
  borrowDetail = null;
  renderBorrowDetail();
  renderBorrowList();
}

async function loadBorrowOrders(options = {}) {
  wireBorrowControls();
  const root = $('#borrow-list');
  if (!options.silent && root && !borrowOrders.length) root.innerHTML = '<div class="dashboard-loading">正在读取借调单…</div>';
  const status = $('#borrow-status-filter')?.value || 'all';
  const query = new URLSearchParams({ limit: '100' });
  if (status !== 'all') query.set('status', status);
  let data;
  try {
    const response = await fetch(`/api/borrow-orders?${query.toString()}`, { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    data = await response.json();
  } catch { return; }
  borrowOrders = Array.isArray(data?.orders) ? data.orders : [];
  borrowCounts = data?.counts ?? null;
  renderBorrowMetrics();
  renderBorrowList();
  if (selectedBorrowOrderId) await loadBorrowOrderDetail(selectedBorrowOrderId, { silent: true });
}

function renderBorrowMetrics() {
  const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };
  setText('#borrow-total', formatTokenCount(borrowCounts?.total ?? 0));
  setText('#borrow-active', formatTokenCount(borrowCounts?.active ?? 0));
  setText('#borrow-completed', formatTokenCount(borrowCounts?.completed ?? 0));
  setText('#borrow-failed', formatTokenCount(borrowCounts?.failed ?? 0));
}

function renderBorrowList() {
  const root = $('#borrow-list');
  if (!root) return;
  if (!borrowOrders.length) {
    root.innerHTML = harborEmpty('arrow-left-right', '暂无借调单', '系统通过 token API 发起借调后会显示在这里');
    refreshIcons(root);
    return;
  }
  const rows = borrowOrders.map((order) => {
    const selected = order.orderId === selectedBorrowOrderId ? ' selected' : '';
    return `<button class="harbor-row borrow-row${selected}" type="button" data-borrow-order="${esc(order.orderId)}">
      <span class="mono">${esc(order.orderId.slice(0, 18))}…</span>
      <span>${esc(order.fromSystem)} → ${esc(order.providerSystem || order.toSystem || '待解析')}</span>
      <span>${esc(borrowCapabilityLabel(order.capability))}${order.capabilityVersion ? `<small class="subtle"> · v${esc(order.capabilityVersion)}</small>` : ''}</span>
      <span>${borrowStatusPill(order.status)}</span>
      <span class="num">${borrowTime(order.dispatchedAt)}</span>
      <span class="num">${borrowTime(order.endedAt)}</span>
    </button>`;
  }).join('');
  root.innerHTML = `<div class="harbor-table borrow-table">
    <div class="harbor-row harbor-head"><span>借调单</span><span>发起 → 提供</span><span>能力</span><span>状态</span><span class="num">派发时间</span><span class="num">结束时间</span></div>
    ${rows}
  </div>`;
  refreshIcons(root);
}

async function loadBorrowOrderDetail(orderId, options = {}) {
  let data;
  try {
    const response = await fetch(`/api/borrow-orders/${encodeURIComponent(orderId)}`, { headers: { accept: 'application/json' } });
    if (response.status === 404) {
      selectedBorrowOrderId = null;
      borrowDetail = null;
      renderBorrowDetail();
      return;
    }
    if (!response.ok) return;
    data = await response.json();
  } catch { return; }
  const order = data?.order;
  if (!order) return;
  selectedBorrowOrderId = order.orderId;
  borrowDetail = order;
  if (!options.silent) renderBorrowList();
  renderBorrowDetail();
}

const BORROW_FIELD_LABELS = {
  id: 'ID', order_no: '订单号', line_no: '行号', customer: '客户', customer_code: '客户编码',
  product_code: '产品编码', product_name: '产品名称', order_qty: '订单数量', completed_qty: '完成数量',
  order_amount: '订单金额', status: '状态', erp_status: 'ERP 状态', risk_level: '风险等级',
  risk_probability: '风险概率', promised_date: '承诺交期', delivery_completed_date: '完成日期',
  planned_start_date: '计划开始', owner: '责任人', updated_at: '更新时间',
  path: '查询路径', params: '查询参数', keyword: '关键字', message: '说明', summary: '摘要', conclusions: '结论',
  items: '数据明细', total: '总条数', page: '页码', page_size: '每页条数', data_as_of: '数据时间',
  data_confidence: '数据置信度', stale: '数据是否过期', request_id: '中台请求号',
  material_code: '物料编码', material_name: '物料名称', on_hand_qty: '在库数量', locked_qty: '锁定数量',
  available_qty: '可用数量', qty_in_transit: '在途数量', supplier_code: '供应商编码', supplier_name: '供应商名称',
  demand_no: '需求单号', shortage_qty: '缺口数量', work_order_no: '工单号', issue_no: '异常单号',
  defect_type: '缺陷类型', report_qty: '报工数量', capacity_qty: '产能数量', line_name: '产线',
};

// 结果表格优先展示的字段顺序：先业务关键信息，再技术字段。
const BORROW_PREFERRED_COLUMNS = [
  'order_no', 'customer', 'product_name', 'material_code', 'material_name', 'supplier_name',
  'order_qty', 'completed_qty', 'order_amount', 'shortage_qty', 'available_qty', 'on_hand_qty',
  'status', 'risk_level', 'risk_probability', 'promised_date', 'delivery_completed_date',
  'work_order_no', 'issue_no', 'owner', 'updated_at', 'id',
];

const BORROW_CAPABILITY_LABELS = {
  query_control_platform: '中台只读查询',
  reason_control_platform: '中台推理分析',
  query_plm: 'PLM 查询',
  query_local_files: '本地文件查询',
  reason_plm: 'PLM 推理分析',
};

const BORROW_RESULT_STATUS_LABELS = {
  completed: '已完成', in_progress: '进行中', pending_review: '待评审', partially_closed: '部分关闭',
  cancelled: '已取消', pending: '待处理', closed: '已关闭', failed: '失败',
};

const BORROW_DATA_CONFIDENCE_LABELS = { high: '高', medium: '中', low: '低' };
const BORROW_RISK_LEVEL_LABELS = { red: '高', yellow: '中', green: '低', blue: '蓝（未分档）' };

function borrowFieldLabel(key) {
  return BORROW_FIELD_LABELS[key] || key;
}

function borrowCapabilityLabel(capability) {
  return BORROW_CAPABILITY_LABELS[capability] || capability || '—';
}

function formatDateTimeText(value) {
  if (!value) return '—';
  return formatBeijingDateTime(value);
}

function borrowCell(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'status') return BORROW_RESULT_STATUS_LABELS[value] || String(value);
  if (key === 'data_confidence') return BORROW_DATA_CONFIDENCE_LABELS[value] || String(value);
  if (key === 'risk_level') return BORROW_RISK_LEVEL_LABELS[value] || String(value);
  if (key === 'stale') return value === true ? '是' : value === false ? '否' : String(value);
  if (key === 'risk_probability' && typeof value === 'number') return `${(value * 100).toFixed(1)}%`;
  if (key === 'order_amount' && typeof value === 'number') return value.toLocaleString('zh-CN');
  if (typeof key === 'string' && (key.endsWith('_date') || key.endsWith('_at'))) return formatDateTimeText(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function renderBorrowInputValue(key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return `<span class="borrow-param-list">${Object.entries(value)
      .map(([paramKey, paramValue]) => `<span>${esc(borrowFieldLabel(paramKey))}：${esc(borrowCell(paramKey, paramValue))}</span>`)
      .join('')}</span>`;
  }
  return esc(borrowCell(key, value));
}

/** 把 { items: [{...}] } 形态的借调结果渲染成可读表格；其他形态回退到原始 JSON。 */
function renderBorrowResultTable(value) {
  const items = Array.isArray(value?.items)
    ? value.items.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    : [];
  if (!items.length) return '';
  const allKeys = [];
  for (const item of items.slice(0, 50)) {
    for (const key of Object.keys(item)) if (!allKeys.includes(key)) allKeys.push(key);
  }
  const cols = [
    ...BORROW_PREFERRED_COLUMNS.filter((key) => allKeys.includes(key)),
    ...allKeys.filter((key) => !BORROW_PREFERRED_COLUMNS.includes(key)),
  ].slice(0, 8);
  if (!cols.length) return '';
  const head = cols.map((key) => `<span>${esc(borrowFieldLabel(key))}</span>`).join('');
  const rows = items.slice(0, 50).map((item) => `<div class="harbor-row">${cols
    .map((key) => {
      const text = borrowCell(key, item[key]);
      return `<span title="${esc(text)}">${esc(text)}</span>`;
    })
    .join('')}</div>`).join('');
  const more = allKeys.length > cols.length || items.length > 50
    ? `<p class="form-hint">仅展示前 ${cols.length} 列 / ${Math.min(items.length, 50)} 行；完整内容见下方原始 JSON。</p>`
    : '';
  return `<div class="harbor-table borrow-result-table" style="--borrow-cols:${cols.length}"><div class="harbor-row harbor-head">${head}</div>${rows}</div>${more}`;
}

function renderBorrowDetail() {
  const root = $('#borrow-detail');
  if (!root) return;
  const collapse = $('#btn-borrow-collapse');
  if (collapse) collapse.classList.toggle('hidden', !borrowDetail);
  if (!borrowDetail) {
    root.innerHTML = '<div class="harbor-empty"><i data-lucide="arrow-left-right"></i><strong>选择一张借调单</strong><small>点击上方列表中的借调单查看输入与结果；再次点击或点「收起」关闭</small></div>';
    refreshIcons(root);
    return;
  }
  const order = borrowDetail;
  const json = (value) => esc(JSON.stringify(value ?? null, null, 2).slice(0, 8_000));
  const error = order.error
    ? `<div class="borrow-detail-block"><h3>未完成原因</h3><p>${esc(humanizeError(order.error.code, order.error.message))}</p></div>`
    : '';
  const truncated = order.resultTruncated
    ? `<p class="form-hint">结果超过 256KB，仅保存摘要（原始 ${formatTokenCount(order.resultBytes)} 字节）。</p>`
    : '';
  const inputEntries = order.input && typeof order.input === 'object' && !Array.isArray(order.input)
    ? Object.entries(order.input)
    : null;
  const inputBlock = inputEntries && inputEntries.length
    ? `<div class="borrow-detail-block"><h3>输入</h3><div class="borrow-detail-grid">${inputEntries
      .map(([key, value]) => `<div><span>${esc(borrowFieldLabel(key))}</span><strong>${renderBorrowInputValue(key, value)}</strong></div>`)
      .join('')}</div></div>`
    : `<div class="borrow-detail-block"><h3>输入</h3><pre class="borrow-json">${json(order.input)}</pre></div>`;
  const resultObject = order.result && typeof order.result === 'object' && !Array.isArray(order.result) ? order.result : null;
  const resultMetaKeys = resultObject
    ? ['total', 'page', 'page_size', 'data_as_of', 'data_confidence', 'stale', 'request_id'].filter((key) => resultObject[key] !== undefined)
    : [];
  const resultMeta = resultMetaKeys.length
    ? `<div class="borrow-detail-grid borrow-result-meta">${resultMetaKeys
      .map((key) => `<div><span>${esc(borrowFieldLabel(key))}</span><strong>${esc(borrowCell(key, resultObject[key]))}</strong></div>`)
      .join('')}</div>`
    : '';
  const resultTable = renderBorrowResultTable(order.result);
  const resultBlock = resultTable
    ? `<div class="borrow-detail-block"><h3>结果</h3>${resultMeta}${resultTable}<details class="borrow-raw"><summary>原始 JSON（技术排查用）</summary><pre class="borrow-json">${json(order.result)}</pre></details></div>`
    : `<div class="borrow-detail-block"><h3>结果</h3>${resultMeta}<pre class="borrow-json">${json(order.result)}</pre></div>`;
  const hashShort = (value) => value ? `${value.slice(0, 12)}…` : '未指定';
  const schemaAnchor = [
    `输入 ${hashShort(order.inputSchemaHash)}`,
    `输出 ${hashShort(order.outputSchemaHash)}`,
  ].join(' · ');
  root.innerHTML = `<div class="borrow-detail-grid">
      <div><span>发起方</span><strong>${esc(order.fromSystem)}${order.fromAgentId ? ` · ${esc(order.fromAgentId)}` : ''}</strong></div>
      ${order.caller ? `<div><span>调用方</span><strong>${esc([order.caller.userId, order.caller.agentId, order.caller.taskId].filter(Boolean).join(' · ') || order.caller.systemId)}</strong></div>` : ''}
      <div><span>提供方</span><strong>${esc(order.providerSystem || '—')}${order.providerAgentId ? ` · ${esc(order.providerAgentId)}` : ''}</strong></div>
      <div><span>业务能力</span><strong>${esc(borrowCapabilityLabel(order.capability))}</strong></div>
      <div><span>状态</span><strong>${borrowStatusPill(order.status)}</strong></div>
      <div><span>时间</span><strong>创建 ${borrowTime(order.createdAt)} · 结束 ${borrowTime(order.endedAt)}</strong></div>
    </div>
    <details class="borrow-tech">
      <summary>技术信息（编号、版本、哈希）</summary>
      <div class="borrow-detail-grid">
        <div><span>记录编号</span><strong class="mono">${esc(order.orderId)}</strong></div>
        <div><span>请求编号</span><strong class="mono">${esc(order.requestId)}</strong></div>
        <div><span>执行编号</span><strong class="mono">${esc(order.runId || '—')}</strong></div>
        <div><span>能力版本</span><strong class="mono">${esc(order.capabilityVersion || '未指定（按能力名匹配）')}</strong></div>
        <div><span>schema 锚定</span><strong class="mono" title="${esc(`input ${order.inputSchemaHash || '—'} / output ${order.outputSchemaHash || '—'}`)}">${esc(schemaAnchor)}</strong></div>
        <div><span>来源</span><strong>执行面 · ${esc(order.providerSystem || '—')}</strong></div>
      </div>
    </details>
    ${truncated}
    ${error}
    ${inputBlock}
    ${resultBlock}
    <div class="borrow-detail-block borrow-detail-actions">
      ${order.runId ? '<button id="btn-borrow-open-run" class="btn secondary compact" type="button">查看执行详情</button>' : ''}
      <button id="btn-borrow-open-trace" class="btn secondary compact" type="button">查看处理记录</button>
    </div>`;
  refreshIcons(root);
  $('#btn-borrow-open-run')?.addEventListener('click', () => {
    if (order.runId) openExecutionRun(order.runId);
  });
  $('#btn-borrow-open-trace')?.addEventListener('click', () => openTraceFor(order.orderId));
}

function syncBorrowRefresh() {
  window.clearInterval(borrowRefreshTimer);
  borrowRefreshTimer = null;
  if (currentView !== 'borrow' || els.app.classList.contains('hidden')) return;
  borrowRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') loadBorrowOrders({ silent: true });
  }, BORROW_LIVE_REFRESH_MS);
}

// ---------- 运行监控（只读） ----------
let opsData = null;
let opsControlsWired = false;

function wireOpsControls() {
  if (opsControlsWired) return;
  opsControlsWired = true;
  $('#btn-ops-refresh')?.addEventListener('click', () => loadOps());
  $('#ops-health-list')?.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-ops-health-toggle]');
    if (!toggle) return;
    const key = toggle.getAttribute('data-ops-health-toggle') || '';
    if (healthExpanded.has(key)) healthExpanded.delete(key);
    else healthExpanded.add(key);
    renderOps();
  });
}

async function loadOps() {
  wireOpsControls();
  let data;
  try {
    const response = await fetch('/api/ops/status?limit=50', { headers: { accept: 'application/json' } });
    if (response.status === 403) {
      renderOpsForbidden();
      return;
    }
    if (!response.ok) return;
    data = await response.json();
  } catch { return; }
  opsData = data;
  renderOps();
}

function renderOpsForbidden() {
  const message = '<div class="harbor-empty"><i data-lucide="shield-alert"></i><strong>无权查看运行状态</strong><small>仅 manager / supervisor 角色可见</small></div>';
  const root = $('#ops-health-list');
  if (root) { root.innerHTML = message; refreshIcons(root); }
}

function opsSeverityPill(severity) {
  const map = { critical: ['danger', '严重'], warn: ['warn', '警告'], info: ['info', '提示'] };
  const [tone, label] = map[severity] || ['neutral', severity];
  return `<b class="status-pill ${tone}">${esc(label)}</b>`;
}

let healthExpanded = new Set();

function renderOps() {
  const snapshot = opsData?.snapshot;
  const metrics = snapshot?.metrics;
  const checks = Array.isArray(snapshot?.checks) ? snapshot.checks : [];
  const alerts = Array.isArray(opsData?.alerts) ? opsData.alerts : [];
  const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };

  const unhealthy = checks.filter((check) => !check.ok).length;
  setText('#ops-health-summary', unhealthy ? `${unhealthy} 项异常` : '正常');
  setText('#ops-agents', `${formatTokenCount(metrics?.agentsOnline ?? 0)}/${formatTokenCount(metrics?.agentsTotal ?? 0)}`);

  const counts = opsData?.alertCounts;
  const activeCount = counts?.active ?? alerts.filter((alert) => alert.status === 'active').length;
  const alertCountEl = $('#ops-alert-count');
  if (alertCountEl) {
    alertCountEl.textContent = String(activeCount);
    alertCountEl.className = `status-pill ${counts?.critical ? 'danger' : counts?.warn ? 'warn' : 'ok'}`;
  }

  const backup = metrics?.backup;
  const backupLabel = !backup ? '未知'
    : backup.status === 'ok' ? `成功 ${backup.lastAt ? borrowTime(backup.lastAt) : ''}`
      : backup.status === 'failed' ? '失败'
        : backup.status === 'stale' ? '已过期' : '未运行';
  setText('#ops-backup', backupLabel);

  const checked = $('#ops-checked-at');
  if (checked) checked.textContent = snapshot?.checkedAt ? `检查于 ${borrowTime(snapshot.checkedAt)}` : '';

  const alertsByKey = new Map();
  for (const alert of alerts) {
    const key = alert.key || alert.component;
    const list = alertsByKey.get(key) || [];
    list.push(alert);
    alertsByKey.set(key, list);
  }
  const entries = new Map();
  for (const check of checks) {
    entries.set(check.key, {
      key: check.key,
      component: check.component,
      title: check.title,
      message: check.message,
      ok: check.ok,
      severity: check.severity,
      action: check.action || null,
      alerts: alertsByKey.get(check.key) || [],
    });
  }
  for (const [key, list] of alertsByKey) {
    if (entries.has(key)) continue;
    const latest = list[0];
    entries.set(key, {
      key,
      component: latest.component,
      title: latest.title,
      message: latest.message,
      ok: latest.status === 'recovered',
      severity: latest.severity,
      action: latest.action || null,
      alerts: list,
    });
  }
  const rows = [...entries.values()].sort((left, right) => {
    const rank = (entry) => (entry.ok && !entry.alerts.some((alert) => alert.status === 'active') ? 1 : 0);
    const severityRank = (entry) => entry.severity === 'critical' ? 0 : entry.severity === 'warn' ? 1 : 2;
    return rank(left) - rank(right)
      || severityRank(left) - severityRank(right)
      || left.component.localeCompare(right.component, 'zh-CN');
  });

  const host = $('#ops-health-list');
  if (!host) return;
  if (!rows.length) {
    host.innerHTML = harborEmpty('activity', '暂无健康事件', '监控每 60 秒运行一次');
    refreshIcons(host);
    return;
  }
  const rowHtml = rows.map((entry) => {
    const activeAlert = entry.alerts.find((alert) => alert.status === 'active');
    const healthy = entry.ok && !activeAlert;
    const statusPill = healthy ? '<b class="status-pill ok">正常</b>' : opsSeverityPill(activeAlert?.severity || entry.severity);
    const lastAt = entry.alerts[0]?.lastSeenAt || snapshot?.checkedAt;
    const expanded = healthExpanded.has(entry.key);
    const history = entry.alerts.length
      ? entry.alerts.map((alert) => `<div class="ops-health-history-row">
          <span class="num">${borrowTime(alert.lastSeenAt)}</span>
          <span>${opsSeverityPill(alert.severity)}</span>
          <span><strong>${esc(alert.title)}</strong><small>${esc(alert.message)}${alert.action ? ` · 建议：${esc(alert.action)}` : ''}</small></span>
          <span>${alert.status === 'active' ? '<b class="status-pill danger">未恢复</b>' : '<b class="status-pill ok">已恢复</b>'}</span>
        </div>`).join('')
      : '<div class="ops-health-history-row empty">暂无告警历史</div>';
    return `<div class="ops-health-entry">
      <button class="ops-health-main" type="button" data-ops-health-toggle="${esc(entry.key)}" aria-expanded="${expanded}">
        <span class="ops-health-title"><strong>${esc(entry.component)}</strong><small>${esc(entry.title)}</small></span>
        <span class="ops-health-detail">${esc(activeAlert?.message || entry.message)}${(activeAlert?.action || entry.action) ? `<small>建议：${esc(activeAlert?.action || entry.action)}</small>` : ''}</span>
        <span class="num ops-health-time">${lastAt ? esc(borrowTime(lastAt)) : '—'}</span>
        ${statusPill}
        <i class="ops-health-chevron" data-lucide="${expanded ? 'chevron-down' : 'chevron-right'}"></i>
      </button>
      ${expanded ? `<div class="ops-health-history">${history}</div>` : ''}
    </div>`;
  }).join('');
  host.innerHTML = `<div class="ops-health-table">${rowHtml}</div>`;
  refreshIcons(host);
}

function syncOpsRefresh() {
  window.clearInterval(opsRefreshTimer);
  opsRefreshTimer = null;
  if (currentView !== 'ops' || els.app.classList.contains('hidden')) return;
  opsRefreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') loadOps();
  }, OPS_LIVE_REFRESH_MS);
}

// ---------- AI 观测（统一总览：Hub 派单任务 / 各系统助手） ----------
let aiObsControlsWired = false;

function wireAiObsControls() {
  if (aiObsControlsWired) return;
  aiObsControlsWired = true;
  $('#btn-ai-obs-refresh')?.addEventListener('click', () => {
    if (aiObsTab === 'runs') loadAiRuns();
    else loadAssistantEvents();
  });
  $$('#view-ai-obs [data-ai-tab]').forEach((button) => {
    button.addEventListener('click', () => switchAiObsTab(button.dataset.aiTab));
  });
  $('#ai-run-status-filter')?.addEventListener('change', () => loadAiRuns());
  $('#ai-run-list')?.addEventListener('click', (event) => {
    const target = event.target.closest('[data-ai-run]');
    const runId = target?.getAttribute('data-ai-run');
    if (!runId) return;
    selectedAiRunId = selectedAiRunId === runId ? null : runId;
    renderAiRunList();
    void renderAiRunDetail();
  });
}

function switchAiObsTab(tab) {
  aiObsTab = tab === 'assistants' ? 'assistants' : 'runs';
  $$('#view-ai-obs [data-ai-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.aiTab === aiObsTab);
  });
  $('#ai-obs-runs')?.classList.toggle('hidden', aiObsTab !== 'runs');
  $('#ai-obs-assistants')?.classList.toggle('hidden', aiObsTab !== 'assistants');
  if (aiObsTab === 'runs') loadAiRuns();
  else {
    assistantUserSelected = false;
    loadAssistantEvents();
  }
}

function loadAiObs() {
  wireAiObsControls();
  switchAiObsTab(aiObsTab);
}

async function loadAiRuns() {
  let data;
  try {
    const response = await fetch('/api/execution/agents', { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    data = await response.json();
  } catch { return; }
  aiAgents = Array.isArray(data?.agents) ? data.agents : [];
  aiRuns = (Array.isArray(data?.runs) ? data.runs : [])
    .slice()
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  try {
    const ordersResponse = await fetch('/api/borrow-orders?limit=100', { headers: { accept: 'application/json' } });
    if (ordersResponse.ok) {
      const ordersData = await ordersResponse.json();
      aiBorrowByRun = new Map((Array.isArray(ordersData?.orders) ? ordersData.orders : [])
        .filter((order) => order.runId)
        .map((order) => [order.runId, order]));
    }
  } catch {
    // 借调信息只用于标注来源，失败不影响任务列表。
  }
  renderAiRunMetrics();
  renderAiRunList();
  void renderAiRunDetail();
}

function aiRunStatusLabel(state) {
  return { dispatched: '已派单', running: '运行中', completed: '已完成', failed: '失败', recalled: '已召回' }[state] || state || '未知';
}

function aiRunStatusTone(state) {
  return state === 'completed' ? 'ok' : state === 'failed' ? 'danger' : state === 'running' ? 'warn' : state === 'recalled' ? 'neutral' : 'info';
}

function aiRunResultSummary(run) {
  if (!run || run.result === undefined || run.result === null) return '—';
  const result = run.result;
  if (Array.isArray(result?.items)) {
    return `返回 ${result.items.length} 条${result.total !== undefined ? `，共 ${result.total} 条` : ''}`;
  }
  if (typeof result?.summary === 'string') return result.summary.slice(0, 120);
  if (typeof result === 'string') return result.slice(0, 120);
  return '已返回结果';
}

function aiRunDuration(run) {
  if (!run?.startedAt) return '—';
  const end = run.endedAt ? new Date(run.endedAt).getTime() : Date.now();
  const start = new Date(run.startedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return '—';
  return `${Math.max(0, Math.round((end - start) / 1000))} s`;
}

function renderAiRunMetrics() {
  const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };
  setText('#ai-run-total', formatTokenCount(aiRuns.length));
  setText('#ai-run-active', formatTokenCount(aiRuns.filter((run) => run.state === 'dispatched' || run.state === 'running').length));
  setText('#ai-run-completed', formatTokenCount(aiRuns.filter((run) => run.state === 'completed').length));
  setText('#ai-run-failed', formatTokenCount(aiRuns.filter((run) => run.state === 'failed' || run.state === 'recalled').length));
}

function renderAiRunList() {
  const root = $('#ai-run-list');
  if (!root) return;
  const status = $('#ai-run-status-filter')?.value || 'all';
  const runs = aiRuns.filter((run) => status === 'all' || run.state === status);
  if (!runs.length) {
    root.innerHTML = harborEmpty('list-tree', '暂无派单任务', 'Hub 派发任务后会显示在这里');
    refreshIcons(root);
    return;
  }
  const rows = runs.slice(0, 200).map((run) => {
    const selected = run.runId === selectedAiRunId ? ' selected' : '';
    const order = aiBorrowByRun.get(run.runId);
    const from = order ? `借调：${esc(order.fromSystem)}` : 'Hub 直接派单';
    const agent = aiAgents.find((item) => item.agentId === run.agentId);
    return `<button class="harbor-row borrow-row${selected}" type="button" data-ai-run="${esc(run.runId)}">
      <span class="num">${borrowTime(run.startedAt)}</span>
      <span><strong>${esc(agent?.name || run.agentId)}</strong><br/><small>${from}</small></span>
      <span>${esc(borrowCapabilityLabel(run.capability))}</span>
      <span><b class="status-pill ${aiRunStatusTone(run.state)}">${esc(aiRunStatusLabel(run.state))}</b></span>
      <span class="num">${esc(aiRunDuration(run))}</span>
      <span>${esc(aiRunResultSummary(run))}</span>
    </button>`;
  }).join('');
  root.innerHTML = `<div class="harbor-table ai-run-table">
    <div class="harbor-row harbor-head"><span class="num">时间</span><span>Agent / 来源</span><span>能力</span><span>状态</span><span class="num">耗时</span><span>结果</span></div>
    ${rows}
  </div>`;
  refreshIcons(root);
}

async function renderAiRunDetail() {
  const root = $('#ai-run-detail');
  if (!root) return;
  const label = $('#ai-run-id');
  if (!selectedAiRunId) {
    if (label) label.textContent = '';
    root.innerHTML = '<div class="harbor-empty"><i data-lucide="list-tree"></i><strong>选择一个任务</strong><small>点击上方任务查看执行步骤</small></div>';
    refreshIcons(root);
    return;
  }
  const run = aiRuns.find((item) => item.runId === selectedAiRunId);
  if (label) label.textContent = selectedAiRunId;
  if (!run) {
    root.innerHTML = '<div class="harbor-empty"><strong>任务不存在</strong></div>';
    return;
  }
  const events = await fetchRunEvents(run.runId);
  const order = aiBorrowByRun.get(run.runId);
  // 推理类 run 直接渲染结构化结论（分发出去的齐套/质量分析也走这里）。
  const reasoningText = run.capability?.startsWith('reason') && run.result ? summarizeReasoningResult(run.result) : '';
  root.innerHTML = `<div class="borrow-detail-grid">
      <div><span>任务</span><strong class="mono">${esc(run.runId)}</strong></div>
      <div><span>Agent</span><strong>${esc(run.agentId)}</strong></div>
      <div><span>能力</span><strong>${esc(borrowCapabilityLabel(run.capability))}</strong></div>
      <div><span>状态</span><strong><b class="status-pill ${aiRunStatusTone(run.state)}">${esc(aiRunStatusLabel(run.state))}</b></strong></div>
      <div><span>来源</span><strong>${order ? `借调：${esc(order.fromSystem)}` : 'Hub 直接派单'}</strong></div>
      <div><span>耗时</span><strong>${esc(aiRunDuration(run))}</strong></div>
    </div>
    <div class="borrow-detail-block"><h3>结果摘要</h3><p class="form-hint">${esc(aiRunResultSummary(run))}</p></div>
    ${reasoningText ? `<div class="borrow-detail-block"><h3>分析结论</h3><pre class="assistant-reply-text">${esc(reasoningText)}</pre></div>` : ''}
    <div class="borrow-detail-block"><h3>执行步骤</h3>${executionTimelineHtml(events)}</div>
    <div class="borrow-detail-block borrow-detail-actions">
      <button id="btn-ai-run-open-trace" class="btn secondary compact" type="button">查看链路</button>
    </div>`;
  refreshIcons(root);
  $('#btn-ai-run-open-trace')?.addEventListener('click', () => openTraceFor(run.runId));
}

function syncAiObsRefresh() {
  window.clearInterval(aiObsRefreshTimer);
  aiObsRefreshTimer = null;
  if (currentView !== 'ai-obs' || els.app.classList.contains('hidden')) return;
  aiObsRefreshTimer = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (aiObsTab === 'runs') loadAiRuns();
    else loadAssistantEvents();
  }, AI_OBS_REFRESH_MS);
}

// ---------- 助手观测（中台自有助手主动上报） ----------
let assistantData = null;
let assistantControlsWired = false;
let selectedAssistantTrace = null;
let assistantFilteredTraces = [];
let assistantFilters = { system: 'all', status: 'all', time: 'all', search: '' };
let assistantUserSelected = false;
let lastAssistantDetailKey = null;

function wireAssistantControls() {
  if (assistantControlsWired) return;
  assistantControlsWired = true;
  $('#assistant-system-filter')?.addEventListener('change', (event) => {
    assistantFilters.system = event.target.value || 'all';
    assistantUserSelected = false;
    renderAssistant();
  });
  $('#assistant-status-filter')?.addEventListener('change', (event) => {
    assistantFilters.status = event.target.value || 'all';
    assistantUserSelected = false;
    renderAssistant();
  });
  $('#assistant-time-filter')?.addEventListener('change', (event) => {
    assistantFilters.time = event.target.value || 'all';
    assistantUserSelected = false;
    renderAssistant();
  });
  $('#assistant-search')?.addEventListener('input', (event) => {
    assistantFilters.search = String(event.target.value || '').trim().toLowerCase();
    assistantUserSelected = false;
    renderAssistant();
  });
  $('#assistant-trace-select')?.addEventListener('change', (event) => {
    const raw = String(event.target.value || '');
    const [encodedSystem, encodedTrace] = raw.split('|');
    if (!encodedSystem || !encodedTrace) return;
    try {
      selectedAssistantTrace = {
        systemId: decodeURIComponent(encodedSystem),
        traceId: decodeURIComponent(encodedTrace),
      };
      assistantUserSelected = true;
      renderAssistantDetail();
    } catch {
      // 忽略非法选项值。
    }
  });
  $('#assistant-failures')?.addEventListener('click', (event) => {
    const target = event.target.closest('[data-failure-trace]');
    const traceId = target?.getAttribute('data-failure-trace');
    const systemId = target?.getAttribute('data-failure-system');
    if (!traceId || !systemId) return;
    // 清掉可能隐藏该会话的筛选，再定位到详情。
    assistantFilters = { system: 'all', status: 'all', time: 'all', search: '' };
    const systemFilter = $('#assistant-system-filter'); if (systemFilter) systemFilter.value = 'all';
    const statusFilter = $('#assistant-status-filter'); if (statusFilter) statusFilter.value = 'all';
    const timeFilter = $('#assistant-time-filter'); if (timeFilter) timeFilter.value = 'all';
    const search = $('#assistant-search'); if (search) search.value = '';
    selectedAssistantTrace = { traceId, systemId };
    assistantUserSelected = true;
    renderAssistant();
    $('#assistant-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

async function loadAssistantEvents() {
  wireAssistantControls();
  let data;
  try {
    // 一次拉取后在本地过滤，保证系统下拉选项和筛选切换即时生效。
    const response = await fetch('/api/assistant-events?limit=1000', { headers: { accept: 'application/json' } });
    if (!response.ok) {
      renderAssistantError(response.status === 401
        ? '登录状态已失效，请刷新页面重新登录'
        : `接口返回 HTTP ${response.status}，请点击刷新重试`);
      return;
    }
    data = await response.json();
  } catch (error) {
    renderAssistantError(`网络异常：${error?.message || error}`);
    return;
  }
  assistantData = data;
  try {
    renderAssistant();
  } catch (error) {
    renderAssistantError(`渲染失败：${error?.message || error}`);
  }
}

function renderAssistantError(message) {
  const root = $('#assistant-detail');
  if (!root) return;
  root.innerHTML = `<div class="harbor-empty"><i data-lucide="triangle-alert"></i><strong>读取助手记录失败</strong><small>${esc(message)}</small></div>`;
  refreshIcons(root);
}

function assistantTraceEvents(trace) {
  const events = Array.isArray(assistantData?.events) ? assistantData.events : [];
  return events.filter((event) => event.traceId === trace.traceId && event.systemId === trace.systemId);
}

function assistantTraceTitle(trace) {
  const events = assistantTraceEvents(trace);
  const first = events.find((event) => event.event === 'conversation_started')
    || events.find((event) => event.event === 'message')
    || events[0];
  const summary = first?.summary || trace.lastSummary || '';
  return summary ? summary.slice(0, 60) : `会话 ${String(trace.traceId).slice(0, 8)}`;
}

function assistantTraceDuration(trace) {
  const start = new Date(trace.firstAt).getTime();
  const end = new Date(trace.lastAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function assistantTraceMatches(trace) {
  if (assistantFilters.system !== 'all' && trace.systemId !== assistantFilters.system) return false;
  if (assistantFilters.status === 'error' && !trace.hasError) return false;
  if (assistantFilters.status === 'ok' && trace.hasError) return false;
  if (assistantFilters.time !== 'all') {
    const ranges = { '1h': 3_600_000, '24h': 24 * 3_600_000, '7d': 7 * 24 * 3_600_000 };
    const range = ranges[assistantFilters.time];
    if (range && Date.now() - new Date(trace.lastAt).getTime() > range) return false;
  }
  if (assistantFilters.search) {
    const haystack = `${trace.traceId} ${trace.systemId} ${trace.lastSummary || ''}`.toLowerCase();
    if (!haystack.includes(assistantFilters.search)) return false;
  }
  return true;
}

function renderAssistant() {
  const events = Array.isArray(assistantData?.events) ? assistantData.events : [];
  const traces = Array.isArray(assistantData?.traces) ? assistantData.traces : [];
  const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };
  setText('#assistant-total', formatTokenCount(events.length));
  setText('#assistant-traces', formatTokenCount(traces.length));

  const filter = $('#assistant-system-filter');
  if (filter) {
    const current = assistantFilters.system;
    const systems = [...new Set(traces.map((trace) => trace.systemId))].sort();
    filter.innerHTML = `<option value="all">全部系统</option>${systems
      .map((system) => `<option value="${esc(system)}">${esc(system)}</option>`)
      .join('')}`;
    filter.value = current === 'all' || systems.includes(current) ? current : 'all';
    if (filter.value !== current) assistantFilters.system = filter.value;
  }

  assistantFilteredTraces = traces.filter(assistantTraceMatches);
  const countEl = $('#assistant-filter-count');
  if (countEl) countEl.textContent = `筛选结果 ${assistantFilteredTraces.length} / ${traces.length}`;

  const latest = assistantFilteredTraces[0];
  const selectedInFiltered = selectedAssistantTrace
    && assistantFilteredTraces.some((trace) => trace.traceId === selectedAssistantTrace.traceId && trace.systemId === selectedAssistantTrace.systemId);
  if (!selectedInFiltered) {
    selectedAssistantTrace = latest ? { traceId: latest.traceId, systemId: latest.systemId } : null;
    assistantUserSelected = false;
  } else if (!assistantUserSelected && latest) {
    // 用户没有手动选过会话时，始终跟随最新一条。
    selectedAssistantTrace = { traceId: latest.traceId, systemId: latest.systemId };
  }
  const failedEvents = events
    .filter((event) => (assistantFilters.system === 'all' || event.systemId === assistantFilters.system)
      && (event.status === 'failed' || event.event === 'error'))
    .sort((a, b) => String(b.endedAt || b.startedAt || b.receivedAt)
      .localeCompare(String(a.endedAt || a.startedAt || a.receivedAt)));
  renderAssistantFailures(failedEvents);
  renderAssistantSelector();
  renderAssistantDetail();
}

function renderAssistantFailures(failedEvents) {
  const panel = $('#assistant-failures-panel');
  const root = $('#assistant-failures');
  const count = $('#assistant-failures-count');
  if (!panel || !root) return;
  if (!failedEvents.length) {
    panel.classList.add('hidden');
    if (count) count.textContent = '0';
    root.innerHTML = '';
    return;
  }
  panel.classList.remove('hidden');
  if (count) count.textContent = `${failedEvents.length} 条`;
  root.innerHTML = failedEvents.slice(0, 50).map((event) => {
    const trace = (assistantData?.traces || []).find((item) => item.traceId === event.traceId && item.systemId === event.systemId);
    const title = trace ? assistantTraceTitle(trace) : `会话 ${String(event.traceId).slice(0, 8)}`;
    return `<button class="assistant-failure-item" type="button" data-failure-trace="${esc(event.traceId)}" data-failure-system="${esc(event.systemId)}">
      <span class="num">${borrowTime(event.endedAt || event.startedAt || event.receivedAt)}</span>
      <span>${esc(event.systemId)}</span>
      <span><strong>${esc(event.name || executionEventLabel(event.event))}</strong><br/><small>${esc(event.summary || '—')}</small></span>
      <span>${esc(title)}</span>
    </button>`;
  }).join('');
  refreshIcons(root);
}

function renderAssistantSelector() {
  const select = $('#assistant-trace-select');
  if (!select) return;
  if (!assistantFilteredTraces.length) {
    select.innerHTML = '<option value="">暂无匹配会话</option>';
    return;
  }
  select.innerHTML = assistantFilteredTraces.map((trace) => {
    const value = `${encodeURIComponent(trace.systemId)}|${encodeURIComponent(trace.traceId)}`;
    const title = assistantTraceTitle(trace);
    return `<option value="${value}">${esc(title)} · ${esc(trace.systemId)} · ${borrowTime(trace.lastAt)}</option>`;
  }).join('');
  if (selectedAssistantTrace) {
    const selectedValue = `${encodeURIComponent(selectedAssistantTrace.systemId)}|${encodeURIComponent(selectedAssistantTrace.traceId)}`;
    select.value = selectedValue;
  }
}

function renderAssistantDetail() {
  const root = $('#assistant-detail');
  if (!root) return;
  const traceLabel = $('#assistant-trace-id');
  if (!selectedAssistantTrace) {
    lastAssistantDetailKey = null;
    if (traceLabel) traceLabel.textContent = '';
    root.innerHTML = '<div class="harbor-empty"><i data-lucide="messages-square"></i><strong>选择一个会话</strong><small>使用上方下拉框选择会话</small></div>';
    refreshIcons(root);
    return;
  }
  const { traceId, systemId } = selectedAssistantTrace;
  const detailKey = `${systemId}|${traceId}`;
  const detailChanged = detailKey !== lastAssistantDetailKey;
  lastAssistantDetailKey = detailKey;
  if (traceLabel) traceLabel.textContent = `${systemId} · ${traceId}`;
  const trace = assistantFilteredTraces.find((item) => item.traceId === traceId && item.systemId === systemId)
    || (assistantData?.traces || []).find((item) => item.traceId === traceId && item.systemId === systemId);
  const events = assistantTraceEvents({ traceId, systemId });
  const usageEvents = events.filter((event) => event.usage
    && ((event.usage.tokensIn || 0) > 0 || (event.usage.tokensOut || 0) > 0));
  const hasModelCall = events.some((event) => event.event === 'model_call');
  const tokensIn = usageEvents.reduce((sum, event) => sum + (event.usage.tokensIn || 0), 0);
  const tokensOut = usageEvents.reduce((sum, event) => sum + (event.usage.tokensOut || 0), 0);
  const cost = usageEvents.reduce((sum, event) => sum + (event.usage.cost || 0), 0);
  const usageLine = usageEvents.length
    ? `输入 ${formatTokenCount(tokensIn)} / 输出 ${formatTokenCount(tokensOut)} / ¥${formatUsageCost(cost)}`
    : (hasModelCall ? '未上报模型用量（需中台回传 Token）' : '未上报模型用量');
  const replies = events.filter((event) => event.event === 'assistant_reply' && event.summary);
  const latestReply = replies[replies.length - 1];
  const errors = events.filter((event) => event.event === 'error' || event.status === 'failed');
  const latestError = errors[errors.length - 1];
  const timeOf = (event) => new Date(event.endedAt || event.startedAt || event.receivedAt || 0).getTime();
  let highlight = '';
  if (latestReply && (!latestError || timeOf(latestReply) >= timeOf(latestError))) {
    const text = String(latestReply.summary);
    highlight = `<div class="assistant-latest-reply">
      <div class="assistant-latest-head"><h3>最新回复</h3><span>${borrowTime(latestReply.endedAt || latestReply.receivedAt)}</span></div>
      <pre class="assistant-reply-text">${esc(text.slice(0, 1200))}</pre>
      ${text.length > 1200 ? '<p class="form-hint">内容较长，完整内容见下方时间线。</p>' : ''}
    </div>`;
  } else if (latestError) {
    highlight = `<div class="assistant-latest-reply assistant-latest-error">
      <div class="assistant-latest-head"><h3>最新错误</h3><span>${borrowTime(latestError.endedAt || latestError.receivedAt)}</span></div>
      <pre class="assistant-reply-text">${esc(latestError.summary || '未提供错误说明')}</pre>
    </div>`;
  }
  root.innerHTML = `<div class="assistant-detail-line">
      <span>时间范围：${borrowTime(trace?.firstAt)} → ${borrowTime(trace?.lastAt)}</span>
      <span>模型用量：${esc(usageLine)}</span>
    </div>
    ${highlight}
    <div class="borrow-detail-block"><h3>时间线</h3>${assistantTimelineHtml(events)}</div>`;
  if (detailChanged) root.scrollTop = 0;
  refreshIcons(root);
}

function executionEmptyState() {
  const div = document.createElement('div');
  div.className = 'harbor-empty';
  div.innerHTML = '<i data-lucide="messages-square"></i><strong>开始对话</strong><small>向该智能体提问，例如「查 HJY20260903-261 的缺料」</small>';
  return div;
}

function executionThreadFor(agentId) {
  let root = executionThreads.get(agentId);
  if (!root) {
    root = document.createElement('div');
    root.className = 'execution-messages';
    root.dataset.executionAgent = agentId;
    root.appendChild(executionEmptyState());
    const panel = $('.execution-chat-panel');
    const composer = $('#execution-chat-input')?.closest('.execution-composer');
    if (panel && composer) panel.insertBefore(root, composer);
    else if (panel) panel.appendChild(root);
    executionThreads.set(agentId, root);
    refreshIcons(root);
  }
  return root;
}

function showExecutionThread(agentId) {
  const defaultRoot = $('#execution-messages');
  if (defaultRoot) defaultRoot.classList.add('hidden');
  for (const root of executionThreads.values()) root.classList.add('hidden');
  if (agentId) executionThreadFor(agentId).classList.remove('hidden');
  else if (defaultRoot) defaultRoot.classList.remove('hidden');
}

function selectExecutionAgent(agentId) {
  selectedExecutionAgent = agentId;
  loadExecution();
  showExecutionThread(agentId);
  const name = executionAgents.find((item) => item.agentId === agentId)?.name || agentId;
  $('#execution-chat-actions')?.classList.remove('hidden');
  const title = $('#execution-chat-title');
  const subtitle = $('#execution-chat-subtitle');
  if (title) title.textContent = `与「${name}」对话`;
  const agent = executionAgents.find((item) => item.agentId === agentId);
  if (subtitle) {
    subtitle.textContent = isReasoningOnly(selectExecutionCapabilities(agent?.capabilities))
      ? '推理需要业务锚点：请带上订单号 / 产品编码 / 批次号。'
      : '请用编号、近 N 天或前 N 条限定范围；系统不会执行全量查询。';
  }
}

function selectedAgentIntent() {
  const agent = executionAgents.find((item) => item.agentId === selectedExecutionAgent);
  return agent?.capabilities?.find((cap) => cap.intent)?.intent;
}

function selectedAgentHasIntent() {
  return Boolean(selectedAgentIntent());
}

function selectedAgentCapability(kind) {
  const agent = executionAgents.find((item) => item.agentId === selectedExecutionAgent);
  const selection = selectExecutionCapabilities(agent?.capabilities);
  return kind === 'query' ? selection.query : selection.reasoning;
}

function selectedAgentCapabilityRecord(capabilityName) {
  const agent = executionAgents.find((item) => item.agentId === selectedExecutionAgent);
  return agent?.capabilities?.find((cap) => cap.name === capabilityName) ?? null;
}

function prepareReasoningRequest(text, reasonCap) {
  const parsed = parseExecutionReasoning(text);
  const request = attachBusinessObjectRef(
    parsed && !parsed.error
      ? parsed
      : { prompt: text, task_type: 'operating_case_analysis', context: {}, constraints: { read_only: true, require_evidence: true } },
    text,
  );
  if (requiresBusinessObjectRef(selectedAgentCapabilityRecord(reasonCap)) && !request.context?.businessObjectRef) {
    return {
      error: '该推理智能体需要业务锚点：请在问题中带上订单号/产品编码/批次号，例如“分析订单 HJY20260903-261 的交付风险”。若要分析“今日风险最高的订单”，请先用查询智能体查出订单号。',
    };
  }
  return { request };
}

function executionMessageBubble(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `execution-message ${role}`;
  const inner = document.createElement('div');
  inner.className = 'execution-bubble';
  const textEl = document.createElement('div');
  textEl.className = 'execution-text';
  textEl.textContent = text;
  inner.appendChild(textEl);
  bubble.appendChild(inner);
  return { bubble, inner, textEl };
}

function appendExecutionMessage(role, text, data) {
  const root = selectedExecutionAgent ? executionThreadFor(selectedExecutionAgent) : $('#execution-messages');
  if (!root) return null;
  const empty = root.querySelector('.harbor-empty');
  if (empty) empty.remove();
  const { bubble, inner, textEl } = executionMessageBubble(role, text);
  if (data !== undefined && data !== null) {
    const dataEl = document.createElement('pre');
    dataEl.className = 'execution-data';
    dataEl.textContent = JSON.stringify(data, null, 2).slice(0, 2000);
    inner.appendChild(dataEl);
  }
  root.appendChild(bubble);
  root.scrollTop = root.scrollHeight;
  return { inner, textEl };
}

async function dispatchExecution(agentId, capability, input, pendingText) {
  const pending = appendExecutionMessage('agent', pendingText, null);
  try {
    const response = await fetch(`/api/execution/agents/${encodeURIComponent(agentId)}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capability, input }),
    });
    const body = await response.json();
    if (!response.ok || body.error) {
      if (pending) pending.textEl.textContent = humanizeError(body.code, body.error || `派单失败（HTTP ${response.status}）`);
      return;
    }
    pollExecutionRun(body.runId, pending, agentId);
  } catch (error) {
    if (pending) pending.textEl.textContent = `派单失败：${error?.message || error}`;
  }
}

// 远端 LLM 意图解析（按 Agent 注册的 intent 动态解析）。成功返回 { kind:'query'|'reasoning', ... }，否则返回 null。
async function tryParseIntentRemote(text, agentId) {
  try {
    const response = await fetch('/api/execution/parse-intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, agentId }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    // 服务端会返回结构化失败原因（401/429/超时等），交给调用方决定提示与回退。
    if (body && typeof body.error === 'string') return { kind: 'error', error: body.error, code: body.code };
    return body && (body.kind === 'query' || body.kind === 'reasoning') ? body : null;
  } catch {
    return null;
  }
}

async function tryDispatchCapabilityTemplate(text) {
  if (!selectedExecutionAgent) return false;
  let templates = [];
  try {
    const response = await fetch(`/api/execution/capability-templates?agentId=${encodeURIComponent(selectedExecutionAgent)}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return false;
    const body = await response.json();
    templates = Array.isArray(body?.templates) ? body.templates : [];
  } catch {
    return false;
  }
  if (!templates.length) return false;

  const template = matchCapabilityTemplate(text, templates);
  if (!template) {
    // 中台查询 Agent 走原有通用查询解析器（订单/齐套/质量/生产等）。
    // 只有没有通用解析能力的 Agent（如 PLM）才提示“没有匹配模板”。
    const agent = executionAgents.find((item) => item.agentId === selectedExecutionAgent);
    const hasLegacyControlQuery = agent?.capabilities?.some((capability) => capability.name === 'query_control_platform');
    if (hasLegacyControlQuery) return false;
    appendExecutionMessage('agent', '没有匹配到该执行面 Agent 的 Hub 能力模板。请带上能力关键词，或先选择其他智能体。', null);
    return true;
  }
  const params = buildCapabilityParams(text, template);
  if (!params) {
    appendExecutionMessage('agent', `已匹配能力模板「${template.title || template.capability}」，但没有提取到必填参数。请补充业务编号/关键字。`, null);
    return true;
  }

  const pending = appendExecutionMessage('agent', `正在通过 Hub 能力模板查询：${template.title || template.capability}…`, null);
  try {
    const response = await fetch('/api/execution/capability-invocations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capability: template.capability,
        params,
        fromAgentId: 'hub-execution-dashboard',
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (pending) pending.textEl.textContent = humanizeError(body.code, body.error || `能力调用失败（HTTP ${response.status}）`);
      return true;
    }
    const orderId = body?.invocation?.borrowOrderId || body?.order?.orderId;
    if (!orderId) {
      if (pending) pending.textEl.textContent = '能力调用没有返回 borrowOrderId';
      return true;
    }
    await pollCapabilityInvocation(orderId, pending, template);
  } catch (error) {
    if (pending) pending.textEl.textContent = `能力调用失败：${error?.message || error}`;
  }
  return true;
}

async function pollCapabilityInvocation(orderId, pending, template) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`/api/borrow-orders/${encodeURIComponent(orderId)}`, { headers: { accept: 'application/json' } });
      if (!response.ok) {
        if (pending) pending.textEl.textContent = `读取借调结果失败（HTTP ${response.status}）`;
        return;
      }
      const body = await response.json();
      const order = body?.order ?? body;
      if (order?.status === 'completed') {
        if (pending) pending.textEl.textContent = summarizeCapabilityResult(order.result, template);
        return;
      }
      if (['failed', 'cancelled', 'recalled'].includes(order?.status)) {
        if (pending) {
          pending.textEl.textContent = `查询未完成：${humanizeError(order?.error?.code || (order?.status === 'cancelled' ? 'TASK_CANCELLED' : undefined), order?.error?.message || order?.status)}`;
        }
        return;
      }
    } catch {
      // 继续轮询
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (pending) pending.textEl.textContent = `查询仍未完成（borrowOrderId: ${orderId}），请稍后到「跨系统查询」查看。`;
}

async function sendExecutionQuery() {
  const input = $('#execution-chat-input');
  const text = input?.value?.trim() ?? '';
  if (!text) return;
  if (!selectedExecutionAgent) {
    appendExecutionMessage('agent', '请先在左侧选择一个智能体', null);
    return;
  }
  if (input) input.value = '';
  appendExecutionMessage('user', text, null);

  const queryCap = selectedAgentCapability('query');
  const reasonCap = selectedAgentCapability('reasoning');
  const selection = { query: queryCap, reasoning: reasonCap };
  if (!queryCap && !reasonCap) {
    appendExecutionMessage('agent', '该 Agent 未声明可用的查询或推理能力，请先让执行面重新注册能力。', null);
    return;
  }
  // 推理-only Agent：直接把原问题作为只读推理请求，不去调用不存在的查询能力。
  if (isReasoningOnly(selection)) {
    const prepared = prepareReasoningRequest(text, reasonCap);
    if (prepared.error) {
      if (isHighestRiskOrderQuery(text)) {
        await dispatchHighestRiskOrderOrchestration(text);
        return;
      }
      appendExecutionMessage('agent', prepared.error, null);
      return;
    }
    await dispatchExecution(selectedExecutionAgent, reasonCap, prepared.request, `正在推理：${describeExecutionReasoning(prepared.request)}…`);
    return;
  }

  // Agent 带查询语义（intent）→ 只用 LLM 解析；旧 Agent 无 intent → 回退本地正则（向后兼容）。
  if (selectedAgentHasIntent()) {
    const remote = await tryParseIntentRemote(text, selectedExecutionAgent);
    if (remote?.kind === 'reasoning' && reasonCap) {
      const request = attachBusinessObjectRef(remote.request, text);
      if (requiresBusinessObjectRef(selectedAgentCapabilityRecord(reasonCap)) && !request.context?.businessObjectRef) {
        if (isHighestRiskOrderQuery(text)) {
          await dispatchHighestRiskOrderOrchestration(text);
          return;
        }
        appendExecutionMessage('agent', '该推理智能体需要业务锚点：请在问题中带上订单号/产品编码/批次号。', null);
        return;
      }
      await dispatchExecution(selectedExecutionAgent, reasonCap, request, `正在推理：${describeExecutionReasoning(request)}…`);
      return;
    }
    if (remote?.kind === 'query') {
      const query = { path: remote.path, params: remote.params };
      await dispatchExecution(selectedExecutionAgent, queryCap, query, `正在查询：${describeExecutionQuery(query)}…`);
      return;
    }
    // LLM 失败/不可用 → 按 Agent 注册的 intent 做关键词回退（确定性，不依赖模型）。
    const fallback = parseExecutionQueryByIntent(text, selectedAgentIntent());
    if (fallback) {
      if (remote?.kind === 'error') toast(`模型解析失败：${remote.error}；已使用关键词规则回退`, true);
      await dispatchExecution(selectedExecutionAgent, queryCap, { path: fallback.path, params: fallback.params }, `正在查询：${describeExecutionQuery(fallback)}…`);
      return;
    }
    if (remote?.kind === 'error') {
      appendExecutionMessage('agent', `意图识别失败：${remote.error}`, null);
      return;
    }
    appendExecutionMessage('agent', '意图识别失败，请换一种说法重试', null);
    return;
  }

  const reasoning = parseExecutionReasoning(text);
  if (reasoning && !reasoning.error && reasonCap) {
    const prepared = prepareReasoningRequest(text, reasonCap);
    if (prepared.error) {
      if (isHighestRiskOrderQuery(text)) {
        await dispatchHighestRiskOrderOrchestration(text);
        return;
      }
      appendExecutionMessage('agent', prepared.error, null);
      return;
    }
    await dispatchExecution(selectedExecutionAgent, reasonCap, prepared.request, `正在推理：${describeExecutionReasoning(prepared.request)}…`);
    return;
  }
  if (reasoning && !reasoning.error && !reasonCap) {
    appendExecutionMessage('agent', '当前 Agent 只支持查询，不支持推理；请选择推理智能体或换一种查询说法。', null);
    return;
  }
  if (!queryCap) {
    appendExecutionMessage('agent', '当前 Agent 未声明查询能力，请使用“分析 / 评估 / 风险 / 建议”等推理表达。', null);
    return;
  }

  if (await tryDispatchCapabilityTemplate(text)) return;

  const parsed = parseExecutionQuery(text);
  if (parsed.error) {
    appendExecutionMessage('agent', parsed.error, null);
    return;
  }
  await dispatchExecution(selectedExecutionAgent, queryCap, { path: parsed.path, params: parsed.params }, `正在查询：${describeExecutionQuery(parsed)}…`);
}

async function dispatchHighestRiskOrderOrchestration(text) {
  const pending = appendExecutionMessage('agent', '正在查询当前风险最高的订单，并交给推理智能体分析（可能需要 10–30 秒）…', null);
  const controls = attachExecutionCancelControls(pending, selectedExecutionAgent);
  try {
    const response = await fetch('/api/execution/highest-risk-order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, reasoningAgentId: selectedExecutionAgent }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      controls.cleanup();
      const suffix = data.requestId ? `（requestId: ${data.requestId}）` : '';
      if (pending) {
        pending.textEl.textContent = controls.wasCancelled()
          ? '分析已取消'
          : `${humanizeError(data.code, data.error || `编排失败（HTTP ${response.status}）`)}${suffix}`;
        appendTraceLink(pending.inner, data.reasoningRunId || data.queryRunId);
      }
      return;
    }
    controls.cleanup();
    const order = data.order || {};
    const summary = data.result !== undefined ? summarizeReasoningResult(data.result) : '推理完成，但没有返回可解析的结论。';
    const orderLine = `已定位当前风险最高订单：${order.orderNo || '—'}（风险等级：${order.riskLevel || '未知'}）\n\n`;
    if (pending) {
      streamTextInto(pending.textEl, orderLine + summary);
      prependResultMeta(pending.inner, data.result);
      appendResultActions(pending.inner, orderLine + summary);
      const details = document.createElement('details');
      details.className = 'execution-raw';
      const summaryEl = document.createElement('summary');
      summaryEl.textContent = `查看编排详情（查询 run ${data.queryRunId || '—'} · 推理 run ${data.reasoningRunId || '—'}）`;
      const dataEl = document.createElement('pre');
      dataEl.className = 'execution-data';
      dataEl.textContent = JSON.stringify({
        requestId: data.requestId,
        order,
        queryRunId: data.queryRunId,
        reasoningRunId: data.reasoningRunId,
        result: data.result,
      }, null, 2).slice(0, 6000);
      details.appendChild(summaryEl);
      details.appendChild(dataEl);
      pending.inner.appendChild(details);
      if (data.reasoningRunId) attachExecutionSteps(pending.inner, data.reasoningRunId);
      appendTraceLink(pending.inner, data.reasoningRunId || data.queryRunId);
    }
    await loadExecution();
  } catch (error) {
    controls.cleanup();
    if (pending) {
      pending.textEl.textContent = controls.wasCancelled()
        ? '分析已取消'
        : `编排失败：${error?.message || error}`;
    }
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers/contexts without clipboard permission.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function prependResultMeta(container, result) {
  if (!container || !result || typeof result !== 'object') return;
  const dataAsOf = typeof result.data_as_of === 'string' ? result.data_as_of.trim() : '';
  const confidence = typeof result.data_confidence === 'string' ? result.data_confidence.trim() : '';
  if (!dataAsOf && !confidence) return;
  const confidenceLabel = { high: '高', medium: '中', low: '低' }[confidence] || confidence;
  const tone = confidence === 'high' ? 'ok' : confidence === 'medium' ? 'warn' : 'danger';
  const text = [
    dataAsOf ? `数据截至 ${formatDateTimeText(dataAsOf)}` : '',
    confidence ? `置信度 ${confidenceLabel}` : '',
  ].filter(Boolean).join(' · ');
  const meta = document.createElement('div');
  meta.className = `execution-data-meta ${tone}`;
  meta.textContent = confidence === 'low' ? `${text}（数据置信度不足，请人工复核）` : text;
  container.insertBefore(meta, container.firstChild);
}

function appendResultActions(container, text, options = {}) {
  if (!container || !text || !text.trim()) return;
  const copyLabel = options.copyLabel || '复制结论';
  const exportLabel = options.exportLabel || '导出结论';
  const filenamePrefix = options.filenamePrefix || '分析结论';
  const row = document.createElement('div');
  row.className = 'execution-result-actions';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn ghost compact';
  copyBtn.textContent = copyLabel;
  copyBtn.addEventListener('click', async () => {
    const ok = await copyToClipboard(text);
    copyBtn.textContent = ok ? '已复制' : '复制失败';
    window.setTimeout(() => { copyBtn.textContent = copyLabel; }, 1_500);
  });
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'btn ghost compact';
  exportBtn.textContent = exportLabel;
  exportBtn.addEventListener('click', () => {
    downloadTextFile(text, `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.txt`);
  });
  row.append(copyBtn, exportBtn);
  container.appendChild(row);
}

function appendTraceLink(container, runId, label = '查看处理记录') {
  if (!container || !runId) return;
  const row = document.createElement('div');
  row.className = 'execution-trace-link';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn ghost compact';
  button.textContent = label;
  button.addEventListener('click', () => openTraceFor(runId));
  row.appendChild(button);
  container.appendChild(row);
}

function attachExecutionCancelControls(pending, agentId) {
  let elapsedTimer = null;
  let cancelRow = null;
  let cancelled = false;
  const startedAt = Date.now();
  const cleanup = () => {
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = null;
    if (cancelRow) cancelRow.remove();
    cancelRow = null;
  };
  if (!pending || !agentId) return { cleanup, wasCancelled: () => cancelled };

  cancelRow = document.createElement('div');
  cancelRow.className = 'execution-cancel-row';
  const elapsedEl = document.createElement('span');
  elapsedEl.className = 'execution-elapsed';
  elapsedEl.textContent = '已等待 0s';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn ghost compact';
  cancelBtn.textContent = '取消分析';
  cancelBtn.addEventListener('click', async () => {
    if (cancelBtn.disabled) return;
    cancelBtn.disabled = true;
    cancelBtn.textContent = '取消中…';
    try {
      const response = await fetch(`/api/execution/agents/${encodeURIComponent(agentId)}/recall`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        cancelBtn.disabled = false;
        cancelBtn.textContent = '取消分析';
        pending.textEl.textContent = humanizeError(body.code || 'EXECUTION_FAILED', body.error || `取消失败（HTTP ${response.status}）`);
        return;
      }
      cancelled = true;
      pending.textEl.textContent = '正在取消…';
    } catch (error) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = '取消分析';
      pending.textEl.textContent = `取消失败：${error?.message || error}`;
    }
  });
  cancelRow.append(elapsedEl, cancelBtn);
  pending.inner.appendChild(cancelRow);
  elapsedTimer = setInterval(() => {
    elapsedEl.textContent = `已等待 ${Math.round((Date.now() - startedAt) / 1000)}s`;
  }, 1000);
  return { cleanup, wasCancelled: () => cancelled };
}

function pollExecutionRun(runId, pending, agentId) {
  const deadline = Date.now() + 60_000;
  const controls = attachExecutionCancelControls(pending, agentId);
  const cleanupPendingControls = controls.cleanup;
  const tick = async () => {
    let runs = [];
    try {
      const response = await fetch('/api/execution/agents');
      if (response.ok) { const data = await response.json(); runs = data.runs || []; }
    } catch { /* 忽略轮询错误，下一轮重试 */ }
    const run = runs.find((item) => item.runId === runId);
    if (run && ['completed', 'failed', 'recalled'].includes(run.state)) {
      cleanupPendingControls();
      if (pending) {
        if (run.state === 'completed') {
          const agent = executionAgents.find((item) => item.agentId === run.agentId);
          const intent = agent?.capabilities?.find((cap) => cap.intent)?.intent;
          const summary = (typeof run.capability === 'string' && run.capability.startsWith('reason'))
            ? summarizeReasoningResult(run.result)
            : summarizeExecutionResult(typeof run.input?.path === 'string' ? run.input.path : '', run.result, run.input?.params || {}, intent);
          pending.textEl.textContent = '';
          streamTextInto(pending.textEl, summary);
          prependResultMeta(pending.inner, run.result);
          appendResultActions(pending.inner, summary);
          if (run.result !== undefined && run.result !== null) {
            const details = document.createElement('details');
            details.className = 'execution-raw';
            const summaryEl = document.createElement('summary');
            summaryEl.textContent = '查看原始数据';
            const dataEl = document.createElement('pre');
            dataEl.className = 'execution-data';
            dataEl.textContent = JSON.stringify(run.result, null, 2).slice(0, 2000);
            details.appendChild(summaryEl);
            details.appendChild(dataEl);
            pending.inner.appendChild(details);
          }
          attachExecutionSteps(pending.inner, runId);
        } else if (run.state === 'failed') {
          pending.textEl.textContent = `查询失败：${humanizeError(run.error?.code, run.error?.message || '未知错误')}`;
        } else {
          pending.textEl.textContent = '分析已取消';
        }
        appendTraceLink(pending.inner, runId);
      }
      return;
    }
    if (Date.now() < deadline) setTimeout(tick, 500);
    else {
      cleanupPendingControls();
      if (pending) pending.textEl.textContent = '查询超时，请稍后重试';
    }
  };
  tick();
}

// ---------- 执行步骤（中台上报的工序回执） ----------
const EXECUTION_EVENT_LABELS = {
  run_received: '收到任务', step_started: '步骤开始', step_completed: '步骤完成',
  tool_call: '工具调用', tool_result: '工具结果', model_call: '模型调用',
  error: '错误', note: '备注', run_summary: '任务总结',
  confirmation_required: '等待写确认', confirmation_resolved: '写确认已处理',
  conversation_started: '会话开始', message: '用户消息', assistant_reply: '助手回复', conversation_ended: '会话结束',
};
const runEventsCache = new Map();

function executionEventLabel(event) {
  return EXECUTION_EVENT_LABELS[event] || event || '步骤';
}

function executionTimelineHtml(events) {
  if (!Array.isArray(events) || !events.length) {
    return '<div class="harbor-empty"><i data-lucide="list-tree"></i><strong>该智能体未上报执行步骤</strong><small>不影响任务结果；接入上报后可在这里看到内部过程</small></div>';
  }
  return `<div class="execution-timeline">${events.map((event) => {
    const time = event.startedAt || event.receivedAt || null;
    const tone = event.status === 'failed' ? 'danger' : event.status === 'completed' ? 'ok' : event.status === 'started' ? 'info' : 'neutral';
    const label = event.status === 'failed' ? '失败' : event.status === 'completed' ? '已完成' : event.status === 'started' ? '进行中' : '说明';
    const duration = event.durationMs !== null && event.durationMs !== undefined ? `${event.durationMs} ms` : '';
    const detail = event.detail
      ? `<details class="execution-step-detail"><summary>详情</summary><pre class="execution-data">${esc(JSON.stringify(event.detail, null, 2).slice(0, 4000))}</pre></details>`
      : '';
    const usage = event.usage
      ? `<small>模型 ${esc(event.usage.modelId || '—')} · 输入 ${formatTokenCount(event.usage.tokensIn)} / 输出 ${formatTokenCount(event.usage.tokensOut)} · ¥${formatUsageCost(event.usage.cost ?? 0)}</small>`
      : '';
    const context = [
      event.tool ? `工具 ${event.tool}` : '',
      event.taskId ? `任务 ${event.taskId}` : '',
      event.stepId !== null && event.stepId !== undefined ? `步骤 ${event.stepId}` : '',
      event.confirmationId ? `确认 ${event.confirmationId}` : '',
    ].filter(Boolean).join(' · ');
    return `<div class="execution-step">
      <span class="execution-step-time">${borrowTime(time)}</span>
      <span class="execution-step-main"><strong>${esc(executionEventLabel(event.event))}${event.name ? ` · ${esc(event.name)}` : ''}</strong><small>${esc(event.summary || '')}</small>${context ? `<small>${esc(context)}</small>` : ''}${usage}${detail}</span>
      <span class="execution-step-meta"><b class="status-pill ${tone}">${label}</b><small>${esc(duration)}</small></span>
    </div>`;
  }).join('')}</div>`;
}

function assistantTimelineHtml(events) {
  const list = Array.isArray(events) ? events : [];
  const hasSteps = list.some((event) => event.event === 'step_started' || event.event === 'step_completed');
  if (!hasSteps) return executionTimelineHtml(list);
  const main = list.filter((event) => event.event !== 'tool_call' && event.event !== 'tool_result');
  const tools = list.filter((event) => event.event === 'tool_call' || event.event === 'tool_result');
  const toolBlock = tools.length
    ? `<details class="execution-step-detail assistant-tool-events"><summary>工具调用明细（${tools.length}）</summary>${executionTimelineHtml(tools)}</details>`
    : '';
  return `${executionTimelineHtml(main)}${toolBlock}`;
}

async function fetchRunEvents(runId, options = {}) {
  if (!runId) return [];
  if (!options.refresh && runEventsCache.has(runId)) return runEventsCache.get(runId);
  try {
    const response = await fetch(`/api/execution/runs/${encodeURIComponent(runId)}/events?limit=200`, { headers: { accept: 'application/json' } });
    if (!response.ok) return [];
    const data = await response.json();
    const events = Array.isArray(data?.events) ? data.events : [];
    runEventsCache.set(runId, events);
    return events;
  } catch {
    return [];
  }
}

function attachExecutionSteps(container, runId) {
  const details = document.createElement('details');
  details.className = 'execution-raw execution-steps';
  const summaryEl = document.createElement('summary');
  summaryEl.textContent = '查看执行步骤';
  details.appendChild(summaryEl);
  const body = document.createElement('div');
  body.className = 'execution-steps-body';
  body.innerHTML = '<div class="dashboard-loading">正在读取执行步骤…</div>';
  details.appendChild(body);
  container.appendChild(details);
  let loaded = false;
  details.addEventListener('toggle', async () => {
    if (!details.open || loaded) return;
    loaded = true;
    const events = await fetchRunEvents(runId);
    body.innerHTML = executionTimelineHtml(events);
    refreshIcons(body);
  });
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
  commandMatches = commands.filter((item) => !LOCALLY_HIDDEN_VIEWS.has(item.view) && viewVisibleForRole(item.view, authSession) && (!query || `${item.label} ${item.desc} ${item.group}`.toLowerCase().includes(query)));
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
  if (isSameBeijingDay(iso, new Date())) return formatBeijingTime(iso);
  return formatBeijingDate(iso, { year: undefined });
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
  chatScope = { type: 'agent', agentId: member.id, squadId: null, label: `${member.name} · 专属会话` };
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

function openHubConversationSpace() {
  chatScope = { type: 'hub', agentId: null, squadId: null, label: '中枢会话' };
  els.chatViewTitle.textContent = '智能助手';
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

function renderDispatchProgress(message) {
  const host = els.messages;
  if (!host) return;
  let el = document.getElementById('dispatch-progress-line');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dispatch-progress-line';
    el.className = 'dispatch-progress-line';
    host.appendChild(el);
  }
  const label = message.domainLabel || message.domain || '分析';
  if (message.phase === 'item_completed') {
    const done = message.status === 'completed'
      ? `已完成${typeof message.conclusions === 'number' ? `（${message.conclusions} 条结论）` : ''}`
      : '未能完成';
    el.textContent = `${label}${done}${message.index < message.total ? '；继续下一项…' : ''}`;
  } else if (message.phase === 'item_started') {
    el.textContent = `正在分发给${label}（${message.index}/${message.total}）…`;
  } else {
    el.textContent = `正在分发给其他系统 Agent（共 ${message.total} 项）…`;
  }
  host.scrollTop = host.scrollHeight;
}

function msgMeta(text) {
  const node = document.createElement('div');
  node.className = 'meta';
  node.textContent = text;
  return node;}

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
  send({ type: 'dispatch_policy:get' });
}

const DISPATCH_DOMAIN_OPTIONS = [['order', '订单交付'], ['kitting', '物料齐套'], ['quality', '质量异常'], ['production', '生产进度']];

function fillDispatchConfig(policy) {
  const enabled = $('#dispatch-cfg-enabled');
  if (enabled) enabled.value = policy?.enabled === true ? '1' : '0';
  const max = $('#dispatch-cfg-max');
  if (max) max.value = String(policy?.maxItemsPerAnalysis ?? 0);
  const host = $('#dispatch-cfg-domains');
  if (!host) return;
  const selected = new Set(Array.isArray(policy?.dispatchDomains) ? policy.dispatchDomains : []);
  host.innerHTML = DISPATCH_DOMAIN_OPTIONS.map(([value, label]) => `<label><input type="checkbox" data-dispatch-domain="${value}" ${selected.has(value) ? 'checked' : ''} /><span>${label}</span></label>`).join('');
}

function saveDispatchConfig() {
  const enabled = ($('#dispatch-cfg-enabled')?.value || '0') === '1';
  const max = Number($('#dispatch-cfg-max')?.value || 0);
  const domains = Array.from(document.querySelectorAll('[data-dispatch-domain]'))
    .filter((node) => node.checked)
    .map((node) => node.getAttribute('data-dispatch-domain'));
  const status = $('#dispatch-cfg-status');
  if (status) status.textContent = '保存中...';
  send({ type: 'dispatch_policy:save', payload: { enabled, dispatchDomains: domains, maxItemsPerAnalysis: max } });
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
      time.innerHTML = `<span>${esc(occurredAt && !Number.isNaN(occurredAt.valueOf()) ? formatBeijingDateTime(occurredAt, { year: undefined }) : '未知时间')}</span><b class="evidence-freshness ${freshness[1]}">${freshness[0]}</b>`;
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
  els.dashboardRiskDispatch.classList.remove('hidden');
  els.dashboardRiskDispatch.innerHTML = '<i data-lucide="bot-message-square"></i><span>交给智能助手分析</span>';
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
  if (ws?.readyState !== WebSocket.OPEN) {
    toast('中枢连接未就绪，请稍后重试', true);
    if (!ws || ws.readyState !== WebSocket.OPEN) connect();
    return;
  }
  els.dashboardRiskDispatch.disabled = true;
  const isKitting = risk.source === 'kitting';
  const isQuality = risk.source === 'quality';
  const isProduction = risk.source === 'production';
  const label = isProduction ? '生产进度' : isQuality ? '质量异常' : isKitting ? '物料齐套' : '订单交付';
  els.dashboardRiskModalStatus.textContent = '正在把该事项交给智能助手…';
  try {
    const subject = isQuality ? (risk.issueNo || risk.orderNo) : risk.orderNo;
    const prompt = risk.prompt || `分析${isQuality ? '质量异常' : '订单'} ${subject} 的影响、建议动作与责任人，并使用关联证据链。`;
    closeDashboardRiskDetail();
    // Hub 只保留智能助手：首页事项统一进入中枢会话，由执行面网关完成只读分析。
    chatScope = { type: 'hub', agentId: null, squadId: null, label: '中枢会话' };
    els.chatViewTitle.textContent = '智能助手';
    els.chatViewDesc.textContent = '跨域经营分析与能力调用';
    els.conversationScopeLabel.textContent = chatScope.label;
    els.chatScopeBack.classList.add('hidden');
    showView('chat');
    curConvId = null;
    pendingText = prompt;
    pendingChoice = null;
    pendingRiskAgentDispatch = null;
    if (!newConversation()) throw new Error('无法创建分析会话');
    const attentionStates = savedMap(ATTENTION_STORAGE);
    const cardId = attentionCardId(risk);
    const previousAttentionState = attentionStates[cardId] || 'new';
    attentionStates[cardId] = 'review';
    saveMap(ATTENTION_STORAGE, attentionStates);
    recordAttentionTransition(cardId, previousAttentionState, 'review', '已交给智能助手分析');
    if (dashboardSnapshot) renderAttention(dashboardSnapshot);
    toast(`已交给智能助手分析：${label} ${subject}`);
  } catch (error) {
    els.dashboardRiskModalStatus.textContent = error.message;
    toast(`发起分析失败：${error.message}`, true);
  } finally {
    els.dashboardRiskDispatch.disabled = false;
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

function attentionSearchGroup(title, caption, items, emptyText, notices = []) {
  const warningList = notices.length ? `<details class="attention-query-notices"><summary>数据提示（${notices.length}）</summary><ul>${notices.map((notice) => `<li>${esc(notice)}</li>`).join('')}</ul></details>` : '';
  return `<section class="attention-search-result-section"><header><div><strong>${esc(title)}</strong><small>${esc(caption)}</small></div><b>${items.length}</b></header>${warningList}${items.length ? `<div class="attention-search-result-list">${items.join('')}</div>` : `<p class="attention-search-empty">${esc(emptyText)}</p>`}</section>`;
}

function attentionLiveCompletionLabel(item) {
  if (!item?.risk) return '<span class="status-pill neutral">中台概览</span>';
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
  if (attentionResultsDismissed) {
    els.attentionSearchResults.classList.add('hidden');
    return;
  }
  const live = attentionLiveResult?.live;
  if (!query && !live) {
    els.attentionSearchResults.classList.add('hidden');
    if (!attentionLiveSearchBusy) els.attentionSearchStatus.textContent = '本地筛选 · 尚未核查中台';
    return;
  }
  const risks = attentionSearchRiskRows(snapshot).filter((risk) => attentionSearchMatch(query, risk.orderNo, risk.issueNo, risk.summary, risk.owner, risk.customer, risk.product, risk.evidenceRef, risk.orderStatus));
  const riskCards = risks.slice(0, 20).map((risk, index) => `<article class="attention-search-result-card"><span class="status-pill ${attentionShouldAutoClose(risk) ? 'ok' : 'info'}">${esc(risk.source === 'kitting' ? '物料齐套' : risk.source === 'quality' ? '异常与质量' : '订单交付')}</span><strong>${esc(risk.issueNo || risk.orderNo)} · ${esc(risk.summary)}</strong><small>${esc(risk.orderStatus || '状态待回传')} · ${esc(evidenceStatus(risk.evidenceRef))}</small><button type="button" class="btn ghost compact" data-attention-search-risk-index="${index}">查看详情</button></article>`);
  els.attentionResultAttention.innerHTML = query ? attentionSearchGroup('本地筛选结果', '当前 Attention 队列及中台已回传的近期闭环事项', riskCards, '没有匹配的 Attention 事项') : '';

  const liveCards = Array.isArray(live?.items) ? live.items.map((item, index) => {
    const refs = Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [];
    const evidence = refs.length ? ` · ${refs.length} 条证据${refs.length <= 2 ? `：${refs.join('、')}` : ` · 示例：${refs.slice(0, 2).join('、')}`}` : ' · 证据待补';
    return `<article class="attention-search-result-card"><div class="attention-live-result-tags"><span class="status-pill ${item.confidence === 'high' ? 'ok' : 'warn'}">${esc(item.source === 'kitting' ? '物料齐套' : item.source === 'quality' ? '异常与质量' : item.source === 'production' ? '生产协同' : '订单交付')} · ${esc(item.confidence || 'unknown')}</span>${attentionLiveCompletionLabel(item)}</div><strong>${esc(item.title)}</strong><small>${esc(item.summary)}${esc(evidence)}</small>${item.risk ? `<button type="button" class="btn ghost compact" data-attention-live-risk-index="${index}">查看详情</button>` : ''}</article>`;
  }) : [];
  const liveSources = Array.isArray(live?.sources) ? live.sources.map((source) => `${source.source === 'kitting' ? '齐套' : source.source === 'quality' ? '质量' : source.source === 'production' ? '生产' : '订单'}：${source.loaded}/${source.total ?? '未知'} 条 · ${source.dataAsOf || '时间未知'}${source.partial ? ' · 部分数据' : ''}`).join('；') : '';
  const liveCaption = live ? (live.status === 'complete' ? `本次读取完成${liveSources ? `；${liveSources}` : ''}` : live.status === 'partial' ? `已返回部分数据${liveSources ? `；${liveSources}` : ''}` : `当前范围暂不可用${liveSources ? `；${liveSources}` : ''}`) : '尚未发起中台核查';
  els.attentionResultLive.innerHTML = live ? attentionSearchGroup('实时中台核查', liveCaption, liveCards, live.status === 'complete' ? '本次读取完成，但该范围内没有匹配事项。' : '当前无法据此得出“没有数据”的结论，请查看数据提示后调整范围或稍后重试。', live.warnings || []) : '';

  const historyRows = [
    ...(evidenceRows || []).map((row) => ({ type: 'Evidence', title: row.summary || row.kind || '证据事件', detail: `${row.occurred_at || ''} ${row.item_type || ''}`, action: 'evidence' })),
    ...(squad.activities || []).map((row) => ({ type: 'Agent 动作', title: row.title, detail: `${row.detail || ''} ${row.createdAt || ''}`, action: 'squad' })),
    ...(squad.memories || []).map((row) => ({ type: 'Agent 记忆', title: row.content, detail: row.createdAt || '', action: 'squad' })),
  ].filter((row) => attentionSearchMatch(query, row.type, row.title, row.detail)).slice(0, 30);
  const historyCards = historyRows.map((row) => `<article class="attention-search-result-card"><span class="status-pill info">${esc(row.type)}</span>${attentionExpandableText(row.title)}<small>${esc(row.detail)}</small><button type="button" class="btn ghost compact" data-attention-search-target="${esc(row.action)}">查看来源</button></article>`);
  els.attentionResultHistory.innerHTML = query ? attentionSearchGroup('Evidence 与 Agent 动作', '最近证据、专业小队活动与独立记忆', historyCards, '没有匹配的 Evidence 或 Agent 动作') : '';
  els.attentionSearchCaption.textContent = live ? `${query ? `“${query}”的` : '当前范围的'}本地筛选与最近一次只读中台核查结果。` : `“${query}”的本地筛选结果；点击“核查中台”可获取中台最新只读数据。`;
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

export function g0CanRecord(session) {
  return Array.isArray(session?.roles) && session.roles.includes('manager');
}

export function g0ConfigEntryVisible(session) {
  return g0CanRecord(session);
}

export function g0DecisionDisplay(snapshot) {
  const decisions = snapshot?.decisions || {};
  return {
    ready: snapshot?.readyForG1 === true,
    entries: [
      ['首个闭环场景', decisions.firstScenario],
      ['业务负责人', decisions.businessOwnerActor],
      ['核验人', decisions.verifyActor],
      ['操作员', decisions.threeAccountAuthorization],
      ['试点范围', decisions.scope],
    ],
    history: Array.isArray(snapshot?.history) ? [...snapshot.history].reverse() : [],
  };
}

export function escapeG0Text(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function renderG0HistoryMarkup(history, formatTime = (value) => value) {
  return history.length ? history.map((entry) => `<li><div><b>${escapeG0Text(entry.field)}</b><span>${escapeG0Text(formatTime(entry.decidedAt))}</span></div><p>${escapeG0Text(entry.note)}</p><small>${escapeG0Text(entry.actorId)} · ${escapeG0Text(entry.tenantId)} · 修订 ${escapeG0Text(entry.revision)}</small></li>`).join('') : '<li class="dashboard-loading">暂无登记历史</li>';
}

export function buildG0DecisionRequest(fields) {
  const value = (name) => String(fields?.[name] || '').trim();
  const patch = {};
  const firstScenario = value('firstScenario');
  const businessOwnerActorId = value('businessOwnerActorId');
  const verifyActorId = value('verifyActorId');
  const demoTenantId = value('demoTenantId');
  const organizationScope = value('organizationScope');
  const managerActorId = value('managerActorId');
  const operatorActorId = value('operatorActorId');
  const ownerActorId = value('ownerActorId');
  const m02OwnerActorId = value('m02OwnerActorId');
  const note = value('note');
  if (!note) throw new Error('请填写登记说明。');
  if (firstScenario) patch.firstScenario = firstScenario;
  if (businessOwnerActorId) patch.businessOwnerActorId = businessOwnerActorId;
  if (verifyActorId) patch.verifyActorId = verifyActorId;
  if (businessOwnerActorId && verifyActorId && businessOwnerActorId === verifyActorId) throw new Error('订单交付风险的 Owner 与 Verify 人必须不同。');
  if (demoTenantId || organizationScope) {
    if (!demoTenantId || !organizationScope) throw new Error('请同时填写试点租户范围与组织范围。');
    patch.scope = { demoTenantId, organizationScope };
  }
  if (managerActorId || operatorActorId || ownerActorId) {
    if (!managerActorId || !operatorActorId || !ownerActorId) throw new Error('请完整填写三账号授权安排。');
    patch.threeAccountAuthorization = { managerActorId, operatorActorId, ownerActorId, decision: 'approved_for_g1' };
  }
  if (m02OwnerActorId) patch.m02Responsibility = { ownerActorId: m02OwnerActorId, status: 'assigned' };
  if (value('taskStoreDecision')) patch.taskStoreDecision = 'reuse_existing_task_center';
  if (value('g4Admission')) patch.g4Admission = 'blocked_until_g1';
  if (!Object.keys(patch).length) throw new Error('请至少填写一项 G0 决策。');
  return { patch, note };
}

export function g0ApiFailureReason(data, status) {
  const reason = typeof data?.error === 'string' ? data.error.trim() : '';
  return reason || `HTTP ${status}`;
}

export function g0SaveFeedback(auditStatus) {
  return auditStatus === 'failed'
    ? { status: '登记已保存，但 Evidence 留痕未确认；请联系管理员核查。', toast: '试点初始化已登记，Evidence 留痕待核查', isError: true }
    : { status: '登记已保存并提交服务端审计。', toast: '试点初始化已保存', isError: false };
}

function g0ManagerCanRecord() { return g0CanRecord(authSession); }

function syncG0GovernanceConfigEntry() {
  els.g0ConfigEntry?.classList.toggle('hidden', !g0ConfigEntryVisible(authSession));
}

function personnelManagerCanManage() { return personnelConfigEntryVisible(authSession, g0DecisionSnapshot); }

function syncPersonnelConfigEntry() {
  const hidden = !personnelConfigEntryVisible(authSession, g0DecisionSnapshot);
  els.personnelConfigEntry?.classList.toggle('hidden', hidden);
  els.roleConfigEntry?.classList.toggle('hidden', hidden);
  els.permissionConfigEntry?.classList.toggle('hidden', hidden);
}

function onboardingManagerCanManage() { return onboardingConfigEntryVisible(authSession, g0DecisionSnapshot); }

function syncOnboardingConfigEntry() {
  els.onboardingConfigEntry?.classList.toggle('hidden', !onboardingConfigEntryVisible(authSession, g0DecisionSnapshot));
}

async function loadPersonnelOnboardingView(options = {}) {
  const ready = g0DecisionSnapshot?.readyForG1 === true;
  els.onboardingG0Readiness.textContent = ready ? '已完成初始化' : '尚未就绪';
  els.onboardingG0Readiness.className = `status-pill ${ready ? 'ok' : 'neutral'}`;
  els.obG0Manager.textContent = authSession?.actorId || '—';
  els.obG0Tenant.textContent = authSession?.tenantId || '—';
  els.obG0Organization.textContent = authSession?.organizationId || '—';
  await loadOnboardingUsers(options);
}

async function loadOnboardingUsers(options = {}) {
  try {
    const response = await personnelApiRequest('/api/system/personnel/onboarding/users');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
    onboardingUsers = Array.isArray(data.users) ? data.users : [];
    renderOnboardingG0Options();
  } catch (error) {
    els.onboardingG0Status.textContent = `人员列表加载失败：${error.message}`;
    if (!options.silent) toast(`人员列表加载失败：${error.message}`, true);
  }
}

function onboardingOptionLabel(user) {
  const name = user.firstName || user.lastName || user.username;
  const role = (user.roles || []).join(',');
  return `${name} · ${user.actorId}${role ? ` · ${role}` : ''}`;
}

function renderOnboardingG0Options(selections = {}) {
  const options = onboardingUsers
    .map((user) => `<option value="${esc(user.actorId)}">${esc(onboardingOptionLabel(user))}</option>`)
    .join('');
  const placeholder = '<option value="">请选择账号</option>';
  for (const select of [els.obG0BusinessOwner, els.obG0Verify, els.obG0Operator]) {
    select.innerHTML = placeholder + options;
  }
  const selectByName = (select, name) => {
    const chosen = selections[name] || onboardingUsers.find((user) => (user.firstName || user.username) === name)?.actorId;
    if (chosen) select.value = chosen;
  };
  selectByName(els.obG0BusinessOwner, '张三');
  selectByName(els.obG0Verify, '李四');
  selectByName(els.obG0Operator, '王五');
}

async function submitOnboardingCreate(event) {
  event.preventDefault();
  if (!onboardingManagerCanManage()) { els.onboardingCreateStatus.textContent = '当前会话无权进行首次开通。'; return; }
  const rows = $$('.onboarding-create-row', els.onboardingCreateRows);
  const accounts = rows.map((row) => ({
    firstName: $('.ob-first-name', row).value.trim(),
    username: $('.ob-username', row).value.trim(),
    role: row.dataset.pilotRole || 'operator',
    temporaryPassword: $('.ob-password', row).value,
  }));
  if (accounts.some((account) => !account.username || !account.temporaryPassword)) {
    els.onboardingCreateStatus.textContent = '请为每个账号填写登录名与临时密码。';
    return;
  }
  els.btnOnboardingCreate.disabled = true;
  els.onboardingCreateStatus.textContent = '正在创建账号…';
  const selections = {};
  try {
    for (let index = 0; index < accounts.length; index++) {
      const account = accounts[index];
      const response = await personnelApiRequest('/api/system/personnel/onboarding/users', 'POST', {
        username: account.username,
        ...(account.firstName ? { firstName: account.firstName } : {}),
        roles: [account.role],
        temporaryPassword: account.temporaryPassword,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
      if (account.firstName && data.user?.actorId) selections[account.firstName] = data.user.actorId;
      $('.ob-password', rows[index]).value = '';
    }
    els.onboardingCreateStatus.textContent = '账号已创建；请在第 2 步登记 G0。';
    await loadOnboardingUsers({ silent: true });
    renderOnboardingG0Options(selections);
  } catch (error) {
    els.onboardingCreateStatus.textContent = `创建失败：${error.message}`;
    toast(`创建账号失败：${error.message}`, true);
  } finally {
    els.btnOnboardingCreate.disabled = false;
  }
}

async function submitOnboardingG0(event) {
  event.preventDefault();
  if (!onboardingManagerCanManage()) { els.onboardingG0Status.textContent = '当前会话无权登记 G0。'; return; }
  const businessOwner = els.obG0BusinessOwner.value;
  const verify = els.obG0Verify.value;
  const operator = els.obG0Operator.value;
  if (!businessOwner || !verify || !operator) {
    els.onboardingG0Status.textContent = '请选择业务 Owner、Verify 人与 operator。';
    return;
  }
  const manager = authSession?.actorId || '';
  const tenantId = authSession?.tenantId || '';
  const organizationScope = authSession?.organizationId || '';
  if (!manager || !tenantId || !organizationScope) {
    els.onboardingG0Status.textContent = '当前会话缺少可信 manager / 租户 / 组织范围，无法登记。';
    return;
  }
  try {
    const request = buildG0DecisionRequest({
      firstScenario: 'order_delivery_risk',
      businessOwnerActorId: businessOwner,
      verifyActorId: verify,
      demoTenantId: tenantId,
      organizationScope,
      managerActorId: manager,
      operatorActorId: operator,
      ownerActorId: businessOwner,
      m02OwnerActorId: businessOwner,
      taskStoreDecision: 'reuse_existing_task_center',
      g4Admission: 'blocked_until_g1',
      note: els.obG0Note.value,
    });
    els.btnOnboardingG0Save.disabled = true;
    els.onboardingG0Status.textContent = '正在保存 G0 决策…';
    const response = await personnelApiRequest('/api/governance/g0-decisions', 'PUT', request);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(g0ApiFailureReason(data, response.status));
    g0DecisionSnapshot = data.snapshot;
    const ready = data.snapshot?.readyForG1 === true;
    els.onboardingG0Readiness.textContent = ready ? '已具备进入 G1 的决策条件' : '尚未具备进入 G1 的决策条件';
    els.onboardingG0Readiness.className = `status-pill ${ready ? 'ok' : 'warn'}`;
    syncPersonnelConfigEntry();
    syncOnboardingConfigEntry();
    if (ready) {
      toast('G0 已就绪，人员与权限入口已启用');
      showView('personnel-admin');
    } else {
      els.onboardingG0Status.textContent = 'G0 已保存但尚未就绪，请核对三账号与 Owner/Verify 是否不同。';
    }
  } catch (error) {
    els.onboardingG0Status.textContent = `保存失败：${error.message}`;
    toast(`G0 登记失败：${error.message}`, true);
  } finally {
    els.btnOnboardingG0Save.disabled = false;
  }
}

function personnelApiRequest(path, method = 'GET', body) {
  return fetch(path, {
    method,
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function loadPersonnelAdminView(options = {}) {
  const canManage = personnelManagerCanManage();
  els.personnelAccess.textContent = canManage ? '当前会话可管理人员与角色' : '当前会话无权管理人员与权限';
  els.personnelAccess.className = `status-pill ${canManage ? 'ok' : 'neutral'}`;
  els.btnPersonnelCreate.disabled = !canManage;
  if (!canManage) {
    els.personnelList.innerHTML = '<div class="dashboard-loading">仅具备 manager 角色且处于 G0 就绪范围的会话可管理人员。</div>';
    els.personnelListCount.textContent = '';
    return;
  }
  const search = els.personnelSearch.value.trim();
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  try {
    const response = await personnelApiRequest(`/api/system/personnel/users${query}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
    personnelUsers = Array.isArray(data.users) ? data.users : [];
    try { await loadAccessRoles(); } catch { accessRoles = ['manager', 'supervisor', 'operator'].map((code) => ({ code, name: PERSONNEL_ROLE_LABELS[code] || code, protected: true, userCount: 0, permissionCount: 0 })); }
    renderPersonnelAdminView();
    return personnelUsers;
  } catch (error) {
    els.personnelList.innerHTML = `<div class="dashboard-loading">人员列表加载失败：${esc(error.message)}</div>`;
    els.personnelListCount.textContent = '';
    if (!options.silent) toast(`人员列表加载失败：${error.message}`, true);
    return null;
  }
}

function personnelUserMarkup(user) {
  const displayName = (user.firstName && user.lastName) ? `${user.firstName} ${user.lastName}` : (user.firstName || user.lastName || user.username);
  const roleMap = new Map(accessRoles.map((role) => [role.code, role]));
  const badges = user.roles
    .map((role) => `<span class="role-badge role-badge-${esc(role)}">${esc(PERSONNEL_ROLE_LABELS[role] || roleMap.get(role)?.name || role)}</span>`)
    .join('');
  const roleChecks = accessRoles
    .filter((role) => role.code !== 'owner')
    .map((role) => `<label class="personnel-role-check"><input type="checkbox" name="role" value="${esc(role.code)}" ${user.roles.includes(role.code) ? 'checked' : ''} data-user-role data-user-id="${esc(user.id)}" data-role="${esc(role.code)}" /> ${esc(PERSONNEL_ROLE_LABELS[role.code] || role.name || role.code)}</label>`)
    .join('');
  const oaMeta = user.identitySource === 'oa' ? ` · OA ${user.externalEmployeeId ? `<code>${esc(user.externalEmployeeId)}</code>` : '已同步'}${user.departmentName ? ` · ${esc(user.departmentName)}` : ''}${user.positionName ? ` / ${esc(user.positionName)}` : ''}` : ' · Hub 应急账号';
  return `<div class="personnel-row" data-user-id="${esc(user.id)}">
    <div class="personnel-row-main">
      <b class="personnel-row-name">${esc(displayName)}</b>
      <span class="personnel-role-badges">${badges}</span>
      <span class="status-pill ${user.enabled ? 'ok' : 'danger'}">${user.enabled ? '已启用' : '已停用'}</span>
    </div>
    <div class="personnel-row-meta">登录名 <code>${esc(user.username)}</code> · <code>${esc(user.actorId)}</code>${user.email ? ` · ${esc(user.email)}` : ''}${oaMeta}</div>
    <div class="personnel-row-actions">
      <span class="personnel-role-group">${roleChecks}</span>
      <button type="button" class="btn secondary compact" data-personnel-role-save data-user-id="${esc(user.id)}">保存角色</button>
      <button type="button" class="btn secondary compact" data-personnel-toggle data-user-id="${esc(user.id)}" data-enabled="${user.enabled ? 'false' : 'true'}">${user.enabled ? '停用' : '启用'}</button>
      <button type="button" class="btn secondary compact" data-personnel-reset data-user-id="${esc(user.id)}" data-username="${esc(user.username)}">重置密码</button>
      <button type="button" class="btn danger compact" data-personnel-delete data-user-id="${esc(user.id)}" data-name="${esc(displayName)}" ${user.identitySource === 'oa' ? 'disabled title="OA 同步用户不可在 Hub 删除"' : ''}>删除</button>
    </div>
  </div>`;
}

function renderPersonnelAdminView() {
  els.personnelListCount.textContent = `共 ${personnelUsers.length} 位试点范围内用户`;
  els.personnelList.innerHTML = personnelUsers.length
    ? personnelUsers.map((user) => personnelUserMarkup(user)).join('')
    : '<div class="dashboard-loading">试点范围内暂无用户</div>';
  refreshIcons($('#view-personnel-admin'));
}

function openPersonnelCreateModal() {
  if (!personnelManagerCanManage()) { toast('当前会话无权创建用户。', true); return; }
  els.personnelCreateForm.reset();
  els.personnelCreateStatus.textContent = '';
  els.personnelCreateModal.classList.remove('hidden');
}

function closePersonnelCreateModal() {
  els.personnelCreateModal.classList.add('hidden');
  els.personnelCreatePassword.value = '';
}

function openPersonnelResetModal(user) {
  personnelTargetId = user.id;
  els.personnelResetTarget.value = user.username;
  els.personnelResetPassword.value = '';
  els.personnelResetStatus.textContent = '';
  els.personnelResetModal.classList.remove('hidden');
}

function closePersonnelResetModal() {
  els.personnelResetModal.classList.add('hidden');
  personnelTargetId = null;
  els.personnelResetPassword.value = '';
}

function personnelCreateRolesChecked() {
  return $$('input[name="role"]:checked', els.personnelCreateRoles).map((node) => node.value);
}

async function submitPersonnelCreate(event) {
  event.preventDefault();
  if (!personnelManagerCanManage()) { els.personnelCreateStatus.textContent = '当前会话无权创建用户。'; return; }
  try {
    const request = buildPersonnelCreateRequest({
      username: els.personnelCreateUsername.value,
      temporaryPassword: els.personnelCreatePassword.value,
      email: els.personnelCreateEmail.value,
      firstName: els.personnelCreateFirst.value,
      lastName: els.personnelCreateLast.value,
      roles: personnelCreateRolesChecked(),
    });
    els.personnelCreatePassword.value = '';
    els.personnelCreateSubmit.disabled = true;
    els.personnelCreateStatus.textContent = '正在创建用户…';
    const response = await personnelApiRequest('/api/system/personnel/users', 'POST', request);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
    els.personnelCreateUsername.value = '';
    els.personnelCreateEmail.value = '';
    els.personnelCreateFirst.value = '';
    els.personnelCreateLast.value = '';
    closePersonnelCreateModal();
    const feedback = personnelSaveFeedback(data.auditStatus);
    toast(feedback.toast, feedback.isError);
    await loadPersonnelAdminView({ silent: true });
  } catch (error) {
    els.personnelCreateStatus.textContent = `创建失败：${error.message}`;
    toast(`创建用户失败：${error.message}`, true);
  } finally {
    els.personnelCreateSubmit.disabled = false;
  }
}

async function submitPersonnelReset(event) {
  event.preventDefault();
  const userId = personnelTargetId;
  if (!userId) return;
  try {
    const request = buildPersonnelResetRequest({ temporaryPassword: els.personnelResetPassword.value });
    els.personnelResetPassword.value = '';
    els.personnelResetSubmit.disabled = true;
    els.personnelResetStatus.textContent = '正在重置密码…';
    const response = await personnelApiRequest(`/api/system/personnel/users/${encodeURIComponent(userId)}/reset-password`, 'POST', request);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
    closePersonnelResetModal();
    const feedback = personnelSaveFeedback(data.auditStatus);
    toast(feedback.toast, feedback.isError);
  } catch (error) {
    els.personnelResetStatus.textContent = `重置失败：${error.message}`;
    toast(`重置密码失败：${error.message}`, true);
  } finally {
    els.personnelResetSubmit.disabled = false;
  }
}

async function togglePersonnelEnabled(userId, enabled) {
  if (enabled === false && !window.confirm('确认停用该用户？')) return;
  try {
    const response = await personnelApiRequest(`/api/system/personnel/users/${encodeURIComponent(userId)}`, 'PATCH', { enabled });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
    const feedback = personnelSaveFeedback(data.auditStatus);
    toast(feedback.toast, feedback.isError);
    await loadPersonnelAdminView({ silent: true });
  } catch (error) {
    toast(`更新用户失败：${error.message}`, true);
  }
}

async function savePersonnelRoles(userId) {
  if (!window.confirm('确认替换该用户的角色？')) return;
  const checked = $$(`input[data-user-role][data-user-id="${userId}"]:checked`).map((node) => node.value);
  try {
    const request = buildPersonnelRolesRequest({ roles: checked });
    const response = await personnelApiRequest(`/api/system/personnel/users/${encodeURIComponent(userId)}/roles`, 'PUT', request);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
    const feedback = personnelSaveFeedback(data.auditStatus);
    toast(feedback.toast, feedback.isError);
    await loadPersonnelAdminView({ silent: true });
  } catch (error) {
    toast(`保存角色失败：${error.message}`, true);
  }
}

async function deletePersonnelUser(userId, displayName) {
  if (!window.confirm(`确认删除账号「${displayName}」？该操作不可撤销。`)) return;
  try {
    const response = await personnelApiRequest(`/api/system/personnel/users/${encodeURIComponent(userId)}`, 'DELETE');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
    const feedback = personnelSaveFeedback(data.auditStatus);
    toast(feedback.toast, feedback.isError);
    await loadPersonnelAdminView({ silent: true });
  } catch (error) {
    toast(`删除账号失败：${error.message}`, true);
  }
}

function flatAccessResources(resources = [], depth = 0, output = []) {
  for (const resource of resources) {
    output.push({ ...resource, depth });
    flatAccessResources(resource.children || [], depth + 1, output);
  }
  return output;
}

function visibleAccessResources(resources = [], depth = 0, output = []) {
  for (const resource of resources) {
    output.push({ ...resource, depth });
    if (!collapsedAccessResources.has(resource.code)) visibleAccessResources(resource.children || [], depth + 1, output);
  }
  return output;
}

async function loadMyGrants() {
  try {
    const response = await personnelApiRequest('/api/system/access-control/my-grants');
    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    myGrants = Array.isArray(data.grants) ? data.grants : [];
  } catch {
    myGrants = [];
  }
}

async function loadAccessRoles() {
  const response = await personnelApiRequest('/api/system/access-control/roles');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
  accessRoles = Array.isArray(data.roles) ? data.roles : [];
  return accessRoles;
}

async function loadAccessResources() {
  const response = await personnelApiRequest('/api/system/access-control/resources');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
  accessResources = Array.isArray(data.resources) ? data.resources : [];
  return accessResources;
}

async function loadRoleAdminView(options = {}) {
  if (!personnelManagerCanManage()) {
    els.roleList.innerHTML = '<div class="dashboard-loading">仅当前 G0 范围内的 manager 可管理角色。</div>';
    return;
  }
  try {
    await loadAccessRoles();
    const query = els.roleSearch.value.trim().toLowerCase();
    const roles = accessRoles.filter((role) => !query || `${role.code} ${role.name}`.toLowerCase().includes(query));
    const inUse = accessRoles.filter((role) => role.userCount > 0).length;
    const protectedCount = accessRoles.filter((role) => role.protected).length;
    els.roleMetrics.innerHTML = [
      ['角色总数', accessRoles.length], ['使用中', inUse], ['未使用', accessRoles.length - inUse], ['系统保护', protectedCount],
    ].map(([label, value]) => `<div class="access-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
    els.roleList.innerHTML = `<table class="access-table"><thead><tr><th>角色编码</th><th>角色名称</th><th>使用人数</th><th>权限概览</th><th>操作</th></tr></thead><tbody>${roles.map((role) => `<tr>
      <td><code class="access-code">${esc(role.code)}</code></td><td><b>${esc(PERSONNEL_ROLE_LABELS[role.code] || role.name)}</b>${role.protected ? ' <span class="status-pill neutral">系统保护</span>' : ''}${role.description ? `<div class="form-hint">${esc(role.description)}</div>` : ''}</td>
      <td>${esc(role.userCount)} 人</td><td>${esc(role.permissionCount)} 个权限节点</td><td><div class="access-table-actions"><button class="btn secondary compact" type="button" data-role-permission="${esc(role.code)}" data-role-name="${esc(PERSONNEL_ROLE_LABELS[role.code] || role.name)}">权限</button><button class="btn danger compact" type="button" data-role-delete="${esc(role.code)}" data-role-name="${esc(PERSONNEL_ROLE_LABELS[role.code] || role.name)}" ${role.protected || role.userCount > 0 ? 'disabled' : ''}>删除</button></div></td>
    </tr>`).join('')}</tbody></table>`;
    els.roleStatus.textContent = `当前范围共 ${accessRoles.length} 个角色；保护角色和仍有用户的角色不可删除。`;
    refreshIcons($('#view-role-admin'));
  } catch (error) {
    els.roleList.innerHTML = `<div class="dashboard-loading">角色加载失败：${esc(error.message)}</div>`;
    if (!options.silent) toast(`角色加载失败：${error.message}`, true);
  }
}

function openRoleCreateModal() {
  els.roleCreateForm.reset();
  els.roleCreateStatus.textContent = '';
  els.roleCreateModal.classList.remove('hidden');
}
function closeRoleCreateModal() { els.roleCreateModal.classList.add('hidden'); }

async function submitRoleCreate(event) {
  event.preventDefault();
  try {
    els.roleCreateStatus.textContent = '正在创建角色…';
    const response = await personnelApiRequest('/api/system/access-control/roles', 'POST', {
      code: els.roleCreateCode.value.trim(), name: els.roleCreateName.value.trim(), description: els.roleCreateDescription.value.trim(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
    closeRoleCreateModal(); toast('角色已创建'); await loadRoleAdminView({ silent: true });
  } catch (error) { els.roleCreateStatus.textContent = `创建失败：${error.message}`; }
}

async function deleteAccessRole(roleCode, roleName) {
  if (!window.confirm(`确认删除角色「${roleName}」？`)) return;
  try {
    const response = await personnelApiRequest(`/api/system/access-control/roles/${encodeURIComponent(roleCode)}`, 'DELETE');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
    toast('角色已删除'); await loadRoleAdminView({ silent: true });
  } catch (error) { toast(`删除角色失败：${error.message}`, true); }
}

async function openRolePermissionModal(roleCode, roleName) {
  accessRoleTarget = roleCode;
  els.rolePermissionTitle.textContent = `配置权限 · ${roleName}`;
  els.rolePermissionStatus.textContent = '正在读取权限…';
  els.rolePermissionGrid.innerHTML = '';
  els.rolePermissionModal.classList.remove('hidden');
  try {
    if (!accessResources.length) await loadAccessResources();
    const response = await personnelApiRequest(`/api/system/access-control/roles/${encodeURIComponent(roleCode)}/permissions`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
    const grants = new Map((data.grants || []).map((grant) => [grant.resourceCode, grant.operations || []]));
    els.rolePermissionGrid.innerHTML = flatAccessResources(accessResources).map((resource) => `<div class="access-grant-row" data-grant-resource="${esc(resource.code)}"><div class="access-grant-resource"><span class="access-indent" style="--depth:${resource.depth}"></span><b>${esc(resource.name)}</b> <code>${esc(resource.code)}</code></div>${['create', 'read', 'update', 'delete'].map((operation) => `<label><input type="checkbox" value="${operation}" ${resource.operations.includes(operation) ? '' : 'disabled'} ${grants.get(resource.code)?.includes(operation) ? 'checked' : ''} />${OPERATION_LABELS[operation] || operation}</label>`).join('')}</div>`).join('');
    els.rolePermissionStatus.textContent = '';
  } catch (error) { els.rolePermissionStatus.textContent = `读取失败：${error.message}`; }
}
function closeRolePermissionModal() { els.rolePermissionModal.classList.add('hidden'); accessRoleTarget = null; }

async function submitRolePermissions(event) {
  event.preventDefault();
  if (!accessRoleTarget) return;
  const grants = $$('[data-grant-resource]', els.rolePermissionGrid).map((row) => ({ resourceCode: row.dataset.grantResource, operations: $$('input:checked', row).map((input) => input.value) })).filter((grant) => grant.operations.length);
  try {
    els.rolePermissionStatus.textContent = '正在保存权限…';
    const response = await personnelApiRequest(`/api/system/access-control/roles/${encodeURIComponent(accessRoleTarget)}/permissions`, 'PUT', { grants });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
    closeRolePermissionModal(); toast('角色权限已保存'); await loadRoleAdminView({ silent: true });
  } catch (error) { els.rolePermissionStatus.textContent = `保存失败：${error.message}`; }
}

async function loadPermissionAdminView(options = {}) {
  if (!personnelManagerCanManage()) {
    els.permissionList.innerHTML = '<div class="dashboard-loading">仅当前 G0 范围内的 manager 可管理权限。</div>';
    return;
  }
  try {
    await loadAccessResources();
    const allResources = flatAccessResources(accessResources);
    const resources = visibleAccessResources(accessResources);
    els.permissionSummary.textContent = `共 ${allResources.length} 个权限节点 · 启用 ${allResources.filter((item) => item.enabled).length} · 停用 ${allResources.filter((item) => !item.enabled).length}`;
    els.permissionList.innerHTML = `<table class="access-table"><thead><tr><th>名称</th><th>编码</th><th>路由</th><th>操作集</th><th>排序</th><th>启用</th><th>操作</th></tr></thead><tbody>${resources.map((resource) => `<tr>
      <td><span class="access-indent" style="--depth:${resource.depth}"></span>${resource.children?.length ? `<button class="icon-btn access-expand" type="button" data-permission-expand="${esc(resource.code)}" aria-label="展开或收起">${collapsedAccessResources.has(resource.code) ? '+' : '−'}</button>` : '<span class="access-expand-placeholder"></span>'}<b>${esc(resource.name)}</b></td><td><code class="access-code">${esc(resource.code)}</code></td><td>${resource.route ? `<code>${esc(resource.route)}</code>` : '—'}</td><td>${resource.operations.map((operation) => `<span class="access-op">${OPERATION_LABELS[operation] || operation}</span>`).join('')}</td><td>${esc(resource.sort)}</td><td><button class="btn secondary compact" type="button" data-permission-toggle="${esc(resource.code)}">${resource.enabled ? '启用' : '停用'}</button></td><td><div class="access-table-actions"><button class="btn secondary compact" type="button" data-permission-child="${esc(resource.code)}">子级</button><button class="btn secondary compact" type="button" data-permission-edit="${esc(resource.code)}">编辑</button><button class="btn danger compact" type="button" data-permission-delete="${esc(resource.code)}">删除</button></div></td>
    </tr>`).join('')}</tbody></table>`;
    els.permissionStatus.textContent = '删除父权限前须先删除其子级；删除权限会同步清理角色中的对应授权。';
    refreshIcons($('#view-permission-admin'));
  } catch (error) {
    els.permissionList.innerHTML = `<div class="dashboard-loading">权限加载失败：${esc(error.message)}</div>`;
    if (!options.silent) toast(`权限加载失败：${error.message}`, true);
  }
}

function openPermissionModal(resource = null, parentCode = '') {
  accessResourceTarget = resource?.code || null;
  els.permissionEditTitle.textContent = resource ? `编辑权限 · ${resource.name}` : (parentCode ? '新增子级权限' : '新增顶级权限');
  els.permissionEditForm.reset();
  const flat = flatAccessResources(accessResources);
  els.permissionEditParent.innerHTML = '<option value="">顶级权限</option>' + flat.map((item) => `<option value="${esc(item.code)}">${'—'.repeat(item.depth)} ${esc(item.name)}</option>`).join('');
  els.permissionEditCode.value = resource?.code || '';
  els.permissionEditName.value = resource?.name || '';
  els.permissionEditParent.value = parentCode || '';
  els.permissionEditRoute.value = resource?.route || '';
  els.permissionEditSort.value = String(resource?.sort ?? 10);
  els.permissionEditEnabled.checked = resource?.enabled ?? true;
  $$('input[type="checkbox"]', els.permissionEditOperations).forEach((input) => { input.checked = (resource?.operations || ['read']).includes(input.value); });
  els.permissionEditCode.disabled = Boolean(resource);
  els.permissionEditParent.disabled = Boolean(resource);
  els.permissionEditStatus.textContent = '';
  els.permissionEditModal.classList.remove('hidden');
}
function closePermissionModal() { els.permissionEditModal.classList.add('hidden'); accessResourceTarget = null; }

async function submitPermission(event) {
  event.preventDefault();
  const body = { name: els.permissionEditName.value.trim(), route: els.permissionEditRoute.value.trim(), operations: $$('input:checked', els.permissionEditOperations).map((input) => input.value), sort: Number(els.permissionEditSort.value), enabled: els.permissionEditEnabled.checked };
  if (!accessResourceTarget) { body.code = els.permissionEditCode.value.trim(); if (els.permissionEditParent.value) body.parentCode = els.permissionEditParent.value; }
  try {
    els.permissionEditStatus.textContent = '正在保存权限…';
    const path = accessResourceTarget ? `/api/system/access-control/resources/${encodeURIComponent(accessResourceTarget)}` : '/api/system/access-control/resources';
    const response = await personnelApiRequest(path, accessResourceTarget ? 'PATCH' : 'POST', body);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
    closePermissionModal(); toast('权限已保存'); await loadPermissionAdminView({ silent: true });
  } catch (error) { els.permissionEditStatus.textContent = `保存失败：${error.message}`; }
}

async function deleteAccessResource(resourceCode) {
  if (!window.confirm(`确认删除权限「${resourceCode}」？`)) return;
  try {
    const response = await personnelApiRequest(`/api/system/access-control/resources/${encodeURIComponent(resourceCode)}`, 'DELETE');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
    toast('权限已删除'); await loadPermissionAdminView({ silent: true });
  } catch (error) { toast(`删除权限失败：${error.message}`, true); }
}

async function toggleAccessResource(resourceCode) {
  const resource = flatAccessResources(accessResources).find((item) => item.code === resourceCode);
  if (!resource) return;
  try {
    const response = await personnelApiRequest(`/api/system/access-control/resources/${encodeURIComponent(resourceCode)}`, 'PATCH', { name: resource.name, route: resource.route || '', operations: resource.operations, sort: resource.sort, enabled: !resource.enabled });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
    toast(`权限已${resource.enabled ? '停用' : '启用'}`); await loadPermissionAdminView({ silent: true });
  } catch (error) { toast(`切换权限状态失败：${error.message}`, true); }
}

function g0ChoiceValue(choice, fallback = '') { return choice?.value ?? fallback; }

function setG0Field(field, value) {
  if (field && document.activeElement !== field) field.value = value || '';
}

function renderG0History() {
  const snapshot = g0DecisionSnapshot;
  const history = snapshot ? [...(snapshot.history || [])].reverse() : [];
  const query = String(els.g0HistorySearch?.value || '').trim().toLowerCase();
  const filtered = query
    ? history.filter((entry) => [entry.field, entry.note, entry.actorId, entry.tenantId, String(entry.revision)].some((value) => String(value || '').toLowerCase().includes(query)))
    : history;
  els.g0DecisionHistory.innerHTML = renderG0HistoryMarkup(filtered, formatHarborTime);
}

function renderG0DecisionView() {
  const snapshot = g0DecisionSnapshot;
  if (!snapshot) return;
  const display = g0DecisionDisplay(snapshot);
  const decisions = snapshot.decisions || {};
  els.g0Readiness.textContent = display.ready ? '已完成初始化' : '尚未完成初始化';
  els.g0Readiness.className = `status-pill ${display.ready ? 'ok' : 'warn'}`;
  els.g0DecisionStatus.innerHTML = display.entries.map(([label, choice]) => `<div class="g0-status-item ${choice ? 'recorded' : 'missing'}"><i data-lucide="${choice ? 'check-circle-2' : 'circle'}"></i><span>${esc(label)}</span><b>${choice ? '已登记' : '尚未登记'}</b></div>`).join('');

  setG0Field(els.g0BusinessOwner, g0ChoiceValue(decisions.businessOwnerActor)?.actorId);
  setG0Field(els.g0VerifyActor, g0ChoiceValue(decisions.verifyActor)?.actorId);
  setG0Field(els.g0OperatorActor, g0ChoiceValue(decisions.threeAccountAuthorization)?.operatorActorId);
  setG0Field(els.g0DemoTenant, g0ChoiceValue(decisions.scope)?.demoTenantId || authSession?.tenantId || '');
  setG0Field(els.g0OrganizationScope, g0ChoiceValue(decisions.scope)?.organizationScope || authSession?.organizationId || '');

  const canRecord = g0ManagerCanRecord();
  els.g0Form.querySelectorAll('input, select, textarea').forEach((field) => { field.disabled = !canRecord; });
  els.btnG0Save.disabled = !canRecord;
  els.g0FormAccess.textContent = canRecord ? '当前会话可登记' : '当前会话仅可查看';
  els.g0FormAccess.className = `status-pill ${canRecord ? 'ok' : 'neutral'}`;
  els.g0FormStatus.textContent = canRecord ? '提交后将作为治理决策登记；服务端会再次验证 manager 权限。' : '当前会话不具备 manager 角色，只能查看已登记的决策与历史。';
  els.g0HistoryCount.textContent = `${display.history.length} 条`;
  renderG0History();
  refreshIcons($('#view-g0-governance'));
}

function g0TrimmedValue(field) { return String(field?.value || '').trim(); }

function collectG0DecisionRequest() {
  const businessOwnerActorId = g0TrimmedValue(els.g0BusinessOwner);
  return buildG0DecisionRequest({
    firstScenario: 'order_delivery_risk',
    businessOwnerActorId,
    verifyActorId: g0TrimmedValue(els.g0VerifyActor),
    demoTenantId: g0TrimmedValue(els.g0DemoTenant),
    organizationScope: g0TrimmedValue(els.g0OrganizationScope),
    managerActorId: authSession?.actorId || '',
    operatorActorId: g0TrimmedValue(els.g0OperatorActor),
    ownerActorId: businessOwnerActorId,
    m02OwnerActorId: businessOwnerActorId,
    taskStoreDecision: 'reuse_existing_task_center',
    g4Admission: 'blocked_until_g1',
    note: g0TrimmedValue(els.g0DecisionNote),
  });
}

function renderG0ResponsibleOptions() {
  const options = onboardingUsers
    .map((user) => `<option value="${esc(user.actorId)}">${esc(onboardingOptionLabel(user))}</option>`)
    .join('');
  const placeholder = '<option value="">请选择账号</option>';
  for (const select of [els.g0BusinessOwner, els.g0VerifyActor, els.g0OperatorActor]) {
    const current = select.value;
    select.innerHTML = placeholder + options;
    if (current) select.value = current;
  }
}

async function loadG0DecisionView(options = {}) {
  try {
    const response = await fetch('/api/governance/g0-decisions', { headers: { accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(g0ApiFailureReason(data, response.status));
    g0DecisionSnapshot = data.snapshot;
    await loadOnboardingUsers({ silent: true });
    renderG0ResponsibleOptions();
    renderG0DecisionView();
    syncPersonnelConfigEntry();
    syncOnboardingConfigEntry();
    return data.snapshot;
  } catch (error) {
    els.g0DecisionStatus.innerHTML = `<div class="dashboard-loading">G0 决策登记加载失败：${esc(error.message)}</div>`;
    if (!options.silent) toast(`G0 决策登记加载失败：${error.message}`, true);
    return null;
  }
}

async function saveG0DecisionView(event) {
  event.preventDefault();
  if (!g0ManagerCanRecord()) { els.g0FormStatus.textContent = '当前会话没有 manager 角色，无法保存。'; return; }
  try {
    const request = collectG0DecisionRequest();
    els.btnG0Save.disabled = true;
    els.g0FormStatus.textContent = '正在保存决策登记…';
    const response = await fetch('/api/governance/g0-decisions', {
      method: 'PUT', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(g0ApiFailureReason(data, response.status));
    g0DecisionSnapshot = data.snapshot;
    els.g0DecisionNote.value = '';
    renderG0DecisionView();
    const feedback = g0SaveFeedback(data.auditStatus);
    els.g0FormStatus.textContent = feedback.status;
    toast(feedback.toast, feedback.isError);
  } catch (error) {
    els.g0FormStatus.textContent = `保存失败：${error.message}`;
    toast(`G0 决策登记保存失败：${error.message}`, true);
  } finally {
    if (g0ManagerCanRecord()) els.btnG0Save.disabled = false;
  }
}

async function taskRequest(path, method = 'GET', body) {
  const response = await fetch(path, {
    method,
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(localizeUiText(data.error || `请求失败（HTTP ${response.status}）`));
  return data;
}

function registeredTaskOwnerActorId() {
  const actorId = g0DecisionSnapshot?.decisions?.businessOwnerActor?.value?.actorId;
  return typeof actorId === 'string' ? actorId : '';
}

function taskMutationGateMessage(gate) {
  if (gate.code === 'G0_DECISION_UNAVAILABLE') return 'G0 决策登记暂时无法读取，任务台账保持只读；请恢复读取后再执行变更。';
  if (gate.code === 'G0_NOT_READY') return 'G0 尚未具备进入 G1 的决策条件，任务台账保持只读。';
  if (gate.code === 'G0_SCOPE_MISMATCH') return '当前会话的租户或组织不在 G0 登记范围内，任务台账保持只读。';
  if (gate.code === 'HUMAN_ACTOR_REQUIRED') return '非人工会话只能查看任务台账，不能执行任务变更。';
  return '当前会话可查看任务台账；创建、分派和改派由 manager 人工账号执行。';
}

async function loadTaskG0Context() {
  try {
    const response = await fetch('/api/governance/g0-decisions', { headers: { accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    g0DecisionSnapshot = data.snapshot;
  } catch {
    // Failure to read the registered Owner must fail closed in the browser;
    // TaskApi remains the authoritative authorization boundary.
    g0DecisionSnapshot = null;
  }
}

function collaborationManager() {
  return authSession?.actorType === 'human' && Array.isArray(authSession?.roles) && (authSession.roles.includes('manager') || authSession.roles.includes('supervisor'));
}

function collaborationTaskEditor(task) {
  if (authSession?.actorType !== 'human' || task?.source !== 'collaboration') return false;
  return collaborationManager() || (Array.isArray(authSession.roles) && authSession.roles.includes('operator') && task.currentAssignee?.actorId === authSession.actorId);
}

function populateCollaborationProjectOptions() {
  const projects = Array.isArray(projectCenterState.projects) ? projectCenterState.projects : [];
  const selectedManual = els.manualTaskProject?.value || '';
  const selectedFilter = els.taskProjectFilter?.value || '';
  const options = projects.map((project) => `<option value="${esc(project.projectId)}">${esc(project.name)}</option>`).join('');
  if (els.manualTaskProject) {
    els.manualTaskProject.innerHTML = `<option value="">无项目</option>${options}`;
    els.manualTaskProject.value = projects.some((project) => project.projectId === selectedManual) ? selectedManual : '';
  }
  if (els.taskProjectFilter) {
    els.taskProjectFilter.innerHTML = `<option value="">全部项目</option>${options}`;
    els.taskProjectFilter.value = projects.some((project) => project.projectId === selectedFilter) ? selectedFilter : '';
  }
}

function taskBoardFilters() {
  return { query: els.taskSearch?.value || '', status: els.taskStatusFilter?.value || 'all', projectId: els.taskProjectFilter?.value || '' };
}

function collaborationBoardGroups(tasks) {
  return [
    { status: 'DRAFT', label: '待规划', tasks: tasks.filter((task) => task.status === 'DRAFT') },
    { status: 'ASSIGNED', label: '待办', tasks: tasks.filter((task) => task.status === 'ASSIGNED') },
    { status: 'IN_PROGRESS', label: '处理中', tasks: tasks.filter((task) => ['ACCEPTED', 'IN_PROGRESS', 'AWAITING_DECISION'].includes(task.status)) },
    { status: 'AWAITING_VERIFY', label: '待核验', tasks: tasks.filter((task) => task.status === 'AWAITING_VERIFY') },
    { status: 'COMPLETED', label: '已完成', tasks: tasks.filter((task) => task.status === 'COMPLETED') },
  ];
}

function agentRunOutputText(value) {
  if (value === null || value === undefined) return '智能体未返回可展示的正文。';
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function renderAgentRunResult(agentRun, compact = false) {
  if (!agentRun) return compact ? '' : '<div class="agent-run-result empty"><i data-lucide="bot"></i><span>尚无已关联的智能体运行记录。</span></div>';
  const execution = agentRun.execution || { state: 'unavailable', message: '运行结果暂不可读取。' };
  const state = execution.state || 'unavailable';
  const tone = state === 'completed' ? 'ok' : state === 'failed' || state === 'recalled' ? 'danger' : state === 'unavailable' ? 'neutral' : 'warn';
  const label = state === 'completed' ? '已回传' : state === 'failed' ? '运行失败' : state === 'recalled' ? '已召回' : state === 'unavailable' ? '记录不可用' : '运行中';
  const body = execution.result !== null && execution.result !== undefined
    ? `<pre>${esc(agentRunOutputText(execution.result))}</pre>`
    : `<p>${esc(execution.error?.message || execution.message || '尚未收到执行面结果。')}</p>`;
  return `<details class="agent-run-result${compact ? ' compact' : ''}"${compact ? '' : ' open'}><summary><span><i data-lucide="bot"></i>智能体回传结果</span><b class="status-pill ${tone}">${label}</b></summary><div class="agent-run-result-meta"><span>Run：${esc(agentRun.runtimeRunId || '—')}</span><span>智能体：${esc(agentRun.agentId || '—')}</span>${execution.capability ? `<span>能力：${esc(execution.capability)}</span>` : ''}</div><div class="agent-run-result-body">${body}</div><small>该回传仅供分析与核验参考，不代表业务动作已完成。</small></details>`;
}

function renderTaskRunHistory(details) {
  if (!details) return '';
  const history = Array.isArray(details.history) ? details.history : [];
  return `${renderAgentRunResult(details.task?.agentRun)}<ol class="task-history">${history.length ? history.map((entry) => `<li><span>${esc(formatHarborTime(entry.occurredAt))}</span><b>${esc(entry.eventType)}</b><p>${esc(entry.actor)} · ${esc(entry.reason)}</p></li>`).join('') : '<li><p>暂无历史记录</p></li>'}</ol>`;
}

function selectableHumanAssignees() {
  return personnelUsers.filter((user) => user.enabled && user.roles?.includes('operator') && user.actorId);
}

function renderHumanAssignmentFields(task) {
  const candidates = selectableHumanAssignees();
  const currentActorId = task.currentAssignee?.kind === 'responsibility_role' ? task.currentAssignee.actorId : '';
  const currentRole = task.currentAssignee?.kind === 'responsibility_role' ? task.currentAssignee.role : '项目协同负责人';
  const includesCurrent = currentActorId && candidates.some((user) => user.actorId === currentActorId);
  const users = includesCurrent ? candidates : (currentActorId ? [{ actorId: currentActorId, username: currentActorId, firstName: '', lastName: '', roles: [], enabled: true }, ...candidates] : candidates);
  const displayName = (user) => [user.lastName, user.firstName].filter(Boolean).join('') || user.username || user.actorId;
  const roles = [...new Set([currentRole, '项目协同负责人', '项目负责人', '执行负责人', '业务核验人'])];
  return `<label>接手人<select name="assigneeActorId" required aria-label="接手人" ${users.length ? '' : 'disabled'}><option value="">请选择已启用的执行人员</option>${users.map((user) => `<option value="${esc(user.actorId)}"${user.actorId === currentActorId ? ' selected' : ''}>${esc(displayName(user))}${user.username && user.username !== displayName(user) ? `（${esc(user.username)}）` : ''}</option>`).join('')}</select></label><label>责任角色<select name="assigneeRole" required aria-label="责任角色">${roles.map((role) => `<option value="${esc(role)}"${role === currentRole ? ' selected' : ''}>${esc(role)}</option>`).join('')}</select></label>${users.length ? '' : '<p class="assignment-empty-note">暂无可选人员。请先在“系统配置 → 人员管理”启用具备 operator 角色的账号。</p>'}`;
}

function renderCollaborationCard(task, compact = false) {
  const state = taskDisplayState(task, localDateKey());
  const project = (projectCenterState.projects || []).find((item) => item.projectId === task.projectId);
  const editable = collaborationTaskEditor(task);
  const details = taskDetails.get(task.taskId);
  const nextStatus = task.status === 'DRAFT' || task.status === 'ASSIGNED' ? 'IN_PROGRESS' : task.status === 'IN_PROGRESS' ? 'COMPLETED' : '';
  return `<article class="collaboration-card${state.needsAttention ? ' needs-attention' : ''}" ${task.source === 'collaboration' && editable ? `draggable="true" data-card-id="${esc(task.taskId)}"` : ''}>
    <div class="collaboration-card-top"><span class="status-pill ${esc(state.tone)}">${esc(state.label)}</span><span class="card-spacer"></span><code>${esc(task.taskId.slice(-8))}</code></div>
    <strong>${esc(task.title)}</strong>
    <p>${project ? `<i data-lucide="folder"></i>${esc(project.name)}` : '<i data-lucide="layers"></i>未归属项目'}</p>
    <div class="collaboration-card-meta"><span><i data-lucide="user-round"></i>${esc(task.currentAssignee?.actorId || '待分派')}</span><span><i data-lucide="calendar"></i>${esc(task.dueAt)}</span><span>${esc(task.priority)}</span></div>
    ${compact ? renderAgentRunResult(task.agentRun, true) : `<small>${esc(state.nextAction)}</small>`}
    <div class="collaboration-card-actions">${nextStatus && task.source === 'collaboration' ? `<button class="text-action task-progress-action" type="button" data-collab-task-status="${esc(nextStatus)}" data-collab-task-id="${esc(task.taskId)}">${nextStatus === 'COMPLETED' ? '标记完成' : '开始处理'}<i data-lucide="arrow-right"></i></button>` : ''}<button class="text-action task-progress-action" type="button" data-collab-task-detail="${esc(task.taskId)}"><i data-lucide="history"></i>${details ? '收起运行与历史' : '查看运行与历史'}</button>${collaborationManager() && task.source === 'collaboration' ? `<button class="text-action task-progress-action" type="button" data-collab-task-assign="${esc(task.taskId)}">改派<i data-lucide="user-round-check"></i></button>` : ''}</div>
    ${editingCollaborationAssignmentId === task.taskId ? `<form class="task-assignment-form collaboration-assignment-form" data-collab-task-assignment-form data-task-id="${esc(task.taskId)}">${renderHumanAssignmentFields(task)}<label>改派说明<input name="reason" maxlength="1000" required value="调整协同任务负责人。" aria-label="改派说明" /></label><button class="btn primary compact" type="submit" ${selectableHumanAssignees().length ? '' : 'disabled'}>确认改派</button><button class="btn ghost compact" type="button" data-collab-task-assign-cancel="${esc(task.taskId)}">取消</button></form>` : ''}
    ${details ? renderTaskRunHistory(details) : ''}
  </article>`;
}

function renderCollaborationTaskBoard() {
  if (!els.taskBoard) return;
  const tasks = filterCollaborationTasks(taskCenterState.tasks || [], taskBoardFilters());
  if (taskBoardView === 'list') {
    els.taskBoard.className = 'collaboration-table-wrap';
    els.taskBoard.innerHTML = `<table class="collaboration-table"><thead><tr><th>任务</th><th>项目</th><th>状态</th><th>负责人</th><th>优先级</th><th>截止日期</th></tr></thead><tbody>${tasks.map((task) => {
      const state = taskDisplayState(task, localDateKey()); const project = (projectCenterState.projects || []).find((item) => item.projectId === task.projectId);
      return `<tr><td><b>${esc(task.title)}</b><small>${esc(task.taskId)}</small></td><td>${esc(project?.name || '—')}</td><td><span class="status-pill ${esc(state.tone)}">${esc(state.label)}</span></td><td>${esc(task.currentAssignee?.actorId || '待分派')}</td><td>${esc(task.priority)}</td><td>${esc(task.dueAt)}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty-cell">未找到匹配的任务</td></tr>'}</tbody></table>`;
  } else {
    els.taskBoard.className = 'collaboration-board';
    els.taskBoard.innerHTML = collaborationBoardGroups(tasks).map((column) => `<section class="collaboration-column" data-kanban-column="${column.status}"><header><span>${esc(column.label)}</span><b>${column.tasks.length}</b></header><div class="collaboration-column-body">${column.tasks.map((task) => renderCollaborationCard(task)).join('') || '<p class="empty-column">暂无任务</p>'}</div></section>`).join('');
    bindKanbanDrag(els.taskBoard, (taskId, status) => { void updateCollaborationTaskStatus(taskId, status); });
  }
  $$('[data-task-view]').forEach((button) => button.classList.toggle('active', button.dataset.taskView === taskBoardView));
  refreshIcons(els.taskBoard);
}

async function loadProjects(options = {}) {
  try {
    projectCenterState = await taskRequest('/api/projects');
    populateCollaborationProjectOptions();
    renderProjectList();
    if (currentView === 'tasks') renderCollaborationTaskBoard();
    return projectCenterState;
  } catch (error) {
    if (els.projectList) els.projectList.innerHTML = `<div class="dashboard-loading">项目加载失败：${esc(error.message)}</div>`;
    const hint = error?.message === 'api endpoint not found'
      ? '项目接口不可用：当前网页已更新，但服务端仍是旧实例。请重启 AEOS Hub 后重试。'
      : `项目加载失败：${error.message}`;
    if (!options.silent) toast(hint, true);
    return null;
  }
}

function renderProjectList() {
  if (!els.projectList) return;
  const query = String(els.projectSearch?.value || '').trim().toLocaleLowerCase('zh-CN');
  const status = els.projectStatusFilter?.value || 'all';
  const projects = (projectCenterState.projects || []).filter((project) => (!query || [project.name, project.description, project.ownerActorId].some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(query))) && (status === 'all' || project.status === status));
  els.projectList.innerHTML = projects.length ? `<table class="collaboration-table"><thead><tr><th>项目名称</th><th>状态</th><th>优先级</th><th>进度</th><th>负责人</th><th>创建时间</th></tr></thead><tbody>${projects.map((project) => {
    const display = projectDisplayState(project, taskCenterState.tasks || []);
    return `<tr class="project-row" data-project-open="${esc(project.projectId)}"><td><b><i data-lucide="folder"></i>${esc(project.name)}</b><small>${esc(project.description || '未填写项目描述')}</small></td><td><span class="status-pill ${esc(display.tone)}">${esc(display.label)}</span></td><td>${esc(display.priorityLabel)}</td><td><div class="progress-cell"><span><i style="width:${display.progress.percent}%"></i></span><b>${display.progress.completed}/${display.progress.total}</b></div></td><td>${esc(display.ownerLabel)}</td><td>${esc(formatHarborTime(project.createdAt))}</td></tr>`;
  }).join('')}</tbody></table>` : '<div class="dashboard-loading">尚无项目。请新建第一个项目开始协同。</div>';
  renderProjectWorkspace();
  refreshIcons(els.projectList);
}

function renderProjectWorkspace() {
  if (!els.projectWorkspace) return;
  const project = (projectCenterState.projects || []).find((item) => item.projectId === selectedProjectId);
  if (!project) { els.projectWorkspace.classList.add('hidden'); els.projectWorkspace.innerHTML = ''; return; }
  const display = projectDisplayState(project, taskCenterState.tasks || []);
  const linkedDetails = projectTaskDetails.get(project.projectId);
  const detailedTasks = new Map((linkedDetails?.tasks || []).map((task) => [task.taskId, task]));
  const tasks = (taskCenterState.tasks || []).filter((task) => task.projectId === project.projectId).map((task) => detailedTasks.get(task.taskId) || task);
  const boardBody = tasks.length
    ? collaborationBoardGroups(tasks).map((column) => `<section class="collaboration-column"><header><span>${esc(column.label)}</span><b>${column.tasks.length}</b></header><div class="collaboration-column-body">${column.tasks.map((task) => renderCollaborationCard(task, true)).join('') || '<p class="empty-column">暂无任务</p>'}</div></section>`).join('')
    : `<div class="project-empty-state"><p>此项目还没有关联任务。</p>${collaborationManager() ? `<button class="btn primary compact" data-project-new-task="${esc(project.projectId)}" type="button"><i data-lucide="plus"></i>在此项目新建任务</button>` : `<p class="empty-column">仅 manager 角色可新建协同任务。</p>`}</div>`;
  els.projectWorkspace.classList.remove('hidden');
  els.projectWorkspace.innerHTML = `<section class="surface project-workspace-board"><div class="surface-head"><div><h2><i data-lucide="folder-open"></i>${esc(project.name)}</h2><p>${esc(project.description || '未填写项目描述')}</p></div><button class="btn ghost compact" data-project-close type="button">返回项目列表</button></div><div class="project-workspace-layout"><div class="project-task-board">${boardBody}</div><aside class="project-detail-panel"><h3>项目属性</h3><dl><div><dt>状态</dt><dd><span class="status-pill ${esc(display.tone)}">${esc(display.label)}</span></dd></div><div><dt>优先级</dt><dd>${esc(display.priorityLabel)}</dd></div><div><dt>负责人</dt><dd>${esc(project.ownerActorId)}</dd></div><div><dt>成员</dt><dd>${esc((project.memberActorIds || []).join('、'))}</dd></div><div><dt>开始日期</dt><dd>${esc(project.startDate || '—')}</dd></div><div><dt>截止日期</dt><dd>${esc(project.dueDate || '—')}</dd></div></dl><div class="project-progress"><span>进度 ${display.progress.percent}%</span><i><b style="width:${display.progress.percent}%"></b></i><small>${display.progress.completed}/${display.progress.total} 项任务已完成</small></div>${collaborationManager() ? `<div class="project-detail-actions"><button class="btn secondary compact" data-project-edit="${esc(project.projectId)}" type="button">编辑属性</button><button class="btn secondary compact" data-project-status="IN_PROGRESS" data-project-id="${esc(project.projectId)}" type="button">设为进行中</button><button class="btn ghost compact" data-project-status="COMPLETED" data-project-id="${esc(project.projectId)}" type="button">标记完成</button>${project.status !== 'CANCELLED' ? `<button class="btn ghost compact" data-project-status="CANCELLED" data-project-id="${esc(project.projectId)}" type="button">取消项目</button>` : ''}</div>` : ''}</aside></div></section>`;
  refreshIcons(els.projectWorkspace);
}

async function loadProjectTaskDetails(projectId) {
  const data = await taskRequest(`/api/projects/${encodeURIComponent(projectId)}`);
  projectTaskDetails.set(projectId, data);
  if (selectedProjectId === projectId) renderProjectWorkspace();
  return data;
}

function openProjectTaskCreate(projectId) {
  if (!collaborationManager()) { toast('只有 manager 人工账号可以创建协同任务。', true); return; }
  showView('tasks');
  els.manualTaskCreatePanel.classList.remove('hidden');
  if (els.manualTaskProject) els.manualTaskProject.value = projectId;
  els.manualTaskForm.elements.title.focus();
}

async function updateCollaborationTaskStatus(taskId, status) {
  try {
    await taskRequest(`/api/tasks/${encodeURIComponent(taskId)}/collaboration`, 'PATCH', { status, reason: `在协同看板中更新为 ${status}` });
    await Promise.all([loadTasks({ silent: true }), loadProjects({ silent: true })]);
    toast('任务状态已更新');
  } catch (error) { toast(`更新任务失败：${error.message}`, true); }
}

async function loadAssignablePersonnel() {
  if (personnelUsers.length) return personnelUsers;
  const response = await personnelApiRequest('/api/system/personnel/users');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(personnelFailureReason(data, response.status));
  personnelUsers = Array.isArray(data.users) ? data.users : [];
  return personnelUsers;
}

async function assignCollaborationTask(taskId) {
  const task = (taskCenterState.tasks || []).find((item) => item.taskId === taskId);
  if (!task || !collaborationManager()) return;
  editingCollaborationAssignmentId = editingCollaborationAssignmentId === taskId ? null : taskId;
  if (editingCollaborationAssignmentId) {
    try {
      await loadAssignablePersonnel();
    } catch (error) {
      toast(`无法读取可改派人员：${error.message}`, true);
    }
  }
  renderCollaborationTaskBoard();
  renderProjectWorkspace();
}

async function submitCollaborationTaskAssignment(event) {
  const form = event.target.closest('[data-collab-task-assignment-form]');
  if (!form) return;
  event.preventDefault();
  const taskId = form.dataset.taskId;
  const task = (taskCenterState.tasks || []).find((item) => item.taskId === taskId);
  if (!task || !collaborationManager()) { toast('当前会话无权改派该任务。', true); return; }
  const submit = $('button[type="submit"]', form);
  try {
    const payload = buildTaskAssignmentPayload(Object.fromEntries(new FormData(form).entries()));
    submit.disabled = true;
    await taskRequest(`/api/tasks/${encodeURIComponent(taskId)}/assignments`, 'POST', payload);
    editingCollaborationAssignmentId = null;
    taskDetails.delete(taskId);
    projectTaskDetails.clear();
    await Promise.all([loadTasks({ silent: true }), loadProjects({ silent: true })]);
    toast('任务负责人已更新');
  } catch (error) { toast(`改派任务失败：${error.message}`, true); }
  finally { if (submit?.isConnected) submit.disabled = false; }
}

async function updateProjectStatus(projectId, status) {
  try {
    await taskRequest(`/api/projects/${encodeURIComponent(projectId)}`, 'PATCH', { status, reason: `更新项目状态为 ${status}` });
    await loadProjects({ silent: true });
    toast('项目状态已更新');
  } catch (error) { toast(`更新项目失败：${error.message}`, true); }
}

async function editProject(projectId) {
  const project = (projectCenterState.projects || []).find((item) => item.projectId === projectId);
  if (!project || !collaborationManager()) return;
  const name = window.prompt('项目名称：', project.name);
  if (!name?.trim()) return;
  const description = window.prompt('项目描述：', project.description || '');
  if (description === null) return;
  const members = window.prompt('成员 actor ID（用英文逗号分隔）：', (project.memberActorIds || []).join(','));
  if (members === null) return;
  const dueDate = window.prompt('截止日期（YYYY-MM-DD，留空表示未设置）：', project.dueDate || '');
  if (dueDate === null) return;
  try {
    await taskRequest(`/api/projects/${encodeURIComponent(projectId)}`, 'PATCH', {
      name, description, dueDate: dueDate.trim() || null, memberActorIds: members.split(',').map((item) => item.trim()).filter(Boolean), reason: '更新项目属性与成员',
    });
    await loadProjects({ silent: true });
    toast('项目属性已更新');
  } catch (error) { toast(`更新项目失败：${error.message}`, true); }
}

function renderTaskCenter() {
  const tasks = Array.isArray(taskCenterState.tasks) ? taskCenterState.tasks : [];
  const controlledTasks = tasks.filter((task) => task.source !== 'collaboration');
  const today = localDateKey();
  const openCases = (operatingCenterState.cases || []).filter((item) => item.status !== 'closed' && item.source === 'order' && Array.isArray(item.evidenceRefs) && item.evidenceRefs.length);
  els.controlledTaskSection?.classList.toggle('hidden', !openCases.length && !controlledTasks.length);
  const taskMutationGate = g1TaskUiMutationGate(authSession, g0DecisionSnapshot);
  const canCreate = canCreateTaskFromCase(authSession, { source: 'order', evidenceRefs: ['ui-projection'] }, g0DecisionSnapshot);
  const selectedCase = els.taskCaseSelect.value;
  els.taskCaseSelect.innerHTML = openCases.length
    ? `<option value="">请选择经营事项</option>${openCases.map((item) => `<option value="${esc(item.id)}">${esc(item.entityId)} · ${esc(item.title)}</option>`).join('')}`
    : '<option value="">暂无带 Evidence 的未闭环经营事项</option>';
  if (openCases.some((item) => item.id === selectedCase)) els.taskCaseSelect.value = selectedCase;
  els.taskCreateControls.classList.toggle('hidden', !canCreate);
  els.taskReadonlyNote.classList.toggle('hidden', canCreate);
  els.btnTaskCreate.disabled = !canCreate || !openCases.length;
  els.taskCreateHint.textContent = canCreate
    ? (openCases.length ? '创建后由 manager 分派具体 M01 actor ID；分析结果必须由业务 Owner 核验。' : '暂无可建任务事项。请先从订单风险详情纳入经营事项，并确保其包含 Evidence。')
    : taskMutationGateMessage(taskMutationGate);

  const ownerActorId = registeredTaskOwnerActorId();
  const display = controlledTasks.map((task) => ({ task, state: taskDisplayState(task, today), capabilities: taskUiCapabilities(task, authSession, ownerActorId, g0DecisionSnapshot) }));
  const draft = display.filter(({ task }) => task.status === 'DRAFT').length;
  const active = display.filter(({ task }) => ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_DECISION'].includes(task.status)).length;
  const verifying = display.filter(({ task }) => task.status === 'AWAITING_VERIFY').length;
  const attention = display.filter(({ state }) => state.needsAttention).length;
  els.taskDraftCount.textContent = String(draft);
  els.taskActiveCount.textContent = String(active);
  els.taskVerifyCount.textContent = String(verifying);
  els.taskAttentionCount.textContent = String(attention);
  const actionable = display.filter(({ task }) => !['COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED'].includes(task.status)).length;
  els.navTaskCount.textContent = String(actionable);
  els.navTaskCount.classList.toggle('hidden', actionable === 0);
  els.taskListCount.textContent = `${controlledTasks.length} 项任务`;
  els.taskListCount.className = `status-pill ${attention ? 'warn' : 'neutral'}`;

  const searchTerm = (els.taskSearch?.value || '').trim().toLowerCase();
  const visible = searchTerm
    ? display.filter(({ task }) => [task.title, task.caseId, task.taskId, task.currentAssignee?.actorId].some((value) => value && String(value).toLowerCase().includes(searchTerm)))
    : display;

  els.taskList.innerHTML = visible.length ? visible.map(({ task, state, capabilities }) => {
    const details = taskDetails.get(task.taskId);
    const agentCandidates = taskAgentCandidates.get(task.taskId);
    const history = Array.isArray(details?.history) ? details.history : [];
    const actions = [
      `<button class="btn ghost compact" type="button" data-task-action="detail" data-task-id="${esc(task.taskId)}"><i data-lucide="history"></i>${details ? '收起运行与历史' : '查看运行与历史'}</button>`,
      `<button class="btn ghost compact" type="button" data-task-action="agent-candidates" data-task-id="${esc(task.taskId)}"><i data-lucide="shield-check"></i>${agentCandidates ? '收起接手条件' : '查看 Agent 接手条件'}</button>`,
      task.currentAssignee?.kind === 'agent' ? `<button class="btn primary compact" type="button" data-task-action="agent-run" data-task-id="${esc(task.taskId)}"><i data-lucide="bot"></i>运行 Agent</button>` : '',
      collaborationManager() ? `<button class="btn ghost compact" type="button" data-task-action="project-link" data-task-id="${esc(task.taskId)}"><i data-lucide="folder-input"></i>${task.projectId ? '调整项目' : '关联项目'}</button>` : '',
      capabilities.canAssign ? `<button class="btn secondary compact" type="button" data-task-action="assign" data-task-id="${esc(task.taskId)}"><i data-lucide="user-round-check"></i>${task.currentAssignee ? '改派责任' : '分派责任'}</button>` : '',
      capabilities.canAccept ? `<button class="btn secondary compact" type="button" data-task-action="accept" data-task-id="${esc(task.taskId)}"><i data-lucide="handshake"></i>记录接受</button>` : '',
      capabilities.canStart ? `<button class="btn secondary compact" type="button" data-task-action="start" data-task-id="${esc(task.taskId)}"><i data-lucide="play"></i>记录处理</button>` : '',
      capabilities.canSupplementEvidence ? `<button class="btn ghost compact" type="button" data-task-action="evidence" data-task-id="${esc(task.taskId)}"><i data-lucide="paperclip"></i>补充证据</button>` : '',
      capabilities.canSubmitPendingResult ? `<button class="btn secondary compact" type="button" data-task-action="result" data-task-id="${esc(task.taskId)}"><i data-lucide="file-check-2"></i>登记待核验结果</button>` : '',
      capabilities.canVerify ? `<button class="btn primary compact" type="button" data-task-action="verify" data-task-id="${esc(task.taskId)}"><i data-lucide="badge-check"></i>业务核验</button>` : '',
      capabilities.canDelete ? `<button class="btn ghost compact danger" type="button" data-task-action="delete" data-task-id="${esc(task.taskId)}"><i data-lucide="trash-2"></i>删除</button>` : '',
    ].filter(Boolean).join('');
    return `<article class="task-card${state.needsAttention ? ' needs-attention' : ''}">
      <div class="task-card-top"><span class="case-source ${esc(task.source)}">${esc(operatingSourceLabel(task.source))}</span><code>${esc(task.taskId.slice(-12))}</code><span class="task-card-spacer"></span><b class="status-pill ${esc(state.tone)}">${esc(state.label)}${state.overdue ? ' · 已逾期' : ''}</b></div>
      <strong>${esc(task.title)}</strong><p class="task-source-line">来源事项：${esc(task.caseId)} · Evidence ${task.evidenceRefs.length} 条</p>
      <div class="task-meta"><span><i data-lucide="user-round-check"></i>责任：${esc(state.assigneeLabel)}</span><span><i data-lucide="fingerprint"></i>经办：${esc(task.currentAssignee?.actorId || '待 manager 指定')}</span><span><i data-lucide="calendar-clock"></i>时限：${esc(task.dueAt)}</span><span><i data-lucide="circle-dot-dashed"></i>优先级：${esc(task.priority)}</span></div>
      <div class="task-next-action"><i data-lucide="arrow-right"></i><span><b>下一步：</b>${esc(state.nextAction)}</span></div>
      ${state.awaitingBusinessVerification ? '<div class="task-verify-note"><i data-lucide="shield-check"></i>分析结果仍为待核验状态，只有业务 Owner 的核验记录才能完成任务。</div>' : ''}
      <div class="case-actions task-actions">${actions}</div>
      ${editingTaskAssignmentId === task.taskId && capabilities.canAssign ? `<form class="task-assignment-form" data-task-assignment-form data-task-id="${esc(task.taskId)}">${renderHumanAssignmentFields(task)}<label>分派说明<input name="reason" maxlength="1000" required placeholder="说明本次分派原因（将留痕）" aria-label="分派说明" /></label><button class="btn primary compact" type="submit" ${selectableHumanAssignees().length ? '' : 'disabled'}>保存分派</button><button class="btn ghost compact" type="button" data-task-action="cancel-assign" data-task-id="${esc(task.taskId)}">取消</button></form>` : ''}
      ${editingTaskProjectId === task.taskId ? `<form class="task-project-link-form" data-task-project-link-form data-task-id="${esc(task.taskId)}"><label>关联项目<select name="projectId" aria-label="关联项目"><option value="">不关联任何项目</option>${(projectCenterState.projects || []).map((project) => `<option value="${esc(project.projectId)}"${project.projectId === task.projectId ? ' selected' : ''}>${esc(project.name)}</option>`).join('')}</select></label><button class="btn primary compact" type="submit">保存关联</button><button class="btn ghost compact" type="button" data-task-action="cancel-project-link" data-task-id="${esc(task.taskId)}">取消</button></form>` : ''}
      ${agentCandidates ? renderAgentCandidatePanel(agentCandidates) : ''}
      ${details ? `${renderAgentRunResult(details.task?.agentRun)}<ol class="task-history">${history.length ? history.map((entry) => `<li><span>${esc(formatHarborTime(entry.occurredAt))}</span><b>${esc(entry.eventType)}</b><p>${esc(entry.actor)} · ${esc(entry.reason)}</p></li>`).join('') : '<li><p>暂无历史记录</p></li>'}</ol>` : ''}
    </article>`;
  }).join('') : (searchTerm ? '<div class="dashboard-loading">没有匹配的任务。</div>' : '<div class="dashboard-loading">暂无责任任务。请先从上方选择经营事项创建任务。</div>');
  populateCollaborationProjectOptions();
  renderCollaborationTaskBoard();
  refreshIcons($('#view-tasks'));
}

async function loadTasks(options = {}) {
  try {
    await Promise.all([loadOperatingCenter({ silent: true }), loadTaskG0Context(), loadProjects({ silent: true })]);
    taskCenterState = await taskRequest('/api/tasks');
    renderTaskCenter();
    return taskCenterState;
  } catch (error) {
    els.taskList.innerHTML = `<div class="dashboard-loading">任务中心加载失败：${esc(error.message)}</div>`;
    if (!options.silent) toast(`任务中心加载失败：${error.message}`, true);
    return null;
  }
}

async function createTaskFromCase() {
  const caseId = els.taskCaseSelect.value;
  const operatingCase = (operatingCenterState.cases || []).find((item) => item.id === caseId);
  if (!canCreateTaskFromCase(authSession, operatingCase, g0DecisionSnapshot)) { toast('当前会话无权创建订单交付风险任务。', true); return; }
  const reason = window.prompt('建任务说明（将留痕到 Evidence，不会执行任何业务动作）：', '建立经营风险责任闭环任务。');
  if (!reason?.trim()) return;
  els.btnTaskCreate.disabled = true;
  try {
    const data = await taskRequest(`/api/operating-cases/${encodeURIComponent(caseId)}/tasks`, 'POST', { priority: els.taskPriority.value, reason });
    await loadTasks({ silent: true });
    toast('责任任务已创建或返回原有未关闭任务；请确认责任角色与下一步动作。');
  } finally { els.btnTaskCreate.disabled = false; }
}

async function createManualTask(event) {
  event.preventDefault();
  if (!collaborationManager()) { toast('只有 manager 人工账号可以创建协同任务。', true); return; }
  const submit = $('button[type="submit"]', els.manualTaskForm);
  try {
    const payload = buildCollaborationTaskPayload(Object.fromEntries(new FormData(els.manualTaskForm).entries()));
    submit.disabled = true;
    await taskRequest('/api/tasks/manual', 'POST', payload);
    els.manualTaskForm.reset();
    els.manualTaskCreatePanel.classList.add('hidden');
    await Promise.all([loadTasks({ silent: true }), loadProjects({ silent: true })]);
    toast('协同任务已创建');
  } catch (error) { toast(`创建协同任务失败：${error.message}`, true); }
  finally { if (submit?.isConnected) submit.disabled = false; }
}

async function createProject(event) {
  event.preventDefault();
  if (!collaborationManager()) { toast('只有 manager 人工账号可以创建项目。', true); return; }
  const submit = $('button[type="submit"]', els.projectForm);
  try {
    const data = Object.fromEntries(new FormData(els.projectForm).entries());
    submit.disabled = true;
    const response = await taskRequest('/api/projects', 'POST', data);
    els.projectForm.reset();
    els.projectCreatePanel.classList.add('hidden');
    selectedProjectId = response.project?.projectId || null;
    await loadProjects({ silent: true });
    toast('项目已创建');
  } catch (error) {
    const hint = error?.message === 'api endpoint not found'
      ? '创建项目失败：项目接口尚未部署到当前服务，请重启 AEOS Hub 后重试。'
      : `创建项目失败：${error.message}`;
    toast(hint, true);
  }
  finally { if (submit?.isConnected) submit.disabled = false; }
}

async function loadTaskDetail(taskId) {
  if (taskDetails.has(taskId)) { taskDetails.delete(taskId); renderTaskCenter(); renderProjectWorkspace(); return; }
  const data = await taskRequest(`/api/tasks/${encodeURIComponent(taskId)}`);
  taskDetails.set(taskId, data);
  renderTaskCenter();
  renderProjectWorkspace();
}

async function loadTaskAgentCandidates(taskId) {
  if (taskAgentCandidates.has(taskId)) {
    taskAgentCandidates.delete(taskId);
    renderTaskCenter();
    return;
  }
  const data = await taskRequest(`/api/tasks/${encodeURIComponent(taskId)}/agent-candidates`);
  taskAgentCandidates.set(taskId, data);
  renderTaskCenter();
}

async function submitTaskAssignment(event) {
  const form = event.target.closest('[data-task-assignment-form]');
  if (!form) return;
  event.preventDefault();
  const taskId = form.dataset.taskId;
  const task = (taskCenterState.tasks || []).find((item) => item.taskId === taskId);
  if (!task || !taskUiCapabilities(task, authSession, registeredTaskOwnerActorId(), g0DecisionSnapshot).canAssign) {
    toast('当前会话无权分派该任务。', true);
    return;
  }
  const submit = $('button[type="submit"]', form);
  try {
    const payload = buildTaskAssignmentPayload(Object.fromEntries(new FormData(form).entries()));
    submit.disabled = true;
    await taskRequest(`/api/tasks/${encodeURIComponent(taskId)}/assignments`, 'POST', payload);
    editingTaskAssignmentId = null;
    taskDetails.delete(taskId);
    taskAgentCandidates.delete(taskId);
    await loadTasks({ silent: true });
    toast('任务分派已留痕。');
  } catch (error) {
    toast(`分派任务失败：${error.message}`, true);
  } finally {
    if (submit.isConnected) submit.disabled = false;
  }
}

async function submitTaskProjectLink(event) {
  const form = event.target.closest('[data-task-project-link-form]');
  if (!form) return;
  event.preventDefault();
  const taskId = form.dataset.taskId;
  const submit = $('button[type="submit"]', form);
  try {
    submit.disabled = true;
    const projectId = String(new FormData(form).get('projectId') || '');
    await taskRequest(`/api/tasks/${encodeURIComponent(taskId)}/project`, 'PATCH', { projectId: projectId || null, reason: projectId ? '关联项目以跟踪任务与智能体结果' : '解除项目关联' });
    editingTaskProjectId = null;
    projectTaskDetails.clear();
    await Promise.all([loadTasks({ silent: true }), loadProjects({ silent: true })]);
    toast(projectId ? '任务已关联项目，运行结果将同步显示在项目工作区。' : '任务已解除项目关联。');
  } catch (error) { toast(`关联项目失败：${error.message}`, true); }
  finally { if (submit?.isConnected) submit.disabled = false; }
}

async function performTaskAction(taskId, action) {
  const task = (taskCenterState.tasks || []).find((item) => item.taskId === taskId);
  if (!task) return;
  if (action === 'detail') { await loadTaskDetail(taskId); return; }
  if (action === 'agent-candidates') { await loadTaskAgentCandidates(taskId); return; }
  if (action === 'cancel-assign') { editingTaskAssignmentId = null; renderTaskCenter(); return; }
  if (action === 'cancel-project-link') { editingTaskProjectId = null; renderTaskCenter(); return; }
  if (action === 'assign') {
    if (!taskUiCapabilities(task, authSession, registeredTaskOwnerActorId(), g0DecisionSnapshot).canAssign) { toast('当前会话无权分派该任务。', true); return; }
    editingTaskAssignmentId = taskId;
    try { await loadAssignablePersonnel(); } catch (error) { toast(`无法读取可分派人员：${error.message}`, true); }
    renderTaskCenter();
    return;
  }
  if (action === 'agent-run') {
    if (task.currentAssignee?.kind !== 'agent') { toast('该任务尚未分派给 Agent。', true); return; }
    if (!window.confirm('确认运行该任务分派的 Agent？运行期间会等待结果。')) return;
    toast('Agent 运行中，请稍候…');
    try {
      await taskRequest(`/api/tasks/${encodeURIComponent(taskId)}/agent-runs`, 'POST', {});
      taskDetails.delete(taskId);
      taskAgentCandidates.delete(taskId);
      projectTaskDetails.clear();
      await loadTasks({ silent: true });
      toast('Agent 运行完成，结果已回写任务');
    } catch (error) {
      const message = String(error?.message || '未知错误');
      if (message.includes('已有待核验或已核验结果')) {
        toast('该任务已有智能体结果，正在等待业务核验；请点击“查看运行与历史”。', true);
      } else {
        toast(`Agent 运行失败：${message}`, true);
      }
    }
    return;
  }
  if (action === 'delete') {
    if (!taskUiCapabilities(task, authSession, registeredTaskOwnerActorId(), g0DecisionSnapshot).canDelete) { toast('当前会话无权删除该任务。', true); return; }
    if (!window.confirm('确认删除该任务？删除后不可恢复。')) return;
    try {
      await taskRequest(`/api/tasks/${encodeURIComponent(taskId)}`, 'DELETE', {});
      taskDetails.delete(taskId);
      taskAgentCandidates.delete(taskId);
      await loadTasks({ silent: true });
      toast('任务已删除');
    } catch (error) {
      toast(`删除失败：${error?.message || '未知错误'}`, true);
    }
    return;
  }
  if (action === 'project-link') {
    if (!collaborationManager()) { toast('只有 manager 人工账号可以关联项目。', true); return; }
    const projects = projectCenterState.projects || [];
    if (!projects.length) { toast('请先在项目模块创建项目。', true); return; }
    editingTaskProjectId = taskId;
    renderTaskCenter();
    return;
  }
  const capabilities = taskUiCapabilities(task, authSession, registeredTaskOwnerActorId(), g0DecisionSnapshot);
  const requiredCapability = {
    accept: 'canAccept', start: 'canStart', evidence: 'canSupplementEvidence', result: 'canSubmitPendingResult', verify: 'canVerify',
  }[action];
  if (requiredCapability && !capabilities[requiredCapability]) { toast('当前会话无权更新该任务。', true); return; }
  let path = `/api/tasks/${encodeURIComponent(taskId)}`;
  let body;
  if (action === 'accept' || action === 'start') {
    const reason = window.prompt(action === 'accept' ? '接受任务说明：' : '开始/恢复处理说明：', action === 'accept' ? '责任角色已接受该任务。' : '责任角色开始处理任务。');
    if (!reason?.trim()) return;
    path += '/transitions'; body = { toStatus: action === 'accept' ? 'ACCEPTED' : 'IN_PROGRESS', reason };
  } else if (action === 'evidence') {
    const evidenceRef = window.prompt('Evidence 引用：');
    if (!evidenceRef?.trim()) return;
    const reason = window.prompt('补充说明：', '补充任务处理依据。');
    if (!reason?.trim()) return;
    path += '/evidence'; body = { evidenceRefs: [evidenceRef], reason };
  } else if (action === 'escalate') {
    const reason = window.prompt('升级原因：', '需管理层协调处理。');
    if (!reason?.trim()) return;
    const nextAction = window.prompt('明确下一步动作：', '由业务负责人确认处理优先级与时限。');
    if (!nextAction?.trim()) return;
    path += '/escalations'; body = { reason, nextAction };
  } else if (action === 'result') {
    const resultType = window.prompt('结果类型：', 'risk_analysis');
    if (!resultType?.trim()) return;
    const summary = window.prompt('分析结果摘要（仅登记，不代表业务已执行）：');
    if (!summary?.trim()) return;
    path += '/results'; body = { resultType, summary, reason: '已登记分析结果，等待业务 Owner 核验。' };
  } else if (action === 'verify') {
    const verified = window.confirm('确认业务 Owner 已核验该结果？\n\n确认后任务将标记为“已核验完成”，但不会自动执行任何业务操作。');
    const reason = window.prompt(verified ? '核验通过说明：' : '退回原因：', verified ? '业务 Owner 已核验通过。' : '证据不足，退回重新分析。');
    if (!reason?.trim()) return;
    path += `/results/${encodeURIComponent(task.resultId)}/verify`; body = { outcome: verified ? 'VERIFIED' : 'REJECTED', reason };
  } else return;
  await taskRequest(path, 'POST', body);
  taskDetails.delete(taskId);
  taskAgentCandidates.delete(taskId);
  await loadTasks({ silent: true });
  toast(action === 'verify' ? '业务核验结果已留痕' : '任务记录已更新');
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
    showView('tasks');
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

const REGISTRY_USAGE_SYSTEM = { 'company-control': 'control-platform', 'aeos-hub': 'aeos-hub' };

function registryUsageSystemId(name) {
  return REGISTRY_USAGE_SYSTEM[String(name || '').toLowerCase()] || null;
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
      <span class="system-actions"><b class="status-pill ${esc(system.statusTone || 'neutral')}">${esc(system.status || '未知')}</b><button class="btn ghost compact registry-system-usage" type="button" data-registry-system-usage="${esc(system.name)}" title="查看该系统成本">成本</button></span>
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
    $('span', els.registryStatus).textContent = `能力目录加载失败：${error.message}`;
    els.registryStatus.classList.add('warning');
    if (!options.silent) toast(`能力目录加载失败：${error.message}`, true);
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
  };
  return maps[kind]?.[value] || [String(value || '未知'), 'neutral'];
}

function statusPill(kind, value) {
  const [label, tone] = harborStatus(kind, value);
  return `<b class="status-pill ${tone}">${esc(label)}</b>`;
}

function formatHarborTime(value) {
  if (!value) return '尚未收到';
  return formatBeijingDateTime(value, { year: undefined, second: undefined });
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
  if (!activity) return { title: '暂无已沉淀任务', detail: '等待智能助手按业务边界派发' };
  return { title: activity.title || '任务活动', detail: activity.detail || '未返回任务说明' };
}

const CATALOG_LEVEL_LABELS = { L0: '中枢编排', L1: '业务编队', L2: '专项执行', L3: '任务执行' };
const CATALOG_DOMAIN_LABELS = { order: '订单交付', kitting: '物料齐套', quality: '质量异常', production: '生产进度', 'cross-domain': '跨系统协同' };
// Hub 侧保留中枢 Agent（跨系统协同），默认隐藏当前没有实际业务入口的 10 个 L1 编队 Agent。
// 只影响 AI 港湾目录展示，不删除数据、不影响执行面或已有引用。
const HIDDEN_HUB_AGENT_IDS = new Set([
  'agent-bcaa0313-4b26-4db2-bb22-2ad88d7d826e',
  'agent-83347684-ce5f-4480-8cfe-b7c37913c3e4',
  'agent-9ccf336f-262b-4ddd-ab7b-a348a63db88b',
  'agent-4724207f-8202-4c73-bda1-fc4dc1c60329',
  'agent-45cb0025-7d48-4a38-b9f4-079c4f65e37f',
  'agent-b734fb5b-bcff-4168-a80a-d95c1748cc0c',
  'agent-b39514bd-f389-4766-a83f-100423b8e84f',
  'agent-ce5fbb98-972a-4fc6-b749-c03f167d400d',
  'agent-d5fed80d-dd24-4677-ae0e-49c6c99ec186',
  'agent-2e8c835f-b6d5-4a93-a9f6-e52b265d30bf',
]);

function isCatalogAgentHidden(agent) {
  return HIDDEN_HUB_AGENT_IDS.has(agent?.id);
}

function visibleHarborAgents() {
  return (harbor?.agents || []).filter((agent) => !HIDDEN_HUB_AGENT_IDS.has(agent?.id));
}

function catalogFilterActive() {
  return Boolean(String(harborAgentFilter.query || '').trim())
    || harborAgentFilter.level !== 'all'
    || harborAgentFilter.status !== 'all'
    || harborAgentFilter.domain !== 'all';
}

function catalogAgentMatches(agent, system) {
  if (isCatalogAgentHidden(agent, system)) return false;
  if (harborAgentFilter.level !== 'all' && agent.hierarchyLevel !== harborAgentFilter.level) return false;
  if (harborAgentFilter.status !== 'all' && agent.status !== harborAgentFilter.status) return false;
  if (harborAgentFilter.domain !== 'all' && !(agent.domainIds || []).includes(harborAgentFilter.domain)) return false;
  const query = String(harborAgentFilter.query || '').trim().toLowerCase();
  if (!query) return true;
  const text = [
    agent.name, agent.role, agent.externalAgentId, system.name,
    ...(agent.skills || []),
    ...(agent.domainIds || []).map((id) => CATALOG_DOMAIN_LABELS[id] || id),
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes(query);
}

function agentExpectsModelUsage(agent) {
  const skills = Array.isArray(agent?.skills) ? agent.skills : [];
  return skills.length === 0 || skills.some((skill) => !String(skill).startsWith('query'));
}

function usageIsQueryOnly(usage) {
  if (!usage || Number(usage.events) <= 0) return false;
  const tokens = (Number(usage.tokensIn) || 0) + (Number(usage.tokensOut) || 0);
  return Number(usage.queryEvents) === Number(usage.events)
    && tokens === 0
    && Number(usage.cost) === 0;
}

function catalogUsageHtml(usage, agent) {
  if (!usage || usage.events === 0) {
    return '<span class="catalog-usage empty"><strong>—</strong><small>未产生记账</small></span>';
  }
  const tokens = usage.tokensIn + usage.tokensOut;
  const missing = tokens === 0 && usage.cost === 0;
  if (usageIsQueryOnly(usage)) {
    return `<span class="catalog-usage empty"><strong>无模型 Token</strong><small>${usage.events} 次查询接口</small></span>`;
  }
  if (missing) {
    if (agent && !agentExpectsModelUsage(agent)) {
      return `<span class="catalog-usage empty"><strong>无模型 Token</strong><small>${usage.events} 次查询接口</small></span>`;
    }
    return `<span class="catalog-usage missing"><strong>Token 未上报</strong><small>${usage.events} 次执行</small></span>`;
  }
  return `<span class="catalog-usage"><strong>¥${formatUsageCost(usage.cost)}</strong><small>${formatTokenCount(tokens)} tok · ${usage.events} 次</small></span>`;
}

function catalogAgentUsageDetail(agent, system) {
  const usage = agent.usage;
  const tokens = usage ? usage.tokensIn + usage.tokensOut : 0;
  const queryOnly = usageIsQueryOnly(usage);
  const modelExpected = !queryOnly && agentExpectsModelUsage(agent);
  const missing = Boolean(usage && usage.events > 0 && tokens === 0 && usage.cost === 0 && !queryOnly);
  const card = (label, value, note, tone = '') => `<div class="catalog-usage-card"><span>${esc(label)}</span><strong class="${tone}">${esc(value)}</strong><small>${esc(note)}</small></div>`;
  return `<div class="catalog-agent-detail">
    <div class="catalog-usage-cards">
      ${card('已记账成本', queryOnly ? '—' : (usage ? `¥${formatUsageCost(usage.cost)}` : '—'), queryOnly ? '查询接口不产生模型费用' : (usage ? `${usage.events} 次记账` : '暂无用量'))}
      ${card('Token', queryOnly ? '无模型 Token' : (usage && tokens > 0 ? formatTokenCount(tokens) : (modelExpected ? '未上报' : '无模型调用')), queryOnly ? '纯查询接口不产生模型 Token' : (missing ? (modelExpected ? '输入 / 输出均缺失' : '查询接口不产生模型 Token') : '输入 + 输出'), missing ? 'missing' : '')}
      ${card('执行次数', usage ? String(usage.events) : '0', '来自 run_complete')}
      ${card('最近调用', usage?.lastAt ? formatHarborTime(usage.lastAt) : '—', agent.status === 'archived' ? '已归档' : '该 Agent')}
    </div>
    ${queryOnly
      ? '<div class="catalog-usage-note"><b>无模型费用</b>：这些执行是纯查询接口，不经过模型；调用次数来自 run_complete，Token 和成本为 0 属正常。</div>'
      : missing ? (modelExpected
        ? '<div class="catalog-usage-note"><b>不把缺失当 0</b>：这些执行没有上报 Token，成本显示为 ¥0.00 并明确标注“未上报”；系统级助手用量汇总在系统节点，不摊到本 Agent。</div>'
        : '<div class="catalog-usage-note"><b>无模型调用</b>：该 Agent 只有查询接口，不产生模型 Token；执行次数来自 run_complete，成本为 ¥0.00 属正常。</div>') : ''}
    <div class="catalog-system-usage-line"><span>所属系统累计</span><strong>${system.usage ? `¥${formatUsageCost(system.usage.cost)} · ${formatTokenCount(system.usage.tokensIn + system.usage.tokensOut)} tokens · ${system.usage.events} 次` : '暂无记账'}</strong><span class="spacer"></span><button class="btn ghost compact" type="button" data-open-usage-detail>查看分析成本</button></div>
  </div>`;
}

function renderCatalogAgentRow(agent, system) {
  const runtime = agent.runtimeId ? (harbor.runtimes || []).find((item) => item.id === agent.runtimeId) : null;
  const linkedMember = (squad.members || []).find((member) => member.harborAgentId === agent.id);
  const isRoot = agent.type === 'hub';
  const serviceDomains = (agent.domainIds || []).map((id) => CATALOG_DOMAIN_LABELS[id] || id);
  const environment = agent.execution
    ? `${agent.execution.local ? '港湾本机' : '远程执行面'} · ${agent.execution.connectionStatus === 'online' ? '在线' : '离线'}`
    : runtime?.name || '未绑定 Runtime';
  const updated = agent.execution ? formatHarborTime(agent.execution.lastSeenAt) : formatHarborTime(agent.updatedAt);
  return `<div class="catalog-agent-row${catalogExpandedAgentId === agent.id ? ' is-expanded' : ''}" data-catalog-agent-id="${esc(agent.id)}">
    <span class="catalog-agent-avatar"><i data-lucide="bot"></i></span>
    <div class="catalog-agent-main">
      <span class="catalog-agent-title"><strong>${esc(agent.name)}</strong><b class="harbor-tier">${esc(agent.hierarchyLevel)} · ${esc(CATALOG_LEVEL_LABELS[agent.hierarchyLevel] || '专项执行')}</b>${isRoot ? '<b class="status-pill ok">根节点</b>' : ''}${agent.registeredInHarbor === false ? '<b class="status-pill warn">未登记港湾</b>' : ''}</span>
      <small>${esc(agent.role || '未定义角色')} · ${esc(system.name)} · 服务域 ${esc(serviceDomains.join('、') || '未设置')}</small>
    </div>
    <span class="catalog-agent-skills">${harborTags(agent.skills, '尚未配置 Skill')}</span>
    <span class="catalog-agent-runtime"><strong>${esc(environment)}</strong><small>${esc(agent.modelProfileId || '未指定模型档')} · ${esc(updated)}</small></span>
    ${catalogUsageHtml(agent.usage, agent)}
    <span class="catalog-agent-status">${statusPill('agent', agent.status)}</span>
    <span class="catalog-agent-actions">${linkedMember
      ? `<button class="btn secondary compact harbor-open-conversation" type="button" data-harbor-open-conversation="${esc(agent.id)}"><i data-lucide="messages-square"></i>进入会话</button>`
      : ''}${agent.registeredInHarbor !== false && !isRoot
      ? `<button class="icon-btn harbor-delete-agent" type="button" title="删除 ${esc(agent.name)}" aria-label="删除 ${esc(agent.name)}" data-harbor-delete-agent-id="${esc(agent.id)}"><i data-lucide="trash-2"></i></button>`
      : ''}</span>
  </div>${catalogExpandedAgentId === agent.id ? catalogAgentUsageDetail(agent, system) : ''}`;
}

function renderCatalogDomain(system, domain, forceExpand) {
  const key = `${system.id}/${domain.id}`;
  const expanded = forceExpand || expandedCatalogDomains.has(key);
  return `<section class="catalog-domain ${expanded ? 'is-expanded' : ''}">
    <button class="catalog-domain-toggle" type="button" data-catalog-domain-toggle="${esc(key)}" aria-expanded="${expanded}">
      <span class="catalog-node-icon domain"><i data-lucide="folder-tree"></i></span>
      <span class="catalog-node-copy"><strong>${esc(domain.name)}</strong><small>主属业务域 · 服务域筛选会一并命中</small></span>
      <span class="catalog-node-count">${domain.agentCount} 个智能体</span>
      <i class="catalog-node-chevron" data-lucide="chevron-right"></i>
    </button>
    <div class="catalog-domain-body">${domain.agents.length
      ? domain.agents.map((agent) => renderCatalogAgentRow(agent, system)).join('')
      : '<div class="catalog-empty-node">该业务域暂无智能体</div>'}</div>
  </section>`;
}

function renderCatalogSystem(system, forceExpand) {
  const expanded = forceExpand || expandedCatalogSystems.has(system.id);
  return `<section class="catalog-system ${expanded ? 'is-expanded' : ''}">
    <button class="catalog-system-toggle" type="button" data-catalog-system-toggle="${esc(system.id)}" aria-expanded="${expanded}">
      <span class="catalog-node-icon system"><i data-lucide="building-2"></i></span>
      <span class="catalog-node-copy"><strong>${esc(system.name)}</strong><small>${system.unregistered ? '未登记系统' : esc(system.owner || '未指定负责人')} · ${system.domains.length} 个业务域</small></span>
      <span class="catalog-node-count">${system.agentCount} 个智能体</span>
      ${catalogUsageHtml(system.usage)}
      <i class="catalog-node-chevron" data-lucide="chevron-right"></i>
    </button>
    <div class="catalog-system-body">${system.domains.length
      ? system.domains.map((domain) => renderCatalogDomain(system, domain, forceExpand)).join('')
      : '<div class="catalog-empty-node">该业务域暂无智能体</div>'}</div>
  </section>`;
}

function renderCatalogHierarchyView(pairs) {
  return `<div class="catalog-hierarchy">${['L0', 'L1', 'L2', 'L3'].map((level) => {
    const members = pairs.filter(({ agent }) => agent.hierarchyLevel === level);
    if (!members.length) return '';
    return `<section class="catalog-hierarchy-group">
      <div class="catalog-hierarchy-head"><span class="catalog-node-icon domain"><i data-lucide="layers"></i></span><span class="catalog-node-copy"><strong>${level} · ${esc(CATALOG_LEVEL_LABELS[level])}</strong><small>功能层级视图，不改变系统与业务域归属</small></span><b class="catalog-node-count">${members.length}</b></div>
      <div class="catalog-hierarchy-members">${members.map(({ agent, system }) => renderCatalogAgentRow(agent, system)).join('')}</div>
    </section>`;
  }).join('')}</div>`;
}


function renderHarbor() {
  const agents = Array.isArray(harbor.agents) ? harbor.agents : [];
  const runtimes = Array.isArray(harbor.runtimes) ? harbor.runtimes : [];
  const projects = Array.isArray(harbor.projects) ? harbor.projects : [];
  const runs = Array.isArray(harbor.runs) ? harbor.runs : [];
  const runtimeById = new Map(runtimes.map((item) => [item.id, item]));
  const agentById = new Map(agents.map((item) => [item.id, item]));
  const visibleAgents = agents.filter((item) => !HIDDEN_HUB_AGENT_IDS.has(item.id));
  const schedulableAgents = visibleAgents.filter((item) => ['idle', 'working'].includes(item.status)).length;
  const onlineRuntimes = runtimes.filter((item) => ['online', 'busy'].includes(item.status)).length;
  const readyRuntimes = runtimes.filter((item) => ['ready', 'online', 'busy'].includes(item.status)).length;
  const activeProjects = projects.filter((item) => item.status === 'in_progress').length;
  const activeRuns = runs.filter((item) => ['queued', 'running', 'waiting_approval'].includes(item.status)).length;

  els.harborAgentCount.textContent = String(visibleAgents.length);
  els.harborAgentActive.textContent = `${schedulableAgents} 个可调度`;
  els.harborRuntimeCount.textContent = String(runtimes.length);
  els.harborRuntimeOnline.textContent = `${onlineRuntimes} 个在线 · ${readyRuntimes} 个可用`;
  els.harborProjectCount.textContent = String(projects.length);
  els.harborProjectActive.textContent = `${activeProjects} 个进行中`;
  els.harborRunCount.textContent = String(runs.length);
  els.harborRunActive.textContent = `${activeRuns} 个待处理/执行中`;
  els.harborRuntimeBoundaryStatus.textContent = `${readyRuntimes} 个待命`;
  els.harborUpdated.textContent = `最近同步 ${formatBeijingTime(new Date(), { second: '2-digit' })}`;

  if (els.harborShowHiddenAgents) els.harborShowHiddenAgents.checked = showHiddenHarborAgents;
  // 默认收起早期创建、无独立入口的业务分析编队；管理需要时可勾选显示。
  const catalogSystems = (Array.isArray(catalogTree?.systems) ? catalogTree.systems : []).map((system) => ({
    ...system,
    domains: (system.domains || []).map((domain) => ({
      ...domain,
      agents: (domain.agents || []).filter((agent) => showHiddenHarborAgents || !HIDDEN_HUB_AGENT_IDS.has(agent.id)),
    })),
  }));
  const activeFilter = catalogFilterActive();
  const allPairs = [];
  for (const system of catalogSystems) {
    for (const domain of system.domains) {
      for (const agent of domain.agents) allPairs.push({ agent, system, domain });
    }
  }
  const matchedPairs = allPairs.filter(({ agent, system }) => catalogAgentMatches(agent, system));
  if (els.harborAgentDomainFilter) els.harborAgentDomainFilter.value = harborAgentFilter.domain;
  const totalCost = catalogSystems.reduce((sum, system) => sum + (system.usage?.cost ?? 0), 0);
  const hasUsage = catalogSystems.some((system) => system.usage && system.usage.events > 0);
  const filteredSystems = catalogSystems.map((system) => {
    const domains = system.domains.map((domain) => {
      const members = domain.agents.filter((agent) => catalogAgentMatches(agent, system));
      return { ...domain, agents: members, agentCount: members.length };
    }).filter((domain) => domain.agents.length > 0 || (!activeFilter && system.id !== 'aeos-hub'));
    return { ...system, domains, agentCount: domains.reduce((sum, domain) => sum + domain.agentCount, 0) };
  }).filter((system) => system.agentCount > 0 || (!activeFilter && system.id !== 'aeos-hub'));

  if (els.catalogSummary) {
    const visibleSystems = filteredSystems.filter((system) => system.agentCount > 0);
    const visibleDomains = visibleSystems.reduce((sum, system) => sum + system.domains.filter((domain) => domain.agentCount > 0).length, 0);
    const visibleAgents = visibleSystems.reduce((sum, system) => sum + system.agentCount, 0);
    const counts = catalogTree
      ? { systems: visibleSystems.length, domains: visibleDomains, agents: visibleAgents, unregisteredInHarbor: catalogTree.counts?.unregisteredInHarbor ?? 0 }
      : null;
    els.catalogSummary.innerHTML = counts
      ? `<span><i data-lucide="network"></i>${counts.systems} 个系统 · ${counts.domains} 个业务域 · ${counts.agents} 个智能体${hasUsage ? ` · 累计 ¥${formatUsageCost(totalCost)}` : ''}</span>${counts.unregisteredInHarbor ? `<span class="catalog-warning"><i data-lucide="unlink"></i>${counts.unregisteredInHarbor} 个执行面智能体未登记港湾</span>` : ''}${activeFilter ? `<span class="catalog-hit"><i data-lucide="filter"></i>筛选命中 ${matchedPairs.length} 个</span>` : ''}`
      : '';
  }

  if (!catalogTree) {
    els.harborAgentList.innerHTML = harborEmpty('cloud-off', '目录数据暂不可用', '请刷新页面后重试');
  } else if (!catalogSystems.length) {
    els.harborAgentList.innerHTML = harborEmpty('building-2', '暂无系统', '请先在系统登记中配置归属系统');
  } else if (activeFilter && matchedPairs.length === 0) {
    els.harborAgentList.innerHTML = harborEmpty('search-x', '没有匹配的智能体', '请调整层级、状态、业务域或关键字筛选');
  } else if (catalogView === 'hierarchy') {
    els.harborAgentList.innerHTML = renderCatalogHierarchyView(matchedPairs);
  } else {
    els.harborAgentList.innerHTML = filteredSystems
      .map((system) => renderCatalogSystem(system, activeFilter))
      .join('');
  }

  const runtimeKinds = {
    'codex-app-server': 'Codex App Server', 'openai-responses': 'OpenAI Responses',
    'mcp-agent': 'MCP Agent', 'custom-cli': 'Custom CLI',
    'remote-execution-agent': '远程执行面', 'system-assistant': '系统托管助手',
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
    const visibleAgentIds = new Set(visibleHarborAgents().map((agent) => agent.id));
    const teamNames = (project.agentIds || []).filter((id) => visibleAgentIds.has(id)).map((id) => agentById.get(id)?.name).filter(Boolean);
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
    const [response, squadResponse, catalogResponse] = await Promise.all([
      fetch('/api/harbor', { headers: { accept: 'application/json' } }),
      fetch('/api/agent-squad', { headers: { accept: 'application/json' } }),
      fetch('/api/catalog/tree', { headers: { accept: 'application/json' } }),
    ]);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    harbor = data;
    if (squadResponse.ok) squad = await squadResponse.json();
    if (catalogResponse.ok) {
      const catalogData = await catalogResponse.json();
      catalogTree = catalogData.tree || null;
      if (!catalogExpansionInitialized && catalogTree) {
        for (const system of catalogTree.systems || []) {
          if (system.agentCount > 0) expandedCatalogSystems.add(system.id);
          for (const domain of system.domains || []) expandedCatalogDomains.add(`${system.id}/${domain.id}`);
        }
        catalogExpansionInitialized = true;
      }
    } else {
      catalogTree = null;
    }
    renderHarbor();
  } catch (error) {
    if (!options.silent) toast(`加载 AI 港湾失败：${error.message}`, true);
    [els.harborAgentList, els.harborRuntimeList, els.harborProjectList].forEach((node) => {
      node.innerHTML = harborEmpty('cloud-off', 'AI 港湾数据暂不可用', '请检查本机服务后重试');
      refreshIcons(node);
    });
  }
}

async function loadSquad(options = {}) {
  try {
    const response = await fetch('/api/agent-squad', { headers: { accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    squad = data;
  } catch (error) {
    if (!options.silent) toast(`加载协作成员失败：${error.message}`, true);
  }
}

async function postSquad(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  if (data.squad) squad = data.squad;
  return data.item;
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
  for (const agent of visibleHarborAgents()) {
    options.push(`<option value="${esc(agent.id)}"${agent.id === selected ? ' selected' : ''}>${esc(agent.name)} · ${esc(agent.role)}</option>`);
  }
  return options.join('');
}

const agentTypeLabels = { master: '系统主 Agent', specialist: '专业 Agent', tool: '工具 Agent' };

function agentParentOptions(type, selected = '') {
  const parents = eligibleParentAgents(visibleHarborAgents(), type);
  const options = ['<option value="">请选择上级 Agent</option>'];
  for (const agent of parents) {
    options.push(`<option value="${esc(agent.id)}"${agent.id === selected ? ' selected' : ''}>${esc(agent.name)} · ${esc(agent.registration?.code || agent.role)}</option>`);
  }
  return options.join('');
}

function syncAgentRegistrationForm() {
  const typeSelect = $('[name="type"]', els.harborFormFields);
  const parentSelect = $('[name="parentAgentId"]', els.harborFormFields);
  const levelInput = $('[name="hierarchyLevel"]', els.harborFormFields);
  const runtimeSelect = $('[name="runtimeId"]', els.harborFormFields);
  const capabilityHint = $('[data-agent-runtime-capabilities]', els.harborFormFields);
  if (!typeSelect || !parentSelect || !levelInput || !runtimeSelect || !capabilityHint) return;

  const { level } = registrationRule(typeSelect.value);
  const oldParent = parentSelect.value;
  const parents = eligibleParentAgents(visibleHarborAgents(), typeSelect.value);
  parentSelect.innerHTML = agentParentOptions(typeSelect.value, oldParent);
  parentSelect.value = parents.some((agent) => agent.id === oldParent) ? oldParent : (parents[0]?.id || '');
  parentSelect.disabled = parents.length === 0;
  levelInput.value = level;

  const runtime = (harbor.runtimes || []).find((item) => item.id === runtimeSelect.value);
  capabilityHint.textContent = runtime
    ? (runtime.capabilities || []).length
      ? `当前 Runtime 可声明的能力：${runtime.capabilities.join('、')}`
      : '当前 Runtime 尚未声明能力；此 Agent 的能力白名单必须留空。'
    : '暂未绑定 Runtime；此 Agent 的能力白名单必须留空。';
}

function wireAgentRegistrationForm() {
  const typeSelect = $('[name="type"]', els.harborFormFields);
  const runtimeSelect = $('[name="runtimeId"]', els.harborFormFields);
  if (!typeSelect || !runtimeSelect) return;
  typeSelect.addEventListener('change', syncAgentRegistrationForm);
  runtimeSelect.addEventListener('change', syncAgentRegistrationForm);
  syncAgentRegistrationForm();
}

function openHarborModal(type) {
  harborModalType = type;
  els.harborFormStatus.textContent = '';
  els.harborForm.reset();
  const definitions = {
    agent: {
      title: '新增智能体', desc: '先登记归属、层级与受限能力，再配置模型和执行环境；新增 Agent 默认保持草稿状态。', submit: '创建智能体',
      fields: `<label><span>智能体名称</span><input name="name" maxlength="80" required placeholder="例如：交付风险 Agent" /></label>
        <label><span>组织角色</span><input name="role" maxlength="120" required placeholder="例如：订单交付风险分析" /></label>
        <label><span>Agent 编码</span><input name="code" maxlength="80" pattern="[A-Za-z][A-Za-z0-9-]{1,79}" required placeholder="例如：erp-order-risk" /><small class="field-note">稳定标识；保存时会统一为小写，不能与已有 Agent 重复。</small></label>
        <label><span>Agent 类型</span><select name="type"><option value="master">系统主 Agent</option><option value="specialist" selected>专业 Agent</option><option value="tool">工具 Agent</option></select><small class="field-note">${agentTypeLabels.master}负责系统入口；专业与工具 Agent 只能归属对应上级。</small></label>
        <label><span>所属组织</span><input name="ownerOrg" maxlength="120" required placeholder="例如：供应链中心" /></label>
        <label><span>归属系统</span><select name="systemId">${((catalogTree?.systems || []).filter((system) => !system.unregistered).map((system) => `<option value="${esc(system.id)}">${esc(system.name)}</option>`).join('')) || '<option value="aeos-hub">AEOS Hub</option>'}</select><small class="field-note">目录树第一层；决定这个 Agent 归属哪个系统。</small></label>
        <label><span>主属业务域</span><select name="primaryDomainId">${Object.entries(CATALOG_DOMAIN_LABELS).map(([id, name]) => `<option value="${esc(id)}"${id === 'cross-domain' ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select><small class="field-note">目录树按主属域分组；共享能力选“跨系统协同”。</small></label>
        <label><span>服务业务域</span><input name="domainIds" placeholder="逗号分隔，例如：order,kitting" /><small class="field-note">派单与筛选按服务域匹配；留空时自动包含主属域。</small></label>
        <label><span>业务域</span><input name="domain" maxlength="120" required placeholder="例如：order-risk" /></label>
        <label><span>模型提供商</span><input name="provider" maxlength="80" required value="openai-codex" /></label>
        <label><span>模型</span><input name="model" maxlength="120" value="account-default" /></label>
        <label><span>执行 Runtime</span><select name="runtimeId">${runtimeOptions()}</select></label>
        <label><span>组织层级</span><input name="hierarchyLevel" readonly /><small class="field-note">由 Agent 类型自动确定，不能手动跨级。</small></label>
        <label><span>上级 Agent</span><select name="parentAgentId" required></select><small class="field-note">只显示符合该类型层级规则的上级 Agent。</small></label>
        <label class="wide"><span>Runtime 能力白名单</span><input name="allowedRuntimeCapabilities" placeholder="逗号分隔，例如：mcp, tool-calling" /><small class="field-note" data-agent-runtime-capabilities></small></label>
        <label><span>治理生命周期</span><select name="lifecycle"><option value="draft" selected>草稿（默认，不可路由）</option><option value="suspended">暂停</option></select><small class="field-note">启用与退役将在版本、策略和审批模块完成后开放。</small></label>
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
        <fieldset class="wide"><legend>智能体编队</legend><div class="agent-checks">${visibleHarborAgents().length ? visibleHarborAgents().map((agent) => `<label><input name="agentIds" type="checkbox" value="${esc(agent.id)}" /><span>${esc(agent.name)} · ${esc(agent.autonomyLevel)}</span></label>`).join('') : '<small class="field-note">当前没有可选智能体，可先创建项目，后续再组建编队。</small>'}</div></fieldset>
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
  if (type === 'agent') wireAgentRegistrationForm();
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
  let payload = Object.fromEntries(formData.entries());
  if (harborModalType === 'project') payload.agentIds = formData.getAll('agentIds');
  const endpoints = { agent: '/api/harbor/agents', runtime: '/api/harbor/runtimes', project: '/api/harbor/projects' };
  const labels = { agent: '智能体已创建', runtime: 'Runtime 已登记，等待真实连接与心跳', project: '协作项目已创建' };
  els.harborFormSubmit.disabled = true;
  els.harborFormStatus.textContent = '保存中...';
  try {
    if (harborModalType === 'agent') payload = buildAgentRegistrationPayload(payload, harbor.agents || []);
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
  wrap.appendChild(msgMeta(`${formatBeijingTime(new Date())} · 你`));
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
    const time = item.createdAt ? formatBeijingTime(item.createdAt) : '历史记录';
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
    wrap.appendChild(msgMeta(`${time} · 智能助手`));
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
      case 'dispatch_progress': {
        if (message.convId === curConvId) renderDispatchProgress(message);
        break;
      }
      case 'assistant_reply': {
        if (message.convId !== curConvId) {
          if (message.meta && message.meta.dispatchComplete) toast('自动分发完成，结果已写入会话');
          break;
        }
        document.getElementById('dispatch-progress-line')?.remove();
        const wrap = appendMsg('agent', '');
        const bubble = $('.bubble', wrap);
        if (bubble) {
          bubble.innerHTML = md(message.text);
          appendResultActions(bubble, message.text, {
            copyLabel: '复制回答',
            exportLabel: '导出回答',
            filenamePrefix: '智能助手回答',
          });
        }
        wrap.appendChild(msgMeta(`${formatBeijingTime(new Date())} · 智能助手 · 分析工作台`));
        els.empty.classList.add('hidden');
        finishThinking();
        setBusy(false);
        els.messages.scrollTop = els.messages.scrollHeight;
        break;
      }
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
      case 'dispatch_policy:data':
        fillDispatchConfig(message.payload);
        break;
      case 'dispatch_policy_saved': {
        if (message.payload) fillDispatchConfig(message.payload);
        const dispatchStatus = $('#dispatch-cfg-status');
        if (dispatchStatus) dispatchStatus.textContent = message.message || '已保存';
        toast(message.message || '分发配置已保存');
        break;
      }
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
      .then(async (response) => {
        if (!authenticated) return;
        const session = response.ok ? await response.json().catch(() => null) : null;
        if (session?.authenticated === true) reconnectTimer = window.setTimeout(connect, 3000);
        else showLoginRequired('登录会话已结束，请重新登录');
      })
      .catch(() => {
        if (authenticated) reconnectTimer = window.setTimeout(connect, 3000);
      });
  });
}

function showLoginRequired(message = '') {
  authenticated = false;
  authSession = null;
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
  window.setTimeout(() => (authMode === 'm01' ? els.m01LoginSubmit : els.loginAccount).focus(), 30);
}

async function bootstrapAuthentication() {
  const query = new URLSearchParams(location.search);
  const loginError = query.get('auth_error') === '1';
  const loggedOut = query.get('logged_out') === '1';
  try {
    const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
    const session = response.ok ? await response.json() : null;
    setLoginMode(session?.authMode);
    if (session?.authenticated === true) {
      authenticated = true;
      authSession = session;
      await loadMyGrants();
      showWorkspace(false);
      return;
    }
  } catch {
    // The visible login form will surface a precise error if the server stays unavailable.
  }
  if (loginError || loggedOut) history.replaceState(null, '', `${location.pathname}${location.hash}`);
  showLoginRequired(loginError ? '统一登录未完成，请重新登录。' : '');
}

/* Authentication and profile interactions */
els.loginForm.addEventListener('submit', handleLogin);
els.m01LoginSubmit.addEventListener('click', () => {
  // After an unsuccessful OIDC callback, request a fresh Keycloak credential
  // page instead of allowing a stale IdP browser session to repeat the failure.
  const retry = !els.loginError.classList.contains('hidden');
  els.m01LoginSubmit.disabled = true;
  window.location.assign(retry ? '/api/auth/login?retry=1' : '/api/auth/login');
});
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

function bindDashboardModuleToggles() {
  $$('.dashboard-module-toggle').forEach((button) => button.addEventListener('click', () => {
    const module = button.closest('.dashboard-module');
    const contentId = button.getAttribute('aria-controls');
    const content = contentId ? document.getElementById(contentId) : null;
    if (!module || !(content instanceof HTMLElement)) return;

    const collapsed = module.classList.toggle('is-collapsed');
    content.hidden = collapsed;
    button.setAttribute('aria-expanded', String(!collapsed));
    const label = $('[data-dashboard-toggle-label]', button);
    if (label) {
      const suffix = module.classList.contains('dashboard-platform-chain') ? '链路' : '';
      label.textContent = `${collapsed ? '展开' : '收起'}${suffix}`;
    }
  }));
}

/* Navigation and command center */
bindDashboardModuleToggles();
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
els.btnTasksRefresh.addEventListener('click', () => loadTasks());
els.taskSearch?.addEventListener('input', () => renderTaskCenter());
els.btnG0Refresh.addEventListener('click', () => loadG0DecisionView());
els.btnOpenG0Governance?.addEventListener('click', () => {
  if (!g0ConfigEntryVisible(authSession)) return;
  showView('g0-governance');
});
els.g0Form.addEventListener('submit', (event) => { void saveG0DecisionView(event); });
els.g0HistorySearch?.addEventListener('input', renderG0History);
els.btnPersonnelRefresh?.addEventListener('click', () => loadPersonnelAdminView());
els.btnOpenPersonnelAdmin?.addEventListener('click', () => {
  if (!personnelConfigEntryVisible(authSession, g0DecisionSnapshot)) return;
  showView('personnel-admin');
});
els.btnOpenRoleAdmin?.addEventListener('click', () => { if (personnelManagerCanManage()) showView('role-admin'); });
els.btnOpenPermissionAdmin?.addEventListener('click', () => { if (personnelManagerCanManage()) showView('permission-admin'); });
els.btnRoleRefresh?.addEventListener('click', () => loadRoleAdminView());
els.roleSearch?.addEventListener('input', () => loadRoleAdminView({ silent: true }));
els.btnRoleCreate?.addEventListener('click', openRoleCreateModal);
els.roleCreateClose?.addEventListener('click', closeRoleCreateModal);
els.roleCreateCancel?.addEventListener('click', closeRoleCreateModal);
els.roleCreateForm?.addEventListener('submit', (event) => { void submitRoleCreate(event); });
els.roleCreateModal?.addEventListener('mousedown', (event) => { if (event.target === els.roleCreateModal) closeRoleCreateModal(); });
els.roleList?.addEventListener('click', (event) => {
  const permission = event.target.closest('[data-role-permission]');
  if (permission) { void openRolePermissionModal(permission.dataset.rolePermission, permission.dataset.roleName); return; }
  const del = event.target.closest('[data-role-delete]');
  if (del) void deleteAccessRole(del.dataset.roleDelete, del.dataset.roleName);
});
els.rolePermissionClose?.addEventListener('click', closeRolePermissionModal);
els.rolePermissionCancel?.addEventListener('click', closeRolePermissionModal);
els.rolePermissionForm?.addEventListener('submit', (event) => { void submitRolePermissions(event); });
els.rolePermissionModal?.addEventListener('mousedown', (event) => { if (event.target === els.rolePermissionModal) closeRolePermissionModal(); });
els.btnPermissionRefresh?.addEventListener('click', () => loadPermissionAdminView());
els.btnPermissionCreate?.addEventListener('click', () => openPermissionModal());
els.permissionList?.addEventListener('click', (event) => {
  const expand = event.target.closest('[data-permission-expand]');
  if (expand) { const code = expand.dataset.permissionExpand; if (collapsedAccessResources.has(code)) collapsedAccessResources.delete(code); else collapsedAccessResources.add(code); void loadPermissionAdminView({ silent: true }); return; }
  const toggle = event.target.closest('[data-permission-toggle]');
  if (toggle) { void toggleAccessResource(toggle.dataset.permissionToggle); return; }
  const child = event.target.closest('[data-permission-child]');
  if (child) { openPermissionModal(null, child.dataset.permissionChild); return; }
  const edit = event.target.closest('[data-permission-edit]');
  if (edit) { const resource = flatAccessResources(accessResources).find((item) => item.code === edit.dataset.permissionEdit); if (resource) openPermissionModal(resource); return; }
  const del = event.target.closest('[data-permission-delete]');
  if (del) void deleteAccessResource(del.dataset.permissionDelete);
});
els.permissionEditClose?.addEventListener('click', closePermissionModal);
els.permissionEditCancel?.addEventListener('click', closePermissionModal);
els.permissionEditForm?.addEventListener('submit', (event) => { void submitPermission(event); });
els.permissionEditModal?.addEventListener('mousedown', (event) => { if (event.target === els.permissionEditModal) closePermissionModal(); });
els.personnelSearch?.addEventListener('input', () => loadPersonnelAdminView({ silent: true }));
els.btnPersonnelCreate?.addEventListener('click', openPersonnelCreateModal);
els.personnelCreateClose?.addEventListener('click', closePersonnelCreateModal);
els.personnelCreateCancel?.addEventListener('click', closePersonnelCreateModal);
els.personnelCreateForm?.addEventListener('submit', (event) => { void submitPersonnelCreate(event); });
els.personnelCreateModal?.addEventListener('mousedown', (event) => { if (event.target === els.personnelCreateModal) closePersonnelCreateModal(); });
els.personnelResetClose?.addEventListener('click', closePersonnelResetModal);
els.personnelResetCancel?.addEventListener('click', closePersonnelResetModal);
els.personnelResetForm?.addEventListener('submit', (event) => { void submitPersonnelReset(event); });
els.personnelResetModal?.addEventListener('mousedown', (event) => { if (event.target === els.personnelResetModal) closePersonnelResetModal(); });
els.personnelList?.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-personnel-toggle]');
  if (toggle) { void togglePersonnelEnabled(toggle.dataset.userId, toggle.dataset.enabled === 'true'); return; }
  const reset = event.target.closest('[data-personnel-reset]');
  if (reset) { openPersonnelResetModal({ id: reset.dataset.userId, username: reset.dataset.username }); return; }
  const roleSave = event.target.closest('[data-personnel-role-save]');
  if (roleSave) { void savePersonnelRoles(roleSave.dataset.userId); return; }
  const del = event.target.closest('[data-personnel-delete]');
  if (del) { void deletePersonnelUser(del.dataset.userId, del.dataset.name); return; }
});
els.btnOpenPersonnelOnboarding?.addEventListener('click', () => {
  if (!onboardingConfigEntryVisible(authSession, g0DecisionSnapshot)) return;
  showView('personnel-onboarding');
});
els.btnOpenPersonnelAdminFromOnboarding?.addEventListener('click', () => showView('personnel-admin'));
els.onboardingCreateForm?.addEventListener('submit', (event) => { void submitOnboardingCreate(event); });
els.onboardingG0Form?.addEventListener('submit', (event) => { void submitOnboardingG0(event); });
els.btnTaskCreate.addEventListener('click', () => { void createTaskFromCase().catch((error) => toast(`创建任务失败：${error.message}`, true)); });
els.btnTaskManualCreate?.addEventListener('click', () => {
  if (!collaborationManager()) { toast('只有 manager 人工账号可以创建协同任务。', true); return; }
  els.manualTaskCreatePanel.classList.toggle('hidden');
  if (!els.manualTaskCreatePanel.classList.contains('hidden')) els.manualTaskForm.elements.title.focus();
});
els.manualTaskForm?.addEventListener('submit', (event) => { void createManualTask(event); });
els.manualTaskCreatePanel?.addEventListener('click', (event) => { if (event.target.closest('[data-manual-task-cancel]')) els.manualTaskCreatePanel.classList.add('hidden'); });
els.taskSearch?.addEventListener('input', renderCollaborationTaskBoard);
els.taskStatusFilter?.addEventListener('change', renderCollaborationTaskBoard);
els.taskProjectFilter?.addEventListener('change', renderCollaborationTaskBoard);
$$('[data-task-view]').forEach((button) => button.addEventListener('click', () => { taskBoardView = button.dataset.taskView === 'list' ? 'list' : 'board'; renderCollaborationTaskBoard(); }));
els.taskBoard?.addEventListener('click', (event) => {
  const action = event.target.closest('[data-collab-task-status]');
  if (action) void updateCollaborationTaskStatus(action.dataset.collabTaskId, action.dataset.collabTaskStatus);
  const detail = event.target.closest('[data-collab-task-detail]');
  if (detail) void loadTaskDetail(detail.dataset.collabTaskDetail).catch((error) => toast(`读取运行与历史失败：${error.message}`, true));
  const assignment = event.target.closest('[data-collab-task-assign]');
  if (assignment) void assignCollaborationTask(assignment.dataset.collabTaskAssign);
  const cancelAssignment = event.target.closest('[data-collab-task-assign-cancel]');
  if (cancelAssignment) { editingCollaborationAssignmentId = null; renderCollaborationTaskBoard(); renderProjectWorkspace(); }
});
els.taskBoard?.addEventListener('submit', (event) => { void submitCollaborationTaskAssignment(event); });
els.taskList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-task-action]');
  if (!button) return;
  void performTaskAction(button.dataset.taskId, button.dataset.taskAction).catch((error) => toast(`更新任务失败：${error.message}`, true));
});
els.taskList.addEventListener('submit', (event) => { void submitTaskAssignment(event); void submitTaskProjectLink(event); });
els.btnProjectsRefresh?.addEventListener('click', () => { void Promise.all([loadProjects(), loadTasks({ silent: true })]); });
els.btnProjectCreate?.addEventListener('click', () => {
  if (!collaborationManager()) { toast('只有 manager 人工账号可以创建项目。', true); return; }
  els.projectCreatePanel.classList.toggle('hidden');
  if (!els.projectCreatePanel.classList.contains('hidden')) els.projectForm.elements.name.focus();
});
els.projectForm?.addEventListener('submit', (event) => { void createProject(event); });
els.projectCreatePanel?.addEventListener('click', (event) => { if (event.target.closest('[data-project-cancel]')) els.projectCreatePanel.classList.add('hidden'); });
els.projectSearch?.addEventListener('input', renderProjectList);
els.projectStatusFilter?.addEventListener('change', renderProjectList);
els.projectList?.addEventListener('click', (event) => {
  const row = event.target.closest('[data-project-open]');
  if (!row) return;
  selectedProjectId = row.dataset.projectOpen;
  renderProjectWorkspace();
  void loadProjectTaskDetails(selectedProjectId).catch((error) => toast(`项目任务详情加载失败：${error.message}`, true));
  els.projectWorkspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
els.projectWorkspace?.addEventListener('click', (event) => {
  const newTask = event.target.closest('[data-project-new-task]');
  if (newTask) { openProjectTaskCreate(newTask.dataset.projectNewTask); return; }
  const close = event.target.closest('[data-project-close]');
  if (close) { selectedProjectId = null; renderProjectWorkspace(); return; }
  const status = event.target.closest('[data-project-status]');
  if (status) {
    if (status.dataset.projectStatus === 'CANCELLED' && !window.confirm('确定取消这个项目吗？取消后项目保留为「已取消」状态，数据不删除。')) return;
    void updateProjectStatus(status.dataset.projectId, status.dataset.projectStatus);
  }
  const edit = event.target.closest('[data-project-edit]');
  if (edit) void editProject(edit.dataset.projectEdit);
  const taskStatus = event.target.closest('[data-collab-task-status]');
  if (taskStatus) void updateCollaborationTaskStatus(taskStatus.dataset.collabTaskId, taskStatus.dataset.collabTaskStatus);
  const detail = event.target.closest('[data-collab-task-detail]');
  if (detail) void loadTaskDetail(detail.dataset.collabTaskDetail).catch((error) => toast(`读取运行与历史失败：${error.message}`, true));
  const assignment = event.target.closest('[data-collab-task-assign]');
  if (assignment) void assignCollaborationTask(assignment.dataset.collabTaskAssign);
  const cancelAssignment = event.target.closest('[data-collab-task-assign-cancel]');
  if (cancelAssignment) { editingCollaborationAssignmentId = null; renderCollaborationTaskBoard(); renderProjectWorkspace(); }
});
els.projectWorkspace?.addEventListener('submit', (event) => { void submitCollaborationTaskAssignment(event); });
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
els.registrySystemGrid?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-registry-system-usage]');
  if (!button) return;
  const name = button.getAttribute('data-registry-system-usage') || '';
  const systemId = registryUsageSystemId(name);
  if (!systemId) { toast('该系统暂无 Hub 成本归属'); return; }
  openUsageForSystem(systemId);
});
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
  const systemToggle = event.target.closest('[data-catalog-system-toggle]');
  if (systemToggle) {
    const systemId = systemToggle.dataset.catalogSystemToggle;
    if (expandedCatalogSystems.has(systemId)) expandedCatalogSystems.delete(systemId);
    else expandedCatalogSystems.add(systemId);
    renderHarbor();
    return;
  }
  const domainToggle = event.target.closest('[data-catalog-domain-toggle]');
  if (domainToggle) {
    const key = domainToggle.dataset.catalogDomainToggle;
    if (expandedCatalogDomains.has(key)) expandedCatalogDomains.delete(key);
    else expandedCatalogDomains.add(key);
    renderHarbor();
    return;
  }
  const usageButton = event.target.closest('[data-open-usage-detail]');
  if (usageButton) {
    showView('usage');
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
  const agentRow = event.target.closest('[data-catalog-agent-id]');
  if (agentRow && !event.target.closest('button, a, input')) {
    const agentId = agentRow.dataset.catalogAgentId;
    catalogExpandedAgentId = catalogExpandedAgentId === agentId ? null : agentId;
    renderHarbor();
  }
});
$$('[data-catalog-view]').forEach((button) => button.addEventListener('click', () => {
  catalogView = button.dataset.catalogView === 'hierarchy' ? 'hierarchy' : 'ownership';
  $$('[data-catalog-view]').forEach((item) => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  renderHarbor();
}));
els.harborAgentSearch?.addEventListener('input', () => { harborAgentFilter.query = els.harborAgentSearch.value; renderHarbor(); });
els.harborShowHiddenAgents?.addEventListener('change', () => { showHiddenHarborAgents = Boolean(els.harborShowHiddenAgents.checked); renderHarbor(); });
els.harborAgentLevelFilter?.addEventListener('change', () => { harborAgentFilter.level = els.harborAgentLevelFilter.value; renderHarbor(); });
els.harborAgentStatusFilter?.addEventListener('change', () => { harborAgentFilter.status = els.harborAgentStatusFilter.value; renderHarbor(); });
els.harborAgentDomainFilter?.addEventListener('change', () => { harborAgentFilter.domain = els.harborAgentDomainFilter.value; renderHarbor(); });
els.harborAgentFilterClear?.addEventListener('click', () => {
  harborAgentFilter = { query: '', level: 'all', status: 'all', domain: 'all' };
  if (els.harborAgentSearch) els.harborAgentSearch.value = '';
  if (els.harborAgentLevelFilter) els.harborAgentLevelFilter.value = 'all';
  if (els.harborAgentStatusFilter) els.harborAgentStatusFilter.value = 'all';
  if (els.harborAgentDomainFilter) els.harborAgentDomainFilter.value = 'all';
  renderHarbor();
});
els.harborModalClose.addEventListener('click', closeHarborModal);
els.harborFormCancel.addEventListener('click', closeHarborModal);
els.harborForm.addEventListener('submit', submitHarborForm);
els.harborModal.addEventListener('mousedown', (event) => { if (event.target === els.harborModal) closeHarborModal(); });
els.headerAgent.addEventListener('click', () => showView('chat'));
els.headerAttention.addEventListener('click', () => showView('attention'));
els.btnAttentionRefresh.addEventListener('click', () => loadDashboard({ force: true }));
els.attentionSearch?.addEventListener('input', () => {
  attentionFilter.query = els.attentionSearch.value;
  attentionResultsDismissed = false;
  if (dashboardSnapshot) renderAttention(dashboardSnapshot);
});
async function runAttentionLiveQuery() {
  if (attentionLiveSearchBusy) return;
  const query = String(els.attentionSearch?.value || '').trim();
  const source = String(els.attentionSourceFilter?.value || 'all');
  attentionResultsDismissed = false;
  attentionLiveSearchBusy = true;
  if (els.attentionLiveQuery) {
    els.attentionLiveQuery.disabled = true;
    els.attentionLiveQuery.setAttribute('aria-busy', 'true');
  }
  els.attentionSearchStatus.textContent = '正在只读核查中台…';
  try {
    const response = await fetch('/api/attention/search', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ query, source, live: true }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    attentionLiveResult = data;
    els.attentionSearchStatus.textContent = data.live?.status === 'complete' ? '中台核查完成' : data.live?.status === 'partial' ? '中台部分返回 · 请查看数据提示' : '中台暂不可用 · 未得出无数据结论';
  } catch (error) {
    attentionLiveResult = { query, source, live: { status: 'unavailable', items: [], sources: [], warnings: [(error && error.message) || '中台核查失败'] } };
    els.attentionSearchStatus.textContent = '中台核查失败 · 请稍后重试';
  } finally {
    attentionLiveSearchBusy = false;
    if (els.attentionLiveQuery) {
      els.attentionLiveQuery.disabled = false;
      els.attentionLiveQuery.removeAttribute('aria-busy');
    }
    if (dashboardSnapshot) renderAttention(dashboardSnapshot);
  }
}
els.attentionSearch?.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  await runAttentionLiveQuery();
});
els.attentionLiveQuery?.addEventListener('click', runAttentionLiveQuery);
els.attentionSearchClose?.addEventListener('click', () => {
  attentionResultsDismissed = true;
  attentionLiveResult = null;
  els.attentionSearchStatus.textContent = '本地筛选 · 已收起核查结果';
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
$('#btn-view-mode')?.addEventListener('click', () => {
  businessMode = !businessMode;
  localStorage.setItem(VIEW_MODE_KEY, businessMode ? 'business' : 'full');
  applyNavVisibility();
  if (!viewVisibleForRole(currentView, authSession)) showView('dashboard');
});
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
document.getElementById('btn-save-dispatch-cfg')?.addEventListener('click', saveDispatchConfig);
document.getElementById('assistant-connectivity-chip')?.addEventListener('click', toggleConnectivityPanel);
document.getElementById('assistant-connectivity-panel')?.addEventListener('click', (event) => {
  if (event.target.closest('[data-open-ops]')) showView('ops');
});
els.evRefresh.addEventListener('click', loadEvidence);
els.evidenceSearch?.addEventListener('input', renderEvidenceRows);
els.evidenceSourceFilter?.addEventListener('change', renderEvidenceRows);
els.chatScopeBack?.addEventListener('click', openHubConversationSpace);

/* ---------- 统一链路追踪 ---------- */
const TRACE_KIND_LABELS = { borrow: '借调', run: '执行', usage: '用量', evidence: '审计' };
const TRACE_AGENT_LABELS = { 'gateway-control-platform': '中台网关', 'runtime-execution-query': 'PLM 助手' };
const TRACE_CAPABILITY_LABELS = { query_control_platform: '查询', reason_control_platform: '分析', query_plm: 'PLM 查询', reason_plm: 'PLM 分析', query_local_files: '本地文件查询' };
const TRACE_RUN_TASK_LABELS = { order_delivery_analysis: '订单交付分析', material_kitting_analysis: '齐套分析', quality_analysis: '质量分析', production_analysis: '生产分析' };
const TRACE_RUN_TASK_SHORT_LABELS = { order_delivery_analysis: '订单交付', material_kitting_analysis: '齐套', quality_analysis: '质量', production_analysis: '生产' };

function traceRunTaskLabel(run) {
  const taskType = run?.input && typeof run.input.task_type === 'string' ? run.input.task_type : '';
  return TRACE_RUN_TASK_LABELS[taskType] || '';
}

function traceRunTaskShortLabel(run) {
  const taskType = run?.input && typeof run.input.task_type === 'string' ? run.input.task_type : '';
  return TRACE_RUN_TASK_SHORT_LABELS[taskType] || '';
}

function traceRunObjectLabel(run) {
  const ref = run?.input?.context?.businessObjectRef;
  if (typeof ref !== 'string' || !ref.trim()) return '';
  const parts = ref.trim().split('/');
  return parts[parts.length - 1] || '';
}

function humanizeTraceText(value) {
  let text = String(value ?? '');
  for (const [agentId, label] of Object.entries(TRACE_AGENT_LABELS)) text = text.split(agentId).join(label);
  for (const [code, label] of Object.entries(ERROR_HINTS)) text = text.split(code).join(label);
  return text;
}
const TRACE_RESOLVED_LABELS = { 'borrow-order': '按记录编号', run: '按执行编号', request: '按请求编号', trace: '按记录编号' };

function openTraceFor(id) {
  const input = $('#trace-id-input');
  if (input) input.value = id;
  showView('trace');
  void loadTrace(id);
}

function openExecutionRun(runId) {
  selectedAiRunId = runId;
  aiObsTab = 'runs';
  showView('ai-obs');
}

async function loadTraceRecent() {
  const root = $('#trace-recent');
  if (!root) return;
  if (root.dataset.bound !== '1') {
    root.dataset.bound = '1';
    root.addEventListener('click', (event) => {
      const id = event.target.closest('[data-trace-id]')?.getAttribute('data-trace-id');
      if (id) openTraceFor(id);
    });
  }
  try {
    const [ordersResponse, agentsResponse] = await Promise.all([
      fetch('/api/borrow-orders?limit=8', { headers: { accept: 'application/json' } }),
      fetch('/api/execution/agents', { headers: { accept: 'application/json' } }),
    ]);
    const ordersData = ordersResponse.ok ? await ordersResponse.json() : {};
    const agentsData = agentsResponse.ok ? await agentsResponse.json() : {};
    const orders = Array.isArray(ordersData?.orders) ? ordersData.orders : [];
    const runIdsWithOrders = new Set(orders.map((order) => order.runId).filter(Boolean));
    const borrowTraceIds = new Set(orders.map((order) => order.orderId));
    // 同一 traceId 下的查询/推理/分发子分析属于同一次分析，列表按链路聚合而不是按 run 拆开。
    const groups = new Map();
    for (const run of (Array.isArray(agentsData?.runs) ? agentsData.runs : [])) {
      if (runIdsWithOrders.has(run.runId)) continue;
      const traceId = run.traceId || run.runId;
      if (borrowTraceIds.has(traceId)) continue;
      const list = groups.get(traceId) || [];
      list.push(run);
      groups.set(traceId, list);
    }
    const traceEntries = [...groups.entries()].map(([traceId, group]) => {
      group.sort((left, right) => String(left.startedAt || '').localeCompare(String(right.startedAt || '')));
      const latest = group[group.length - 1];
      const fullLabels = [...new Set(group.map(traceRunTaskLabel).filter(Boolean))];
      const shortLabels = [...new Set(group.map(traceRunTaskShortLabel).filter(Boolean))];
      const objectLabel = group.map(traceRunObjectLabel).find(Boolean) || '';
      const baseTitle = fullLabels.length > 1
        ? `经营分析（${shortLabels.join('、')}）`
        : (fullLabels[0] || TRACE_CAPABILITY_LABELS[group[0].capability] || group[0].capability);
      const title = objectLabel ? `${baseTitle} · ${objectLabel}` : baseTitle;
      const running = group.some((run) => run.state === 'dispatched' || run.state === 'running');
      const failed = group.some((run) => run.state === 'failed' || run.state === 'recalled');
      const status = running ? '运行中' : failed ? '有失败' : '已完成';
      const at = latest.endedAt || latest.startedAt;
      return {
        at,
        html: `
      <button class="trace-recent-item" type="button" data-trace-id="${esc(traceId)}">
        <span><strong>${esc(title)}</strong><small>${esc(group[0].agentId)} · ${group.length > 1 ? `${group.length} 个步骤 · ` : ''}${status}</small></span>
        <time>${esc(formatDateTimeText(at))}</time>
      </button>`,
      };
    });
    // 借调单与执行链路是两条留痕来源：按时间合并排序，避免最新的分析被更早的记录压在下面。
    const entries = [
      ...orders.map((order) => ({
        at: order.createdAt,
        html: `
      <button class="trace-recent-item" type="button" data-trace-id="${esc(order.orderId)}">
        <span><strong>${esc(order.orderId)}</strong><small>借调 · ${esc(order.fromSystem)} → ${esc(order.providerSystem || '—')} · ${esc(order.status)}</small></span>
        <time>${esc(formatDateTimeText(order.createdAt))}</time>
      </button>`,
      })),
      ...traceEntries,
    ].sort((left, right) => String(right.at || '').localeCompare(String(left.at || ''))).slice(0, 10);
    const items = entries.map((entry) => entry.html);
    root.innerHTML = items.length
      ? `<div class="trace-recent-list">${items.join('')}</div>`
      : '<div class="dashboard-loading">暂无借调单或执行记录</div>';
    refreshIcons(root);
  } catch {
    root.innerHTML = '<div class="dashboard-loading">最近链路读取失败</div>';
  }
}

function loadTraceView() {
  const form = $('#trace-form');
  if (form && form.dataset.bound !== '1') {
    form.dataset.bound = '1';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const id = $('#trace-id-input')?.value.trim();
      if (id) void loadTrace(id);
    });
  }
  void loadTraceRecent();
}

async function loadTrace(id) {
  const root = $('#trace-result');
  if (!root) return;
  root.innerHTML = '<div class="dashboard-loading">正在读取链路…</div>';
  try {
    const [response, agentsResponse] = await Promise.all([
      fetch(`/api/trace/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } }),
      fetch('/api/execution/agents', { headers: { accept: 'application/json' } }).catch(() => null),
    ]);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      root.innerHTML = harborEmpty('git-branch', '查询失败', esc(humanizeError(body.code, body.error || `HTTP ${response.status}`)));
      return;
    }
    // 链路接口只带结论摘要；完整结论从执行面快照按 runId 取回，一次分析的所有结论在同一页展示。
    let runDetails = new Map();
    try {
      const agentsData = agentsResponse && agentsResponse.ok ? await agentsResponse.json() : {};
      runDetails = new Map((Array.isArray(agentsData?.runs) ? agentsData.runs : []).map((run) => [run.runId, run]));
    } catch {
      runDetails = new Map();
    }
    renderTrace(body, runDetails);
  } catch (error) {
    root.innerHTML = harborEmpty('git-branch', '查询失败', esc(error?.message || String(error)));
  }
}

function traceConclusionsSection(runs, runDetails) {
  const blocks = [];
  for (const run of runs) {
    if (!String(run.capability || '').startsWith('reason')) continue;
    const detail = runDetails?.get(run.runId);
    if (!detail || !detail.result) continue;
    const label = traceRunTaskLabel(detail) || TRACE_CAPABILITY_LABELS[run.capability] || '分析';
    const handler = run.handledBy?.agentName || run.handledBy?.agentId || '';
    blocks.push(`<div class="trace-conclusion"><h3>${esc(label)} · ${esc(run.agentId)}${handler ? ` · 实际处理：${esc(handler)}` : ''}</h3><pre class="assistant-reply-text">${esc(summarizeReasoningResult(detail.result))}</pre></div>`);
  }
  if (!blocks.length) return '';
  return `<section class="surface">
      <div class="surface-head"><div><h2>分析结论</h2><p>同一次分析的订单交付、齐套、质量结论</p></div></div>
      ${blocks.join('')}
    </section>`;
}

function renderTrace(trace, runDetails = new Map()) {
  const root = $('#trace-result');
  if (!root) return;
  if (!trace || trace.resolvedBy === 'none') {
    root.innerHTML = harborEmpty('git-branch', '没有找到链路', `未找到与「${esc(trace?.traceId || '')}」关联的借调单、run 或编排请求`);
    return;
  }
  const borrow = trace.borrowOrder;
  const usage = Array.isArray(trace.usage) ? trace.usage : [];
  const runs = Array.isArray(trace.runs) ? trace.runs : [];
  const cost = usage.reduce((sum, item) => sum + Number(item.cost || 0), 0);
  const queryRuns = runs.filter((item) => String(item.capability || '').startsWith('query')).length;
  const lastRun = runs[runs.length - 1] ?? null;
  const summary = `
    <section class="surface">
      <div class="surface-head">
        <div><h2>链路概览</h2><p>${esc(TRACE_RESOLVED_LABELS[trace.resolvedBy] || trace.resolvedBy)} · <span class="mono">${esc(trace.traceId)}</span></p></div>
      </div>
      <div class="harbor-metrics usage-metrics">
        <div><span>借调单</span><strong>${borrow ? esc(borrow.status) : '无'}</strong><small>${borrow ? esc(`${borrow.fromSystem} → ${borrow.providerSystem || '—'}`) : '直接派单 / 编排'}</small></div>
        <div><span>执行环节</span><strong>${runs.length}</strong><small>查询 ${queryRuns} · 推理 ${runs.length - queryRuns}</small></div>
        <div><span>证据引用</span><strong>${(trace.evidenceRefs || []).length}</strong><small>evidence_refs</small></div>
        <div><span>总成本</span><strong>${cost ? `¥${formatUsageCost(cost)}` : '—'}</strong><small>${usage.length} 条用量记录</small></div>
      </div>
      ${runs.length && !businessMode ? `<div class="trace-actions"><button id="btn-trace-open-run" class="btn secondary compact" type="button">查看执行详情${runs.length > 1 ? `（${runs.length} 个 run）` : ''} → AI 运行观测</button></div>` : ''}
    </section>`;

  const timelineItems = (trace.timeline || []).map((item) => `
    <li class="trace-entry">
      <span class="trace-kind ${esc(item.kind)}">${esc(TRACE_KIND_LABELS[item.kind] || item.kind)}</span>
      <div><strong>${esc(humanizeTraceText(item.title))}</strong>${item.detail ? `<small>${esc(humanizeTraceText(item.detail))}</small>` : ''}</div>
      <time>${esc(formatDateTimeText(item.at))}</time>
    </li>`).join('');
  const timeline = `
    <section class="surface">
      <div class="surface-head"><div><h2>时间线</h2><p>借调、执行、用量与审计按时间排序</p></div></div>
      <ul class="trace-timeline">${timelineItems || '<li class="trace-entry">暂无事件</li>'}</ul>
    </section>`;

  const usageRows = usage.map((item) => `
    <tr>
      <td>${esc(formatDateTimeText(item.endedAt))}</td>
      <td>${esc(item.usageKind === 'query' ? '查询' : item.modelId || '模型')}</td>
      <td>${esc(item.metering)}</td>
      <td class="num">${item.tokensIn} / ${item.tokensOut}</td>
      <td class="num">${item.cost ? `¥${Number(item.cost).toFixed(4)}` : '—'}</td>
      <td>${esc(item.consumerSystemId || '—')}</td>
      <td>${esc(item.callerUserId || item.callerAgentId || '—')}</td>
    </tr>`).join('');
  const usageSection = `
    <section class="surface">
      <div class="surface-head"><div><h2>用量</h2><p>执行方与请求方归属</p></div></div>
      <div class="trace-scroll trace-usage-scroll">
        <table class="trace-table">
          <thead><tr><th>时间</th><th>模型/类型</th><th>计量</th><th class="num">Token in / out</th><th class="num">成本</th><th>请求方</th><th>调用方</th></tr></thead>
          <tbody>${usageRows || '<tr><td colspan="7">没有用量记录</td></tr>'}</tbody>
        </table>
      </div>
    </section>`;

  root.innerHTML = summary + traceConclusionsSection(runs, runDetails) + timeline + usageSection;
  refreshIcons();
  $('#btn-trace-open-run')?.addEventListener('click', () => {
    if (lastRun) openExecutionRun(lastRun.runId);
    else showView('ai-obs');
  });
}

localizeStaticDocument();
refreshIcons();
void bootstrapAuthentication();
