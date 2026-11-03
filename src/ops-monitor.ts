// 运行监控：定期执行健康检查，把异常交给告警中心；同时产出页面快照。
// 检查项：登录服务、中台接口、执行面在线数、磁盘空间、备份结果、模型错误、借调失败率、进程内存。
import { existsSync, readFileSync, statfsSync } from 'node:fs';
import type { AlertCenter, AlertSeverity } from './alert-center.ts';
import type { ExecutionAgentRecord, ExecutionPlaneRegistry } from './execution-plane.ts';
import type { BorrowOrderRecord } from './borrow-order-store.ts';
import { getModelHealth, type ModelHealth } from './model-observability.ts';

export interface OpsCheckResult {
  key: string;
  component: string;
  ok: boolean;
  severity: AlertSeverity;
  title: string;
  message: string;
  action: string | null;
}

export interface OpsMetrics {
  checkedAt: string;
  uptimeSec: number;
  memoryMb: number;
  agentsOnline: number;
  agentsTotal: number;
  disk: Array<{ path: string; freeGb: number }>;
  backup: { status: 'ok' | 'stale' | 'failed' | 'missing'; lastAt: string | null };
  borrow: { endedInWindow: number; failedInWindow: number; active: number };
  model: ModelHealth;
  keycloak: 'ok' | 'fail' | 'skip';
  mcp: 'ok' | 'fail' | 'skip';
}

export interface OpsSnapshot {
  checkedAt: string;
  checks: OpsCheckResult[];
  metrics: OpsMetrics;
}

const GIB = 1024 ** 3;
export const DISK_WARN_GB = 10;
export const DISK_CRITICAL_GB = 2;
export const BACKUP_MAX_AGE_HOURS = 26;
const BORROW_WINDOW_MS = 60 * 60_000;
const MEMORY_WARN_MB = 1_500;

export function evaluateDisk(path: string, freeGb: number): OpsCheckResult {
  const key = `disk:${path}`;
  if (freeGb < DISK_CRITICAL_GB) {
    return { key, component: '磁盘', ok: false, severity: 'critical', title: '磁盘空间严重不足', message: `${path} 剩余 ${freeGb.toFixed(1)} GB`, action: '清理日志/归档或扩容磁盘' };
  }
  if (freeGb < DISK_WARN_GB) {
    return { key, component: '磁盘', ok: false, severity: 'warn', title: '磁盘空间偏低', message: `${path} 剩余 ${freeGb.toFixed(1)} GB`, action: '关注增长趋势，必要时清理归档' };
  }
  return { key, component: '磁盘', ok: true, severity: 'info', title: '磁盘空间正常', message: `${path} 剩余 ${freeGb.toFixed(1)} GB`, action: null };
}

export function evaluateBackup(logText: string | null, now: Date): OpsCheckResult {
  const key = 'backup';
  if (!logText || !logText.trim()) {
    return { key, component: '备份', ok: false, severity: 'warn', title: '尚未发现备份记录', message: 'backup.log 不存在或为空', action: '手动执行 scripts/backup-data.ps1 并检查计划任务' };
  }
  const lines = logText.trim().split(/\r?\n/).filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  const token = last.split(/\s+/)[0] ?? '';
  const lastAt = Number.isNaN(new Date(token).getTime()) ? null : token;
  if (last.includes(' FAILED ')) {
    return { key, component: '备份', ok: false, severity: 'critical', title: '最近一次备份失败', message: last, action: '查看 backup.log 并手动重跑备份' };
  }
  if (!lastAt) {
    return { key, component: '备份', ok: false, severity: 'warn', title: '备份日志格式无法识别', message: last, action: '检查备份脚本输出格式' };
  }
  const ageHours = (now.getTime() - new Date(lastAt).getTime()) / 3_600_000;
  if (ageHours > BACKUP_MAX_AGE_HOURS) {
    return { key, component: '备份', ok: false, severity: 'warn', title: '备份已超过 26 小时未更新', message: `最近成功：${lastAt}`, action: '检查计划任务是否执行' };
  }
  return { key, component: '备份', ok: true, severity: 'info', title: '备份正常', message: `最近成功：${lastAt}`, action: null };
}

