// AEOS Hub Web 控制台服务端：静态页 + WebSocket（聊天流/审批/配置）
// 复用 src/codex-client.ts；codex 运行时仍为项目内固定版本 + 隔离 CODEX_HOME。
// 启动: npm run web   →   http://127.0.0.1:8787
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir, networkInterfaces } from 'node:os';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { ZodError } from 'zod';
import { loadConversations, saveConversations, upsertConversation, dataDir, convFile, type Conversation, type ConversationMessage } from './conversations.ts';
import { codexHome, configFile, readConfig, saveModelConfig, listEnvKeys, setEnvKey, loadModelPresets, saveModelPresets, ensureConfigFile } from './hub-config.ts';
import { appendEvidence, evidenceFile, readRecentEvidence, evidenceHealth } from './evidence.ts';
import { appendAuthenticationAuditEvidence } from './authentication-audit.ts';
import { collectMcpPages, payloadOf } from './mcp-pagination.ts';
import { dashboardReadPlan, loadDashboardReadLimits } from './dashboard-read-plan.ts';
import { serveRuntimeImage, validOrigin, boundedLimit } from './http-security.ts';
import {
  DailyQuestionConflictError,
  hasDailyGeneratedBatch,
  loadDailyQuestionConfig,
  replaceDailyGeneratedQuestions,
  saveDailyQuestionConfig,
  type DailyQuestionConfig,
} from './daily-questions.ts';
import { generateDailyQuestionsWithRuntime } from './daily-question-generator.ts';
import { buildCapabilityRegistry } from './capability-registry.ts';
import { buildDashboardSnapshot, type DashboardSnapshot } from './dashboard.ts';
import { AttentionSearchRequestSchema, searchLiveDashboard } from './attention-search.ts';
import { operatingCenter } from './operating-center.ts';
import { taskCenter } from './task-center.ts';
import { TaskApi } from './task-api.ts';
import { G0DecisionApi } from './g0-decision-api.ts';
import { G0DecisionRegisterStore } from './g0-decision-register.ts';
import { McpAccessGateway } from './mcp-access-gateway.ts';
import { McpReadinessError, waitForReadOnlyMcpTools } from './mcp-readiness.ts';
import { loadMcpRegistry } from './mcp-registry.ts';
import {
  loadHarbor,
  saveHarbor,
  createHarborAgent,
  deleteHarborAgent,
  transitionHarborAgentLifecycle,
  createHarborRuntime,
  createHarborProject,
  recordHarborRuntimeVerification,
  updateHarborAgentM01Registration,
  HarborStoreNotFoundError,
  type HarborAgent,
  type HarborRuntimeVerificationStatus,
} from './harbor-store.ts';
import {
  isM01AgentDispatchable,
  loadM01AgentBridgeConfig,
  registerAgentWithM01,
  type M01AgentRegistrationResult,
} from './m01-agent-bridge.ts';
import { createPersonLifecycleService } from './person-lifecycle.ts';
import {
  addAgentSquadActivity,
  addAgentSquadMemory,
  bindAgentSquadMember,
  createAgentSquadMember,
  deleteAgentSquadMember,
  loadAgentSquad,
  sendAgentSquadMessage,
  setAgentSquadProject,
} from './agent-squad-store.ts';
import {
  loadModelRegistry,
  createModel,
  updateModel,
  deleteModel,
  findModelPricing,
  ModelRegistryNotFoundError,
  ModelRegistryError,
} from './model-registry.ts';
import { UsageStore } from './usage-store.ts';
import { CodexRuntimeAdapter, RuntimeSupervisor, type RuntimeApprovalRequest, type RuntimeEvent } from './runtime/index.ts';
import {
  BrowserSessionAuth,
  SessionSocketRegistry,
  assertAuthModeAllowedInEnvironment,
  authRoutePolicy,
  buildLocalDevActor,
  cookieSecureFromEnvironment,
  createBrowserAuthGateway,
  isPublicLoginResource,
  passwordFromEnvironment,
  usernameFromEnvironment,
} from './web-auth.ts';
import { M01OidcAuth, derivePostLogoutRedirectUri, readM01Config } from './auth/m01-oidc.ts';
import { KeycloakPersonnelAdmin, readPersonnelAdminConfig } from './keycloak-personnel-admin.ts';
import { PersonnelApi } from './personnel-api.ts';
import { AccessControlStore } from './access-control-store.ts';
import { AccessControlApi } from './access-control-api.ts';
import { AgentControlApi } from './agent-control-api.ts';
import { ExecutionPlaneRegistry, ExecutionPlaneError, isLoopbackExecutionPeer, executionPlaneTimeoutsFromEnv } from './execution-plane.ts';
import { gatewayRegistrationEvidence } from './execution-gateway-audit.ts';
import { ExecutionPlaneRuntimeAdapter } from './execution-plane-runtime-adapter.ts';
import { beijingDateString, ExecutionOrchestrationError, ExecutionOrchestrator } from './execution-orchestrator.ts';
import { buildDailyBriefing, formatBriefingOrderPrompt, formatDailyBriefingMarkdown, selectBriefingDispatchOrders, type DailyBriefing } from './daily-briefing.ts';
import { ConclusionDispatcher, DOMAIN_LABELS, formatConclusionDispatchReport, loadConclusionDispatchPolicy, saveConclusionDispatchPolicy } from './conclusion-dispatcher.ts';
import { RecentAnalysisCache } from './recent-analysis-cache.ts';
import { isExecutionAgentAllowed } from './execution-agent-policy.ts';
import { authorizeCapability, filterRegistrationCapabilities, loadExecutionAgentPermissions } from './execution-agent-permissions.ts';
import { createExecutionPolicyAuditor } from './execution-policy-audit.ts';
import { formatHighestRiskAnswer } from './hub-execution-routing.ts';
import { ACTION_LABELS, formatIntentExecutionAnswer, formatIntentRoutingReply, buildIntentDispatch, extractBusinessIdentifier, recognizeHubIntent, selectAgentForIntent } from './hub-intent-router.ts';
import { ensureModelProfiles, loadModelProfiles } from './model-profile-store.ts';
import { estimateUsageCostCny } from './model-pricing.ts';
import { estimateUsageCostForModel } from './usage-cost.ts';
import { recordThreadUsageTotal } from './codex-usage-baseline-store.ts';
import { BorrowOrderStore, BORROW_ORDER_STATUSES, type BorrowOrderStatus } from './borrow-order-store.ts';
import { BorrowOrderService, BorrowOrderServiceError, borrowOrderSummary } from './borrow-order-service.ts';
import { CatalogApi } from './catalog-api.ts';
import { ensureSystems, listSystems, getSystem, findSystemBySourceSystem } from './system-registry.ts';
import { verifySystemToken } from './system-token.ts';
import { parseCallerContext } from './caller-context.ts';
import { WriteRequestStore, type WriteRequestRecord } from './write-request-store.ts';
import { WriteRequestError, WriteRequestService } from './write-request-service.ts';
import { buildConnectivitySummary } from './connectivity-summary.ts';
import { looksLikeWriteCommand, parseWriteConfirmation, parseWriteIntentWithLLM } from './write-intent.ts';
import { buildTrace, readEvidenceEntries } from './trace.ts';
import { DEFAULT_TENANT_ID, resolveTenantId } from './tenant-registry.ts';
import {
  ExecutionIdentityError,
  resolveExecutionPlaneAuth,
  resolveRegistrationIdentity,
  type ExecutionPlaneConnectionAuth,
  type ExecutionRegistrationIdentity,
  type RegisteredSystem,
} from './execution-identity.ts';
import { BorrowOrderApi } from './borrow-order-api.ts';
import { CapabilityInvocationApi } from './capability-invocation-api.ts';
import { M13AgentChatApi, M13_AGENT_CHAT_PATH_PREFIX, type M13ChatRuntimePort } from './m13-agent-chat-api.ts';
import { M13AgentApplicationApi, M13_AGENT_APPLICATION_PATH_PREFIX } from './m13-agent-application-api.ts';
import { CapabilityInvocationError, CapabilityInvocationService } from './capability-invocation-service.ts';
import { CapabilityQueryTemplateError } from './capability-query-template.ts';
import { AlertCenter, LogAlertChannel, WeComAlertChannel } from './alert-center.ts';
import { OpsMonitor } from './ops-monitor.ts';
import { ExecutionEventStore } from './execution-event-store.ts';
import { AssistantEventStore } from './assistant-event-store.ts';
import { AssistantEventApi } from './assistant-event-api.ts';
import { OrchestrationTaskStore } from './orchestration-task-store.ts';
import { OrchestrationTaskService } from './orchestration-task-service.ts';
import { OrchestrationTaskExecutor } from './orchestration-task-executor.ts';
import { BorrowOrderExecutionAdapter } from './orchestration-task-borrow-adapter.ts';
import { OrchestrationTaskApi } from './orchestration-task-api.ts';
import { routeModel } from './model-router.ts';
import { parseIntentWithLLM } from './execution-intent-llm.ts';
import {
  ensureUsageLedger,
  appendUsageEvent,
  aggregateUsageByAgent,
  aggregateUsageBySystem,
  aggregateUsageByConsumerSystem,
  aggregateUsageByCallerAgent,
  aggregateUsageByCallerUser,
  listUsageEvents,
  type UsageEventAppendInput,
} from './usage-ledger-store.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const binary = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex');
const PORT = Number(process.env.PORT ?? 8787);
const EXECUTION_WS_PORT = Number(process.env.EXECUTION_WS_PORT ?? 8788);
const CODEX_RUNTIME_ID = 'runtime-codex-local';

if (!existsSync(binary)) {
  console.error(`[FAIL] 未找到项目内 codex CLI: ${binary}，请先 npm install`);
  process.exit(1);
}
// 首次运行自动生成隔离配置；真实 company-control 启用后，demo-erp 默认禁用。
ensureConfigFile();
if (!existsSync(join(codexHome, 'auth.json'))) {
  console.warn('[WARN] 隔离目录缺少凭证 auth.json：对话将无法调用模型。');
  console.warn('       可先执行: cp ~/.codex/auth.json 到 ' + join(codexHome, 'auth.json'));
}

// ---------- 监听地址与浏览器登录 ----------
const cliArgs = process.argv.slice(2);
const LAN_MODE = cliArgs.includes('--lan');
const LISTEN_HOST = process.env.HOST || (LAN_MODE ? '0.0.0.0' : '127.0.0.1');
const m01Config = readM01Config();
const AUTH_MODE = m01Config.authMode;
assertAuthModeAllowedInEnvironment(AUTH_MODE);
const COOKIE_SECURE = cookieSecureFromEnvironment();
const LOGIN_USERNAME = usernameFromEnvironment();
const sessionSockets = new SessionSocketRegistry();
const webAuth = new BrowserSessionAuth(
  LOGIN_USERNAME,
  AUTH_MODE === 'local-dev' ? passwordFromEnvironment() : '',
  buildLocalDevActor(process.env, LOGIN_USERNAME),
  { secureCookies: COOKIE_SECURE, onSessionRevoked: (sessionId) => sessionSockets.closeSession(sessionId) },
);
const m01Oidc = AUTH_MODE === 'm01' ? new M01OidcAuth(m01Config) : null;
const authGateway = createBrowserAuthGateway({
  authMode: AUTH_MODE,
  webAuth,
  ...(m01Oidc ? { oidc: m01Oidc } : {}),
  ...(m01Config.authMode === 'm01' ? { allowedRoles: m01Config.allowedRoles } : {}),
  ...(m01Config.authMode === 'm01' ? { postLogoutRedirectUri: derivePostLogoutRedirectUri(m01Config.redirectUri) } : {}),
  onAuthenticationAudit: (event) => { appendAuthenticationAuditEvidence(event); },
  secureCookies: COOKIE_SECURE,
});
function addCookie(res: ServerResponse, value: string): void {
  const current = res.getHeader('set-cookie');
  const cookies = Array.isArray(current) ? [...current.map(String)] : current ? [String(current)] : [];
  cookies.push(value);
  res.setHeader('set-cookie', cookies);
}
const codexRuntime = new CodexRuntimeAdapter({
  runtimeInstanceId: CODEX_RUNTIME_ID,
  startOptions: { cwd: root, codexHome, binary, clientName: 'aeos_hub_web' },
});
const runtimeSupervisor = new RuntimeSupervisor().register(codexRuntime);
// Hub-initiated calls (dashboard and future scheduled jobs) must not bypass
// this policy boundary.  Chat-agent calls are constrained by the same registry
// through generated enabled_tools in Codex config.
const mcpAccessGateway = new McpAccessGateway(codexRuntime, loadMcpRegistry());
const usageStore = new UsageStore({ pricingResolver: findModelPricing });
const g0DecisionStore = new G0DecisionRegisterStore();
const taskApi = new TaskApi({ operatingCenter, taskCenter, g0DecisionStore, appendEvidence, resolveRuntime: (runtimeId) => {
  if (runtimeId === CODEX_RUNTIME_ID) return codexRuntime;
  if (executionPlane.list().agents.some((agent) => agent.agentId === runtimeId)) {
    return new ExecutionPlaneRuntimeAdapter(executionPlane, runtimeId);
  }
  return undefined;
}, findExecutionRun: (runId) => executionPlane.list().runs.find((run) => run.runId === runId), findExecutionIntent: (agentId, capability) => executionPlane.list().agents.find((agent) => agent.agentId === agentId)?.capabilities.find((cap) => cap.name === capability)?.intent, findExecutionCapability: (agentId, kind) => {
  const agent = executionPlane.list().agents.find((item) => item.agentId === agentId);
  const capabilities = agent?.capabilities ?? [];
  if (kind === 'query') return capabilities.find((cap) => cap.intent)?.name ?? capabilities.find((cap) => cap.name.startsWith('query'))?.name;
  if (kind === 'reasoning') return capabilities.find((cap) => cap.name.startsWith('reason'))?.name;
  return undefined;
} });
const g0DecisionApi = new G0DecisionApi({ store: g0DecisionStore, appendEvidence });
const personnelAdminConfig = AUTH_MODE === 'm01'
  ? readPersonnelAdminConfig(process.env, (m01Config as { issuer: string }).issuer)
  : ({ enabled: false } as const);
const personnelAdmin = personnelAdminConfig.enabled
  ? new KeycloakPersonnelAdmin({ issuer: personnelAdminConfig.issuer, clientId: personnelAdminConfig.clientId, clientSecret: personnelAdminConfig.clientSecret })
  : null;
const personnelApi = new PersonnelApi({ admin: personnelAdmin, g0DecisionStore, appendEvidence });
const accessControlApi = new AccessControlApi({ admin: personnelAdmin, store: new AccessControlStore(), g0DecisionStore, appendEvidence });

// ---------- 用量台账记账（中枢自身 LLM + 执行面用量上报，两条数据源共用） ----------
function recordUsageEvent(event: UsageEventAppendInput): void {
  try {
    let cost = event.cost;
    if (cost <= 0 && event.modelId && (event.tokensIn > 0 || event.tokensOut > 0)) {
      const endedAt = new Date(event.endedAt || event.startedAt);
      const estimated = estimateUsageCostForModel(event.modelId, {
        inputTokens: event.tokensIn,
        cachedInputTokens: event.cachedTokens ?? 0,
        outputTokens: event.tokensOut,
      }, Number.isNaN(endedAt.getTime()) ? new Date() : endedAt);
      if (estimated !== null) cost = estimated;
    }
    appendUsageEvent({ ...event, cost, tenantId: resolveTenantId(event.systemId, listSystems()) });
  } catch (error) {
    console.warn('[usage-ledger] 记账失败:', (error as Error).message);
  }
}

// ---------- 执行面接入（远程查询智能体：反向连接 + 心跳 + 派单/召回） ----------
// 服务凭证来自环境变量 EXECUTION_PLANE_TOKEN；未配置则 /ws/agent 拒绝所有连接（fail-closed）。
const EXECUTION_PLANE_TOKEN = process.env.EXECUTION_PLANE_TOKEN ?? '';
const executionHealthSyncedAt = new Map<string, { status: 'healthy' | 'unhealthy'; at: number }>();
// 借调服务晚绑定：执行面回调在运行期才会触发，构造顺序无 TDZ 风险。
let borrowOrderService: BorrowOrderService | null = null;
// 写服务同样晚绑定：run 状态回调（完成/失败/召回/离线回收）要把结果回填到写请求台账。
let writeRequestServiceForRunEvents: WriteRequestService | null = null;
const executionPlane = new ExecutionPlaneRegistry({
  file: join(dataDir, 'execution-plane.json'),
  ...executionPlaneTimeoutsFromEnv(),
  onChange: () => syncExecutionHealth(),
  onUsageEvent: (event) => recordUsageEvent(borrowOrderService ? borrowOrderService.attributeUsage(event) : event),
  onRunStateChange: (event) => {
    borrowOrderService?.handleRunStateChange(event);
    if (!writeRequestServiceForRunEvents) return;
    if (event.state === 'completed') {
      writeRequestServiceForRunEvents.onRunFinished(event.runId, { state: 'completed', result: event.result });
    } else if (event.state === 'failed') {
      writeRequestServiceForRunEvents.onRunFinished(event.runId, { state: 'failed', error: event.error ?? null });
    } else if (event.state === 'recalled') {
      writeRequestServiceForRunEvents.onRunFinished(event.runId, { state: 'failed', error: { code: 'RECALLED', message: '写操作已召回' } });
    }
  },
  onAgentOffline: (event) => borrowOrderService?.handleAgentOffline(event),
  isCapabilityAuthorized: (agent, capability) => {
    const systemId = agent.systemId ?? agent.sourceSystem;
    const tenantId = resolveTenantId(systemId, listSystems());
    return authorizeCapability(loadExecutionAgentPermissions(), {
      systemId,
      agentId: agent.agentId,
      capability,
      tenantId,
    });
  },
});
const agentControlApi = new AgentControlApi({ rootSecret: EXECUTION_PLANE_TOKEN, executionPlane, appendEvidence });
// 执行面三张配置（准入/授权/选路）变更审计：首次只建基线，之后按文件哈希写 evidence。
createExecutionPolicyAuditor({ appendEvidence }).start();const executionOrchestrator = new ExecutionOrchestrator(executionPlane, appendEvidence);
// 结论自动分发：中枢出结论后，按策略交给其他系统的执行面能力继续只读分析。
const conclusionDispatcher = new ConclusionDispatcher(executionPlane, {
  appendEvidence,
  systemLabel: (systemId) => listSystems().find((system) => system.systemId === systemId)?.name ?? systemId,
});
// 最高风险分析短时缓存：5 分钟内相同问题直接复用，避免重复调用执行面。
type HighestRiskCacheEntry = {
  answer: string;
  requestId: string;
  queryRunId: string;
  reasoningRunId: string;
  orderNo: string;
  cachedAt: string;
};
const HIGHEST_RISK_CACHE_TTL_MS = 5 * 60_000;
const highestRiskAnswerCache = new RecentAnalysisCache<HighestRiskCacheEntry>({ ttlMs: HIGHEST_RISK_CACHE_TTL_MS });
// 写操作审批：提交 → 人工审批 → 派单；写能力只能由该服务在审批后派单。
const writeRequestStore = new WriteRequestStore();
const writeRequestService = new WriteRequestService({
  store: writeRequestStore,
  plane: executionPlane,
  loadPermissions: loadExecutionAgentPermissions,
  tenantIdOf: (systemId) => systemId ? resolveTenantId(systemId, listSystems()) : null,
  appendEvidence,
});
writeRequestServiceForRunEvents = writeRequestService;
const catalogApi = new CatalogApi((tenantId) => {
  const allSystems = listSystems();
  const systems = tenantId ? allSystems.filter((system) => system.tenantId === tenantId) : allSystems;
  const systemIds = new Set(systems.map((system) => system.systemId));
  const harbor = loadHarbor();
  const executionAgents = executionPlane.list().agents.filter((agent) => {
    if (!tenantId) return true;
    return resolveTenantId(agent.systemId ?? agent.sourceSystem, allSystems) === tenantId;
  });
  return {
    harbor: {
      ...harbor,
      agents: tenantId ? harbor.agents.filter((agent) => systemIds.has(agent.systemId)) : harbor.agents,
    },
    systems,
    executionAgents,
    mcp: (() => { try { return loadMcpRegistry(); } catch { return null; } })(),
    usage: {
      byAgent: aggregateUsageByAgent(tenantId),
      bySystem: aggregateUsageBySystem(tenantId),
    },
  };
});
const executionEventStore = new ExecutionEventStore();
const assistantEventStore = new AssistantEventStore();
const assistantEventApi = new AssistantEventApi({
  rootSecret: EXECUTION_PLANE_TOKEN,
  store: assistantEventStore,
  appendEvidence,
  recordUsage: recordUsageEvent,
});
const borrowOrderStore = new BorrowOrderStore({ file: join(dataDir, 'borrow-orders.json') });
borrowOrderService = new BorrowOrderService({
  store: borrowOrderStore,
  executionPlane,
  appendEvidence,
  tenantId: process.env.AEOS_TENANT_ID,
});
const borrowOrderApi = new BorrowOrderApi({
  rootSecret: EXECUTION_PLANE_TOKEN,
  service: borrowOrderService,
  appendEvidence,
});
let capabilityTemplateOverrides: unknown;
try {
  const capabilityTemplateFile = join(dataDir, 'capability-query-templates.json');
  if (existsSync(capabilityTemplateFile)) {
    capabilityTemplateOverrides = JSON.parse(readFileSync(capabilityTemplateFile, 'utf8'));
  }
} catch (error) {
  console.warn('[capability-invocation] 模板覆盖文件加载失败，使用内置模板:', (error as Error).message);
}
const capabilityInvocationService = new CapabilityInvocationService({
  borrowOrders: borrowOrderService,
  executionPlane,
  templates: capabilityTemplateOverrides,
});
const capabilityInvocationApi = new CapabilityInvocationApi({
  rootSecret: EXECUTION_PLANE_TOKEN,
  service: capabilityInvocationService,
  appendEvidence,
});
const m13ChatRuntime: M13ChatRuntimePort = {
  createSession: (request) => runtimeSupervisor.createSession(CODEX_RUNTIME_ID, request),
  resumeSession: (sessionId, request) => runtimeSupervisor.resumeSession(CODEX_RUNTIME_ID, sessionId, request),
  startRun: (sessionId, request) => runtimeSupervisor.startRun(CODEX_RUNTIME_ID, sessionId, request),
  waitForRun: (runId, timeoutMs) => runtimeSupervisor.waitForRun(CODEX_RUNTIME_ID, runId, timeoutMs),
  onEvent: (listener) => runtimeSupervisor.onEvent(listener, CODEX_RUNTIME_ID),
};
const m13AgentApplicationApi = new M13AgentApplicationApi({
  apiKey: process.env.M13_AGENT_CHAT_API_KEY ?? '',
  appendEvidence,
});
const m13AgentChatApi = new M13AgentChatApi({
  apiKey: process.env.M13_AGENT_CHAT_API_KEY ?? '',
  runtime: m13ChatRuntime,
  appendEvidence,
  verifyKey: (key) => m13AgentApplicationApi.verifyCredential(key),
  runTimeoutMs: Number(process.env.M13_CHAT_RUN_TIMEOUT_MS) || 300000,
});
const orchestrationTaskStore = new OrchestrationTaskStore({ file: join(dataDir, 'orchestration-tasks.json') });
const orchestrationTaskService = new OrchestrationTaskService({
  store: orchestrationTaskStore,
  executionPlane,
  tenantId: process.env.AEOS_TENANT_ID,
});
const orchestrationTaskExecutor = new OrchestrationTaskExecutor({
  store: orchestrationTaskStore,
  borrowPort: new BorrowOrderExecutionAdapter({ borrowOrderService }),
});
const orchestrationTaskApi = new OrchestrationTaskApi({
  rootSecret: EXECUTION_PLANE_TOKEN,
  enabled: process.env.ORCHESTRATION_TASKS_ENABLED === '1',
  service: orchestrationTaskService,
  store: orchestrationTaskStore,
  executor: orchestrationTaskExecutor,
  appendEvidence,
});
try {
  const reconciled = borrowOrderService.reconcileOnStartup();
  if (reconciled.reconciled || reconciled.failed) {
    console.log(`[borrow-order] 启动对账：同步 ${reconciled.reconciled}，失败 ${reconciled.failed}`);
  }
} catch (error) {
  console.warn('[borrow-order] 启动对账失败:', (error as Error).message);
}
// ---------- 运行监控与告警（页面 + 日志；企微渠道配置 webhook 后自动启用） ----------
const alertCenter = new AlertCenter({
  channels: [new LogAlertChannel(), new WeComAlertChannel()],
});
const opsMonitor = new OpsMonitor({
  alertCenter,
  executionPlane,
  listBorrowOrders: () => borrowOrderStore.load().orders,
  checkKeycloak,
  checkMcp,
  backupLogFile: process.env.AEOS_BACKUP_LOG?.trim() || 'G:\\PyCharm\\data\\aeos-hub-backup\\backup.log',
  diskPaths: ['G:\\', 'C:\\'],
});
setTimeout(() => {
  void opsMonitor.runOnce().catch((error) => console.warn('[ops] 首次检查失败:', (error as Error).message));
}, 5_000);
setInterval(() => {
  void opsMonitor.runOnce().catch((error) => console.warn('[ops] 检查失败:', (error as Error).message));
}, 60_000);
setInterval(() => {
  executionPlane.markStaleOffline();
  const timedOut = executionPlane.markRunTimeouts();
  const orphaned = executionPlane.reconcileIdleRuns();
  if (timedOut > 0) console.warn(`[execution-plane] 运行超时：${timedOut}`);
  if (orphaned > 0) console.warn(`[execution-plane] 空闲孤儿任务：${orphaned}`);
}, 5_000);

