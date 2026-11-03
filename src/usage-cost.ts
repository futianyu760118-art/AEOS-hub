// 用量计价补算：执行面上报 Token 但没给成本（或给了 0）时，按模型目录补算。
import { estimateUsageCostCny, type UsageTokens } from './model-pricing.ts';
import { loadModelProfiles, type ModelProfile } from './model-profile-store.ts';

/** 按模型 ID 或模型名匹配计价档；followsDefault / 未知模型返回 null。 */
export function estimateUsageCostForModel(
  modelId: string | null,
  usage: UsageTokens,
  at: Date = new Date(),
  profiles: ModelProfile[] = loadModelProfiles().profiles,
): number | null {
  if (!modelId) return null;
  const id = modelId.trim();
  if (!id) return null;
  const profile = profiles.find((item) => !item.followsDefault
    && (item.id === id || item.modelName === id));
  if (!profile) return null;
  return estimateUsageCostCny(profile, usage, at);
}