export function evaluateBorrow(orders: BorrowOrderRecord[], now: Date): OpsCheckResult {
  const key = 'borrow:failure-rate';
  const windowStart = now.getTime() - BORROW_WINDOW_MS;
  const ended = orders.filter((order) => order.endedAt && new Date(order.endedAt).getTime() >= windowStart);
  const failed = ended.filter((order) => order.status === 'failed' || order.status === 'cancelled');
  const active = orders.filter((order) => order.status === 'pending' || order.status === 'dispatched' || order.status === 'running').length;
  if (ended.length >= 3) {
    const rate = failed.length / ended.length;
    if (rate >= 0.8 && ended.length >= 5) {
      return { key, component: '借调', ok: false, severity: 'critical', title: '近 1 小时借调失败率过高', message: `${failed.length}/${ended.length} 失败（${Math.round(rate * 100)}%）`, action: '检查提供方在线状态与执行面日志' };
    }
    if (rate >= 0.5) {
      return { key, component: '借调', ok: false, severity: 'warn', title: '近 1 小时借调失败率偏高', message: `${failed.length}/${ended.length} 失败（${Math.round(rate * 100)}%），进行中 ${active}`, action: '关注提供方稳定性' };
    }
  }
  return { key, component: '借调', ok: true, severity: 'info', title: '借调运行正常', message: `近 1 小时完成 ${ended.length} 单，失败 ${failed.length} 单，进行中 ${active}`, action: null };
}

export function evaluateModel(health: ModelHealth, now: Date): OpsCheckResult[] {
  const checks: OpsCheckResult[] = [];
  const within = (iso: string | null, ms: number): boolean => Boolean(iso) && now.getTime() - new Date(iso as string).getTime() <= ms;
  checks.push(within(health.lastAuthErrorAt, 10 * 60_000)
    ? { key: 'model:auth', component: '模型', ok: false, severity: 'critical', title: '模型密钥失效', message: `最近 401/403：${health.lastAuthErrorAt}`, action: '检查 DEEPSEEK_API_KEY 是否有效并重启 Hub' }
    : { key: 'model:auth', component: '模型', ok: true, severity: 'info', title: '模型鉴权正常', message: '最近 10 分钟无 401/403', action: null });
  checks.push(within(health.lastRateLimitAt, 5 * 60_000)
    ? { key: 'model:rate-limit', component: '模型', ok: false, severity: 'warn', title: '模型接口限流', message: `最近 429：${health.lastRateLimitAt}`, action: '降低调用频率或联系供应商提升配额' }
    : { key: 'model:rate-limit', component: '模型', ok: true, severity: 'info', title: '模型限流正常', message: '最近 5 分钟无 429', action: null });
  checks.push(within(health.lastServerErrorAt, 5 * 60_000)
    ? { key: 'model:server', component: '模型', ok: false, severity: 'warn', title: '模型服务端异常', message: `最近 5xx：${health.lastServerErrorAt}`, action: '关注供应商状态，必要时切换备用模型' }
    : { key: 'model:server', component: '模型', ok: true, severity: 'info', title: '模型服务正常', message: '最近 5 分钟无 5xx', action: null });
  checks.push(health.errorsInWindow >= 3
    ? { key: 'model:timeout', component: '模型', ok: false, severity: 'warn', title: '模型调用错误偏多', message: `最近 5 分钟 ${health.errorsInWindow}/${health.callsInWindow} 次失败`, action: '检查网络与供应商状态' }
    : { key: 'model:timeout', component: '模型', ok: true, severity: 'info', title: '模型调用稳定', message: `最近 5 分钟错误 ${health.errorsInWindow}/${health.callsInWindow}`, action: null });
  return checks;
}