const companyControlPython = process.platform === 'win32'
  ? join(root, '.venv', 'Scripts', 'python.exe')
  : join(root, '.venv', 'bin', 'python');
const companyControlDir = join(root, 'mcp-company-control');
const companyControlQuery = join(root, 'scripts', 'company-control-query.py');

/** 登录服务检查：M01 模式下探测 OIDC 发现端点；本地模式跳过。 */
async function checkKeycloak(): Promise<'ok' | 'fail' | 'skip'> {
  const issuer = process.env.M01_ISSUER?.trim();
  if (!issuer) return 'skip';
  try {
    const response = await fetch(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? 'ok' : 'fail';
  } catch {
    return 'fail';
  }
}

/** 中台接口检查：复用执行面同一份只读 ping 辅助脚本。 */
function checkMcp(): Promise<'ok' | 'fail' | 'skip'> {
  if (!existsSync(companyControlPython) || !existsSync(companyControlQuery)) return Promise.resolve('skip');
  return new Promise((resolve) => {
    execFile(companyControlPython, [companyControlQuery, '/common/ping', '{}'], {
      cwd: companyControlDir,
      timeout: 15_000,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) return resolve('fail');
      try {
        const parsed = JSON.parse(String(stdout).trim()) as { ok?: unknown };
        return resolve(parsed.ok === true ? 'ok' : 'fail');
      } catch {
        return resolve('fail');
      }
    });
  });
}

// 执行面心跳 → Harbor runtime 健康（节流：状态变化立即写，否则每 agent 最多 30s 写一次）。
function syncExecutionHealth(): void {
  for (const agent of executionPlane.list().agents) {
    const status: 'healthy' | 'unhealthy' = agent.connectionStatus === 'online' ? 'healthy' : 'unhealthy';
    const last = executionHealthSyncedAt.get(agent.agentId);
    const now = Date.now();
    if (last && last.status === status && now - last.at < 30_000) continue;
    executionHealthSyncedAt.set(agent.agentId, { status, at: now });
    try {
      recordHarborRuntimeVerification(agent.agentId, {
        status,
        checkedAt: new Date().toISOString(),
        message: agent.connectionStatus === 'online' ? '执行面在线' : '执行面离线',
        code: null,
      });
    } catch {
      // 执行面 Agent 尚未在 Harbor 登记对应 runtime 时忽略。
    }
  }
}

// 旧的一体化中台执行面 Agent 已退役；中台现在注册「查询」「推理」两个独立 Agent。
// 不再自动补种旧 Agent，避免港湾出现离线的重复档案。历史脚本 scripts/ensure-execution-agent.ts 仅保留手工兼容用途。

// 幂等补齐模型目录种子档（data/model-profiles.json）。失败不阻塞启动。
try {
  ensureModelProfiles();
} catch (error) {
  console.warn('[model-profile-store] 模型目录初始化失败:', (error as Error).message);
}

// 幂等补齐默认系统登记（data/systems.json）。失败不阻塞启动。
try {
  ensureSystems();
} catch (error) {
  console.warn('[system-registry] 系统登记初始化失败:', (error as Error).message);
}

// 幂等初始化用量台账（data/usage-ledger.json）。失败不阻塞启动。
try {
  ensureUsageLedger();
} catch (error) {
  console.warn('[usage-ledger] 用量台账初始化失败:', (error as Error).message);
}

const m01AgentBridge = loadM01AgentBridgeConfig();
const personLifecycleService = createPersonLifecycleService(join(root, 'data', 'person-lifecycle.json'));

function applyHubPersonLifecycle(event: import('./person-lifecycle.ts').PersonLifecycleEvent): Record<string, unknown> {
  const harbor = loadHarbor();
  const result = personLifecycleService.apply(event, {
    agents: harbor.agents,
    ownerPersonId: m01AgentBridge.config?.ownerPersonId || process.env.AEOS_AGENT_OWNER_PERSON_ID || null,
  });
  const rawStatus = String(result.status || 'failed').toLowerCase();
  const status = rawStatus === 'stale' ? 'skipped' : rawStatus === 'scheduled' ? 'pending_confirmation' : ['synced', 'skipped', 'pending_confirmation', 'retrying', 'failed'].includes(rawStatus) ? rawStatus : 'failed';
  result.status = status;
  result.target_system = 'M13_AEOS_HUB';
  result.event_id = result.event_id || event.event_id;
  result.changed = result.changed || { closed_items: Array.isArray(result.closed_items) ? result.closed_items.length : 0 };
  result.received_at = result.received_at || new Date().toISOString();
  const revoked = new Set(Array.isArray(result.revoked_agent_ids) ? result.revoked_agent_ids.map(String) : []);
  if (revoked.size) {
    for (const agent of harbor.agents) {
      if (!revoked.has(agent.id)) continue;
      agent.status = 'offline';
      agent.m01Registration = {
        ...agent.m01Registration,
        state: 'revoked',
        lastAttemptAt: new Date().toISOString(),
        lastSuccessAt: null,
        reason: '人员已离职，已停止 Agent 执行身份',
      };
    }
    saveHarbor(harbor);
  }
  return result;
}

function registrationUpdate(result: M01AgentRegistrationResult, now = new Date().toISOString()) {
  return {
    state: result.state,
    m01AgentId: result.state === 'not_configured' ? null : result.agentId,
    eventId: result.eventId,
    idempotencyKey: result.idempotencyKey ?? result.eventId,
    tenantId: m01AgentBridge.config?.tenantId ?? null,
    requestedScopes: result.requestedScopes,
    effectiveScopes: result.effectiveScopes,
    clampedScopes: result.clampedScopes,
    lastAttemptAt: result.state === 'not_configured' ? null : now,
    lastSuccessAt: result.state === 'active' ? now : null,
    reason: result.reason,
  };
}

async function registerHarborAgentToM01(agent: HarborAgent): Promise<{ item: HarborAgent; registration: M01AgentRegistrationResult }> {
  const registration = await registerAgentWithM01(agent, m01AgentBridge.config);
  const item = updateHarborAgentM01Registration(agent.id, registrationUpdate(registration));
  return { item, registration };
}

// ---------- 状态 ----------
const convCache = new Map<string, Conversation>(); // convId -> conv
// 会话发起人：把 Hub 内对话/分析产生的用量归属到具体 M01 用户（“按调用方”视图）。
const conversationActorId = new Map<string, string>();
const convByThread = new Map<string, string>(); // codex threadId -> convId
const activeTurn = new Map<string, { convId: string; turnId: string | null }>(); // threadId -> 进行中的 turn
const dailyQuestionGenerationLocks = new Map<string, Promise<DailyQuestionConfig>>();
let dashboardLoadPromise: Promise<DashboardSnapshot> | null = null;
let decisionDataRefreshPromise: Promise<DashboardSnapshot> | null = null;
let latestDecisionData: DashboardSnapshot | null = null;
let latestDecisionDataAt: string | null = null;
// Last accepted run per provider session.  This survives activeTurn cleanup so
// late notifications from an older run cannot be routed into a later turn.
const latestRunBySession = new Map<string, string>();
// Serializes turn setup for one local conversation (including thread/resume
// RPCs), preventing double-clicks from creating overlapping provider turns.
const turnStartLocks = new Map<string, Promise<void>>();
// A user cancellation is a normal terminal state. Keep it separate from a
// provider-side interruption so only a requested stop is presented as such.
const requestedInterruptConversations = new Set<string>();
// 真实模型一轮（含工具调用与推理）通常需要 30s~3min；12s 会必然触发离线兜底。
// 120s 仍保留"模型通道等待超时→本地降级回复"的设计，但给真实 Agent 足够执行时间。
const RUNTIME_WAIT_MS = 120_000;
const DECISION_DATA_REFRESH_MS = 5 * 60_000;
const viewOf = new Map<WebSocket, string | null>(); // ws -> 正在查看的 convId
const actorOf = new Map<WebSocket, string>(); // ws -> 服务端生成的审计 actor
const actorContextOf = new Map<WebSocket, { actorId: string; roles: string[]; tenantId?: string }>();
const pendingGuard = new Map<string, { timer: ReturnType<typeof setTimeout> }>();
const pendingApprovals = new Map<string, RuntimeApprovalRequest>();
const allSockets = new Set<WebSocket>();
type AgentDispatchContext = { agentId: string; harborAgentId: string; orderNo: string; evidenceRef: string; taskType: 'order' | 'kitting' | 'quality' | 'production' };
type AgentRunCapture = AgentDispatchContext & { text: string; persisted: boolean };
const agentRunCaptures = new Map<string, AgentRunCapture>();
// Agent message deltas are transient; retain only a bounded final transcript
// so switching conversations can restore what the user actually saw.
const agentTranscriptBuffers = new Map<string, string>();
const MAX_CONVERSATION_MESSAGES = 200;
const MAX_CONVERSATION_MESSAGE_CHARS = 16_000;

// ---------- 会话加载 ----------
for (const c of loadConversations()) convCache.set(c.id, c);
for (const c of convCache.values()) {
  if (c.threadId) convByThread.set(c.threadId, c.id);
}

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function socketsFor(convId: string | null): WebSocket[] {
  if (convId) {
    const list = [];
    for (const [ws, v] of viewOf) if (v === convId) list.push(ws);
    return list;
  }
  return [...allSockets];
}
function pushConv(convId: string, obj: unknown): void {
  for (const ws of socketsFor(convId)) send(ws, obj);
}
function broadcast(obj: unknown): void {
  for (const ws of allSockets) send(ws, obj);
}

/**
 * Resolve identifiers from both the runtime-neutral envelope and the raw
 * Codex notification.  Codex's turn lifecycle notifications put the turn id
 * under `turn.id`, while item notifications expose `turnId` directly.
 */
