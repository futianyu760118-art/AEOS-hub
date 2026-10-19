import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AlertCenter,
  LogAlertChannel,
  WeComAlertChannel,
  type AlertChannel,
  type AlertEvent,
} from '../src/alert-center.ts';

class CaptureChannel implements AlertChannel {
  readonly name = 'capture';
  readonly sent: Array<{ event: AlertEvent; phase: 'active' | 'recovered' }> = [];

  enabled(): boolean {
    return true;
  }

  async send(event: AlertEvent, phase: 'active' | 'recovered'): Promise<void> {
    this.sent.push({ event, phase });
  }
}

function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'aeos-alerts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { current: new Date('2026-10-19T09:00:00.000Z') };
  const channel = new CaptureChannel();
  let counter = 0;
  const center = new AlertCenter({
    file: join(dir, 'alerts.json'),
    logFile: join(dir, 'alerts.log'),
    clock: () => clock.current,
    idFactory: () => `a-${++counter}`,
    channels: [channel],
    cooldownMs: 10 * 60_000,
  });
  return { dir, clock, channel, center };
}

const input = {
  key: 'disk:G:\\',
  severity: 'warn' as const,
  component: '磁盘',
  title: '磁盘空间偏低',
  message: '剩余 5 GB',
  action: '清理归档',
};

test('首次告警落库并通知一次', async (t) => {
  const { center, channel } = fixture(t);
  const event = center.raise(input);
  await center.flush();
  assert.equal(event.status, 'active');
  assert.equal(event.notifications, 1);
  assert.equal(channel.sent.length, 1);
  assert.equal(channel.sent[0].phase, 'active');
  assert.equal(center.counts().active, 1);
});

test('冷却期内重复告警只更新时间，不重复通知', async (t) => {
  const { center, channel, clock } = fixture(t);
  center.raise(input);
  await center.flush();
  clock.current = new Date('2026-10-19T09:05:00.000Z');
  const second = center.raise({ ...input, message: '剩余 4 GB' });
  await center.flush();
  assert.equal(second.notifications, 1);
  assert.equal(second.message, '剩余 4 GB');
  assert.equal(channel.sent.length, 1);
});

test('超过冷却期再次通知，并向上合并严重级别', async (t) => {
  const { center, channel, clock } = fixture(t);
  center.raise(input);
  await center.flush();
  clock.current = new Date('2026-10-19T09:11:00.000Z');
  const second = center.raise({ ...input, severity: 'critical' });
  await center.flush();
  assert.equal(second.severity, 'critical');
  assert.equal(second.notifications, 2);
  assert.equal(channel.sent.length, 2);
});

test('恢复后写入恢复状态并通知', async (t) => {
  const { center, channel } = fixture(t);
  center.raise(input);
  await center.flush();
  const recovered = center.recover('disk:G:\\', '磁盘已清理');
  await center.flush();
  assert.equal(recovered?.status, 'recovered');
  assert.equal(recovered?.message, '磁盘已清理');
  assert.equal(channel.sent[channel.sent.length - 1].phase, 'recovered');
  assert.equal(center.counts().active, 0);
  assert.equal(center.counts().recovered, 1);
});

test('告警快照可跨实例读取', async (t) => {
  const { center, dir } = fixture(t);
  center.raise(input);
  const reloaded = new AlertCenter({ file: join(dir, 'alerts.json') });
  assert.equal(reloaded.list().length, 1);
  assert.equal(reloaded.list()[0].key, 'disk:G:\\');
});

test('日志通道写入 alerts.log', async (t) => {
  const { dir, center } = fixture(t);
  const logFile = join(dir, 'channel.log');
  const centerWithLog = new AlertCenter({
    file: join(dir, 'alerts-2.json'),
    logFile,
    channels: [new LogAlertChannel(logFile, false)],
  });
  centerWithLog.raise(input);
  await centerWithLog.flush();
  assert.equal(existsSync(logFile), true);
  assert.match(readFileSync(logFile, 'utf8'), /磁盘空间偏低/);
  assert.ok(center);
});

test('企微渠道未配置 webhook 时禁用', () => {
  const channel = new WeComAlertChannel({ webhook: '' });
  assert.equal(channel.enabled(), false);
});

test('企微渠道发送 markdown 并在失败时重试一次', async (t) => {
  const { center } = fixture(t);
  const event = center.raise(input);
  let calls = 0;
  let body = '';
  const fetchImpl = (async (_url: string, init?: { body?: string }) => {
    calls += 1;
    body = init?.body ?? '';
    if (calls === 1) return new Response('fail', { status: 500 });
    return new Response('{"errcode":0}', { status: 200 });
  }) as unknown as typeof fetch;
  const channel = new WeComAlertChannel({ webhook: 'https://example.test/webhook', fetchImpl });
  assert.equal(channel.enabled(), true);
  await channel.send(event, 'active');
  assert.equal(calls, 2);
  const payload = JSON.parse(body) as { msgtype: string; markdown: { content: string } };
  assert.equal(payload.msgtype, 'markdown');
  assert.match(payload.markdown.content, /磁盘空间偏低/);
});