export function evaluateAgents(
  agents: ExecutionAgentRecord[],
  previousOnline: Set<string>,
): { checks: OpsCheckResult[]; online: Set<string> } {
  const checks: OpsCheckResult[] = [];
  const online = new Set(
    agents
      .filter((agent) => !agent.deregisteredAt && agent.connectionStatus === 'online')
      .map((agent) => agent.agentId),
  );
  for (const agent of agents) {
    if (agent.deregisteredAt) continue;
    if (previousOnline.has(agent.agentId) && !online.has(agent.agentId)) {
      checks.push({
        key: `agent:offline:${agent.agentId}`,
        component: '执行面',
        ok: false,
        severity: 'warn',
        title: `执行面离线：${agent.name}`,
        message: `${agent.sourceSystem} / ${agent.agentId}`,
        action: '检查提供方进程与网络连接',
      });
    }
  }
  if (previousOnline.size > 0 && online.size === 0) {
    checks.push({
      key: 'agents:none-online',
      component: '执行面',
      ok: false,
      severity: 'critical',
      title: '没有在线执行面',
      message: '之前有在线 Agent，现在全部离线',
      action: '检查执行面网关与各提供方连接',
    });
  }
  return { checks, online };
}

export function evaluateMemory(rssBytes: number): OpsCheckResult {
  const memoryMb = Math.round(rssBytes / 1024 / 1024);
  return memoryMb >= MEMORY_WARN_MB
    ? { key: 'hub:memory', component: 'Hub', ok: false, severity: 'warn', title: 'Hub 内存占用偏高', message: `${memoryMb} MB`, action: '检查是否有大对象/连接泄漏，必要时重启' }
    : { key: 'hub:memory', component: 'Hub', ok: true, severity: 'info', title: 'Hub 内存正常', message: `${memoryMb} MB`, action: null };
}

export interface OpsMonitorOptions {
  alertCenter: AlertCenter;
  executionPlane: Pick<ExecutionPlaneRegistry, 'list'>;
  listBorrowOrders: () => BorrowOrderRecord[];
  checkKeycloak?: () => Promise<'ok' | 'fail' | 'skip'>;
  checkMcp?: () => Promise<'ok' | 'fail' | 'skip'>;
  backupLogFile?: string;
  diskPaths?: string[];
  diskFreeGb?: (path: string) => number;
  clock?: () => Date;
}

export class OpsMonitor {
  private readonly options: OpsMonitorOptions;
  private previousOnline = new Set<string>();
  private previousFailingKeys = new Set<string>();
  private lastSnapshot: OpsSnapshot | null = null;
  private running = false;

  constructor(options: OpsMonitorOptions) {
    this.options = options;
  }

  snapshot(): OpsSnapshot | null {
    return this.lastSnapshot;
  }