function runtimeEventSessionId(event: RuntimeEvent): string | undefined {
  if (event.sessionId) return event.sessionId;
  const data = isRecord(event.data) ? event.data : undefined;
  const nestedThread = isRecord(data?.thread) ? data.thread : undefined;
  const nestedTurn = isRecord(data?.turn) ? data.turn : undefined;
  const nestedItem = isRecord(data?.item) ? data.item : undefined;
  for (const value of [
    data?.sessionId,
    data?.session_id,
    data?.threadId,
    data?.thread_id,
    nestedThread?.id,
    nestedTurn?.threadId,
    nestedItem?.threadId,
  ]) {
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function runtimeEventRunId(event: RuntimeEvent): string | undefined {
  if (event.runId) return event.runId;
  const data = isRecord(event.data) ? event.data : undefined;
  const nestedTurn = isRecord(data?.turn) ? data.turn : undefined;
  const nestedItem = isRecord(data?.item) ? data.item : undefined;
  for (const value of [
    data?.runId,
    data?.run_id,
    data?.turnId,
    data?.turn_id,
    nestedTurn?.id,
    nestedItem?.turnId,
  ]) {
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function runtimeEventConversationId(event: RuntimeEvent, sessionId?: string, runId?: string): string | null {
  const sid = sessionId ?? runtimeEventSessionId(event);
  const rid = runId ?? runtimeEventRunId(event);

  // If a late notification from an older turn arrives after a new turn has
  // started on the same session, do not let it bleed into the new turn.
  if (sid && rid) {
    const active = activeTurn.get(sid);
    if (active?.turnId && active.turnId !== rid) return null;
    const latest = latestRunBySession.get(sid);
    if (!active?.turnId && latest && latest !== rid) return null;
  }

  if (sid) return convByThread.get(sid) ?? null;
  if (rid) {
    for (const active of activeTurn.values()) {
      if (active.turnId === rid) return active.convId;
    }
  }
  return null;
}

function runtimeEventEnvelope(
  event: RuntimeEvent,
  convId: string | null,
  sessionId?: string,
  runId?: string,
): Record<string, unknown> {
  return {
    type: 'evt',
    method: event.name,
    // Preserve the provider payload verbatim.  Consumers can use the outer
    // ids for filtering without having to reinterpret provider-specific data.
    params: event.data ?? null,
    convId,
    runtimeInstanceId: event.runtimeInstanceId,
    sessionId: sessionId ?? null,
    runId: runId ?? null,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
  };
}

function getConv(convId: string): Conversation | null {
  return convCache.get(convId) ?? null;
}

function conversationTurnBlockMessage(convId: string, includeStartLock = true): string | null {
  if (includeStartLock && turnStartLocks.has(convId)) return '该对话正在启动中，请稍候';
  const conv = getConv(convId);
  if (conv?.threadId && activeTurn.has(conv.threadId)) return '该对话正在执行中，请等待完成或先停止';
  return null;
}

/** 对话页可切换的模型选项：各自定义提供商的模型清单。 */
function buildModelOptions(): Array<{ provider: string; model: string; label: string }> {
  const cfg = readConfig();
  const presets = loadModelPresets();
  const opts: Array<{ provider: string; model: string; label: string }> = [];
  for (const p of cfg.providers) {
    if (!p.id) continue;
    const models = presets[p.id]?.length ? presets[p.id] : [p.id];
    for (const m of models) opts.push({ provider: p.id, model: m, label: `${p.id} · ${m}` });
  }
  return opts;
}

function normChoice(x: { provider?: string; model?: string } | null | undefined): { provider: string; model: string } {
  return { provider: x?.provider || 'openai', model: x?.model || '' };
}
function sameChoice(a: { provider?: string; model?: string } | null | undefined, b: { provider?: string; model?: string }): boolean {
  const A = normChoice(a); const B = normChoice(b);
  return A.provider === B.provider && A.model === B.model;
}

/** 模型和提供商属于运行版本的一部分，已有 Session 不做原地变更。 */
function ensureThreadModel(_conv: Conversation, _chosen: { provider: string; model: string }): never {
  throw new Error('当前对话的运行模型已固定；请新建对话后选择其他模型，以保留可追溯的运行版本');
}

function touch(conv: Conversation): void {
  conv.updatedAt = new Date().toISOString();
  upsertConversation(conv);
}

function appendConversationMessage(
  convId: string,
  input: Omit<ConversationMessage, 'createdAt'> & { createdAt?: string },
): void {
  const conv = getConv(convId);
  if (!conv) return;
  const text = input.text.trim().slice(0, MAX_CONVERSATION_MESSAGE_CHARS);
  if (!text) return;
  const messages = Array.isArray(conv.messages) ? conv.messages : [];
  const item: ConversationMessage = {
    id: input.id,
    role: input.role,
    text,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.itemId ? { itemId: input.itemId } : {}),
    ...(input.phase ? { phase: input.phase } : {}),
  };
  const existing = input.itemId ? messages.findIndex((message) => message.itemId === input.itemId) : -1;
  if (existing >= 0) messages[existing] = item;
  else messages.push(item);
  conv.messages = messages.slice(-MAX_CONVERSATION_MESSAGES);
  touch(conv);
}

/** Extract the displayable text-only parts from an app-server user message. */
function historyUserText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Conversations created before local transcript persistence only have a
 * provider thread id. Read its bounded history once, then cache it locally.
 * A failed provider read is deliberately non-fatal: the conversation remains
 * usable and newly sent messages are still persisted locally.
 */
async function hydrateConversationTranscript(conv: Conversation): Promise<ConversationMessage[]> {
  if (conv.messages?.length || !conv.threadId) return conv.messages ?? [];
  try {
    const response = await codexRuntime.readSessionHistory(conv.threadId);
    const thread = isRecord(response) && isRecord(response.thread) ? response.thread : null;
    const turns = Array.isArray(thread?.turns) ? thread.turns : [];
    const restored: ConversationMessage[] = [];
    for (const turn of turns) {
      if (!isRecord(turn) || !Array.isArray(turn.items)) continue;
      const createdAt = typeof turn.completedAt === 'number'
        ? new Date(turn.completedAt * 1000).toISOString()
        : typeof turn.startedAt === 'number' ? new Date(turn.startedAt * 1000).toISOString() : new Date().toISOString();
      for (const item of turn.items) {
        if (!isRecord(item) || typeof item.id !== 'string') continue;
        if (item.type === 'userMessage') {
          const text = historyUserText(item.content);
          if (text) restored.push({ id: `history-user-${item.id}`, itemId: `history-${item.id}`, role: 'user', text, createdAt });
        } else if (item.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) {
          restored.push({
            id: `history-assistant-${item.id}`,
            itemId: `history-${item.id}`,
            role: 'assistant',
            text: item.text.slice(0, MAX_CONVERSATION_MESSAGE_CHARS),
            createdAt,
            ...(typeof item.phase === 'string' ? { phase: item.phase } : {}),
          });
        }
      }
    }
    if (restored.length) {
      conv.messages = restored.slice(-MAX_CONVERSATION_MESSAGES);
      touch(conv);
    }
  } catch (error) {
    console.warn(`[conversation] 无法恢复会话 ${conv.id} 的历史记录: ${(error as Error).message}`);
  }
  return conv.messages ?? [];
}

function runtimeAgentItem(event: RuntimeEvent): { id: string; text: string; phase: string } | null {
  const data = isRecord(event.data) ? event.data : {};
  const item = isRecord(data.item) ? data.item : {};
  const itemId = typeof item.id === 'string' ? item.id : typeof data.itemId === 'string' ? data.itemId : '';
  const type = typeof item.type === 'string' ? item.type : 'agentMessage';
  if (type !== 'agentMessage') return null;
  const text = typeof item.text === 'string' ? item.text : typeof data.delta === 'string' ? data.delta : '';
  const phase = typeof item.phase === 'string' ? item.phase : typeof data.phase === 'string' ? data.phase : '';
  return { id: itemId || 'agent-message', text, phase };
}

// ---------- codex app-server 引擎 ----------
const NOTIFY_ALLOW = new Set([
  'item/agentMessage/delta',
  'item/started',
  'item/completed',
  'item/reasoning/summaryTextDelta',
  // Newer app-server builds expose the reasoning stream under textDelta;
  // keep both spellings so the control plane does not silently drop it.
  'item/reasoning/textDelta',
  'item/reasoning/summaryPartAdded',
  'item/plan/delta',
  // Tool/process output is kept on its own event channel.  In particular,
  // screenshot commands arrive as PNG/base64 chunks on this notification.
  'item/commandExecution/outputDelta',
  'item/commandExecution/terminalInteraction',
  'command/exec/outputDelta',
  'process/outputDelta',
  'process/exited',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'item/mcpToolCall/progress',
  'mcpServer/event/stream/notification',
  'turn/started',
  'turn/completed',
  'turn/plan/updated',
  'thread/started',
  'mcpServer/startupStatus/updated',
  'error',
  'warning',
  'configWarning',
]);

async function resolveRuntimeApproval(
  request: RuntimeApprovalRequest,
  outcome: 'approved' | 'denied',
  reason: string,
  actor = 'system:guard',
): Promise<void> {
  await runtimeSupervisor.resolveApproval(CODEX_RUNTIME_ID, request.requestId, { outcome, reason });
  appendEvidence({
    kind: 'guard_decision',
    method: request.method,
    thread_id: request.sessionId,
    turn_id: request.runId,
    summary: `${outcome} by ${reason}`,
    payload: { requestId: request.requestId, outcome, reason, actor },
  });
}

function agentMessageText(event: RuntimeEvent): string {
  const data = isRecord(event.data) ? event.data : {};
  const item = isRecord(data.item) ? data.item : {};
  if (typeof item.text === 'string') return item.text;
  return typeof data.delta === 'string' ? data.delta : '';
}

async function persistAgentDispatchResult(runId: string, fallbackText = ''): Promise<void> {
  const capture = agentRunCaptures.get(runId);
  if (!capture || capture.persisted) return;
  capture.persisted = true;
  const result = (fallbackText || capture.text).trim();
  const evidence = capture.evidenceRef ? `\n依据：${capture.evidenceRef}` : '\n依据：本次运行中返回的 evidence_refs。';
  const subject = capture.taskType === 'kitting' ? '需求对象' : capture.taskType === 'quality' ? '质量异常' : capture.taskType === 'production' ? '生产对象' : '订单';
  const taskLabel = capture.taskType === 'kitting' ? '物料齐套分析' : capture.taskType === 'quality' ? '异常与质量分析' : capture.taskType === 'production' ? '生产协同分析' : '订单风险分析';
  const content = result
    ? `${subject} ${capture.orderNo} ${taskLabel}结果（自动沉淀）${evidence}\n\n${result.slice(0, 1_650)}`
    : `${subject} ${capture.orderNo} 的${taskLabel}运行已完成，但未捕获到可沉淀的文本结论；请在会话中核对结果。${evidence}`;
  try {
    addAgentSquadActivity({
      agentId: capture.agentId,
      title: `${taskLabel}已完成`,
      detail: `${subject} ${capture.orderNo} 的分析已完成；结果已写入该 Agent 的独立记忆。`,
    });
    addAgentSquadMemory({ agentId: capture.agentId, content });
  } catch (error) {
    console.error('[agent-dispatch] 无法沉淀专业分析结果:', (error as Error).message);
  } finally {
    agentRunCaptures.delete(runId);
  }
}

// ---------- Codex 运行时用量记账（第三次台账来源） ----------
// app-server 的 thread/tokenUsage/updated 报告线程累计用量；基线持久化后只记增量。
// 归属：threadId → 会话 → Harbor Agent；未关联会话时记到中枢 Agent。
function codexUsageInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function recordCodexTokenUsage(event: RuntimeEvent): void {
  const params = event.data as {
    threadId?: unknown;
    tokenUsage?: { total?: { inputTokens?: unknown; cachedInputTokens?: unknown; outputTokens?: unknown } };
  } | undefined;
  const threadId = typeof params?.threadId === 'string' && params.threadId.trim()
    ? params.threadId.trim()
    : event.sessionId;
  const total = params?.tokenUsage?.total;
  if (!threadId || !total) return;
  const inputTokens = codexUsageInt(total.inputTokens);
  const cachedInputTokens = codexUsageInt(total.cachedInputTokens);
  const outputTokens = codexUsageInt(total.outputTokens);
  if (!inputTokens && !outputTokens) return;

  const delta = recordThreadUsageTotal(threadId, { inputTokens, cachedInputTokens, outputTokens });
  if (!delta.inputTokens && !delta.cachedInputTokens && !delta.outputTokens) return;

  const convId = convByThread.get(threadId);
  const conv = convId ? convCache.get(convId) : undefined;
  const callerUserId = convId ? conversationActorId.get(convId) ?? null : null;
  const configuredModel = readConfig().model?.trim();
  const modelName = conv?.lastChoice?.model?.trim() || configuredModel || 'deepseek-flash';
  const profiles = loadModelProfiles().profiles;
  const profile = profiles.find((item) => !item.followsDefault && item.modelName === modelName)
    ?? profiles.find((item) => !item.followsDefault && item.provider === 'deepseek');
  const cost = profile
    ? estimateUsageCostCny(profile, {
      inputTokens: delta.inputTokens,
      cachedInputTokens: delta.cachedInputTokens,
      outputTokens: delta.outputTokens,
    }, new Date(event.occurredAt))
    : 0;
  recordUsageEvent({
    agentId: conv?.agentId || 'agent-aeos-hub',
    systemId: 'aeos-hub',
    modelId: profile?.id ?? modelName,
    runId: null,
    callerUserId,
    tokensIn: delta.inputTokens,
    cachedTokens: delta.cachedInputTokens,
    tokensOut: delta.outputTokens,
    cost,
    metering: 'app-server',
    startedAt: event.occurredAt,
    endedAt: new Date().toISOString(),
  });
}

function handleRuntimeEvent(event: RuntimeEvent): void {
  if (event.kind === 'notification') {
    // 用量通知只用于记账，不进入前端事件流。
    if (event.name === 'thread/tokenUsage/updated') {
      recordCodexTokenUsage(event);
      return;
    }
    if (!NOTIFY_ALLOW.has(event.name)) return;
    const sessionId = runtimeEventSessionId(event);
    const runId = runtimeEventRunId(event);
    if (runId && agentRunCaptures.has(runId) && (event.name === 'item/agentMessage/delta' || event.name === 'item/completed')) {
      const capture = agentRunCaptures.get(runId)!;
      const text = agentMessageText(event);
      if (text) {
        capture.text = event.name === 'item/agentMessage/delta'
          ? `${capture.text}${text}`.slice(-8_000)
          : text.slice(-8_000);
      }
    }

    // Turn lifecycle is the authoritative run boundary.  Record it before
    // routing so a completed run remains identifiable after activeTurn is
    // cleared, while a newly-started run immediately supersedes old events.
    if (sessionId && runId && event.name === 'turn/started') {
      latestRunBySession.set(sessionId, runId);
      const active = activeTurn.get(sessionId);
      if (active && active.turnId === null) active.turnId = runId;
    } else if (sessionId && runId && event.name === 'turn/completed' && !latestRunBySession.has(sessionId)) {
      latestRunBySession.set(sessionId, runId);
    }

    const convId = runtimeEventConversationId(event, sessionId, runId);
    const agentItem = runtimeAgentItem(event);
    if (convId && agentItem) {
      const bufferKey = `${convId}:${runId ?? 'no-run'}:${agentItem.id}`;
      if (event.name === 'item/agentMessage/delta' && agentItem.text) {
        agentTranscriptBuffers.set(bufferKey, `${agentTranscriptBuffers.get(bufferKey) ?? ''}${agentItem.text}`.slice(-MAX_CONVERSATION_MESSAGE_CHARS));
      }
      if (event.name === 'item/completed') {
        const text = agentItem.text || agentTranscriptBuffers.get(bufferKey) || '';
        appendConversationMessage(convId, {
          id: `assistant-${runId ?? 'run'}-${agentItem.id}`,
          itemId: bufferKey,
          role: 'assistant',
          text,
          phase: agentItem.phase,
          createdAt: event.occurredAt,
        });
        agentTranscriptBuffers.delete(bufferKey);
      }
    }
    const obj = runtimeEventEnvelope(event, convId, sessionId, runId);
    if (convId) pushConv(convId, obj);
    else if (!sessionId && !runId) broadcast(obj);
    return;
  }

  if (event.kind === 'approval' && event.name === 'approval/requested') {
    const request = (event.data as { request?: RuntimeApprovalRequest } | undefined)?.request;
    if (!request) return;
    appendEvidence({
      kind: 'guard_request',
      method: request.method,
      thread_id: request.sessionId,
      turn_id: request.runId,
      payload: request.payload,
    });
    const convId = request.sessionId ? convByThread.get(request.sessionId) ?? null : null;
    const candidates = convId ? socketsFor(convId) : [];
    if (!candidates.length) {
      console.log(`[Guard] 无对应会话的前端监听，自动拒绝 ${request.method}`);
      void resolveRuntimeApproval(request, 'denied', 'no-active-reviewer').catch((error) => console.error('[Guard]', error));
      return;
    }
    const timer = setTimeout(() => {
      pendingGuard.delete(request.requestId);
      pendingApprovals.delete(request.requestId);
      console.log(`[Guard] 超时未决，自动拒绝 ${request.method}`);
      void resolveRuntimeApproval(request, 'denied', 'approval-timeout').catch((error) => console.error('[Guard]', error));
    }, 300_000);
    pendingGuard.set(request.requestId, { timer });
    pendingApprovals.set(request.requestId, request);
    for (const ws of candidates) {
      send(ws, { type: 'guard', id: Number(request.requestId), method: request.method, params: request.payload });
    }
    return;
  }

  if (event.kind === 'lifecycle' && event.name === 'runtime/exited') {
    console.log('[engine] Codex Runtime 已退出');
  }
}

runtimeSupervisor.onEvent(handleRuntimeEvent, CODEX_RUNTIME_ID);

async function restartEngine(): Promise<void> {
  await runtimeSupervisor.stop(CODEX_RUNTIME_ID);
  await new Promise((r) => setTimeout(r, 600));
  await runtimeSupervisor.ensureStarted(CODEX_RUNTIME_ID);
}

async function startTurnUnsafe(convId: string, text: string, choice?: { provider?: string; model?: string }, dispatch?: AgentDispatchContext): Promise<void> {
  const chosen = { provider: choice?.provider || 'openai', model: choice?.model || '' };
  let conv = getConv(convId);
  if (!conv) {
    conv = { id: convId, threadId: null, title: '新对话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), turnCount: 0 };
    convCache.set(convId, conv);
    upsertConversation(conv);
  }
  // The wrapper already owns this conversation's start lock; only inspect an
  // existing active provider turn here.
  const blocked = conversationTurnBlockMessage(convId, false);
  if (blocked) throw new Error(blocked);

  // 1) Session 由 Runtime Adapter 创建或恢复，不向控制面泄漏 Codex RPC。
  let tid = conv.threadId;
  const isCustom = chosen.provider && chosen.provider !== 'openai';
  if (!tid) {
    const sessionRequest: { workingDirectory: string; model?: string; modelProvider?: string } = { workingDirectory: root };
    if (isCustom && chosen.model) {
      sessionRequest.model = chosen.model;
      sessionRequest.modelProvider = chosen.provider;
    } else if (chosen.model) {
      sessionRequest.model = chosen.model;
      sessionRequest.modelProvider = 'openai';
    }
    const session = await runtimeSupervisor.createSession(CODEX_RUNTIME_ID, sessionRequest);
    tid = session.id;
    conv.threadId = tid;
    convByThread.set(tid, convId);
    conv.title = text.replace(/\s+/g, ' ').slice(0, 24) || '新对话';
    conv.lastChoice = chosen;
    upsertConversation(conv);
  } else {
    convByThread.set(tid, convId);
    if (!sameChoice(conv.lastChoice, chosen)) {
      ensureThreadModel(conv, chosen);
    }
    await runtimeSupervisor.resumeSession(CODEX_RUNTIME_ID, tid, { workingDirectory: root });
  }

  // 2) Run 与 Session 分离；Supervisor 负责启动锁和完成事件竞态。
  activeTurn.set(tid, { convId, turnId: null });
  let startedRunId: string | null = null;
  try {
    const run = await runtimeSupervisor.startRun(CODEX_RUNTIME_ID, tid, {
      input: text,
      clientRequestId: `web_${randomUUID()}`,
      metadata: { conversationId: convId, agentId: dispatch?.agentId || 'agent-aeos-hub' },
    });
    startedRunId = run.id;
    if (dispatch) agentRunCaptures.set(run.id, { ...dispatch, text: '', persisted: false });
    activeTurn.set(tid, { convId, turnId: run.id });
    if (requestedInterruptConversations.has(convId)) {
      void runtimeSupervisor.interruptRun(CODEX_RUNTIME_ID, run.id).catch(() => undefined);
    }
    conv.turnCount += 1;
    touch(conv);
    const outcome = await Promise.race([
      runtimeSupervisor.waitForRun(CODEX_RUNTIME_ID, run.id, 600_000),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('模型通道等待超时，已切换到本地回复')), RUNTIME_WAIT_MS)),
    ]);
    if (outcome.state === 'interrupted' && requestedInterruptConversations.has(convId)) {
      pushConv(convId, {
        type: 'turn_end', convId, sessionId: tid, runId: outcome.id,
        runtimeInstanceId: CODEX_RUNTIME_ID, occurredAt: new Date().toISOString(),
        status: 'interrupted', message: '已停止本轮分析',
      });
      return;
    }
    if (outcome.state !== 'completed') throw new Error(outcome.failure?.message || `运行状态：${outcome.state}`);
    if (dispatch) await persistAgentDispatchResult(outcome.id);
    pushConv(convId, {
      type: 'turn_end',
      convId,
      sessionId: tid,
      runId: outcome.id,
      runtimeInstanceId: CODEX_RUNTIME_ID,
      occurredAt: new Date().toISOString(),
      status: 'completed',
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (startedRunId && msg.includes('模型通道等待超时')) {
      void runtimeSupervisor.interruptRun(CODEX_RUNTIME_ID, startedRunId).catch(() => undefined);
      // The timeout is a failed/degraded run, never a source of Agent memory.
      // Drop the capture before any late provider callback can persist it.
      agentRunCaptures.delete(startedRunId);
      const fallbackItemId = `offline-${randomUUID()}`;
      const fallbackText = `我已收到你的消息：\n\n“${text}”\n\n当前模型网络通道正在重连，我先保持对话可用。网络恢复后，新消息会自动交给真实 Agent 继续处理。`;
      appendConversationMessage(convId, {
        id: `assistant-${startedRunId}-${fallbackItemId}`,
        itemId: `${convId}:${startedRunId}:${fallbackItemId}`,
        role: 'assistant', text: fallbackText, phase: 'degraded',
      });
      pushConv(convId, {
        type: 'evt',
        method: 'item/agentMessage/delta',
        convId,
        sessionId: tid,
        runId: startedRunId,
        params: { threadId: tid, turnId: startedRunId, itemId: fallbackItemId, delta: fallbackText },
      });
      pushConv(convId, {
        type: 'turn_end',
        convId,
        sessionId: tid,
        runId: startedRunId,
        runtimeInstanceId: CODEX_RUNTIME_ID,
        occurredAt: new Date().toISOString(),
        status: 'failed',
        error: '模型通道等待超时，已切换到降级提示；未形成有效分析结论',
        degraded: true,
      });
      return;
    }
    if (dispatch && startedRunId && agentRunCaptures.has(startedRunId)) {
      try {
        addAgentSquadActivity({
          agentId: dispatch.agentId,
          title: '订单风险分析运行失败',
          detail: `订单 ${dispatch.orderNo} 的分析未完成：${msg.slice(0, 600)}`,
        });
      } catch (activityError) {
        console.error('[agent-dispatch] 无法记录订单风险分析失败:', (activityError as Error).message);
      }
      agentRunCaptures.delete(startedRunId);
    }
    pushConv(convId, {
      type: 'turn_end',
      convId,
      sessionId: tid,
      runId: startedRunId ?? activeTurn.get(tid)?.turnId ?? null,
      runtimeInstanceId: CODEX_RUNTIME_ID,
      occurredAt: new Date().toISOString(),
      status: 'failed',
      error: msg,
    });
    throw new Error(msg);
  } finally {
    requestedInterruptConversations.delete(convId);
    const current = activeTurn.get(tid);
    // Do not clear a marker belonging to a newer run if a provider callback
    // raced with this turn's cleanup.
    if (current?.convId === convId && (startedRunId === null || current.turnId === startedRunId || current.turnId === null)) {
      activeTurn.delete(tid);
    }
    touch(conv);
  }
}

/** Serialize the complete setup/start lifecycle for one conversation. */
async function startTurn(convId: string, text: string, choice?: { provider?: string; model?: string }, dispatch?: AgentDispatchContext): Promise<void> {
  const conversation = getConv(convId);
  const squadMember = conversation?.scope === 'agent' && conversation.agentId
    ? loadAgentSquad().members.find((item) => item.id === conversation.agentId)
    : undefined;
  const executionAgentId = dispatch?.harborAgentId
    || dispatch?.agentId
    || squadMember?.harborAgentId
    || (conversation?.scope === 'agent' ? conversation.agentId : undefined)
    || 'agent-aeos-hub';
  const executionAgent = loadHarbor().agents.find((item) => item.id === executionAgentId);
  if (!executionAgent || !isM01AgentDispatchable(executionAgent)) {
    throw new Error(`Agent ${executionAgent?.name || executionAgentId} 尚未完成 M01 注册或缺少 task:execute 权限，当前不可执行`);
  }
  if (turnStartLocks.has(convId)) {
    throw new Error('该对话正在启动中，请稍候');
  }
  let release!: () => void;
  const lock = new Promise<void>((resolve) => { release = resolve; });
  turnStartLocks.set(convId, lock);
  try {
    await startTurnUnsafe(convId, text, choice, dispatch);
  } finally {
    if (turnStartLocks.get(convId) === lock) turnStartLocks.delete(convId);
    release();
  }
}

// ---------- 对话内写操作：自然语言发起 → 对话内确认 → 审批派单 ----------
const pendingWriteByConversation = new Map<string, { id: string; summary: string }>();
const lastOrderByConversation = new Map<string, string>();
const writeConversationByRequest = new Map<string, string>();

/** Hub 重启后从写请求台账恢复对话内的待确认/已派单状态，避免请求变成无人可批的孤儿。 */
function rehydrateConversationWrites(): void {
  try {
    for (const record of writeRequestStore.load()) {
      const convId = typeof record.conversationId === 'string' ? record.conversationId.trim() : '';
      if (!convId || !convCache.has(convId)) continue;
      if (record.status === 'pending_approval') {
        if (pendingWriteByConversation.has(convId)) continue;
        const summary = describeWriteIntent({
          operation: record.operation,
          input: isRecord(record.input) ? record.input : {},
        });
        pendingWriteByConversation.set(convId, { id: record.id, summary });
      } else if (record.status === 'dispatched') {
        if (!writeConversationByRequest.has(record.id)) writeConversationByRequest.set(record.id, convId);
      }
    }
  } catch (error) {
    console.warn('[write-chat] 恢复待确认写操作失败:', (error as Error).message);
  }
}
rehydrateConversationWrites();

function describeWriteIntent(
  intent: { operation: string; input: Record<string, unknown> },
  operationDetails?: Array<{ name: string; title?: string; fields?: Array<{ name: string; label: string }> }>,
): string {
  const orderNo = typeof intent.input.orderNo === 'string' ? intent.input.orderNo : '';
  const detail = operationDetails?.find((item) => item.name === intent.operation);
  const changesSource = isRecord(intent.input.changes) ? intent.input.changes : {};
  const parts = Object.entries(changesSource).map(([key, value]) => {
    const label = detail?.fields?.find((field) => field.name === key)?.label ?? key;
    return `${label}：${String(value)}`;
  });
  const head = detail?.title ?? intent.operation;
  return `${head}${orderNo ? ` · 订单 ${orderNo}` : ''}${parts.length ? `（${parts.join('；')}）` : ''}`;
}

function pushAssistantReply(convId: string, text: string, meta?: Record<string, unknown>): void {
  appendConversationMessage(convId, { id: `assistant-${randomUUID()}`, role: 'assistant', text });
  pushConv(convId, { type: 'assistant_reply', convId, text, ...(meta ? { meta } : {}) });
  pushConv(convId, { type: 'turn_end', convId, status: 'completed', runId: `write-chat-${randomUUID()}`, sessionId: 'hub-write', occurredAt: new Date().toISOString() });
}

/** 对话内确认/取消：按钮与文字“确认/取消”共用同一条路径。 */
function decidePendingWrite(
  convId: string,
  pending: { id: string; summary: string },
  actor: { actorId: string; roles: string[]; tenantId?: string },
  decision: 'approve' | 'reject',
): void {
  const tenantId = actor.tenantId && actor.tenantId !== 'local-dev' ? actor.tenantId : DEFAULT_TENANT_ID;
  const roles = Array.isArray(actor.roles) ? actor.roles : [];
  const canWrite = roles.includes('manager') || roles.includes('supervisor');
  if (!canWrite) {
    pushAssistantReply(convId, '当前账号没有写操作权限（需要 manager / supervisor）。');
    return;
  }
  if (decision === 'reject') {
    try {
      writeRequestService.reject(pending.id, { id: actor.actorId, roles, tenantId }, '用户在对话中取消');
    } catch {
      // 已不在待审批状态时忽略。
    }
    pendingWriteByConversation.delete(convId);
    pushAssistantReply(convId, '已取消本次写操作，未修改任何数据。');
    return;
  }
  writeConversationByRequest.set(pending.id, convId);
  try {
    const record = writeRequestService.approve(pending.id, { id: actor.actorId, roles, tenantId });
    pendingWriteByConversation.delete(convId);
    if (record.status === 'completed' || record.status === 'failed') {
      notifyWriteRecord(writeRequestStore.get(record.id) ?? record);
    } else {
      pushAssistantReply(convId, `已确认并派单：${pending.summary}。执行完成后会在这里回报结果。`);
    }
  } catch (error) {
    writeConversationByRequest.delete(pending.id);
    pushAssistantReply(convId, `写操作未能执行：${(error as Error).message}`);
  }
}

function notifyWriteRecord(record: WriteRequestRecord): void {
  const convId = writeConversationByRequest.get(record.id);
  if (!convId) return;
  writeConversationByRequest.delete(record.id);
  const orderNo = (record.input as Record<string, unknown> | null)?.orderNo;
  const result = isRecord(record.result) ? record.result : {};
  const handledBy = isRecord(result.handled_by) ? result.handled_by : {};
  const handler = typeof handledBy.agentName === 'string' ? handledBy.agentName
    : typeof handledBy.agentId === 'string' ? handledBy.agentId : '';
  const runRef = record.runId ? ` · run ${record.runId}` : '';
  const hints: string[] = [];
  if (record.status === 'completed') {
    const after = isRecord(record.result) && isRecord(record.result.after) ? record.result.after : {};
    if (typeof after.status === 'string' && after.status === 'closed') {
      hints.push(`该订单状态已变为 closed，如需恢复可回复：更新订单 ${orderNo || '…'} 状态为 open`);
    }
  }
  const text = record.status === 'completed'
    ? `写操作完成：${record.operation}${orderNo ? ` · 订单 ${String(orderNo)}` : ''}${handler ? ` · 处理方 ${handler}` : ''}。${hints.length ? ` ${hints.join(' ')}` : ''}`
    : `写操作失败：${record.error?.message || '未知错误'}（请求 ${record.id}${runRef}）。`;
  pushAssistantReply(convId, text, record.runId ? { writeTraceId: `write-${record.id}` } : undefined);
}

/** 页面/API 审批后同步对话侧状态：清掉“待确认”按钮，并让完成/失败消息回到原会话。 */
function syncConversationWriteState(record: WriteRequestRecord): void {
  const convId = typeof record.conversationId === 'string' ? record.conversationId.trim() : '';
  if (!convId) return;
  const pending = pendingWriteByConversation.get(convId);
  if (pending && pending.id === record.id && record.status !== 'pending_approval') {
    pendingWriteByConversation.delete(convId);
    if (record.status === 'rejected') pushAssistantReply(convId, '写操作已取消，未修改任何数据。');
  }
  if (record.status === 'dispatched' && !writeConversationByRequest.has(record.id)) {
    writeConversationByRequest.set(record.id, convId);
  }
}

async function handleConversationalWrite(
  convId: string,
  text: string,
  actor?: { actorId: string; roles: string[]; tenantId?: string },
): Promise<boolean> {
  const contextLastOrder = lastOrderByConversation.get(convId);
  const pending = pendingWriteByConversation.get(convId);
  const confirmation = parseWriteConfirmation(text);
  if (confirmation) {
    if (!pending || !actor) return false;
    decidePendingWrite(convId, pending, actor, confirmation === 'confirm' ? 'approve' : 'reject');
    return true;
  }

  if (!looksLikeWriteCommand(text)) return false;
  if (!actor) return false;
  const tenantId = actor.tenantId && actor.tenantId !== 'local-dev' ? actor.tenantId : DEFAULT_TENANT_ID;
  const roles = Array.isArray(actor.roles) ? actor.roles : [];
  const canWrite = roles.includes('manager') || roles.includes('supervisor');
  if (!canWrite) {
    pushAssistantReply(convId, '当前账号没有写操作权限（需要 manager / supervisor）。');
    return true;
  }

  // 同一会话同时只允许一笔待确认写操作；否则旧请求会失去按钮、变成孤儿。
  if (pending) {
    const current = writeRequestStore.get(pending.id);
    if (current && current.status === 'pending_approval') {
      pushAssistantReply(convId, `还有一笔待确认的写操作：${pending.summary}。请先回复“确认”或“取消”，再发起新的写操作。`);
      return true;
    }
    pendingWriteByConversation.delete(convId);
  }

  // 由提供方声明的写能力 + 输入 schema 驱动解析，不在 Hub 里硬编码具体写命令。
  const capabilities = writeRequestService.listCapabilities(tenantId);
  const hasOrderRef = /business:\/\//.test(text)
    || Boolean(extractBusinessIdentifier(text))
    || /(它|该|这条|这个订单|上一条)/.test(text)
    || contextLastOrder != null;
  if (!hasOrderRef) {
    pushAssistantReply(convId, '请提供要修改的订单号，例如：改写订单 HJ202602-0009-0028 的交付日期为 2026-11-15。');
    return true;
  }
  const intent = await parseWriteIntentWithLLM(
    text,
    capabilities,
    {},
    contextLastOrder ? { fallbackOrderNo: contextLastOrder } : {},
  );
  if (intent.kind === 'clarify') {
    pushAssistantReply(convId, intent.message);
    return true;
  }
  if (intent.kind !== 'write') return false;

  const summary = describeWriteIntent(
    intent,
    capabilities.find((item) => item.systemId === intent.systemId && item.capability === intent.capability)?.operationDetails,
  );
  try {
    const { record } = writeRequestService.create({
      tenantId,
      capability: intent.capability,
      systemId: intent.systemId,
      input: intent.input,
      reason: `对话内发起：${intent.raw}`.slice(0, 500),
      requestedBy: { kind: 'user', id: actor.actorId },
      conversationId: convId,
      idempotencyKey: `chat-${randomUUID()}`,
    });
    pendingWriteByConversation.set(convId, { id: record.id, summary });
    pushAssistantReply(
      convId,
      `即将执行：${summary}。
点击「确认执行」或回复“确认”；点击「取消」或回复“取消”放弃。`,
      { writeConfirmation: { requestId: record.id, summary } },
    );
  } catch (error) {
    pushAssistantReply(convId, `写操作未能提交：${(error as Error).message}`);
  }
  return true;
}

/**
 * 中枢对话的通用意图路由：识别业务域与动作；最高风险订单走编排，
 * 其他已识别意图返回可用 Agent 与补充信息提示；无法识别时交给 Codex。
 */
async function routeHubExecutionTurn(convId: string, text: string, actor?: { actorId: string; roles: string[]; tenantId?: string }): Promise<boolean> {
  const conv = getConv(convId);
  if ((conv?.scope ?? 'hub') !== 'hub') return false;
  // 把 M01 用户作为调用方传入执行面，用量台账才能按人归属。
  const caller = actor?.actorId
    ? { systemId: 'aeos-hub', agentId: null, userId: actor.actorId, taskId: null, traceId: null }
    : null;
  if (await handleConversationalWrite(convId, text, actor)) return true;
  const intent = recognizeHubIntent(text);
  // 范围控制：用户可直接要求“下一条高风险订单”，跳过最近已分析过的订单。
  const wantsNextOrder = /^(下一条|下一个|下个)\s*(高风险)?\s*订单?/.test(text.trim());
  if (intent.action === 'chat' && !wantsNextOrder) return false;
  const effectiveIntent = wantsNextOrder
    ? { ...intent, domain: 'cross-domain' as const, action: 'highest-risk' as const, confidence: 'high' as const }
    : intent;

  const agents = executionPlane.list().agents;
  const selection = selectAgentForIntent(effectiveIntent, agents);
  const sessionId = conv?.threadId || 'hub-execution-orchestrator';

  if (effectiveIntent.action !== 'highest-risk') {
    const plan = selection ? buildIntentDispatch(intent, text) : null;
    if (selection && plan) {
      const runId = `hub-intent-${randomUUID()}`;
      const envelope = { type: 'evt', convId, sessionId, runId, runtimeInstanceId: 'hub-execution-orchestrator' };
      pushConv(convId, {
        ...envelope,
        method: 'turn/started',
        params: { threadId: sessionId, turn: { id: runId, threadId: sessionId } },
      });
      pushConv(convId, {
        ...envelope,
        method: 'item/reasoning/textDelta',
        params: {
          itemId: `reasoning:${runId}`,
          delta: `已识别为${ACTION_LABELS[intent.action]}，正在调用${selection.name}（${selection.capability}）…`,
        },
      });
      try {
        const result = await executionOrchestrator.runCapability({
          agentId: selection.agentId,
          capability: selection.capability,
          input: plan.input,
          timeoutMs: plan.timeoutMs,
          caller,
        });
        const answer = formatIntentExecutionAnswer(intent, result);
        appendConversationMessage(convId, { id: `assistant-${randomUUID()}`, role: 'assistant', text: answer, phase: 'final_answer' });
        pushConv(convId, { type: 'assistant_reply', convId, text: answer, meta: { runId, agentId: selection.agentId, capability: selection.capability } });
        pushConv(convId, { type: 'turn_end', convId, status: 'completed', runId, sessionId, occurredAt: new Date().toISOString() });
      } catch (error) {
        const message = `执行面调用失败：${(error as Error).message}`;
        appendConversationMessage(convId, { id: `assistant-${randomUUID()}`, role: 'assistant', text: message });
        pushConv(convId, { type: 'assistant_reply', convId, text: message });
        pushConv(convId, { type: 'turn_end', convId, status: 'failed', runId, sessionId, message, occurredAt: new Date().toISOString() });
      }
      return true;
    }

    const reply = formatIntentRoutingReply(intent, selection);
    appendConversationMessage(convId, { id: `assistant-${randomUUID()}`, role: 'assistant', text: reply });
    pushConv(convId, { type: 'assistant_reply', convId, text: reply });
    pushConv(convId, { type: 'turn_end', convId, status: 'completed', runId: `hub-route-${randomUUID()}`, sessionId, occurredAt: new Date().toISOString() });
    return true;
  }

  if (!selection) {
    const reply = formatIntentRoutingReply(intent, null);
    appendConversationMessage(convId, { id: `assistant-${randomUUID()}`, role: 'assistant', text: reply });
    pushConv(convId, { type: 'assistant_reply', convId, text: reply });
    pushConv(convId, { type: 'turn_end', convId, status: 'completed', runId: `hub-route-${randomUUID()}`, sessionId, occurredAt: new Date().toISOString() });
    return true;
  }

  const runId = `hub-orch-${randomUUID()}`;
  // 短时缓存：同一问题 5 分钟内重复提问直接复用上次结果；“重新分析/下一条”不走缓存。
  const forceRefresh = /重新分析|再分析|重跑/.test(text);
  const cacheKey = `highest-risk|${beijingDateString()}|${text.trim().replace(/\s+/g, ' ').toLowerCase()}`;
  const cached = !forceRefresh && !wantsNextOrder ? highestRiskAnswerCache.get(cacheKey) : null;
  if (cached) {
    const analyzedAt = new Date(cached.cachedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    const answer = `${cached.answer}\n\n（本次结果来自 ${analyzedAt} 的分析，5 分钟内重复提问会直接复用；如需重新分析，请回复“重新分析”。）`;
    appendConversationMessage(convId, { id: `assistant-${randomUUID()}`, role: 'assistant', text: answer, phase: 'final_answer' });
    pushConv(convId, {
      type: 'assistant_reply',
      convId,
      text: answer,
      meta: {
        requestId: cached.requestId,
        queryRunId: cached.queryRunId,
        reasoningRunId: cached.reasoningRunId,
        orderNo: cached.orderNo,
        cached: true,
        cachedAt: cached.cachedAt,
      },
    });
    pushConv(convId, { type: 'turn_end', convId, status: 'completed', runId, sessionId, occurredAt: new Date().toISOString() });
    return true;
  }
  const envelope = { type: 'evt', convId, sessionId, runId, runtimeInstanceId: 'hub-execution-orchestrator' };
  pushConv(convId, {
    ...envelope,
    method: 'turn/started',
    params: { threadId: sessionId, turn: { id: runId, threadId: sessionId } },
  });
  pushConv(convId, {
    ...envelope,
    method: 'item/reasoning/textDelta',
    params: { itemId: `reasoning:${runId}`, delta: '正在查询当前风险最高的订单，并交给系统推理智能体…' },
  });

  try {
    const excludeOrderNos = wantsNextOrder
      ? conclusionDispatcher.recentBusinessObjectRefs(24)
        .filter((ref) => ref.startsWith('business://order/'))
        .map((ref) => ref.slice('business://order/'.length))
      : undefined;
    const result = await executionOrchestrator.highestRiskOrder({
      reasoningAgentId: selection.agentId,
      text,
      caller,
      ...(excludeOrderNos && excludeOrderNos.length ? { excludeOrderNos } : {}),
    });
    lastOrderByConversation.set(convId, result.order.orderNo);
    const answer = formatHighestRiskAnswer(result);
    if (!forceRefresh && !wantsNextOrder) {
      highestRiskAnswerCache.set(cacheKey, {
        answer,
        requestId: result.requestId,
        queryRunId: result.queryRunId,
        reasoningRunId: result.reasoningRunId,
        orderNo: result.order.orderNo,
        cachedAt: new Date().toISOString(),
      });
    }
    appendConversationMessage(convId, { id: `assistant-${randomUUID()}`, role: 'assistant', text: answer, phase: 'final_answer' });
    pushConv(convId, {
      type: 'assistant_reply',
      convId,
      text: answer,
      meta: {
        requestId: result.requestId,
        queryRunId: result.queryRunId,
        reasoningRunId: result.reasoningRunId,
        orderNo: result.order.orderNo,
      },
    });
    // 结论自动分发：不阻塞主回答，过程中推送进度，完成后在同一会话追加报告。
    void conclusionDispatcher
      .dispatchForObject(
        {
          businessObjectRef: result.order.businessObjectRef,
          orderNo: result.order.orderNo,
          title: result.order.businessObjectRef,
        },
        {
          traceId: result.requestId,
          force: forceRefresh,
          onProgress: (event) => {
            pushConv(convId, {
              type: 'dispatch_progress',
              convId,
              phase: event.phase,
              domain: event.domain ?? null,
              domainLabel: event.domain ? DOMAIN_LABELS[event.domain] : null,
              index: event.index,
              total: event.total,
              status: event.status ?? null,
              conclusions: event.conclusions ?? null,
            });
          },
        },
      )
      .then((report) => {
        const text = formatConclusionDispatchReport(report);
        if (!text) return;
        appendConversationMessage(convId, { id: `dispatch-${randomUUID()}`, role: 'assistant', text, phase: 'follow_up' });
        pushConv(convId, {
          type: 'assistant_reply',
          convId,
          text,
          meta: { dispatchId: report.dispatchId, traceId: report.traceId, counts: report.counts, dispatchComplete: true },
        });
      })
      .catch((error) => {
        const text = `自动分发失败：${(error as Error).message || '未知错误'}`;
        appendConversationMessage(convId, { id: `dispatch-${randomUUID()}`, role: 'assistant', text });
        pushConv(convId, { type: 'assistant_reply', convId, text });
      });
    pushConv(convId, { type: 'turn_end', convId, status: 'completed', runId, sessionId, occurredAt: new Date().toISOString() });
  } catch (error) {
    const message = wantsNextOrder && error instanceof ExecutionOrchestrationError && error.code === 'NO_ELIGIBLE_ORDER'
      ? '没有更多未分析的高风险订单；如需重新分析，请回复“重新分析”。'
      : `执行面编排失败：${(error as Error).message}`;
    appendConversationMessage(convId, { id: `assistant-${randomUUID()}`, role: 'assistant', text: message });
    pushConv(convId, { type: 'assistant_reply', convId, text: message });
    pushConv(convId, { type: 'turn_end', convId, status: 'failed', runId, sessionId, message, occurredAt: new Date().toISOString() });
  }
  return true;
}

// ---------- HTTP ----------
/** 系统 ID 可能包含中文；浏览器/curl 只能安全传 ASCII，故支持百分号编码后再比对令牌。 */
function decodeSystemIdHeader(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDailyQuestionGenerationInput(input: Record<string, unknown>): { dateKey: string; role: string } {
  const allowed = new Set(['dateKey', 'role']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`生成参数不支持: ${key}`);
  }
  const dateKey = typeof input.dateKey === 'string' ? input.dateKey.trim() : '';
  const role = typeof input.role === 'string' ? input.role.trim() : '';
  const parsedDate = new Date(`${dateKey}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateKey) {
    throw new Error('dateKey 必须是有效的 YYYY-MM-DD 日期');
  }
  if (dateKey !== localDateKey()) throw new Error('只能生成当天的经营问题');
  if (!role || role.length > 40) throw new Error('role 必须是 1 到 40 个字符');
  return { dateKey, role };
}

async function ensureDailyQuestionsGenerated(dateKey: string, role: string): Promise<{ config: DailyQuestionConfig; cached: boolean }> {
  const current = loadDailyQuestionConfig();
  if (hasDailyGeneratedBatch(current, dateKey, role)) return { config: current, cached: true };

  const key = `${dateKey}\u0000${role}`;
  let operation = dailyQuestionGenerationLocks.get(key);
  const joined = Boolean(operation);
  if (!operation) {
    operation = (async () => {
      const latest = loadDailyQuestionConfig();
      if (hasDailyGeneratedBatch(latest, dateKey, role)) return latest;
      let capabilitySummary = '';
      try {
        const inventory = await codexRuntime.listMcpServerStatus();
        const registry = buildCapabilityRegistry(readConfig().mcpServers, inventory);
        capabilitySummary = registry.capabilities
          .filter((capability) => capability.readOnly)
          .map((capability) => `${capability.server}/${capability.name}`)
          .join('；');
      } catch {
        // Generation remains available in conservative mode when runtime inventory is unavailable.
      }
      const drafts = await generateDailyQuestionsWithRuntime({
        supervisor: runtimeSupervisor,
        runtimeInstanceId: CODEX_RUNTIME_ID,
        workingDirectory: root,
        dateKey,
        role,
        config: latest,
        capabilitySummary,
      });
      const saved = replaceDailyGeneratedQuestions(dateKey, role, drafts);
      appendEvidence({
        kind: 'app_event',
        summary: 'daily operating questions generated',
        payload: { dateKey, role, count: drafts.length, revision: saved.revision },
      });
      return saved;
    })();
    dailyQuestionGenerationLocks.set(key, operation);
    void operation.finally(() => {
      if (dailyQuestionGenerationLocks.get(key) === operation) dailyQuestionGenerationLocks.delete(key);
    }).catch(() => undefined);
  }
  return { config: await operation, cached: joined };
}

async function loadDashboardSnapshot(force = false): Promise<DashboardSnapshot> {
  // The dashboard is a live operational view. Keep only the in-flight lock so
  // concurrent browser requests share one read, but never serve a completed
  // snapshot from a server-side TTL cache.
  if (dashboardLoadPromise) return dashboardLoadPromise;

  dashboardLoadPromise = (async () => {
    const warnings: string[] = [];
    const registeredServers = readConfig().mcpServers;
    let runtimeInventory: unknown = null;
    try {
      runtimeInventory = await codexRuntime.listMcpServerStatus();
    } catch (error) {
      warnings.push(`Capability 清单读取失败：${(error as Error).message}`);
    }
    let registry = buildCapabilityRegistry(registeredServers, runtimeInventory, warnings[0]);

    let orderRiskResponse: unknown;
    let shortageResponse: unknown;
    let kittingResponse: unknown;
    let qualityResponse: unknown;
    let productionResponses: { workOrders?: unknown; operations?: unknown; orderLinks?: unknown; reports?: unknown; capacity?: unknown } = {};
    const useCompanyControl = registeredServers.includes('company-control');
    const businessSource = useCompanyControl ? 'company-control' : 'demo-erp';
    let sessionId: string | null = null;
    try {
      const session = await runtimeSupervisor.createSession(CODEX_RUNTIME_ID, {
        workingDirectory: root,
        metadata: { purpose: 'manager-dashboard-readonly' },
      });
      sessionId = session.id;
      if (useCompanyControl) {
        const dashboardTools = [
          'detail_orders_list',
          'material_shortages_list',
          'material_kitting_results_list',
          'quality_issues_list',
          'production_work_orders_list',
          'production_capacity_list',
          'production_operations_list',
          'production_order_links_list',
          'production_reports_list',
        ];
        try {
          // Session creation triggers stdio MCP startup. The inventory read above can be
          // too early, so only direct calls below use an inventory that proves read-only.
          runtimeInventory = await waitForReadOnlyMcpTools({
            readInventory: () => codexRuntime.listMcpServerStatus(),
            server: 'company-control',
            tools: dashboardTools,
            // 每次清单 RPC 自身最多 20 秒；只重试 3 次，避免启动时无限等待。
            attempts: 3,
          });
          registry = buildCapabilityRegistry(registeredServers, runtimeInventory, warnings[0]);
        } catch (error) {
          const message = error instanceof McpReadinessError
            ? error.message
            : '中控只读能力清单读取失败，请稍后刷新';
          console.warn('[dashboard] MCP 未就绪：', message);
          warnings.push(message);
          const unavailable = { source: 'company-control', error: { code: 'MCP_NOT_READY', message } };
          orderRiskResponse = unavailable;
          shortageResponse = unavailable;
          kittingResponse = unavailable;
          qualityResponse = unavailable;
        }
        if (orderRiskResponse) {
          // The dashboard mapper will surface the readiness warning. Do not make any
          // unverified call merely to replace it with a misleading empty result.
        } else {
        const readPlan = dashboardReadPlan(new Date());
        const readLimits = loadDashboardReadLimits();
        const [orders, shortages, kitting, quality, workOrders, capacity] = await Promise.allSettled([
          collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({
            sessionId: session.id,
            server: 'company-control',
            tool: 'detail_orders_list',
            args: pageArgs,
            purpose: 'manager-dashboard-order-risk',
            runtimeInventory,
          }), readPlan.orders, readLimits.orders, Math.min(readLimits.pageSize, 100)),
          collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({
            sessionId: session.id,
            server: 'company-control',
            tool: 'material_shortages_list',
            args: pageArgs,
            purpose: 'manager-dashboard-material-shortage',
            runtimeInventory,
          }), {}, readLimits.shortages, readLimits.pageSize),
          collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({
            sessionId: session.id,
            server: 'company-control',
            tool: 'material_kitting_results_list',
            args: pageArgs,
            purpose: 'manager-dashboard-material-kitting',
            runtimeInventory,
          }), readPlan.kitting, readLimits.kitting, readLimits.pageSize),
          collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({
            sessionId: session.id,
            server: 'company-control',
            tool: 'quality_issues_list',
            args: pageArgs,
            purpose: 'manager-dashboard-quality-issues',
            runtimeInventory,
          // Attention 同时需要拿到质量事项的终态，才能将此前已进入队列的
          // 事项以中台证据归入“已闭环”；前端仍只把非终态计入待关注指标。
          }), { status: 'open,in_progress,closed,resolved,completed,cancelled,canceled' }, readLimits.quality, readLimits.pageSize),
          collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({
            sessionId: session.id, server: 'company-control', tool: 'production_work_orders_list',
            args: pageArgs, purpose: 'manager-dashboard-production-work-orders', runtimeInventory,
          }), {
            planned_end_start: readPlan.orders.date_from,
            planned_end_end: readPlan.orders.date_to,
          }, readLimits.workOrders, readLimits.pageSize),
          collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({
            sessionId: session.id, server: 'company-control', tool: 'production_capacity_list',
            args: pageArgs, purpose: 'manager-dashboard-production-capacity', runtimeInventory,
          }), readPlan.capacity, readLimits.capacity, readLimits.pageSize),
        ]);
        if (orders.status === 'fulfilled') orderRiskResponse = orders.value;
        else warnings.push(`中控平台订单数据读取失败：${orders.reason instanceof Error ? orders.reason.message : String(orders.reason)}`);
        if (shortages.status === 'fulfilled') shortageResponse = shortages.value;
        else warnings.push(`中控平台缺料数据读取失败：${shortages.reason instanceof Error ? shortages.reason.message : String(shortages.reason)}`);
        if (kitting.status === 'fulfilled') kittingResponse = kitting.value;
        else warnings.push(`中控平台齐套数据读取失败：${kitting.reason instanceof Error ? kitting.reason.message : String(kitting.reason)}`);
        if (quality.status === 'fulfilled') qualityResponse = quality.value;
        else warnings.push(`中控平台质量异常数据读取失败：${quality.reason instanceof Error ? quality.reason.message : String(quality.reason)}`);
        if (workOrders.status === 'fulfilled') productionResponses.workOrders = workOrders.value;
        else warnings.push(`中控平台生产工单读取失败：${workOrders.reason instanceof Error ? workOrders.reason.message : String(workOrders.reason)}`);
        if (capacity.status === 'fulfilled') productionResponses.capacity = capacity.value;
        else warnings.push(`中控平台产能读取失败：${capacity.reason instanceof Error ? capacity.reason.message : String(capacity.reason)}`);
        if (workOrders.status === 'fulfilled') {
          const workOrderPayload = payloadOf(workOrders.value) as Record<string, unknown>;
          const firstWorkOrder = Array.isArray(workOrderPayload.data) && workOrderPayload.data[0] && typeof workOrderPayload.data[0] === 'object'
            ? workOrderPayload.data[0] as Record<string, unknown> : {};
          const orderNo = typeof firstWorkOrder.order_no === 'string' ? firstWorkOrder.order_no : '';
          const workOrderNo = typeof firstWorkOrder.work_order_no === 'string' ? firstWorkOrder.work_order_no : typeof firstWorkOrder.work_order_id === 'string' ? firstWorkOrder.work_order_id : '';
          if (orderNo || workOrderNo) {
            const [operations, links, reports] = await Promise.allSettled([
              orderNo ? collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({ sessionId: session.id, server: 'company-control', tool: 'production_operations_list', args: pageArgs, purpose: 'manager-dashboard-production-operations', runtimeInventory }), { order_no: orderNo }, readLimits.productionScoped, readLimits.pageSize) : Promise.resolve(undefined),
              collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({ sessionId: session.id, server: 'company-control', tool: 'production_order_links_list', args: pageArgs, purpose: 'manager-dashboard-production-links', runtimeInventory }), { ...(orderNo ? { order_no: orderNo } : {}), ...(workOrderNo ? { work_order_no: workOrderNo } : {}) }, readLimits.productionScoped, readLimits.pageSize),
              workOrderNo ? collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({ sessionId: session.id, server: 'company-control', tool: 'production_reports_list', args: pageArgs, purpose: 'manager-dashboard-production-reports', runtimeInventory }), { work_order_no: workOrderNo }, readLimits.productionScoped, readLimits.pageSize) : Promise.resolve(undefined),
            ]);
            if (operations.status === 'fulfilled' && operations.value) productionResponses.operations = operations.value;
            if (links.status === 'fulfilled') productionResponses.orderLinks = links.value;
            if (reports.status === 'fulfilled' && reports.value) productionResponses.reports = reports.value;
          }
        }
        }
      } else {
        const [orders, shortages] = await Promise.allSettled([
          mcpAccessGateway.callReadOnly({
            sessionId: session.id, server: 'demo-erp', tool: 'list_order_risks',
            args: { window_days: 60, min_probability: 0.4 }, purpose: 'manager-dashboard-order-risk', runtimeInventory,
          }),
          mcpAccessGateway.callReadOnly({
            sessionId: session.id, server: 'demo-erp', tool: 'check_material_shortages',
            args: {}, purpose: 'manager-dashboard-material-shortage', runtimeInventory,
          }),
        ]);
        if (orders.status === 'fulfilled') orderRiskResponse = orders.value;
        else warnings.push(`订单风险读取失败：${orders.reason instanceof Error ? orders.reason.message : String(orders.reason)}`);
        if (shortages.status === 'fulfilled') shortageResponse = shortages.value;
        else warnings.push(`物料缺口读取失败：${shortages.reason instanceof Error ? shortages.reason.message : String(shortages.reason)}`);
      }
    } catch (error) {
      warnings.push(`经营数据读取失败：${(error as Error).message}`);
    } finally {
      if (sessionId) await runtimeSupervisor.deleteSession(CODEX_RUNTIME_ID, sessionId).catch(() => undefined);
    }

    const snapshot = buildDashboardSnapshot({ registry, orderRiskResponse, shortageResponse, kittingResponse, qualityResponse, productionResponses, source: businessSource, warnings, now: Date.now() });
    return snapshot;
  })();
  try {
    return await dashboardLoadPromise;
  } finally {
    dashboardLoadPromise = null;
  }
}

// ---------- 每日风险简报：按“需求日期 = 今天”口径只读汇总齐套红色风险 ----------
const DAILY_BRIEFING_TTL_MS = 5 * 60_000;
let dailyBriefingCache: { at: number; windowEnd: string; brief: DailyBriefing; markdown: string } | null = null;

async function loadDailyBriefing(force = false): Promise<{ at: number; windowEnd: string; brief: DailyBriefing; markdown: string }> {
  const windowEnd = beijingDateString();
  if (!force && dailyBriefingCache && dailyBriefingCache.windowEnd === windowEnd
    && Date.now() - dailyBriefingCache.at < DAILY_BRIEFING_TTL_MS) {
    return dailyBriefingCache;
  }
  let sessionId: string | null = null;
  try {
    const session = await runtimeSupervisor.createSession(CODEX_RUNTIME_ID, {
      workingDirectory: root,
      metadata: { purpose: 'daily-briefing-readonly' },
    });
    sessionId = session.id;
    const runtimeInventory = await waitForReadOnlyMcpTools({
      readInventory: () => codexRuntime.listMcpServerStatus(),
      server: 'company-control',
      tools: ['material_kitting_results_list'],
    });
    const response = await collectMcpPages((pageArgs) => mcpAccessGateway.callReadOnly({
      sessionId: session.id,
      server: 'company-control',
      tool: 'material_kitting_results_list',
      args: pageArgs,
      purpose: 'daily-briefing-kitting',
      runtimeInventory,
    }), { risk_level: 'red', required_date_start: windowEnd, required_date_end: windowEnd }, 5, 200);
    const payload = payloadOf(response);
    if (payload.error) throw new Error(`中台齐套查询失败：${JSON.stringify(payload.error)}`);
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const brief = buildDailyBriefing({
      rows,
      windowEnd,
      dataAsOf: typeof payload.data_as_of === 'string' ? payload.data_as_of : null,
      confidence: typeof payload.data_confidence === 'string' ? payload.data_confidence : 'unknown',
      stale: typeof payload.stale === 'boolean' ? payload.stale : null,
      warnings: Array.isArray(payload.warnings) ? payload.warnings.filter((item): item is string => typeof item === 'string') : [],
    });
    const entry = { at: Date.now(), windowEnd, brief, markdown: formatDailyBriefingMarkdown(brief) };
    dailyBriefingCache = entry;
    return entry;
  } finally {
    if (sessionId) await runtimeSupervisor.deleteSession(CODEX_RUNTIME_ID, sessionId).catch(() => undefined);
  }
}

/**
 * AEOS keeps a warm, read-only decision snapshot even while no browser is
 * open. This is intentionally separate from the removed Autopilot: it does
 * not create cases, send notifications, or call any non-read-only tool.
 */
function dashboardHasBusinessData(snapshot: DashboardSnapshot): boolean {
  return Boolean(snapshot.businessData?.available)
    || (snapshot.risks?.length ?? 0) > 0
    || (snapshot.kittingRisks?.length ?? 0) > 0
    || (snapshot.qualityRisks?.length ?? 0) > 0
    || (snapshot.attentionRisks?.length ?? 0) > 0
    || Boolean(snapshot.productionAssessment?.available);
}

async function refreshDecisionData(): Promise<DashboardSnapshot> {
  if (decisionDataRefreshPromise) return decisionDataRefreshPromise;
  decisionDataRefreshPromise = (async () => {
    let snapshot = await loadDashboardSnapshot(true);
    // MCP/Codex 冷启动时第一次读取可能拿不到业务数据：短暂等待后重试一次，
    // 且空快照不写入缓存，避免重启后一直返回空看板。
    if (!dashboardHasBusinessData(snapshot)) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      snapshot = await loadDashboardSnapshot(true);
    }
    if (dashboardHasBusinessData(snapshot)) {
      latestDecisionData = structuredClone(snapshot);
      latestDecisionDataAt = new Date().toISOString();
    } else {
      console.warn('[dashboard] 快照没有业务数据，暂不缓存；下次刷新会重试', (snapshot.warnings ?? []).slice(0, 3).join('；'));
    }
    console.log('[dashboard] snapshot', JSON.stringify({
      orders: snapshot.risks.length,
      kitting: snapshot.kittingRisks.length,
      quality: snapshot.qualityRisks.length,
      attention: snapshot.attentionRisks.length,
      available: snapshot.businessData?.available ?? false,
      warnings: (snapshot.warnings ?? []).slice(0, 3),
    }));
    return snapshot;
  })();
  try {
    return await decisionDataRefreshPromise;
  } finally {
    decisionDataRefreshPromise = null;
  }
}

async function decisionDataForRequest(force = false): Promise<DashboardSnapshot & { refreshedAt?: string }> {
  const snapshot = force || !latestDecisionData ? await refreshDecisionData() : structuredClone(latestDecisionData);
  return { ...snapshot, ...(latestDecisionDataAt ? { refreshedAt: latestDecisionDataAt } : {}) };
}

function dashboardEntityId(risk: DashboardSnapshot['attentionRisks'][number]): string {
  if (risk.source === 'quality') return risk.issueNo || risk.orderNo;
  return risk.source === 'kitting' && risk.demandLineNo ? `${risk.orderNo}:${risk.demandLineNo}` : risk.orderNo;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

function verificationStatus(status: string): HarborRuntimeVerificationStatus {
  if (status === 'healthy' || status === 'degraded' || status === 'unhealthy' || status === 'stopped' || status === 'starting') {
    return status;
  }
  return 'unverified';
}

function verificationHttpStatus(status: HarborRuntimeVerificationStatus): number {
  return status === 'healthy' || status === 'degraded' ? 200 : 503;
}

function parseRuntimeVerifyOptions(input: Record<string, unknown>): {
  startIfStopped?: boolean;
  timeoutMs?: number;
  probeMethod?: string;
  probeParams?: unknown;
} {
  const allowed = new Set(['startIfStopped', 'timeoutMs', 'probeMethod', 'probeParams']);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`verify 参数不支持: ${key}`);
  }
  let startIfStopped: boolean | undefined;
  if (input.startIfStopped !== undefined) {
    if (typeof input.startIfStopped !== 'boolean') throw new Error('startIfStopped 必须是布尔值');
    startIfStopped = input.startIfStopped;
  }
  let timeoutMs: number | undefined;
  if (input.timeoutMs !== undefined) {
    if (typeof input.timeoutMs !== 'number' || !Number.isFinite(input.timeoutMs) || input.timeoutMs < 0 || input.timeoutMs > 120_000) {
      throw new Error('timeoutMs 必须是 0 到 120000 之间的有限数值');
    }
    timeoutMs = input.timeoutMs;
  }
  let probeMethod: string | undefined;
  if (input.probeMethod !== undefined) {
    if (typeof input.probeMethod !== 'string' || !input.probeMethod.trim() || input.probeMethod.length > 120) {
      throw new Error('probeMethod 必须是非空字符串且不超过 120 个字符');
    }
    probeMethod = input.probeMethod.trim();
  }
  return { startIfStopped, timeoutMs, probeMethod, ...(input.probeParams !== undefined ? { probeParams: input.probeParams } : {}) };
}

async function readOptionalJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentLength = Number(req.headers['content-length'] ?? 0);
  const contentType = String(req.headers['content-type'] ?? '').trim();
  if (!contentLength && !contentType) return {};
  return readJsonBody(req);
}

async function verifyHarborRuntime(
  runtimeId: string,
  options: ReturnType<typeof parseRuntimeVerifyOptions>,
): Promise<{ runtime: ReturnType<typeof loadHarbor>['runtimes'][number]; health: Record<string, unknown>; statusCode: number }> {
  const snapshot = loadHarbor();
  const harborRuntime = snapshot.runtimes.find((runtime) => runtime.id === runtimeId);
  if (!harborRuntime) throw new HarborStoreNotFoundError(`Runtime 不存在: ${runtimeId}`);

  const checkedAt = new Date().toISOString();
  let health: Record<string, unknown>;
  if (!runtimeSupervisor.has(runtimeId)) {
    health = {
      runtimeInstanceId: runtimeId,
      status: 'unverified',
      checkedAt,
      message: 'Runtime 已登记，但当前进程没有对应的 Runtime Adapter；未执行网络探测',
      details: { adapterRegistered: false, runtimeKind: harborRuntime.kind },
    };
  } else {
    try {
      const result = await runtimeSupervisor.verifyHealth(runtimeId, {
        ...options,
        // 点击“验证”应主动尝试唤起本机 Runtime；调用方仍可显式传 false。
        startIfStopped: options.startIfStopped ?? true,
      });
      health = { ...result, status: verificationStatus(result.status) };
    } catch (error) {
      health = {
        runtimeInstanceId: runtimeId,
        status: 'unhealthy',
        checkedAt,
        message: (error as Error).message,
        code: errorCode(error),
      };
    }
  }

  const persisted = recordHarborRuntimeVerification(runtimeId, {
    status: verificationStatus(String(health.status ?? 'unverified')),
    checkedAt: typeof health.checkedAt === 'string' ? health.checkedAt : checkedAt,
    message: typeof health.message === 'string' ? health.message : 'Runtime 验证已完成',
    code: typeof health.code === 'string' ? health.code : null,
  });
  appendEvidence({
    kind: 'runtime_verification',
    summary: `${runtimeId}: ${String(health.status)}`,
    payload: { runtimeId, health, persistedStatus: persisted.status },
  });
  return { runtime: persisted, health, statusCode: verificationHttpStatus(verificationStatus(String(health.status))) };
}

async function readRawRequestBody(req: IncomingMessage, maxBytes = 256 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      total += chunk.length;
      if (total > maxBytes) {
        failed = true;
        reject(new Error('请求体不能超过大小上限'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('error', (error) => { if (!failed) reject(error); });
  });
}

async function readJsonBody(req: IncomingMessage, maxBytes = 256 * 1024): Promise<Record<string, unknown>> {
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.includes('application/json')) throw new Error('请求 Content-Type 必须为 application/json');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) {
        failed = true;
        reject(new Error(`请求体不能超过 ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        const value = raw ? JSON.parse(raw) : {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON 请求体必须是对象');
        resolve(value as Record<string, unknown>);
      } catch (error) {
        reject(new Error(`无效 JSON：${(error as Error).message}`));
      }
    });
    req.on('error', reject);
  });
}

function verifyPersonLifecycleSignature(req: IncomingMessage, raw: Buffer): boolean {
  const keyId = String(req.headers['x-aeos-key-id'] ?? '');
  const timestamp = String(req.headers['x-aeos-timestamp'] ?? '');
  const supplied = String(req.headers['x-aeos-signature'] ?? '').replace(/^sha256=/, '');
  const expectedKeyId = process.env.AEOS_PERSON_LIFECYCLE_KEY_ID || 'm01-kernel';
  const secret = process.env.AEOS_PERSON_LIFECYCLE_SECRET || process.env.AEOS_HUB_PERSON_LIFECYCLE_SECRET || '';
  const timestampMs = Number(timestamp);
  if (!keyId || keyId !== expectedKeyId || !timestamp || !Number.isInteger(timestampMs) || !supplied || !secret) return false;
  const maxSkew = Number(process.env.AEOS_PERSON_LIFECYCLE_MAX_SKEW_SECONDS || 300) * 1000;
  if (Math.abs(Date.now() - timestampMs) > maxSkew) return false;
  const expected = createHmac('sha256', secret).update(timestamp).update('.').update(raw).digest('hex');
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const runtimeImageRoots = [join(dataDir, 'artifacts'), join(codexHome, 'generated_images')];

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('content-security-policy', "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:");
  if (url.pathname.startsWith('/api/')) res.setHeader('cache-control', 'no-store');
  if (url.pathname === '/healthz' && req.method === 'GET') {
    sendJson(res, evidenceHealth() ? 503 : 200, { status: evidenceHealth() ? 'degraded' : 'ok' }); return;
  }
  if (!validOrigin(req.headers.origin, req.headers.host)) { sendJson(res, 403, { error: 'origin denied' }); return; }
  if (url.pathname === '/internal/aeos/person-lifecycle') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const raw = await readRawRequestBody(req);
      if (!verifyPersonLifecycleSignature(req, raw)) { sendJson(res, 401, { error: '人员同步签名无效' }); return; }
      const parsed = JSON.parse(raw.toString('utf8')) as import('./person-lifecycle.ts').PersonLifecycleEvent;
      const result = applyHubPersonLifecycle(parsed);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/auth/login') {
    if (AUTH_MODE === 'm01') {
      const outcome = await authGateway.login(req.method, req.headers.cookie, url.searchParams.get('retry') === '1');
      for (const cookie of outcome.cookies ?? []) addCookie(res, cookie);
      if (outcome.location) { res.writeHead(outcome.status, { location: outcome.location }); res.end(); }
      else sendJson(res, outcome.status, { error: outcome.error });
      return;
    }
    const policy = authRoutePolicy(AUTH_MODE, url.pathname)!;
    if (req.method !== policy.method) { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const input = await readJsonBody(req, 4 * 1024);
      const account = typeof input.account === 'string' ? input.account.trim() : '';
      const password = typeof input.password === 'string' ? input.password : '';
      if (!account || !password || account.length > 128 || password.length > 1024) {
        sendJson(res, 401, { error: '账号或密码错误' }); return;
      }
      const sessionId = webAuth.loginReplacing(req.headers.cookie, account, password);
      if (!sessionId) { sendJson(res, 401, { error: '账号或密码错误' }); return; }
      addCookie(res, webAuth.sessionCookie(sessionId));
      sendJson(res, 200, { ok: true });
    } catch {
      sendJson(res, 400, { error: 'invalid login request' });
    }
    return;
  }
  if (url.pathname === '/api/auth/callback') {
    const outcome = await authGateway.callback(req.method, req.headers.cookie, url.searchParams.get('code') ?? '', url.searchParams.get('state') ?? '');
    for (const cookie of outcome.cookies ?? []) addCookie(res, cookie);
    if (outcome.location) { res.writeHead(outcome.status, { location: outcome.location }); res.end(); }
    else sendJson(res, outcome.status, { error: outcome.error });
    return;
  }
  if (url.pathname === '/api/auth/session') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    sendJson(res, 200, authGateway.session(req.headers.cookie));
    return;
  }
  // ---------- 系统自助增删本系统 Agent 控制面（token 鉴权，绕过 cookie 网关） ----------
  if (url.pathname.startsWith('/api/system/agents')) {
    try {
      let body: Record<string, unknown> = {};
      let bodyParseFailed = false;
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        try { body = await readJsonBody(req); } catch { bodyParseFailed = true; }
      }
      const headerValue = (name: string): string => {
        const value = req.headers[name];
        return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
      };
      const outcome = await agentControlApi.handle({
        method: req.method,
        pathname: url.pathname,
        systemId: decodeSystemIdHeader(headerValue('x-aeos-system-id')),
        token: headerValue('x-aeos-system-token'),
        body,
        bodyParseFailed,
      });
      if (!outcome) { sendJson(res, 404, { error: 'agent-control endpoint not found' }); }
      else sendJson(res, outcome.status, outcome.body);
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  // ---------- M13 Agent Workforce 会话接口（X-API-Key / Bearer 鉴权，供 M05 等外部系统调用） ----------
  if (url.pathname.startsWith(M13_AGENT_CHAT_PATH_PREFIX)) {
    try {
      let body: Record<string, unknown> = {};
      let bodyParseFailed = false;
      if (req.method === 'POST') {
        try { body = await readJsonBody(req, 64 * 1024); } catch { bodyParseFailed = true; }
      }
      const headerValue = (name: string): string => {
        const value = req.headers[name];
        return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
      };
      const outcome = await m13AgentChatApi.handle({
        method: req.method,
        pathname: url.pathname,
        authorization: headerValue('authorization'),
        apiKey: headerValue('x-api-key'),
        body,
        bodyParseFailed,
        query: url.searchParams,
      });
      if (!outcome) { sendJson(res, 404, { error: 'm13 agent endpoint not found' }); }
      else sendJson(res, outcome.status, outcome.body);
    } catch (error) {
      sendJson(res, 500, { code: 500, message: 'M13 内部错误', extra: { detail: (error as Error).message } });
    }
    return;
  }
  // ---------- M13 Agent 自助申请（提交/查询开放；台账列表需密钥） ----------
  if (url.pathname.startsWith(M13_AGENT_APPLICATION_PATH_PREFIX)) {
    try {
      let body: Record<string, unknown> = {};
      let bodyParseFailed = false;
      if (req.method === 'POST' || req.method === 'PATCH') {
        try { body = await readJsonBody(req, 64 * 1024); } catch { bodyParseFailed = true; }
      }
      const headerValue = (name: string): string => {
        const value = req.headers[name];
        return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
      };
      const outcome = await m13AgentApplicationApi.handle({
        method: req.method,
        pathname: url.pathname,
        authorization: headerValue('authorization'),
        apiKey: headerValue('x-api-key'),
        idempotencyKey: headerValue('idempotency-key'),
        body,
        bodyParseFailed,
        clientAddress: req.socket.remoteAddress ?? '',
      });
      if (!outcome) { sendJson(res, 404, { error: 'm13 application endpoint not found' }); }
      else sendJson(res, outcome.status, outcome.body);
    } catch (error) {
      sendJson(res, 500, { code: 500, message: 'M13 内部错误', extra: { detail: (error as Error).message } });
    }
    return;
  }
  // ---------- 跨系统借调（系统 token 鉴权，绕过 cookie 网关） ----------
  if (url.pathname.startsWith('/api/system/borrow-orders')) {
    try {
      let body: Record<string, unknown> = {};
      let bodyParseFailed = false;
      if (req.method === 'POST') {
        try { body = await readJsonBody(req, 128 * 1024); } catch { bodyParseFailed = true; }
      }
      const headerValue = (name: string): string => {
        const value = req.headers[name];
        return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
      };
      const outcome = borrowOrderApi.handle({
        method: req.method,
        pathname: url.pathname,
        systemId: decodeSystemIdHeader(headerValue('x-aeos-system-id')),
        token: headerValue('x-aeos-system-token'),
        body,
        bodyParseFailed,
        query: url.searchParams,
      });
      if (!outcome) sendJson(res, 404, { error: 'borrow-order endpoint not found' });
      else sendJson(res, outcome.status, outcome.body);
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  // ---------- 能力模板自动派单（系统 token 鉴权，绕过 cookie 网关） ----------
  if (url.pathname.startsWith('/api/system/capability-invocations')) {
    try {
      let body: Record<string, unknown> = {};
      let bodyParseFailed = false;
      if (req.method === 'POST') {
        try { body = await readJsonBody(req, 128 * 1024); } catch { bodyParseFailed = true; }
      }
      const headerValue = (name: string): string => {
        const value = req.headers[name];
        return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
      };
      const outcome = capabilityInvocationApi.handle({
        method: req.method,
        pathname: url.pathname,
        systemId: decodeSystemIdHeader(headerValue('x-aeos-system-id')),
        token: headerValue('x-aeos-system-token'),
        body,
        bodyParseFailed,
      });
      if (!outcome) sendJson(res, 404, { error: 'capability-invocation endpoint not found' });
      else sendJson(res, outcome.status, outcome.body);
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  // ---------- 跨系统任务交接（系统 token 鉴权，绕过 cookie 网关） ----------
  if (url.pathname.startsWith('/api/system/orchestration-tasks')) {
    try {
      let body: Record<string, unknown> = {};
      let bodyParseFailed = false;
      if (req.method === 'POST') {
        try { body = await readJsonBody(req, 128 * 1024); } catch { bodyParseFailed = true; }
      }
      const headerValue = (name: string): string => {
        const value = req.headers[name];
        return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
      };
      const outcome = orchestrationTaskApi.handle({
        method: req.method,
        pathname: url.pathname,
        systemId: decodeSystemIdHeader(headerValue('x-aeos-system-id')),
        token: headerValue('x-aeos-system-token'),
        body,
        bodyParseFailed,
        query: url.searchParams,
      });
      if (!outcome) sendJson(res, 404, { error: 'orchestration-task endpoint not found' });
      else sendJson(res, outcome.status, outcome.body);
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  // ---------- 中台助手观测上报（系统 token 鉴权，绕过 cookie 网关） ----------
  if (url.pathname.startsWith('/api/system/assistant-events')) {
    try {
      let body: Record<string, unknown> = {};
      let bodyParseFailed = false;
      if (req.method === 'POST') {
        try { body = await readJsonBody(req, 128 * 1024); } catch { bodyParseFailed = true; }
      }
      const headerValue = (name: string): string => {
        const value = req.headers[name];
        return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
      };
      const outcome = assistantEventApi.handle({
        method: req.method,
        pathname: url.pathname,
        systemId: decodeSystemIdHeader(headerValue('x-aeos-system-id')),
        token: headerValue('x-aeos-system-token'),
        body,
        bodyParseFailed,
        query: url.searchParams,
      });
      if (!outcome) sendJson(res, 404, { error: 'assistant-event endpoint not found' });
      else sendJson(res, outcome.status, outcome.body);
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  // ---------- 写操作请求（系统 token：可提交/查询；审批只能由 Hub 用户完成） ----------
  if (url.pathname.startsWith('/api/system/write-requests')) {
    try {
      const headerValue = (name: string): string => {
        const value = req.headers[name];
        return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
      };
      const systemId = decodeSystemIdHeader(headerValue('x-aeos-system-id'));
      const token = headerValue('x-aeos-system-token');
      if (!systemId || !token || !verifySystemToken(EXECUTION_PLANE_TOKEN, systemId, token)) {
        sendJson(res, 401, { error: 'authentication required' });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/system/write-requests') {
        const body = await readJsonBody(req, 128 * 1024).catch(() => null);
        if (!isRecord(body)) { sendJson(res, 400, { error: 'invalid write request body' }); return; }
        const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
        if (!requestId) { sendJson(res, 400, { error: 'requestId 必填' }); return; }
        let caller = null;
        if (body.caller !== undefined) {
          try {
            caller = parseCallerContext(body.caller);
          } catch (error) {
            sendJson(res, 400, { error: `caller 无效：${(error as Error).message}` });
            return;
          }
          if (caller && caller.systemId !== systemId) {
            sendJson(res, 400, { error: 'caller.systemId 必须等于发起系统' });
            return;
          }
        }
        const outcome = writeRequestService.create({
          tenantId: resolveTenantId(systemId, listSystems()) ?? DEFAULT_TENANT_ID,
          capability: typeof body.capability === 'string' ? body.capability : '',
          systemId: typeof body.toSystem === 'string' ? body.toSystem : null,
          input: body.input,
          reason: typeof body.reason === 'string' ? body.reason : '',
          requestedBy: { kind: 'system', id: systemId },
          caller,
          idempotencyKey: requestId,
        });
        sendJson(res, outcome.idempotent ? 200 : 201, outcome);
        return;
      }
      const detailMatch = url.pathname.match(/^\/api\/system\/write-requests\/([^/]+)$/);
      if (detailMatch && req.method === 'GET') {
        const id = decodeURIComponent(detailMatch[1] ?? '').trim();
        const record = writeRequestStore.get(id);
        if (!record) { sendJson(res, 404, { error: 'write request not found' }); return; }
        const requesterSystem = record.requestedBy.kind === 'system' ? record.requestedBy.id : null;
        if (requesterSystem !== systemId && record.systemId !== systemId) {
          sendJson(res, 403, { error: 'write request not visible to this system' });
          return;
        }
        sendJson(res, 200, { request: record });
        return;
      }
      sendJson(res, 404, { error: 'write request endpoint not found' });
    } catch (error) {
      if (error instanceof WriteRequestError) {
        sendJson(res, error.status, { error: error.message, code: error.code, ...(error.details ?? {}) });
      } else {
        sendJson(res, 400, { error: (error as Error).message });
      }
    }
    return;
  }
  // ---------- 统一链路查询（系统 token，只读，限参与方） ----------
  const systemTraceMatch = url.pathname.match(/^\/api\/system\/trace\/([^/]+)$/);
  if (systemTraceMatch) {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const headerValue = (name: string): string => {
      const value = req.headers[name];
      return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
    };
    const systemId = decodeSystemIdHeader(headerValue('x-aeos-system-id'));
    const token = headerValue('x-aeos-system-token');
    if (!systemId || !token || !verifySystemToken(EXECUTION_PLANE_TOKEN, systemId, token)) {
      sendJson(res, 401, { error: 'authentication required' });
      return;
    }
    const traceId = decodeURIComponent(systemTraceMatch[1] ?? '').trim();
    if (!traceId || traceId.length > 200) { sendJson(res, 400, { error: 'traceId 无效' }); return; }
    const agents = executionPlane.list().agents;
    const systemOfAgent = (agentId: string): string | null => {
      const agent = agents.find((item) => item.agentId === agentId);
      return agent ? agent.systemId ?? agent.sourceSystem : null;
    };
    const trace = buildTrace(traceId, {
      borrowOrderById: (orderId) => borrowOrderStore.get(orderId),
      borrowOrders: () => borrowOrderStore.load().orders,
      runById: (runId) => executionPlane.getRun(runId),
      allRuns: () => executionPlane.list().runs,
      usageEvents: () => listUsageEvents(5_000),
      evidenceEntries: () => readEvidenceEntries(),
    });
    const participated = trace.borrowOrder?.fromSystem === systemId
      || trace.borrowOrder?.providerSystem === systemId
      || trace.runs.some((run) => systemOfAgent(run.agentId) === systemId)
      || trace.usage.some((event) => event.systemId === systemId || event.consumerSystemId === systemId);
    if (!participated) { sendJson(res, 403, { error: 'trace not visible to this system' }); return; }
    sendJson(res, 200, trace);
    return;
  }
  // ---------- 执行 run 召回（系统 token，只读试点内的取消链路） ----------
  const systemRecallMatch = url.pathname.match(/^\/api\/system\/execution\/runs\/([^/]+)\/recall$/);
  if (systemRecallMatch) {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const headerValue = (name: string): string => {
      const value = req.headers[name];
      return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
    };
    const systemId = decodeSystemIdHeader(headerValue('x-aeos-system-id'));
    const token = headerValue('x-aeos-system-token');
    if (!systemId || !token || !verifySystemToken(EXECUTION_PLANE_TOKEN, systemId, token)) {
      sendJson(res, 401, { error: 'authentication required' });
      return;
    }
    const runId = decodeURIComponent(systemRecallMatch[1] ?? '').trim();
    if (!runId) { sendJson(res, 400, { error: 'runId 无效' }); return; }
    const run = executionPlane.getRun(runId);
    if (!run) { sendJson(res, 404, { error: 'run not found' }); return; }
    const agent = executionPlane.list().agents.find((item) => item.agentId === run.agentId);
    const agentSystem = agent ? agent.systemId ?? agent.sourceSystem : null;
    if (!agent || agentSystem !== systemId) {
      sendJson(res, 403, { error: 'run not visible to this system' });
      return;
    }
    if (run.state === 'completed' || run.state === 'failed' || run.state === 'recalled') {
      sendJson(res, 409, { error: `run 已结束：${run.state}`, state: run.state });
      return;
    }
    if (agent.currentRunId !== runId) {
      sendJson(res, 409, { error: 'run 已不是当前执行任务', currentRunId: agent.currentRunId });
      return;
    }
    const result = executionPlane.recall(run.agentId);
    try {
      appendEvidence({
        kind: 'app_event',
        actor_id: `execution-token:system:${systemId}`,
        actor_type: 'system',
        object_ref: `hub://execution-run/${encodeURIComponent(runId)}`,
        source_system: systemId,
        correlation_id: 'execution-run-recalled',
        summary: 'execution run recalled',
        payload: { runId, agentId: run.agentId, recalled: result.recalled },
      });
    } catch {
      // 审计失败不改变召回结果。
    }
    sendJson(res, 200, { runId, recalled: result.recalled, state: executionPlane.getRun(runId)?.state ?? null });
    return;
  }
  const publicAsset = isPublicLoginResource(url.pathname, req.method);
  if (!authGateway.canAccess(url.pathname, req.method, req.headers.cookie)) {
    sendJson(res, 401, { error: 'authentication required' });
    return;
  }
  if (url.pathname === '/api/auth/logout') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const outcome = await authGateway.logout(req.headers.cookie);
    for (const cookie of outcome.cookies) addCookie(res, cookie);
    // In M01 mode the browser must still end the IdP session, so the Hub hands the
    // client the RP-initiated logout URL instead of following a cross-origin redirect.
    sendJson(res, 200, { ok: true, ...(outcome.redirectTo ? { redirectTo: outcome.redirectTo } : {}) });
    return;
  }
  const requestActorContext = publicAsset ? null : authGateway.actorFromCookie(req.headers.cookie);
  const requestActor = publicAsset ? 'anonymous' : requestActorContext!.actorId;
  const actorTenant = requestActorContext?.tenantId?.trim();
  const requestTenantId = !actorTenant || actorTenant === 'local-dev' ? DEFAULT_TENANT_ID : actorTenant;
  // ---------- 写操作审批（浏览器会话；创建与审批仅 manager / supervisor） ----------
  if (url.pathname.startsWith('/api/write-requests')) {
    try {
      const roles = requestActorContext?.roles ?? [];
      const canWrite = roles.includes('manager') || roles.includes('supervisor');
      const actor = { id: requestActor, roles, tenantId: requestTenantId };
      if (url.pathname === '/api/write-requests/capabilities' && req.method === 'GET') {
        sendJson(res, 200, { capabilities: writeRequestService.listCapabilities(requestTenantId) });
        return;
      }
      if (url.pathname === '/api/write-requests') {
        if (req.method === 'GET') {
          const status = url.searchParams.get('status');
          const limit = Number(url.searchParams.get('limit') || 100);
          sendJson(res, 200, {
            requests: writeRequestService.list({
              tenantId: requestTenantId,
              status: status === 'pending_approval' || status === 'rejected' || status === 'dispatched'
                || status === 'completed' || status === 'failed' || status === 'cancelled' ? status : null,
              limit: Number.isFinite(limit) ? limit : 100,
            }),
          });
          return;
        }
        if (req.method === 'POST') {
          if (!canWrite) { sendJson(res, 403, { error: '只有 manager / supervisor 可以提交写操作' }); return; }
          const body = await readJsonBody(req, 128 * 1024).catch(() => null);
          if (!isRecord(body)) { sendJson(res, 400, { error: 'invalid write request body' }); return; }
          const outcome = writeRequestService.create({
            tenantId: requestTenantId,
            capability: typeof body.capability === 'string' ? body.capability : '',
            systemId: typeof body.systemId === 'string' ? body.systemId : null,
            input: body.input,
            reason: typeof body.reason === 'string' ? body.reason : '',
            requestedBy: { kind: 'user', id: requestActor },
            idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null,
          });
          sendJson(res, outcome.idempotent ? 200 : 201, outcome);
          return;
        }
      }
      const match = url.pathname.match(/^\/api\/write-requests\/([^/]+)(?:\/(approve|reject))?$/);
      if (match) {
        const id = decodeURIComponent(match[1] ?? '').trim();
        if (!match[2] && req.method === 'GET') {
          sendJson(res, 200, { request: writeRequestService.get(id, requestTenantId) });
          return;
        }
        if (match[2] && req.method === 'POST') {
          if (!canWrite) { sendJson(res, 403, { error: '只有 manager / supervisor 可以审批写操作' }); return; }
          const body = await readJsonBody(req, 16 * 1024).catch(() => null);
          const record = match[2] === 'approve'
            ? writeRequestService.approve(id, actor, isRecord(body) && typeof body.note === 'string' ? body.note : null)
            : writeRequestService.reject(id, actor, isRecord(body) && typeof body.reason === 'string' ? body.reason : null);
          syncConversationWriteState(record);
          sendJson(res, 200, { request: record });
          return;
        }
      }
      sendJson(res, 404, { error: 'write request endpoint not found' });
    } catch (error) {
      if (error instanceof WriteRequestError) {
        sendJson(res, error.status, { error: error.message, code: error.code, ...(error.details ?? {}) });
      } else {
        sendJson(res, 400, { error: (error as Error).message });
      }
    }
    return;
  }
  if (url.pathname === '/api/connectivity') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const agents = executionPlane.list().agents.filter((agent) => (
      resolveTenantId(agent.systemId ?? agent.sourceSystem, listSystems()) === requestTenantId
    ));
    sendJson(res, 200, buildConnectivitySummary(agents));
    return;
  }
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname).replace(/^[/\\]+/, '');
  } catch {
    res.writeHead(400); res.end('bad request'); return;
  }
  if (url.pathname === '/api/governance/g0-decisions') {
    try {
      let body: Record<string, unknown> = {};
      let bodyParseFailed = false;
      if (req.method === 'PUT') {
        try { body = await readJsonBody(req); }
        catch { bodyParseFailed = true; }
      }
      const g0Response = g0DecisionApi.handle({
        method: req.method,
        pathname: url.pathname,
        actor: requestActorContext,
        body,
        bodyParseFailed,
      });
      if (!g0Response) { sendJson(res, 404, { error: 'governance endpoint not found' }); }
      else sendJson(res, g0Response.status, g0Response.body);
    } catch (error) { sendJson(res, 400, { error: (error as Error).message }); }
    return;
  }
  if (url.pathname.startsWith('/api/system/personnel/')) {
    try {
      let body: Record<string, unknown> = {};
      let bodyParseFailed = false;
      if (req.method !== 'GET') {
        try { body = await readJsonBody(req); }
        catch { bodyParseFailed = true; }
      }
      const personnelResponse = await personnelApi.handle({
        method: req.method,
        pathname: url.pathname,
        actor: requestActorContext ? {
          actorId: requestActorContext.actorId,
          actorType: requestActorContext.actorType,
          tenantId: requestActorContext.tenantId,
          organizationId: requestActorContext.organizationId,
          roles: requestActorContext.roles,
        } : null,
        body,
        bodyParseFailed,
        search: url.searchParams.get('search') ?? undefined,
      });
      if (!personnelResponse) { sendJson(res, 404, { error: 'personnel endpoint not found' }); }
      else sendJson(res, personnelResponse.status, personnelResponse.body);
    } catch (error) { sendJson(res, 400, { error: (error as Error).message }); }
    return;
  }
  if (url.pathname.startsWith('/api/system/access-control/')) {
    try {
      let body: Record<string, unknown> = {};
      let bodyParseFailed = false;
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        try { body = await readJsonBody(req); }
        catch { bodyParseFailed = true; }
      }
      const response = await accessControlApi.handle({
        method: req.method,
        pathname: url.pathname,
        actor: requestActorContext ? {
          actorId: requestActorContext.actorId,
          actorType: requestActorContext.actorType,
          tenantId: requestActorContext.tenantId,
          organizationId: requestActorContext.organizationId,
          roles: requestActorContext.roles,
        } : null,
        body,
        bodyParseFailed,
      });
      if (!response) sendJson(res, 404, { error: 'access-control endpoint not found' });
      else sendJson(res, response.status, response.body);
    } catch (error) { sendJson(res, 400, { error: (error as Error).message }); }
    return;
  }
  const catalogResponse = catalogApi.handle({ method: req.method, pathname: url.pathname, tenantId: requestTenantId });
  if (catalogResponse) { sendJson(res, catalogResponse.status, catalogResponse.body); return; }
  if (url.pathname === '/api/harbor') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const snapshot = loadHarbor();
      const systemIds = new Set(listSystems().filter((system) => system.tenantId === requestTenantId).map((system) => system.systemId));
      const agents = snapshot.agents.filter((agent) => systemIds.has(agent.systemId));
      const agentIds = new Set(agents.map((agent) => agent.id));
      const projects = snapshot.projects.filter((project) => project.agentIds.some((id) => agentIds.has(id))
        || (project.leadType === 'agent' && agentIds.has(project.leadId)));
      sendJson(res, 200, {
        ...snapshot,
        agents,
        projects,
        runs: snapshot.runs.filter((run) => agentIds.has(run.agentId)),
      });
    } catch (error) {
      sendJson(res, 500, { error: (error as Error).message });
    }
    return;
  }

  const m01AgentRegisterMatch = url.pathname.match(/^\/api\/harbor\/agents\/([^/]+)\/m01\/register$/);
  if (m01AgentRegisterMatch) {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const id = decodeURIComponent(m01AgentRegisterMatch[1] ?? '').trim();
      const agent = loadHarbor().agents.find((item) => item.id === id);
      if (!agent) throw new HarborStoreNotFoundError(`Agent 不存在: ${id}`);
      const result = await registerHarborAgentToM01(agent);
      const status = result.registration.state === 'active' ? 200 : 503;
      sendJson(res, status, result);
    } catch (error) {
      const status = error instanceof HarborStoreNotFoundError ? 404 : 400;
      sendJson(res, status, { error: (error as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/models') {
    if (req.method === 'GET') {
      try { sendJson(res, 200, loadModelRegistry()); } catch (error) { sendJson(res, 500, { error: (error as Error).message }); }
      return;
    }
    if (req.method === 'POST') {
      try {
        const item = createModel(await readJsonBody(req));
        appendEvidence({ kind: 'app_event', summary: 'model registered', payload: { id: item.id, provider: item.provider, model: item.model } });
        sendJson(res, 201, { item });
      } catch (error) {
        sendJson(res, 400, { error: (error as Error).message });
      }
      return;
    }
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  const modelMatch = url.pathname.match(/^\/api\/models\/([^/]+)$/);
  if (modelMatch) {
    let modelId = '';
    try { modelId = decodeURIComponent(modelMatch[1] ?? '').trim(); } catch { modelId = ''; }
    if (!modelId) { sendJson(res, 400, { error: '模型 id 无效' }); return; }
    try {
      if (req.method === 'PATCH') {
        const item = updateModel(modelId, await readJsonBody(req));
        appendEvidence({ kind: 'app_event', summary: 'model updated', payload: { id: item.id, provider: item.provider, model: item.model } });
        sendJson(res, 200, { item });
        return;
      }
      if (req.method === 'DELETE') {
        const item = deleteModel(modelId);
        appendEvidence({ kind: 'app_event', summary: 'model removed', payload: { id: item.id, provider: item.provider, model: item.model } });
        sendJson(res, 200, { item });
        return;
      }
      sendJson(res, 405, { error: 'method not allowed' });
    } catch (error) {
      const status = error instanceof ModelRegistryNotFoundError ? 404 : error instanceof ModelRegistryError ? 400 : 500;
      sendJson(res, status, { error: (error as Error).message, code: errorCode(error) });
    }
    return;
  }
  if (url.pathname === '/api/usage/summary') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const summary = usageStore.summary({
        from: url.searchParams.get('from') ?? undefined,
        to: url.searchParams.get('to') ?? undefined,
        agentId: url.searchParams.get('agentId') ?? undefined,
        recentLimit: url.searchParams.get('recentLimit') ? Number(url.searchParams.get('recentLimit')) : undefined,
      });
    } catch (error) {
      sendJson(res, 500, { error: (error as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/agent-squad') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      sendJson(res, 200, loadAgentSquad());
    } catch (error) {
      sendJson(res, 500, { error: (error as Error).message });
    }
    return;
  }
  const squadMemberDeleteMatch = url.pathname.match(/^\/api\/agent-squad\/members\/([^/]+)$/);
  if (squadMemberDeleteMatch) {
    if (req.method !== 'DELETE') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const agentId = decodeURIComponent(squadMemberDeleteMatch[1] ?? '').trim();
      if (!agentId) throw new Error('小队成员标识无效');
      const item = deleteAgentSquadMember({ agentId });
      sendJson(res, 200, { item, squad: loadAgentSquad() });
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  const squadCreators: Record<string, (input: Record<string, unknown>) => unknown> = {
    '/api/agent-squad/activities': addAgentSquadActivity,
    '/api/agent-squad/memories': addAgentSquadMemory,
    '/api/agent-squad/messages': sendAgentSquadMessage,
  };
  if (url.pathname.startsWith('/api/agent-squad/')) {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const input = await readJsonBody(req);
      const harbor = loadHarbor();
      const resolveHarborAgent = (value: unknown) => {
        if (typeof value !== 'string' || !value.trim()) throw new Error('请选择 AI 港湾 Agent');
        const agent = harbor.agents.find((item) => item.id === value.trim());
        if (!agent) throw new Error('关联的 AI 港湾 Agent 不存在');
        return agent;
      };
      let item: unknown;
      if (url.pathname === '/api/agent-squad/members') {
        const agent = resolveHarborAgent(input.harborAgentId);
        const current = loadAgentSquad();
        if (current.lead.harborAgentId === agent.id || current.lead.id === agent.id) throw new Error('主 Agent 不能重复加入为子 Agent');
        item = createAgentSquadMember({ harborAgentId: agent.id, name: agent.name, role: agent.role, model: agent.model });
      } else if (url.pathname === '/api/agent-squad/member-links') {
        const agent = resolveHarborAgent(input.harborAgentId);
        const current = loadAgentSquad();
        if (current.lead.harborAgentId === agent.id || current.lead.id === agent.id) throw new Error('主 Agent 不能重复作为子 Agent');
        item = bindAgentSquadMember({ agentId: input.agentId, harborAgentId: agent.id, name: agent.name, role: agent.role, model: agent.model });
      } else if (url.pathname === '/api/agent-squad/project-link') {
        const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
        if (!projectId) {
          item = setAgentSquadProject({ projectId: null });
        } else {
          const project = harbor.projects.find((candidate) => candidate.id === projectId);
          if (!project) throw new Error('关联的 AI 港湾项目不存在');
          item = setAgentSquadProject({
            projectId: project.id,
            ...(project.leadType === 'agent' ? { leadHarborAgentId: project.leadId } : {}),
          });
        }
      } else {
        const creator = squadCreators[url.pathname];
        if (!creator) { sendJson(res, 404, { error: 'agent squad endpoint not found' }); return; }
        item = creator(input);
      }
      sendJson(res, 201, { item, squad: loadAgentSquad() });
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/operating-center') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const snapshot = operatingCenter.load();
      sendJson(res, 200, { ...snapshot, unreadInboxCount: snapshot.inbox.filter((item) => item.state === 'unread').length });
    } catch (error) { sendJson(res, 500, { error: (error as Error).message }); }
    return;
  }
  if (/^\/api\/tasks\/[^/]+\/agent-runs$/.test(url.pathname)) {
    try {
      const body = req.method === 'GET' ? {} : await readJsonBody(req);
      const taskResponse = await taskApi.handleAgentRun({
        method: req.method,
        pathname: url.pathname,
        actor: requestActorContext ? {
          actorId: requestActorContext.actorId,
          actorType: requestActorContext.actorType,
          tenantId: requestActorContext.tenantId,
          organizationId: requestActorContext.organizationId,
          roles: requestActorContext.roles,
        } : null,
        body,
      });
      if (!taskResponse) { sendJson(res, 404, { error: 'task endpoint not found' }); }
      else sendJson(res, taskResponse.status, taskResponse.body);
    } catch (error) { sendJson(res, 400, { error: (error as Error).message }); }
    return;
  }
  if (url.pathname === '/api/tasks' || url.pathname.startsWith('/api/tasks/') || url.pathname === '/api/projects' || url.pathname.startsWith('/api/projects/') || /^\/api\/operating-cases\/[^/]+\/tasks$/.test(url.pathname)) {
    try {
      const body = req.method === 'GET' ? {} : await readJsonBody(req);
      const taskResponse = taskApi.handle({
        method: req.method,
        pathname: url.pathname,
        actor: requestActorContext ? {
          actorId: requestActorContext.actorId,
          actorType: requestActorContext.actorType,
          tenantId: requestActorContext.tenantId,
          organizationId: requestActorContext.organizationId,
          roles: requestActorContext.roles,
        } : null,
        body,
      });
      if (!taskResponse) { sendJson(res, 404, { error: 'task endpoint not found' }); }
      else sendJson(res, taskResponse.status, taskResponse.body);
    } catch (error) { sendJson(res, 400, { error: (error as Error).message }); }
    return;
  }
  if (url.pathname === '/api/operating-cases/from-dashboard') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const input = await readJsonBody(req);
      const source = typeof input.source === 'string' ? input.source : '';
      const entityId = typeof input.entityId === 'string' ? input.entityId : '';
      const evidenceRef = typeof input.evidenceRef === 'string' ? input.evidenceRef : '';
      if (!['order', 'kitting', 'quality', 'production'].includes(source) || !entityId || !evidenceRef) throw new Error('事项来源、对象和 evidence_ref 均为必填');
      const dashboard = await loadDashboardSnapshot();
      const risk = dashboard.attentionRisks.find((item) => item.source === source && dashboardEntityId(item) === entityId && item.evidenceRef === evidenceRef);
      if (!risk) throw new Error('未找到与当前中控数据一致的风险事项；请刷新看板后重试');
      const result = operatingCenter.upsertDashboardRisks([risk], 'dashboard', 1);
      appendEvidence({ kind: 'app_event', summary: 'operating case created from dashboard', payload: { source, entityId, evidenceRef, created: result.created.map((item) => item.id) } });
      sendJson(res, 201, { ...result, snapshot: operatingCenter.load() });
    } catch (error) { sendJson(res, 400, { error: (error as Error).message }); }
    return;
  }
  const caseDecisionMatch = url.pathname.match(/^\/api\/operating-cases\/([^/]+)\/decisions$/);
  if (caseDecisionMatch) {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const decision = operatingCenter.addDecision({ ...await readJsonBody(req), actor: requestActor, caseId: decodeURIComponent(caseDecisionMatch[1] ?? '') });
      appendEvidence({ kind: 'app_event', summary: 'operating case decision recorded', payload: decision });
      sendJson(res, 201, { decision, snapshot: operatingCenter.load() });
    } catch (error) { sendJson(res, 400, { error: (error as Error).message }); }
    return;
  }
  const caseMatch = url.pathname.match(/^\/api\/operating-cases\/([^/]+)$/);
  if (caseMatch) {
    if (req.method !== 'PATCH') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const item = operatingCenter.updateCase({ ...await readJsonBody(req), id: decodeURIComponent(caseMatch[1] ?? '') });
      appendEvidence({ kind: 'app_event', summary: 'operating case updated', payload: { id: item.id, status: item.status, ownerRole: item.ownerRole, dueAt: item.dueAt } });
      sendJson(res, 200, { item, snapshot: operatingCenter.load() });
    } catch (error) { sendJson(res, 400, { error: (error as Error).message }); }
    return;
  }
  const inboxMatch = url.pathname.match(/^\/api\/inbox\/([^/]+)$/);
  if (inboxMatch) {
    if (req.method !== 'PATCH') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const item = operatingCenter.updateInbox({ ...await readJsonBody(req), id: decodeURIComponent(inboxMatch[1] ?? '') });
      sendJson(res, 200, { item, snapshot: operatingCenter.load() });
    } catch (error) { sendJson(res, 400, { error: (error as Error).message }); }
    return;
  }
  if (url.pathname === '/api/inbox') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const snapshot = operatingCenter.load();
      sendJson(res, 200, { items: snapshot.inbox.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), unreadCount: snapshot.inbox.filter((item) => item.state === 'unread').length });
    } catch (error) { sendJson(res, 500, { error: (error as Error).message }); }
    return;
  }
  if (url.pathname === '/api/capability-registry') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const registeredServers = readConfig().mcpServers;
    let businessData: DashboardSnapshot['businessData'] | undefined;
    let riskAssessment: DashboardSnapshot['riskAssessment'] | undefined;
    try {
      const dashboard = await loadDashboardSnapshot();
      businessData = dashboard.businessData;
      riskAssessment = dashboard.riskAssessment;
    } catch (error) {
      businessData = {
        source: registeredServers.includes('company-control') ? 'company-control' : 'demo-erp',
        available: false,
        confidence: 'unknown',
        message: (error as Error).message,
      };
      riskAssessment = { available: false, message: '经营数据读取失败，无法评估订单风险' };
    }
    try {
      const runtimeInventory = await codexRuntime.listMcpServerStatus();
      sendJson(res, 200, { ...buildCapabilityRegistry(registeredServers, runtimeInventory), businessData, riskAssessment });
    } catch (error) {
      sendJson(res, 200, { ...buildCapabilityRegistry(registeredServers, null, (error as Error).message), businessData, riskAssessment });
    }
    return;
  }
  if (url.pathname === '/api/dashboard') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      sendJson(res, 200, await decisionDataForRequest(url.searchParams.get('refresh') === '1'));
    } catch (error) {
      sendJson(res, 503, { error: (error as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/briefing/daily') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const entry = await loadDailyBriefing(url.searchParams.get('refresh') === '1');
      sendJson(res, 200, {
        brief: entry.brief,
        markdown: entry.markdown,
        cachedAt: new Date(entry.at).toISOString(),
      });
    } catch (error) {
      sendJson(res, 503, { error: (error as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/briefing/daily/dispatch') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const roles = requestActorContext?.roles ?? [];
    if (!requestActorContext || (!roles.includes('manager') && !roles.includes('supervisor'))) {
      sendJson(res, 403, { error: '只有管理者可以把简报分发给 Agent' });
      return;
    }
    try {
      const policy = loadConclusionDispatchPolicy();
      if (!policy.enabled) {
        sendJson(res, 409, { error: '结论分发未启用：请在系统配置中开启自动分发后再发送' });
        return;
      }
      const entry = await loadDailyBriefing();
      if (!entry.brief.top.length) {
        sendJson(res, 409, { error: `今日（${entry.windowEnd}）没有红色齐套风险，无需分发` });
        return;
      }
      const caller = { systemId: 'aeos-hub', agentId: null, userId: requestActorContext.actorId, taskId: null, traceId: null };
      // 执行面推理能力只分析具体对象，且会先按锚点去中台取证据：
      // 因此按订单逐条派发，锚点用真实的 business://order/<订单号>。
      const orderNos = selectBriefingDispatchOrders(entry.brief, 3);
      if (!orderNos.length) {
        sendJson(res, 409, { error: `今日（${entry.windowEnd}）没有可派发的订单` });
        return;
      }
      const report = await conclusionDispatcher.dispatch(
        orderNos.map((orderNo) => ({
          domain: 'kitting' as const,
          businessObjectRef: `business://order/${orderNo}`,
          orderNo,
          title: `今日风险简报 ${entry.windowEnd} · 订单 ${orderNo}`,
          prompt: formatBriefingOrderPrompt(entry.brief, orderNo),
        })),
        { caller, force: true, traceId: `briefing-${entry.windowEnd}`, policy: { ...policy, maxItemsPerAnalysis: orderNos.length } },
      );
      const markdown = formatConclusionDispatchReport(report);
      sendJson(res, 200, {
        dispatchId: report.dispatchId,
        status: report.status,
        counts: report.counts,
        orders: orderNos,
        items: report.items.map((item) => ({
          domain: item.domain,
          businessObjectRef: item.businessObjectRef,
          status: item.status,
          reason: item.reason ?? null,
          systemId: item.systemId ?? null,
          agentId: item.agentId ?? null,
          runId: item.runId ?? null,
          summary: item.summary ?? null,
        })),
        markdown,
        message: markdown || (report.status === 'disabled'
          ? '结论分发未启用'
          : report.items.map((item) => `${item.reason ?? item.status}${item.error?.message ? `：${item.error.message}` : ''}`).join('；') || '本次分发未产生可展示结论'),
      });
    } catch (error) {
      sendJson(res, 503, { error: (error as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/attention/search') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const input = AttentionSearchRequestSchema.parse(await readJsonBody(req));
      // 该接口由用户显式点击“核查中台”（或按 Enter）调用。快照加载通过既有
      // McpAccessGateway 的只读路径完成；不会写入业务系统或 Evidence。
      const snapshot = await loadDashboardSnapshot(true);
      sendJson(res, 200, { query: input.query, source: input.source, live: searchLiveDashboard(input, snapshot) });
    } catch (error) {
      const status = error instanceof ZodError ? 400 : 503;
      sendJson(res, status, { error: (error as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/daily-questions/generate') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    let input: Record<string, unknown>;
    try {
      input = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
      return;
    }
    try {
      const { dateKey, role } = parseDailyQuestionGenerationInput(input);
      const result = await ensureDailyQuestionsGenerated(dateKey, role);
      sendJson(res, 200, result);
    } catch (error) {
      const status = error instanceof ZodError || /^(生成参数|dateKey|只能生成当天|role)/.test((error as Error).message) ? 400 : 503;
      sendJson(res, status, { error: (error as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/daily-questions') {
    if (req.method === 'GET') {
      try {
        sendJson(res, 200, loadDailyQuestionConfig());
      } catch (error) {
        sendJson(res, 500, { error: (error as Error).message });
      }
      return;
    }
    if (req.method === 'PUT') {
      let input: Record<string, unknown>;
      try {
        input = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, { error: (error as Error).message });
        return;
      }
      try {
        const saved = saveDailyQuestionConfig(input);
        sendJson(res, 200, saved);
      } catch (error) {
        const status = error instanceof DailyQuestionConflictError ? 409 : error instanceof ZodError ? 400 : 500;
        sendJson(res, status, { error: (error as Error).message });
      }
      return;
    }
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  const runtimeVerifyMatch = url.pathname.match(/^\/api\/harbor\/runtimes\/([^/]+)\/verify$/);
  if (runtimeVerifyMatch) {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const runtimeId = decodeURIComponent(runtimeVerifyMatch[1]).trim();
      if (!runtimeId || runtimeId.length > 160) throw new Error('Runtime id 无效');
      const options = parseRuntimeVerifyOptions(await readOptionalJsonBody(req));
      const result = await verifyHarborRuntime(runtimeId, options);
      sendJson(res, result.statusCode, { runtime: result.runtime, health: result.health });
    } catch (error) {
      const status = error instanceof HarborStoreNotFoundError ? 404 : 400;
      sendJson(res, status, { error: (error as Error).message, code: errorCode(error) });
    }
    return;
  }
  const harborLifecycleMatch = url.pathname.match(/^\/api\/harbor\/agents\/([^/]+)\/lifecycle$/);
  if (harborLifecycleMatch) {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const agentId = decodeURIComponent(harborLifecycleMatch[1] ?? '').trim();
      if (!agentId) throw new Error('Agent id 无效');
      const input = await readJsonBody(req);
      const item = transitionHarborAgentLifecycle({ agentId, to: input.to, reason: input.reason, actor: typeof input.actor === 'string' && input.actor.trim() ? input.actor.trim() : 'local-operator' });
      sendJson(res, 200, { item });
    } catch (error) {
      const status = error instanceof HarborStoreNotFoundError ? 404 : 400;
      sendJson(res, status, { error: (error as Error).message });
    }
    return;
  }
  const harborAgentDeleteMatch = url.pathname.match(/^\/api\/harbor\/agents\/([^/]+)$/);
  if (harborAgentDeleteMatch) {
    if (req.method !== 'DELETE') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const id = decodeURIComponent(harborAgentDeleteMatch[1] ?? '').trim();
      if (!id) throw new Error('Agent id 无效');
      const squad = loadAgentSquad();
      if (squad.lead.harborAgentId === id) throw new Error('该 Agent 是当前主 Agent，请先更换主 Agent 关联');
      if (squad.members.some((member) => member.harborAgentId === id)) throw new Error('该 Agent 仍在协作成员中，请先将其移出');
      const item = deleteHarborAgent({ id });
      sendJson(res, 200, { item });
    } catch (error) {
      const status = error instanceof HarborStoreNotFoundError ? 404 : 400;
      sendJson(res, status, { error: (error as Error).message });
    }
    return;
  }
  const harborCreators: Record<string, (input: Record<string, unknown>) => unknown> = {
    '/api/harbor/agents': createHarborAgent,
    '/api/harbor/runtimes': createHarborRuntime,
    '/api/harbor/projects': createHarborProject,
  };
  if (url.pathname.startsWith('/api/harbor/')) {
    const creator = harborCreators[url.pathname];
    if (!creator) { sendJson(res, 404, { error: 'harbor endpoint not found' }); return; }
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const input = await readJsonBody(req);
      let item = creator(input);
      let registration: M01AgentRegistrationResult | undefined;
      if (url.pathname === '/api/harbor/agents') {
        const synced = await registerHarborAgentToM01(item as HarborAgent);
        item = synced.item;
        registration = synced.registration;
      }
      sendJson(res, 201, registration ? { item, registration } : { item });
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  // ---------- 执行面接入 HTTP API（仪表盘读取 + 派单/召回 + LLM 意图解析） ----------
  if (url.pathname === '/api/execution/highest-risk-order') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const input = await readJsonBody(req, 8 * 1024);
      const result = await executionOrchestrator.highestRiskOrder({
        reasoningAgentId: typeof input.reasoningAgentId === 'string' ? input.reasoningAgentId : '',
        text: typeof input.text === 'string' ? input.text : '',
      });
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof ExecutionOrchestrationError) {
        sendJson(res, error.status, {
          error: error.message,
          code: error.code,
          requestId: error.requestId,
          queryRunId: error.queryRunId,
          reasoningRunId: error.reasoningRunId,
        });
      } else {
        sendJson(res, 500, { error: (error as Error).message || '编排失败' });
      }
    }
    return;
  }
  const executionParseIntentMatch = url.pathname.match(/^\/api\/execution\/parse-intent$/);
  if (executionParseIntentMatch) {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const input = await readJsonBody(req, 8 * 1024);
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (!text || text.length > 2000) { sendJson(res, 400, { error: 'text 必填且不超过 2000 字符' }); return; }
      const agentId = typeof input.agentId === 'string' ? input.agentId.trim() : '';
      const agent = agentId ? executionPlane.list().agents.find((item) => item.agentId === agentId) : undefined;
      const intent = agent?.capabilities.find((cap) => cap.intent)?.intent;
      // LLM 优先路径，按 Agent 注册的查询语义（intent）动态解析；失败返回 { error }，由前端回退。
      // 模型选择统一走选型器（意图解析是轻任务 → light 档，deepseek-flash + effort=low）。
      const route = routeModel({ difficulty: 'light' });
      const routedProfile = route.satisfied ? route.profile : null;
      const routedModel = route.executable && routedProfile ? routedProfile.modelName : undefined;
      sendJson(res, 200, await parseIntentWithLLM(text, {
        intent,
        model: routedModel,
        effort: routedProfile?.effort,
        // 用量回调：把中枢自身这次 DeepSeek 调用的 Token/成本记账（systemId 对齐中枢注册码 aeos-hub）。
        onUsage: (usage) => {
          const cost = routedProfile
            ? estimateUsageCostCny(routedProfile, {
              inputTokens: usage.tokensIn,
              cachedInputTokens: usage.cachedTokens,
              outputTokens: usage.tokensOut,
            }, new Date(usage.endedAt))
            : 0;
          recordUsageEvent({
            agentId: 'agent-aeos-hub',
            systemId: 'aeos-hub',
            modelId: routedProfile?.id ?? usage.model,
            runId: null,
            tokensIn: usage.tokensIn,
            cachedTokens: usage.cachedTokens,
            tokensOut: usage.tokensOut,
            cost,
            metering: 'direct',
            startedAt: usage.startedAt,
            endedAt: usage.endedAt,
          });
        },
      }));
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  const executionAgentsMatch = url.pathname.match(/^\/api\/execution\/agents$/);
  if (executionAgentsMatch) {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const snapshot = executionPlane.list();
    const agents = snapshot.agents.filter((agent) => resolveTenantId(agent.systemId ?? agent.sourceSystem, listSystems()) === requestTenantId);
    const agentIds = new Set(agents.map((agent) => agent.agentId));
    sendJson(res, 200, { agents, runs: snapshot.runs.filter((run) => agentIds.has(run.agentId)) });
    return;
  }
  if (url.pathname === '/api/execution/capability-templates') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const agentId = url.searchParams.get('agentId')?.trim();
    const templates = capabilityInvocationService.listTemplates().filter((template) => {
      if (template.providerAgentId && agentId && template.providerAgentId !== agentId) return false;
      return resolveTenantId(template.providerSystem, listSystems()) === requestTenantId;
    });
    sendJson(res, 200, { templates });
    return;
  }
  if (url.pathname === '/api/execution/capability-invocations') {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const body = await readJsonBody(req, 128 * 1024);
      const result = capabilityInvocationService.invoke({
        fromSystem: 'aeos-hub',
        body: {
          ...body,
          fromAgentId: typeof body.fromAgentId === 'string' && body.fromAgentId.trim()
            ? body.fromAgentId
            : 'hub-execution-dashboard',
        },
      });
      const terminal = result.order.status === 'completed' || result.order.status === 'failed';
      sendJson(res, result.idempotent || terminal ? 200 : 202, {
        invocation: {
          capability: result.capability,
          templateVersion: result.templateVersion,
          borrowOrderId: result.order.orderId,
          runId: result.order.runId,
          status: result.order.status,
        },
        order: result.order,
        idempotent: result.idempotent,
      });
    } catch (error) {
      if (error instanceof CapabilityInvocationError) {
        sendJson(res, error.httpStatus, { error: error.message, code: error.code, ...(error.details ?? {}) });
      } else if (error instanceof BorrowOrderServiceError) {
        sendJson(res, error.httpStatus, { error: error.message, code: error.code, ...(error.details ?? {}) });
      } else if (error instanceof CapabilityQueryTemplateError) {
        sendJson(res, error.code === 'INVALID_ARGUMENT' ? 400 : 500, { error: error.message, code: error.code });
      } else {
        sendJson(res, 400, { error: (error as Error).message });
      }
    }
    return;
  }
  const executionRunEventsMatch = url.pathname.match(/^\/api\/execution\/runs\/([^/]+)\/events$/);
  if (executionRunEventsMatch) {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const runId = decodeURIComponent(executionRunEventsMatch[1] ?? '').trim();
    const run = runId ? executionPlane.getRun(runId) : undefined;
    const runAgent = run ? executionPlane.list().agents.find((agent) => agent.agentId === run.agentId) : undefined;
    if (!runId || !run || !runAgent || resolveTenantId(runAgent.systemId ?? runAgent.sourceSystem, listSystems()) !== requestTenantId) {
      sendJson(res, 404, { error: 'run not found' });
      return;
    }
    try {
      const limit = boundedLimit(url.searchParams.get('limit'));
      sendJson(res, 200, {
        runId,
        count: executionEventStore.countByRun(runId, requestTenantId),
        events: executionEventStore.listByRun(runId, limit, requestTenantId),
      });
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  // ---------- 中台助手观测只读 API（登录用户） ----------
  if (url.pathname === '/api/assistant-events') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const systemId = url.searchParams.get('system')?.trim() || undefined;
    const traceId = url.searchParams.get('traceId')?.trim() || undefined;
    const limit = boundedLimit(url.searchParams.get('limit'));
    sendJson(res, 200, {
      events: assistantEventStore.listEvents({ systemId, traceId, tenantId: requestTenantId, limit }),
      traces: assistantEventStore.listTraces({ systemId, tenantId: requestTenantId, limit }),
      count: assistantEventStore.countEvents({ systemId, traceId, tenantId: requestTenantId }),
    });
    return;
  }
  const executionDispatchMatch = url.pathname.match(/^\/api\/execution\/agents\/([^/]+)\/dispatch$/);
  if (executionDispatchMatch) {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const agentId = decodeURIComponent(executionDispatchMatch[1] ?? '').trim();
      if (!agentId) throw new ExecutionPlaneError('INVALID_ARGUMENT', 'agentId 无效');
      const input = await readJsonBody(req);
      const capability = typeof input.capability === 'string' ? input.capability.trim() : '';
      if (!capability) throw new ExecutionPlaneError('INVALID_ARGUMENT', 'capability 不能为空');
      sendJson(res, 200, executionPlane.dispatch(agentId, capability, input.input, {
        caller: {
          systemId: 'aeos-hub',
          agentId: null,
          userId: requestActorContext?.actorId ?? null,
          taskId: null,
          traceId: null,
        },
      }));
    } catch (error) {
      const status = error instanceof ExecutionPlaneError && error.code === 'AGENT_NOT_FOUND' ? 404 : 400;
      sendJson(res, status, { error: (error as Error).message, ...(error instanceof ExecutionPlaneError ? { code: error.code } : {}) });
    }
    return;
  }
  const executionRecallMatch = url.pathname.match(/^\/api\/execution\/agents\/([^/]+)\/recall$/);
  if (executionRecallMatch) {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const agentId = decodeURIComponent(executionRecallMatch[1] ?? '').trim();
      if (!agentId) throw new ExecutionPlaneError('INVALID_ARGUMENT', 'agentId 无效');
      const result = executionPlane.recall(agentId);
      if (result.recalled) {
        try {
          appendEvidence({
            kind: 'app_event',
            actor_id: requestActorContext?.actorId ? `human:${requestActorContext.actorId}` : 'execution-ui',
            actor_type: requestActorContext ? 'human' : 'system',
            object_ref: `hub://execution-run/${encodeURIComponent(result.runId ?? agentId)}`,
            source_system: 'aeos-hub',
            correlation_id: 'execution-run-recalled',
            summary: 'execution run recalled from UI',
            payload: {
              runId: result.runId,
              agentId,
              actor: requestActorContext?.actorId ?? null,
            },
          });
        } catch {
          // 审计失败不改变召回结果。
        }
      }
      sendJson(res, 200, result);
    } catch (error) {
      const status = error instanceof ExecutionPlaneError && error.code === 'AGENT_NOT_FOUND' ? 404 : 400;
      sendJson(res, status, { error: (error as Error).message });
    }
    return;
  }
  // ---------- 用量台账只读 API（按 Agent/系统聚合 + 明细） ----------
  // ---------- 运行监控只读 API（manager / supervisor） ----------
  if (url.pathname === '/api/ops/status') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const roles = requestActorContext?.roles ?? [];
    if (!roles.includes('manager') && !roles.includes('supervisor')) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }
    const limit = boundedLimit(url.searchParams.get('limit'));
    sendJson(res, 200, {
      snapshot: opsMonitor.snapshot(),
      alerts: alertCenter.list(limit),
      alertCounts: alertCenter.counts(),
      channels: { log: true, wecom: alertCenter.channelEnabled('wecom') },
    });
    return;
  }
  // ---------- 跨系统借调只读监控（登录用户，只读） ----------
  if (url.pathname === '/api/borrow-orders') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const statusRaw = url.searchParams.get('status');
      let status: BorrowOrderStatus | undefined;
      if (statusRaw) {
        if (!(BORROW_ORDER_STATUSES as readonly string[]).includes(statusRaw)) {
          sendJson(res, 400, { error: `status 无效：${statusRaw}` });
          return;
        }
        status = statusRaw as BorrowOrderStatus;
      }
      const limit = boundedLimit(url.searchParams.get('limit'));
      const orders = borrowOrderService ? borrowOrderService.listAll({ status, tenantId: requestTenantId, limit }) : [];
      const all = borrowOrderStore.load().orders.filter((order) => order.tenantId === requestTenantId);
      const byStatus: Record<string, number> = {};
      for (const item of all) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
      const systems = new Set<string>();
      for (const item of all) {
        systems.add(item.fromSystem);
        if (item.providerSystem) systems.add(item.providerSystem);
      }
      sendJson(res, 200, {
        orders: orders.map(borrowOrderSummary),
        counts: {
          total: all.length,
          active: (byStatus.pending ?? 0) + (byStatus.dispatched ?? 0) + (byStatus.running ?? 0),
          completed: byStatus.completed ?? 0,
          failed: byStatus.failed ?? 0,
          cancelled: byStatus.cancelled ?? 0,
          byStatus,
          systems: systems.size,
        },
      });
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
    return;
  }
  const borrowDetailMatch = url.pathname.match(/^\/api\/borrow-orders\/([^/]+)$/);
  if (borrowDetailMatch) {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const orderId = decodeURIComponent(borrowDetailMatch[1] ?? '').trim();
    const order = orderId ? borrowOrderStore.get(orderId) : null;
    if (!order) { sendJson(res, 404, { error: 'borrow order not found' }); return; }
    sendJson(res, 200, { order });
    return;
  }
  // ---------- 统一链路查询（登录用户，只读） ----------
  const traceMatch = url.pathname.match(/^\/api\/trace\/([^/]+)$/);
  if (traceMatch) {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    const traceId = decodeURIComponent(traceMatch[1] ?? '').trim();
    if (!traceId || traceId.length > 200) { sendJson(res, 400, { error: 'traceId 无效' }); return; }
    const trace = buildTrace(traceId, {
      borrowOrderById: (orderId) => {
        const order = borrowOrderStore.get(orderId);
        return order && order.tenantId === requestTenantId ? order : null;
      },
      borrowOrders: () => borrowOrderStore.load().orders.filter((order) => order.tenantId === requestTenantId),
      runById: (runId) => executionPlane.getRun(runId),
      allRuns: () => executionPlane.list().runs,
      usageEvents: () => listUsageEvents(5_000, requestTenantId),
      evidenceEntries: () => readEvidenceEntries().filter((entry) => entry.tenant_id === requestTenantId),
    });
    const tenantAgents = new Set(executionPlane.list().agents
      .filter((agent) => resolveTenantId(agent.systemId ?? agent.sourceSystem, listSystems()) === requestTenantId)
      .map((agent) => agent.agentId));
    if (trace.runs.some((run) => !tenantAgents.has(run.agentId))) {
      sendJson(res, 404, { error: 'trace not found' });
      return;
    }
    sendJson(res, 200, trace);
    return;
  }
  if (url.pathname === '/api/usage/summary') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    sendJson(res, 200, {
      byAgent: aggregateUsageByAgent(requestTenantId),
      bySystem: aggregateUsageBySystem(requestTenantId),
      byConsumerSystem: aggregateUsageByConsumerSystem(requestTenantId),
      byCallerAgent: aggregateUsageByCallerAgent(requestTenantId),
      byCallerUser: aggregateUsageByCallerUser(requestTenantId),
    });
    return;
  }
  if (url.pathname === '/api/usage/events') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const limit = boundedLimit(url.searchParams.get('limit'));
      sendJson(res, 200, { events: listUsageEvents(limit, requestTenantId) });
    } catch (e) {
      sendJson(res, 400, { error: (e as Error).message });
    }
    return;
  }
  if (url.pathname === '/api/evidence') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    try {
      const limit = boundedLimit(url.searchParams.get('limit'));
      const actorId = url.searchParams.get('actor_id')?.trim();
      const requestedActorType = url.searchParams.get('actor_type')?.trim();
      if ((actorId !== undefined && (!actorId || actorId.length > 200))
        || (requestedActorType !== undefined && !['human', 'service', 'agent', 'system'].includes(requestedActorType))) {
        throw new Error('invalid actor filter');
      }
      sendJson(res, 200, await readRecentEvidence(limit, evidenceFile, {
        tenantId: requestTenantId,
        ...(actorId ? { actorId } : {}),
        ...(requestedActorType ? { actorType: requestedActorType as 'human' | 'service' | 'agent' | 'system' } : {}),
      }));
      return;
    } catch (e) {
      sendJson(res, 400, { error: (e as Error).message });
      return;
    }
  }
  if (url.pathname === '/api/runtime-image') {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return; }
    await serveRuntimeImage(url.searchParams.get('path')?.trim() ?? '', runtimeImageRoots, res);
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'api endpoint not found' });
    return;
  }
  let fp = normalize(join(publicDir, rel));
  if (!fp.startsWith(normalize(publicDir) + sep) && fp !== normalize(join(publicDir, 'index.html'))) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (!existsSync(fp) || statIsDir(fp)) fp = join(publicDir, 'index.html');
  try {
    // This is an operator console served from a mutable Docker image. Do not
    // let a browser keep an older app.js/style.css after the container updates.
    res.writeHead(200, {
      'content-type': MIME[extname(fp)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(readFileSync(fp));
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

function statIsDir(fp: string): boolean {
  try { return statSync(fp).isDirectory(); } catch { return false; }
}

// ---------- 执行面接入 WebSocket（服务凭证 + 反向连接） ----------
// ---------- 执行面接入 WebSocket（服务凭证 + 反向连接） ----------
// 独立 http server + 独立端口：`ws` 不支持同一 server 上挂多个不同 path 的 WebSocketServer
// （非匹配 path 的实例会 abortHandshake(400) 把已升级的连接打掉）。故执行面控制通道走独立端口。
const executionServer = createServer((_req, res) => {
  res.writeHead(404);
  res.end('execution plane control channel (WebSocket only)');
});

// P1：连接鉴权结果缓存到 IncomingMessage，供 verifyClient 与 connection 复用。
const executionPlaneAuthByRequest = new WeakMap<IncomingMessage, ExecutionPlaneConnectionAuth | null>();

function executionHeader(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return '';
  try { return decodeURIComponent(raw).trim(); } catch { return raw.trim(); }
}

function toRegisteredSystem(systemId: string): RegisteredSystem | null {
  const system = getSystem(systemId);
  return system ? { systemId: system.systemId, name: system.name, status: system.status } : null;
}

function authenticateExecutionPlane(req: IncomingMessage): ExecutionPlaneConnectionAuth | null {
  if (executionPlaneAuthByRequest.has(req)) return executionPlaneAuthByRequest.get(req) ?? null;
  const auth = resolveExecutionPlaneAuth({
    systemId: executionHeader(req.headers['x-aeos-system-id']),
    systemToken: executionHeader(req.headers['x-aeos-system-token']),
    legacyToken: executionHeader(req.headers['x-aeos-execution-token']),
  }, {
    rootSecret: EXECUTION_PLANE_TOKEN,
    verifySystemToken: (systemId, token) => verifySystemToken(EXECUTION_PLANE_TOKEN, systemId, token),
    getSystem: toRegisteredSystem,
    // 兼容期默认允许旧根令牌；设置 EXECUTION_LEGACY_ROOT_ENABLED=0 后只接受每系统令牌。
    allowLegacyRoot: process.env.EXECUTION_LEGACY_ROOT_ENABLED !== '0',
  });
  executionPlaneAuthByRequest.set(req, auth);
  return auth;
}

function executionRegistrationIdentity(
  auth: ExecutionPlaneConnectionAuth,
  reportedSource: unknown,
): ExecutionRegistrationIdentity {
  return resolveRegistrationIdentity(auth, reportedSource, {
    findBySourceSystem: (sourceSystem) => {
      const system = findSystemBySourceSystem(sourceSystem);
      return system ? { systemId: system.systemId, name: system.name, status: system.status } : null;
    },
  });
}
const executionWss = new WebSocketServer({
  server: executionServer,
  path: '/execution-agent',
  maxPayload: 1024 * 1024,
  verifyClient: (info: { req: IncomingMessage }) => Boolean(authenticateExecutionPlane(info.req)),
});
const executionWsAgent = new Map<WebSocket, string>(); // ws -> agentId（register 后建立）
executionWss.on('connection', (ws, request) => {
  const auth = executionPlaneAuthByRequest.get(request) ?? null;
  if (!auth) {
    ws.close(1008, 'Authentication required');
    return;
  }
  const peerAddress = request.socket.remoteAddress;
  ws.on('message', (raw) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(String(raw)); } catch { send(ws, { type: 'error', message: 'invalid json' }); return; }
    const type = msg.type as string;
    try {
      if (type === 'register') {
        let identity: ExecutionRegistrationIdentity;
        try {
          identity = executionRegistrationIdentity(auth, msg.sourceSystem);
        } catch (error) {
          if (error instanceof ExecutionIdentityError) {
            try {
              appendEvidence({
                kind: 'app_event',
                actor_id: auth.systemId ? `execution-token:system:${auth.systemId}` : 'execution-token:legacy-root',
                actor_type: 'system',
                object_ref: 'hub://execution-agent/registration',
                source_system: auth.systemId ?? 'legacy-root',
                correlation_id: 'execution-register-rejected',
                summary: 'execution agent registration rejected',
                payload: {
                  reason: error.code,
                  authMode: auth.mode,
                  authenticatedSystemId: auth.systemId,
                  reportedSource: typeof msg.sourceSystem === 'string' ? msg.sourceSystem.slice(0, 160) : null,
                },
              });
            } catch {
              // 审计失败不改变拒绝结果。
            }
            send(ws, { type: 'error', code: error.code, message: error.message });
            return;
          }
          throw error;
        }
        const requestedAgentId = typeof msg.agentId === 'string' ? msg.agentId.trim() : '';
        if (!isExecutionAgentAllowed(identity.systemId, requestedAgentId)) {
          try {
            appendEvidence({
              kind: 'app_event',
              actor_id: auth.systemId ? `execution-token:system:${auth.systemId}` : 'execution-token:legacy-root',
              actor_type: 'system',
              object_ref: 'hub://execution-agent/registration',
              source_system: auth.systemId ?? identity.sourceSystem,
              correlation_id: 'execution-register-rejected',
              summary: 'execution agent registration rejected',
              payload: {
                reason: 'AGENT_NOT_ALLOWED',
                authMode: auth.mode,
                authenticatedSystemId: auth.systemId,
                agentId: requestedAgentId.slice(0, 160),
                reportedSource: typeof msg.sourceSystem === 'string' ? msg.sourceSystem.slice(0, 160) : null,
              },
            });
          } catch {
            // 审计失败不改变拒绝结果。
          }
          send(ws, { type: 'error', code: 'AGENT_NOT_ALLOWED', message: '该执行面 Agent 未在允许列表中，禁止注册' });
          return;
        }
        // 注册时按授权表校验自报能力：enforce 下只登记已授权能力；全部未授权则拒绝注册。
        const declaredCapabilities = Array.isArray(msg.capabilities) ? msg.capabilities : [];
        let acceptedCapabilities = declaredCapabilities;
        if (identity.systemId && declaredCapabilities.length) {
          const declaredNames = declaredCapabilities
            .map((capability) => capability && typeof capability === 'object' ? (capability as Record<string, unknown>).name : null)
            .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()));
          const capabilityFilter = filterRegistrationCapabilities(loadExecutionAgentPermissions(), {
            systemId: identity.systemId,
            agentId: requestedAgentId,
            tenantId: resolveTenantId(identity.systemId, listSystems()),
            capabilities: declaredNames,
          });
          if (capabilityFilter.denied.length) {
            console.warn(`[execution-plane] 注册能力未授权：${requestedAgentId} -> ${capabilityFilter.denied.join(', ')}（${capabilityFilter.enforcement}）`);
          }
          if (capabilityFilter.enforcement === 'enforce') {
            if (!capabilityFilter.allowed.length) {
              try {
                appendEvidence({
                  kind: 'app_event',
                  actor_id: `execution-token:system:${identity.systemId}`,
                  actor_type: 'system',
                  object_ref: 'hub://execution-agent/registration',
                  source_system: identity.systemId,
                  correlation_id: 'execution-register-rejected',
                  summary: 'execution agent registration rejected',
                  payload: {
                    reason: 'CAPABILITY_FORBIDDEN',
                    agentId: requestedAgentId.slice(0, 160),
                    denied: capabilityFilter.denied,
                  },
                });
              } catch {
                // 审计失败不改变拒绝结果。
              }
              send(ws, { type: 'error', code: 'CAPABILITY_FORBIDDEN', message: '该 Agent 声明的能力均未获授权，禁止注册' });
              return;
            }
            acceptedCapabilities = declaredCapabilities.filter((capability) => {
              const name = capability && typeof capability === 'object' ? (capability as Record<string, unknown>).name : null;
              return typeof name === 'string' && capabilityFilter.allowed.includes(name);
            });
            if (capabilityFilter.denied.length) {
              try {
                appendEvidence({
                  kind: 'app_event',
                  actor_id: `execution-token:system:${identity.systemId}`,
                  actor_type: 'system',
                  object_ref: 'hub://execution-agent/registration',
                  source_system: identity.systemId,
                  correlation_id: 'execution-register-filtered',
                  summary: 'execution agent capabilities filtered by permission table',
                  payload: {
                    agentId: requestedAgentId.slice(0, 160),
                    allowed: capabilityFilter.allowed,
                    denied: capabilityFilter.denied,
                  },
                });
              } catch {
                // 审计失败不阻断注册。
              }
            }
          }
        }
        const reply = executionPlane.onRegister({
          agentId: msg.agentId,
          name: msg.name,
          version: msg.version,
          capabilities: acceptedCapabilities,
          sourceSystem: msg.sourceSystem,
          local: isLoopbackExecutionPeer(peerAddress),
          simulated: msg.simulated,
          kind: msg.kind,
          gatewayVersion: msg.gatewayVersion,
        },
          (m) => send(ws, m),
          identity,
        );
        const registered = executionPlane.list().agents.find((agent) => agent.agentId === reply.agentId);
        const gatewayEvidence = registered
          ? gatewayRegistrationEvidence(registered, {
            systemId: identity.systemId ?? registered.sourceSystem,
            authMode: identity.authMode,
          })
          : null;
        if (gatewayEvidence) {
          try {
            appendEvidence(gatewayEvidence);
          } catch {
            // 审计失败不阻断注册。
          }
        }
        executionWsAgent.set(ws, reply.agentId);
        send(ws, { type: 'registered', ...reply, authMode: identity.authMode });
        if (identity.authMode === 'legacy-root') {
          try {
            appendEvidence({
              kind: 'app_event',
              actor_id: 'execution-token:legacy-root',
              actor_type: 'system',
              object_ref: `hub://execution-agent/${reply.agentId}`,
              source_system: identity.systemId ?? identity.sourceSystem,
              correlation_id: 'execution-register-legacy',
              summary: 'legacy execution agent registered',
              payload: {
                agentId: reply.agentId,
                authMode: identity.authMode,
                reportedSource: typeof msg.sourceSystem === 'string' ? msg.sourceSystem.slice(0, 160) : null,
                resolvedSystemId: identity.systemId,
                unresolved: identity.legacyUnresolved,
              },
            });
          } catch {
            // 审计失败不影响注册。
          }
        }
      } else if (type === 'heartbeat') {
        const agentId = executionWsAgent.get(ws);
        if (agentId) executionPlane.onHeartbeat(agentId, { status: msg.status, currentRunId: msg.currentRunId });
      } else if (type === 'run_update') {
        const agentId = executionWsAgent.get(ws);
        if (agentId) {
          executionPlane.onRunUpdate(agentId, { runId: msg.runId, state: msg.state });
          if (msg.state === 'recalled' && typeof msg.runId === 'string' && msg.runId.trim()) {
            writeRequestService.onRunFinished(msg.runId.trim(), { state: 'failed', error: { code: 'RECALLED', message: '写操作已召回' } });
          }
        }
      } else if (type === 'run_complete') {
        const agentId = executionWsAgent.get(ws);
        if (agentId) {
          executionPlane.onRunComplete(agentId, { runId: msg.runId, result: msg.result, usage: msg.usage });
          if (typeof msg.runId === 'string' && msg.runId.trim()) {
            writeRequestService.onRunFinished(msg.runId.trim(), { state: 'completed', result: msg.result });
            const writeRecord = writeRequestStore.load().find((item) => item.runId === msg.runId);
            if (writeRecord) notifyWriteRecord(writeRecord);
          }
        }
      } else if (type === 'run_failed') {
        const agentId = executionWsAgent.get(ws);
        if (agentId) {
          executionPlane.onRunFailed(agentId, { runId: msg.runId, error: msg.error });
          if (typeof msg.runId === 'string' && msg.runId.trim()) {
            writeRequestService.onRunFinished(msg.runId.trim(), {
              state: 'failed',
              error: isRecord(msg.error) && typeof msg.error.code === 'string' && typeof msg.error.message === 'string'
                ? { code: msg.error.code, message: msg.error.message }
                : null,
            });
            const writeRecord = writeRequestStore.load().find((item) => item.runId === msg.runId);
            if (writeRecord) notifyWriteRecord(writeRecord);
          }
        }
      } else if (type === 'run_event') {
        // 执行步骤回执：校验归属、去重、限额后落库；失败只回 ack，不影响任务本身。
        const agentId = executionWsAgent.get(ws);
        if (!agentId) {
          send(ws, { type: 'run_event_ack', runId: msg.runId ?? null, eventId: msg.eventId ?? null, accepted: false, reason: 'AGENT_NOT_REGISTERED' });
          return;
        }
        const runId = typeof msg.runId === 'string' ? msg.runId.trim() : '';
        const run = runId ? executionPlane.getRun(runId) : undefined;
        const agentRecord = executionPlane.list().agents.find((agent) => agent.agentId === agentId);
        const outcome = executionEventStore.record(msg, {
          agentId,
          sourceSystem: agentRecord?.sourceSystem ?? 'unknown',
          runAgentId: run?.agentId ?? null,
        });
        send(ws, { type: 'run_event_ack', runId: msg.runId ?? null, eventId: msg.eventId ?? null, ...outcome });
      }
    } catch (error) {
      send(ws, { type: 'error', message: (error as Error).message });
    }
  });
  ws.on('close', () => {
    const agentId = executionWsAgent.get(ws);
    if (agentId) executionPlane.disconnect(agentId);
    executionWsAgent.delete(ws);
  });
});
executionServer.listen(EXECUTION_WS_PORT, LISTEN_HOST, () => {
  console.log(`  执行面控制通道: ws://${LISTEN_HOST === '0.0.0.0' ? 'localhost' : LISTEN_HOST}:${EXECUTION_WS_PORT}/execution-agent`);
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 1024 * 1024,
  verifyClient: (info: { req: IncomingMessage }) => {
    try {
      return validOrigin(info.req.headers.origin, info.req.headers.host) && authGateway.isAuthorized(info.req.headers.cookie);
    } catch {
      return false;
    }
  },
});
wss.on('connection', (ws, request) => {
  const sessionId = authGateway.sessionIdFromCookie(request.headers.cookie);
  const actorId = authGateway.actorIdFromCookie(request.headers.cookie);
  if (!sessionId || !actorId) {
    ws.close(1008, 'Authentication required');
    return;
  }
  allSockets.add(ws);
  viewOf.set(ws, null);
  actorOf.set(ws, actorId);
  const actorContext = authGateway.actorFromCookie(request.headers.cookie);
  if (actorContext) actorContextOf.set(ws, actorContext);
  sessionSockets.attach(sessionId, ws);
  send(ws, { type: 'hello', conversations: [...convCache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), modelOptions: buildModelOptions(), dataDir, evidenceFile });
  // 待确认写操作只推当前查看的会话（客户端收到 hello 后会立即发 view），避免把别的会话摘要发给每个连接。

  ws.on('message', async (raw) => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    const type = msg.type as string;
    try {
      if (type === 'view') {
        const convId = typeof msg.conversationId === 'string' ? msg.conversationId : '';
        viewOf.set(ws, convId || null);
        const conv = convId ? getConv(convId) : null;
        if (conv) send(ws, { type: 'conversation_transcript', convId, messages: await hydrateConversationTranscript(conv) });
        const pendingWrite = pendingWriteByConversation.get(convId);
        if (pendingWrite) send(ws, { type: 'write_pending', convId, requestId: pendingWrite.id, summary: pendingWrite.summary });
      }
      else if (type === 'new') {
        const requestedScope = msg.scope === 'agent' ? 'agent' : 'hub';
        const requestedAgentId = typeof msg.agentId === 'string' ? msg.agentId.trim() : '';
        const requestedSquadId = typeof msg.squadId === 'string' ? msg.squadId.trim() : '';
        if (requestedScope === 'agent' && (!requestedAgentId || requestedAgentId.length > 160 || requestedSquadId.length > 160)) {
          throw new Error('子 Agent 会话必须指定有效的 Agent 与小队归属');
        }
        const conv: Conversation = {
          id: randomUUID(), threadId: null, title: '新对话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), turnCount: 0,
          scope: requestedScope,
          ...(requestedScope === 'agent' ? { agentId: requestedAgentId, squadId: requestedSquadId } : {}),
        };
        convCache.set(conv.id, conv);
        upsertConversation(conv);
        broadcast({ type: 'conversations_updated', conversations: [...convCache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
        send(ws, { type: 'conversation_created', conversation: conv });
      } else if (type === 'chat') {
        const convId = String(msg.conversationId ?? '');
        const text = String(msg.text ?? '').trim();
        if (!text) { send(ws, { type: 'error', convId, message: '消息不能为空' }); return; }
        // A chat request implicitly subscribes its sender. This keeps direct
        // integrations and reconnecting clients observable even when they did
        // not send a separate view message first.
        viewOf.set(ws, convId || null);
        const blocked = conversationTurnBlockMessage(convId);
        if (blocked) { send(ws, { type: 'error', convId, message: blocked }); return; }
        let dispatch: AgentDispatchContext | undefined;
        if (typeof msg.agentId === 'string' && msg.agentId.trim()) {
          const task = isRecord(msg.dispatch) ? msg.dispatch : null;
          const orderNo = typeof task?.orderNo === 'string' ? task.orderNo.trim() : '';
          const evidenceRef = typeof task?.evidenceRef === 'string' ? task.evidenceRef.trim() : '';
          const taskType = task?.taskType === 'kitting' ? 'kitting' : task?.taskType === 'quality' ? 'quality' : task?.taskType === 'production' ? 'production' : 'order';
          if (!task || !orderNo || orderNo.length > 160 || !evidenceRef || evidenceRef.length > 500) {
            send(ws, { type: 'error', convId, message: '专业 Agent 派发参数无效' });
            return;
          }
          const evidenceSource = taskType === 'kitting' ? 'kitting' : taskType === 'quality' ? 'quality' : taskType === 'production' ? 'production' : 'order';
          const dashboard = await loadDashboardSnapshot(true);
          const matchedRisk = dashboard.attentionRisks.find((risk) => risk.source === evidenceSource
            && risk.evidenceRef === evidenceRef
            && (dashboardEntityId(risk) === orderNo || risk.orderNo === orderNo || risk.issueNo === orderNo));
          // Production rows are a dedicated read-only assessment and are not
          // included in attentionRisks. Validate their work-order key and
          // evidence against the same freshly loaded snapshot instead of
          // routing a specialist task through the central Agent.
          const productionRow = taskType === 'production'
            ? dashboard.productionAssessment.workOrders.find((row) => {
              const workOrderNo = typeof row.work_order_no === 'string' ? row.work_order_no : typeof row.work_order_id === 'string' ? row.work_order_id : '';
              const rowEvidence = typeof row.evidence_ref === 'string' ? row.evidence_ref : '';
              return workOrderNo === orderNo && (rowEvidence === evidenceRef || dashboard.productionAssessment.evidenceRefs.includes(evidenceRef));
            })
            : undefined;
          if (!matchedRisk && !productionRow) {
            send(ws, { type: 'error', convId, message: '专业 Agent 派发依据未通过当前中控风险校验，请刷新看板后重试' });
            return;
          }
          const agentId = msg.agentId.trim();
          const harborAgent = loadHarbor().agents.find((item) => item.id === agentId);
          const member = loadAgentSquad().members.find((item) => item.harborAgentId === agentId);
          const domainId = taskType === 'production' ? 'production' : taskType === 'quality' ? 'quality' : taskType === 'kitting' ? 'kitting' : 'order';
          const roleAllowed = taskType === 'order'
            ? /订单交付风险/.test(harborAgent?.role || '')
            : taskType === 'kitting'
              ? /物料齐套|缺料|供给/.test(harborAgent?.role || '')
              : taskType === 'production'
                ? /生产进度|生产关联|报工产能|生产证据/.test(harborAgent?.role || '')
                : /质量异常|质量追溯|质量证据|责任部门|质量协同/.test(harborAgent?.role || '');
          // 归属轴：服务业务域是派单的权威依据；小队外壳退役后不再依赖 squadId。
          const domainAllowed = Boolean(harborAgent?.domainIds?.includes(domainId));
          if (!harborAgent || !roleAllowed || !domainAllowed) {
            const message = taskType === 'kitting'
              ? '只能向服务域包含物料齐套的专业 Agent 派发该任务'
              : taskType === 'production'
                ? '只能向服务域包含生产协同的专业 Agent 派发该任务'
                : taskType === 'quality'
                ? '只能向服务域包含异常与质量的专业 Agent 派发该任务'
                : '只能向服务域包含订单交付的风险交付 Agent 派发该任务';
            send(ws, { type: 'error', convId, message });
            return;
          }
          dispatch = { agentId: member.id, harborAgentId: harborAgent.id, orderNo, evidenceRef, taskType };
          const dispatchedAgentId = member.id;
          // A specialist dispatch is never a central conversation. Persist its
          // ownership defensively even if an older client created it as hub.
          const dispatchedConversation = getConv(convId);
          if (dispatchedConversation && (dispatchedConversation.scope !== 'agent' || dispatchedConversation.agentId !== dispatchedAgentId)) {
            dispatchedConversation.scope = 'agent';
            dispatchedConversation.agentId = dispatchedAgentId;
            dispatchedConversation.squadId = undefined;
            touch(dispatchedConversation);
            broadcast({ type: 'conversations_updated', conversations: [...convCache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
          }
          const summary = taskType === 'kitting' ? 'material kitting task dispatched to specialist agent'
            : taskType === 'quality' ? 'quality issue task dispatched to specialist agent'
              : taskType === 'production' ? 'production coordination task dispatched to specialist agent'
              : 'order risk dispatched to risk delivery agent';
          appendEvidence({ kind: 'app_event', summary, payload: { orderNo, evidenceRef, taskType, harborAgentId: agentId, squadAgentId: dispatchedAgentId } });
        }
        const requestedChoice = (msg.choice ?? {}) as { provider?: string; model?: string };
        const existingConversation = getConv(convId);
        // A provider session is model-bound. Reconnects may briefly send the UI
        // default before the bound choice is restored, so an existing thread's
        // recorded choice is authoritative for every subsequent request.
        const choice = existingConversation?.threadId
          ? normChoice(existingConversation.lastChoice)
          : requestedChoice;
        appendConversationMessage(convId, { id: `user-${randomUUID()}`, role: 'user', text });
        pushConv(convId, { type: 'user_message', convId, text });
        const chatActor = actorContextOf.get(ws);
        if (chatActor) conversationActorId.set(convId, chatActor.actorId);
        if (await routeHubExecutionTurn(convId, text, chatActor)) return;
        await startTurn(convId, text, choice, dispatch);
      } else if (type === 'write_decision') {
        const convId = String(msg.conversationId ?? '').trim();
        const requestId = String(msg.requestId ?? '').trim();
        const actor = actorContextOf.get(ws);
        const pending = convId ? pendingWriteByConversation.get(convId) : undefined;
        const decision = msg.decision === 'reject' ? 'reject' : msg.decision === 'approve' ? 'approve' : null;
        if (!actor || !convId || !requestId || !pending || pending.id !== requestId || !decision) {
          send(ws, { type: 'error', convId: convId || null, message: '写操作确认已失效，请重新发起。' });
          return;
        }
        decidePendingWrite(convId, pending, actor, decision);
      } else if (type === 'interrupt') {
        const convId = String(msg.conversationId ?? '');
        const conv = getConv(convId);
        if (conv && (turnStartLocks.has(convId) || (conv.threadId && activeTurn.has(conv.threadId)))) {
          requestedInterruptConversations.add(convId);
          const { turnId } = conv.threadId ? activeTurn.get(conv.threadId) ?? { turnId: null } : { turnId: null };
          if (turnId) {
            try { await runtimeSupervisor.interruptRun(CODEX_RUNTIME_ID, turnId); } catch { /* 已结束 */ }
          }
          pushConv(convId, { type: 'info', convId, text: '已发送停止请求' });
        }
      } else if (type === 'decision') {
        const reqId = String(msg.reqId ?? '');
        const outcome = msg.decision === 'accept' ? 'approved' : 'denied';
        const p = pendingGuard.get(reqId);
        if (p) { clearTimeout(p.timer); pendingGuard.delete(reqId); }
        const request = pendingApprovals.get(reqId);
        pendingApprovals.delete(reqId);
        if (request) {
          const expectedConvId = request.sessionId ? convByThread.get(request.sessionId) ?? null : null;
          if (!expectedConvId || viewOf.get(ws) !== expectedConvId) throw new Error('当前会话无权处理这条审批请求');
          await resolveRuntimeApproval(request, outcome, 'workspace-manager', actorOf.get(ws) || 'system:guard');
        }
      } else if (type === 'conversation:archive') {
        const convId = String(msg.conversationId ?? '');
        const conv = getConv(convId);
        if (!conv) throw new Error('会话不存在');
        if (conv.threadId && activeTurn.has(conv.threadId)) throw new Error('会话正在执行，请先停止再归档');
        const archived = msg.archived === true;
        conv.archived = archived || undefined;
        touch(conv);
        appendEvidence({ kind: 'app_event', summary: archived ? 'conversation archived' : 'conversation unarchived', thread_id: conv.threadId ?? undefined, payload: { conversationId: convId, archived } });
        // 同步归档 codex 线程（best-effort：协议失败不阻断本地状态，记录证据即可）
        if (conv.threadId) {
          try {
            if (archived) await runtimeSupervisor.closeSession(CODEX_RUNTIME_ID, conv.threadId);
            else await runtimeSupervisor.resumeSession(CODEX_RUNTIME_ID, conv.threadId, { workingDirectory: root });
          } catch (error) {
            appendEvidence({ kind: 'app_event', summary: `thread ${archived ? 'archive' : 'unarchive'} rpc failed`, thread_id: conv.threadId, payload: { message: (error as Error).message } });
          }
        }
        broadcast({ type: 'conversations_updated', conversations: [...convCache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
        send(ws, { type: 'conversation_archived', conversationId: convId, archived });
      } else if (type === 'conversation:delete') {
        const convId = String(msg.conversationId ?? '');
        const conv = getConv(convId);
        if (!conv) throw new Error('会话不存在');
        if (conv.threadId && activeTurn.has(conv.threadId)) throw new Error('会话正在执行，请先停止再删除');
        const hadThread = conv.threadId;
        convCache.delete(convId);
        if (hadThread) convByThread.delete(hadThread);
        saveConversations([...convCache.values()]);
        appendEvidence({ kind: 'app_event', summary: 'conversation deleted', thread_id: hadThread ?? undefined, payload: { conversationId: convId, title: conv.title } });
        // 同步删除 codex 线程（best-effort，失败仅记录）
        if (hadThread) {
          try {
            await runtimeSupervisor.deleteSession(CODEX_RUNTIME_ID, hadThread);
          } catch (error) {
            appendEvidence({ kind: 'app_event', summary: 'thread delete rpc failed', thread_id: hadThread, payload: { message: (error as Error).message } });
          }
        }
        broadcast({ type: 'conversations_updated', conversations: [...convCache.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
        send(ws, { type: 'conversation_deleted', conversationId: convId });
      } else if (type === 'config:get') {
        const cfg = readConfig();
        send(ws, { type: 'config:data', payload: { ...cfg, presets: loadModelPresets(), modelOptions: buildModelOptions(), envKeys: listEnvKeys(), configFile, codexHome } });
      } else if (type === 'config:save') {
        const rawPayload = msg.payload;
        if (!isRecord(rawPayload) || typeof rawPayload.model !== 'string' || typeof rawPayload.modelProvider !== 'string' || !Array.isArray(rawPayload.providers)) {
          throw new Error('配置保存请求不完整：model、modelProvider、providers 均为必填字段');
        }
        const p = rawPayload as { model: string; modelProvider: string; providers: Array<{ id: string; base_url?: string; env_key?: string; wire_api?: string }>; presets?: Record<string, string[]>; secrets?: Record<string, string | null> };
        if (p.providers.some((provider) => !isRecord(provider) || typeof provider.id !== 'string')) {
          throw new Error('配置提供商必须为包含 id 的对象数组');
        }
        if (activeTurn.size > 0) { send(ws, { type: 'error', convId: null, message: '有对话正在执行，请先停止再保存配置' }); return; }
        saveModelConfig({ model: p.model ?? '', modelProvider: p.modelProvider ?? '', providers: p.providers ?? [] });
        for (const [k, v] of Object.entries(p.secrets ?? {})) setEnvKey(k, v);
        if (p.presets) saveModelPresets(p.presets);
        await restartEngine();
        send(ws, { type: 'config_saved', message: '配置已保存，codex 运行时已用新配置重启' });
        broadcast({ type: 'model_options', modelOptions: buildModelOptions() });
        broadcast({ type: 'info', convId: null, text: '模型配置已更新' });
      } else if (type === 'dispatch_policy:get') {
        send(ws, { type: 'dispatch_policy:data', payload: loadConclusionDispatchPolicy() });
      } else if (type === 'dispatch_policy:save') {
        const policy = saveConclusionDispatchPolicy(msg.payload);
        try {
          appendEvidence({
            kind: 'app_event',
            actor_id: 'hub-config',
            actor_type: 'system',
            object_ref: 'hub://config/conclusion-dispatch',
            source_system: 'aeos-hub',
            correlation_id: 'conclusion-dispatch-policy-updated',
            summary: 'conclusion dispatch policy updated',
            payload: {
              enabled: policy.enabled,
              dispatchDomains: policy.dispatchDomains,
              maxItemsPerAnalysis: policy.maxItemsPerAnalysis,
              revision: policy.revision,
            },
          });
        } catch {
          // 审计失败不影响保存。
        }
        send(ws, { type: 'dispatch_policy_saved', message: '分发配置已保存（立即生效）', payload: policy });
      } else {
        send(ws, { type: 'error', convId: null, message: `不支持的 WebSocket 消息类型：${type || '缺失 type'}` });
      }
    } catch (e) {
      const convId = (msg.conversationId as string) ?? null;
      send(ws, { type: 'error', convId, message: (e as Error).message });
    }
  });
  ws.on('close', () => {
    sessionSockets.detach(ws);
    allSockets.delete(ws);
    viewOf.delete(ws);
    actorOf.delete(ws);
    actorContextOf.delete(ws);
  });
});

// ---------- 启动 ----------
function lanAddresses(): string[] {
  const list: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) list.push(info.address);
    }
  }
  return [...new Set(list)];
}

const decisionDataRefreshTimer = setInterval(() => {
  void refreshDecisionData().catch((error) => console.error('[decision-data-refresh]', (error as Error).message));
}, DECISION_DATA_REFRESH_MS);
decisionDataRefreshTimer.unref();

server.listen(PORT, LISTEN_HOST, () => {
  const scope = LAN_MODE || LISTEN_HOST === '0.0.0.0' ? '局域网可访问' : '仅本机可访问';
  console.log('==============================================');
  console.log(` AEOS Hub 中枢控制台已启动（${scope}）`);
  console.log(`   本机地址: http://127.0.0.1:${PORT}`);
  if (LAN_MODE || LISTEN_HOST === '0.0.0.0') {
    for (const ip of lanAddresses()) {
      console.log(`   局域网地址: http://${ip}:${PORT}`);
    }
    console.log('   提示: 首次从其他设备访问若不通，请在 Windows 防火墙放行该端口');
    console.log(`         (管理员 PowerShell: netsh advfirewall firewall add rule name="AEOS Hub ${PORT}" dir=in action=allow protocol=TCP localport=${PORT})`);
  }
  console.log(`   登录保护: 已启用（账号: ${LOGIN_USERNAME}；密码来自 AEOS_LOGIN_PASSWORD）`);
  console.log(`   隔离 CODEX_HOME: ${codexHome}`);
  console.log('   按 Ctrl+C 退出');
  console.log('==============================================');
  void refreshDecisionData().catch((error) => console.error('[decision-data-refresh]', (error as Error).message));
});
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(decisionDataRefreshTimer);
  const deadline = setTimeout(() => process.exit(1), 20_000);
  deadline.unref();
  server.close();
  executionServer.close();
  executionServer.closeAllConnections();
  for (const guard of pendingGuard.values()) clearTimeout(guard.timer);
  for (const ws of allSockets) ws.close(1001, 'server shutting down');
  try { await runtimeSupervisor.stopAll(); process.exitCode = 0; }
  catch { process.exitCode = 1; }
  for (const ws of allSockets) ws.terminate();
  server.closeAllConnections();
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
