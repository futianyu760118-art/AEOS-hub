// 模型计价：把 Token 用量换算成人民币成本。
// DeepSeek 官方价目分「高峰/空闲」与「缓存命中/未命中」；本模块是唯一换算入口，
// 调用方只上报原始 Token（含缓存命中数），不自行算价。
import type { ModelProfile } from './model-profile-store.ts';

export interface UsageTokens {
  inputTokens: number;
  /** 输入 Token 中命中上下文缓存的部分；未上报按 0 处理。 */
  cachedInputTokens?: number;
  outputTokens: number;
}

const beijingParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  hour: '2-digit',
  hourCycle: 'h23',
});

/**
 * 是否处于 DeepSeek 高峰时段（北京时间）：
 * 周一至周五 9:00-12:00、14:00-18:00；其余（含周末）为空闲时段。
 * 注意：官方口径还排除中国法定节假日；本函数不内置节假日表，
 * 节假日仍需按高峰计费的场景请由调用方传入 judgment 结果。
 */
export function isDeepSeekPeak(at: Date): boolean {
  const parts = beijingParts.formatToParts(at);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}

/** 按显式峰谷状态计算成本（便于单测与离线重算）。 */
export function estimateUsageCostCnyAtPeak(profile: ModelProfile, usage: UsageTokens, peak: boolean): number {
  if (profile.followsDefault) return 0;
  const factor = peak ? 1 : profile.offPeakMultiplier;
  const inputTokens = Math.max(0, usage.inputTokens);
  const cachedInputTokens = Math.min(Math.max(0, usage.cachedInputTokens ?? 0), inputTokens);
  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const outputTokens = Math.max(0, usage.outputTokens);
  const cost =
    (uncachedInputTokens * profile.inputPrice
      + cachedInputTokens * profile.inputPriceCached
      + outputTokens * profile.outputPrice) * factor;
  return cost / 1_000_000;
}

/** 按调用发生时刻自动判断峰谷后计算成本。 */
export function estimateUsageCostCny(profile: ModelProfile, usage: UsageTokens, at: Date = new Date()): number {
  return estimateUsageCostCnyAtPeak(profile, usage, isDeepSeekPeak(at));
}
