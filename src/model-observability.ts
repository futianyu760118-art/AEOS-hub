// 模型调用可观测性：记录最近的调用结果，供运行监控判断密钥失效、限流与服务端异常。
// 只保留内存中的最近记录，不落盘；进程重启后重新开始统计。
export interface ModelCallRecord {
  at: string;
  ok: boolean;
  /** HTTP 状态码；网络/超时为 null。 */
  status: number | null;
  kind: 'success' | 'http' | 'timeout' | 'network';
  model: string | null;
}

const MAX_RECORDS = 200;
let records: ModelCallRecord[] = [];

export function recordModelCall(input: { ok: boolean; status?: number | null; kind: ModelCallRecord['kind']; model?: string | null }): void {
  records.push({
    at: new Date().toISOString(),
    ok: input.ok,
    status: input.status ?? null,
    kind: input.kind,
    model: input.model ?? null,
  });
  if (records.length > MAX_RECORDS) records = records.slice(-MAX_RECORDS);
}

export function resetModelObservability(): void {
  records = [];
}

export interface ModelHealth {
  callsInWindow: number;
  errorsInWindow: number;
  lastSuccessAt: string | null;
  lastAuthErrorAt: string | null;
  lastRateLimitAt: string | null;
  lastServerErrorAt: string | null;
  lastTimeoutAt: string | null;
}

export function getModelHealth(now = Date.now(), windowMs = 5 * 60_000): ModelHealth {
  const inWindow = records.filter((record) => now - new Date(record.at).getTime() <= windowMs);
  const findLast = (predicate: (record: ModelCallRecord) => boolean): string | null => {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      if (predicate(records[index])) return records[index].at;
    }
    return null;
  };
  return {
    callsInWindow: inWindow.length,
    errorsInWindow: inWindow.filter((record) => !record.ok).length,
    lastSuccessAt: findLast((record) => record.ok),
    lastAuthErrorAt: findLast((record) => record.status === 401 || record.status === 403),
    lastRateLimitAt: findLast((record) => record.status === 429),
    lastServerErrorAt: findLast((record) => record.status !== null && record.status >= 500),
    lastTimeoutAt: findLast((record) => record.kind === 'timeout' || record.kind === 'network'),
  };
}
