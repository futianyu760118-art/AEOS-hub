// 统一告警中心：监控检查只产生「告警事件」，由中心负责去重、冷却、恢复通知与多渠道分发。
// 渠道可插拔：页面（告警中心自身快照）、日志、企业微信群机器人（配置 webhook 后启用）。
import { existsSync, appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { atomicWrite } from './atomic-file.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const alertFile = join(root, 'data', 'alerts.json');
export const alertLogFile = join(root, 'data', 'alerts.log');
const MAX_ALERTS = 500;

export const ALERT_SEVERITIES = ['info', 'warn', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export const ALERT_STATUSES = ['active', 'recovered'] as const;

export const AlertEventSchema = z.object({
  id: z.string().min(1).max(160),
  key: z.string().min(1).max(200),
  severity: z.enum(ALERT_SEVERITIES),
  component: z.string().min(1).max(160),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2_000),
  action: z.string().max(500).nullable(),
  status: z.enum(ALERT_STATUSES),
  firstSeenAt: z.string().min(1).max(64),
  lastSeenAt: z.string().min(1).max(64),
  lastNotifiedAt: z.string().max(64).nullable(),
  recoveredAt: z.string().max(64).nullable(),
  notifications: z.number().int().nonnegative(),
}).strict();

export const AlertSnapshotSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().min(1).max(64),
  alerts: z.array(AlertEventSchema).max(MAX_ALERTS),
}).strict();

export type AlertEvent = z.infer<typeof AlertEventSchema>;
export type AlertSnapshot = z.infer<typeof AlertSnapshotSchema>;

export interface AlertChannel {
  name: string;
  enabled(): boolean;
  send(event: AlertEvent, phase: 'active' | 'recovered'): Promise<void>;
}

export interface RaiseAlertInput {
  key: string;
  severity: AlertSeverity;
  component: string;
  title: string;
  message: string;
  action?: string | null;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warn: 1, critical: 2 };

export interface AlertCenterOptions {
  file?: string;
  logFile?: string;
  clock?: () => Date;
  idFactory?: () => string;
  channels?: AlertChannel[];
  /** 同一告警 key 的重复通知冷却时间（默认 10 分钟）。 */
  cooldownMs?: number;
}

export class AlertCenter {
  readonly file: string;
  private readonly logFile: string;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly channels: AlertChannel[];
  private readonly cooldownMs: number;
  private pending: Promise<void> = Promise.resolve();