  async runOnce(): Promise<OpsSnapshot> {
    if (this.running) return this.lastSnapshot ?? this.buildEmptySnapshot();
    this.running = true;
    try {
      const now = this.options.clock?.() ?? new Date();
      const agents = this.options.executionPlane.list().agents;
      const [keycloak, mcp] = await Promise.all([
        this.options.checkKeycloak ? this.options.checkKeycloak() : Promise.resolve<'ok' | 'fail' | 'skip'>('skip'),
        this.options.checkMcp ? this.options.checkMcp() : Promise.resolve<'ok' | 'fail' | 'skip'>('skip'),
      ]);

      const checks: OpsCheckResult[] = [];
      if (keycloak !== 'skip') {
        checks.push(keycloak === 'ok'
          ? { key: 'keycloak', component: '登录服务', ok: true, severity: 'info', title: '登录服务正常', message: 'OIDC 发现端点可用', action: null }
          : { key: 'keycloak', component: '登录服务', ok: false, severity: 'critical', title: '登录服务不可用', message: 'OIDC 发现端点请求失败', action: '检查 Keycloak/Caddy 容器状态' });
      }
      if (mcp !== 'skip') {
        checks.push(mcp === 'ok'
          ? { key: 'mcp', component: '中台接口', ok: true, severity: 'info', title: '中台接口正常', message: 'company-control /common/ping 成功', action: null }
          : { key: 'mcp', component: '中台接口', ok: false, severity: 'warn', title: '中台接口不可用', message: 'company-control /common/ping 失败', action: '检查中台上游与 MCP 凭据' });
      }

      const diskPaths = this.options.diskPaths ?? [];
      for (const path of diskPaths) {
        const freeGb = this.options.diskFreeGb ? this.options.diskFreeGb(path) : defaultDiskFreeGb(path);
        checks.push(evaluateDisk(path, freeGb));
      }

      checks.push(evaluateMemory(process.memoryUsage().rss));

      const backupText = this.readBackupLog();
      checks.push(evaluateBackup(backupText, now));

      const orders = this.options.listBorrowOrders();
      checks.push(evaluateBorrow(orders, now));

      const modelHealth = getModelHealth(now.getTime());
      checks.push(...evaluateModel(modelHealth, now));

      const agentResult = evaluateAgents(agents, this.previousOnline);
      checks.push(...agentResult.checks);
      this.previousOnline = agentResult.online;

      const failing = checks.filter((check) => !check.ok);
      const failingKeys = new Set(failing.map((check) => check.key));
      for (const check of failing) {
        this.options.alertCenter.raise({
          key: check.key,
          severity: check.severity,
          component: check.component,
          title: check.title,
          message: check.message,
          action: check.action,
        });
      }
      for (const key of this.previousFailingKeys) {
        if (!failingKeys.has(key)) this.options.alertCenter.recover(key);
      }
      this.previousFailingKeys = failingKeys;

      const online = agents.filter((agent) => !agent.deregisteredAt && agent.connectionStatus === 'online').length;
      const active = orders.filter((order) => order.status === 'pending' || order.status === 'dispatched' || order.status === 'running').length;
      const endedInWindow = orders.filter((order) => order.endedAt && new Date(order.endedAt).getTime() >= now.getTime() - BORROW_WINDOW_MS).length;
      const failedInWindow = orders.filter((order) => order.endedAt && new Date(order.endedAt).getTime() >= now.getTime() - BORROW_WINDOW_MS
        && (order.status === 'failed' || order.status === 'cancelled')).length;
      const backupCheck = checks.find((check) => check.key === 'backup');
      const backupStatus: OpsMetrics['backup']['status'] = !backupCheck || backupCheck.title.includes('尚未')
        ? 'missing'
        : backupCheck.ok ? 'ok' : (backupCheck.severity === 'critical' ? 'failed' : 'stale');
      const backupLastAt = backupCheck?.message.startsWith('最近成功：') ? backupCheck.message.slice('最近成功：'.length) : null;

      const snapshot: OpsSnapshot = {
        checkedAt: now.toISOString(),
        checks,
        metrics: {
          checkedAt: now.toISOString(),
          uptimeSec: Math.round(process.uptime()),
          memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          agentsOnline: online,
          agentsTotal: agents.filter((agent) => !agent.deregisteredAt).length,
          disk: diskPaths.map((path) => ({ path, freeGb: this.options.diskFreeGb ? this.options.diskFreeGb(path) : defaultDiskFreeGb(path) })),
          backup: { status: backupStatus, lastAt: backupLastAt },
          borrow: { endedInWindow, failedInWindow, active },
          model: modelHealth,
          keycloak,
          mcp,
        },
      };
      this.lastSnapshot = snapshot;
      return snapshot;
    } finally {
      this.running = false;
    }
  }

  private readBackupLog(): string | null {
    const file = this.options.backupLogFile;
    if (!file || !existsSync(file)) return null;
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }

  private buildEmptySnapshot(): OpsSnapshot {
    const now = new Date().toISOString();
    return {
      checkedAt: now,
      checks: [],
      metrics: {
        checkedAt: now,
        uptimeSec: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        agentsOnline: 0,
        agentsTotal: 0,
        disk: [],
        backup: { status: 'missing', lastAt: null },
        borrow: { endedInWindow: 0, failedInWindow: 0, active: 0 },
        model: getModelHealth(),
        keycloak: 'skip',
        mcp: 'skip',
      },
    };
  }
}

export function defaultDiskFreeGb(path: string): number {
  try {
    const stats = statfsSync(path);
    return (stats.bavail * stats.bsize) / GIB;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
