// Codex 线程用量基线：thread/tokenUsage/updated 报告的是线程累计值，
// 台账需要的是「本次新增」。把每个 thread 的上次累计值持久化，重启后也不会重复记账。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from './atomic-file.ts';
import { hubRoot } from './hub-config.ts';

export interface CodexUsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

interface BaselineSnapshot {
  version: 1;
  threads: Record<string, CodexUsageTotals>;
}

export const codexUsageBaselineFile = join(hubRoot, 'data', 'codex-usage-baselines.json');

const zero = (): CodexUsageTotals => ({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function load(file: string): BaselineSnapshot {
  if (!existsSync(file)) return { version: 1, threads: {} };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<BaselineSnapshot>;
    const threads: Record<string, CodexUsageTotals> = {};
    for (const [threadId, totals] of Object.entries(raw.threads ?? {})) {
      if (!threadId || !totals || typeof totals !== 'object') continue;
      threads[threadId] = {
        inputTokens: nonNegativeInt((totals as CodexUsageTotals).inputTokens),
        cachedInputTokens: nonNegativeInt((totals as CodexUsageTotals).cachedInputTokens),
        outputTokens: nonNegativeInt((totals as CodexUsageTotals).outputTokens),
      };
    }
    return { version: 1, threads };
  } catch {
    // 基线损坏时从零开始；宁可漏记一次，也不重复记账。
    return { version: 1, threads: {} };
  }
}

/**
 * 记录线程新的累计值并返回相对上次的增量。
 * 累计值下降视为计数重置：把基线更新为当前值并返回零，避免把同一段用量再记一遍。
 */
export function recordThreadUsageTotal(
  threadId: string,
  totals: CodexUsageTotals,
  file: string = codexUsageBaselineFile,
): CodexUsageTotals {
  const snapshot = load(file);
  const prev = snapshot.threads[threadId] ?? zero();
  const current: CodexUsageTotals = {
    inputTokens: nonNegativeInt(totals.inputTokens),
    cachedInputTokens: nonNegativeInt(totals.cachedInputTokens),
    outputTokens: nonNegativeInt(totals.outputTokens),
  };
  const reset = current.inputTokens < prev.inputTokens
    || current.cachedInputTokens < prev.cachedInputTokens
    || current.outputTokens < prev.outputTokens;
  const delta = reset ? zero() : {
    inputTokens: current.inputTokens - prev.inputTokens,
    cachedInputTokens: current.cachedInputTokens - prev.cachedInputTokens,
    outputTokens: current.outputTokens - prev.outputTokens,
  };
  snapshot.threads[threadId] = current;
  atomicWrite(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  return delta;
}

/** 测试与运维用：读取某线程的基线。 */
export function getThreadUsageBaseline(threadId: string, file: string = codexUsageBaselineFile): CodexUsageTotals | null {
  return load(file).threads[threadId] ?? null;
}