  constructor(options: AlertCenterOptions = {}) {
    this.file = options.file ?? alertFile;
    this.logFile = options.logFile ?? alertLogFile;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.channels = options.channels ?? [];
    this.cooldownMs = options.cooldownMs ?? 10 * 60_000;
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private empty(): AlertSnapshot {
    return { version: 1, revision: 0, updatedAt: this.nowIso(), alerts: [] };
  }

  load(): AlertSnapshot {
    if (!existsSync(this.file)) return this.empty();
    try {
      return AlertSnapshotSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      // 告警文件损坏不应阻塞服务；回退为空并保留原文件供排查。
      return this.empty();
    }
  }

  private save(snapshot: AlertSnapshot): void {
    const validated = AlertSnapshotSchema.parse({ ...snapshot, updatedAt: this.nowIso() });
    atomicWrite(this.file, `${JSON.stringify(validated, null, 2)}\n`);
  }

  list(limit = 100): AlertEvent[] {
    const bounded = Math.max(1, Math.min(Math.trunc(limit), MAX_ALERTS));
    return [...this.load().alerts].reverse().slice(0, bounded);
  }

  counts(): { active: number; critical: number; warn: number; info: number; recovered: number; total: number } {
    const alerts = this.load().alerts;
    const active = alerts.filter((alert) => alert.status === 'active');
    return {
      total: alerts.length,
      active: active.length,
      critical: active.filter((alert) => alert.severity === 'critical').length,
      warn: active.filter((alert) => alert.severity === 'warn').length,
      info: active.filter((alert) => alert.severity === 'info').length,
      recovered: alerts.filter((alert) => alert.status === 'recovered').length,
    };
  }

  channelEnabled(name: string): boolean {
    return this.channels.some((channel) => channel.name === name && channel.enabled());
  }

  raise(input: RaiseAlertInput): AlertEvent {
    const snapshot = this.load();
    const now = this.nowIso();
    const index = snapshot.alerts.findIndex((alert) => alert.key === input.key && alert.status === 'active');
    if (index >= 0) {
      const existing = snapshot.alerts[index];
      const severity = SEVERITY_RANK[input.severity] > SEVERITY_RANK[existing.severity] ? input.severity : existing.severity;
      const sinceNotify = existing.lastNotifiedAt ? new Date(now).getTime() - new Date(existing.lastNotifiedAt).getTime() : Number.POSITIVE_INFINITY;
      const notify = sinceNotify >= this.cooldownMs;
      const updated: AlertEvent = {
        ...existing,
        severity,
        component: input.component,
        title: input.title,
        message: input.message,
        action: input.action ?? existing.action,
        lastSeenAt: now,
        lastNotifiedAt: notify ? now : existing.lastNotifiedAt,
        notifications: notify ? existing.notifications + 1 : existing.notifications,
      };
      const alerts = [...snapshot.alerts];
      alerts[index] = updated;
      this.save({ ...snapshot, revision: snapshot.revision + 1, alerts });
      if (notify) this.enqueue(updated, 'active');
      return updated;
    }

    const event = AlertEventSchema.parse({
      id: `alert-${this.idFactory()}`,
      key: input.key,
      severity: input.severity,
      component: input.component,
      title: input.title,
      message: input.message,
      action: input.action ?? null,
      status: 'active',
      firstSeenAt: now,
      lastSeenAt: now,
      lastNotifiedAt: now,
      recoveredAt: null,
      notifications: 1,
    });
    const alerts = [...snapshot.alerts, event].slice(-MAX_ALERTS);
    this.save({ ...snapshot, revision: snapshot.revision + 1, alerts });
    this.enqueue(event, 'active');
    return event;
  }

  recover(key: string, message?: string): AlertEvent | null {
    const snapshot = this.load();
    const index = snapshot.alerts.findIndex((alert) => alert.key === key && alert.status === 'active');
    if (index < 0) return null;
    const existing = snapshot.alerts[index];
    const now = this.nowIso();
    const updated: AlertEvent = {
      ...existing,
      status: 'recovered',
      message: message ?? existing.message,
      recoveredAt: now,
      lastSeenAt: now,
    };
    const alerts = [...snapshot.alerts];
    alerts[index] = updated;
    this.save({ ...snapshot, revision: snapshot.revision + 1, alerts });
    this.enqueue(updated, 'recovered');
    return updated;
  }

  /** 等待所有已排队的渠道发送完成（测试与 CLI 使用）。 */
  async flush(): Promise<void> {
    await this.pending;
  }

  private enqueue(event: AlertEvent, phase: 'active' | 'recovered'): void {
    this.pending = this.pending
      .then(() => this.dispatch(event, phase))
      .catch(() => undefined);
  }

  private async dispatch(event: AlertEvent, phase: 'active' | 'recovered'): Promise<void> {
    for (const channel of this.channels) {
      if (!channel.enabled()) continue;
      try {
        await channel.send(event, phase);
      } catch (error) {
        // 渠道失败不影响告警落库与页面展示。
        console.warn(`[alert] 渠道 ${channel.name} 发送失败:`, (error as Error).message);
      }
    }
  }
}

function severityLabel(severity: AlertSeverity): string {
  return severity === 'critical' ? '严重' : severity === 'warn' ? '警告' : '提示';
}

function alertLine(event: AlertEvent, phase: 'active' | 'recovered'): string {
  const status = phase === 'recovered' ? '已恢复' : '告警';
  return `${event.lastSeenAt} ${status} [${severityLabel(event.severity)}] ${event.component} ${event.title} | ${event.message}${event.action ? ` | 建议: ${event.action}` : ''}`;
}

/** 日志通道：data/alerts.log + 控制台。 */
export class LogAlertChannel implements AlertChannel {
  readonly name = 'log';
  private readonly file: string;
  private readonly echo: boolean;

  constructor(file = alertLogFile, echo = true) {
    this.file = file;
    this.echo = echo;
  }

  enabled(): boolean {
    return true;
  }

  async send(event: AlertEvent, phase: 'active' | 'recovered'): Promise<void> {
    const line = alertLine(event, phase);
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, `${line}\n`, 'utf8');
    } catch {
      // 文件日志失败不阻断控制台输出。
    }
    if (this.echo) console.log(`[alert] ${line}`);
  }
}

/** 企业微信群机器人通道：只有配置了 WECOM_ALERT_WEBHOOK 才启用。 */
export class WeComAlertChannel implements AlertChannel {
  readonly name = 'wecom';
  private readonly webhook: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: { webhook?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
    this.webhook = (options.webhook ?? process.env.WECOM_ALERT_WEBHOOK ?? '').trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  enabled(): boolean {
    return Boolean(this.webhook);
  }

  async send(event: AlertEvent, phase: 'active' | 'recovered'): Promise<void> {
    if (!this.webhook) return;
    const status = phase === 'recovered' ? '已恢复' : '告警';
    const content = [
      `### ${status}｜${severityLabel(event.severity)}｜${event.component}`,
      `> ${event.title}`,
      `> ${event.message}`,
      ...(event.action ? [`> 建议：${event.action}`] : []),
      `> 时间：${event.lastSeenAt}`,
    ].join('\n');
    const body = JSON.stringify({ msgtype: 'markdown', markdown: { content } });
    const attempt = async (): Promise<void> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(this.webhook, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      await attempt();
    } catch {
      await attempt();
    }
  }
}
