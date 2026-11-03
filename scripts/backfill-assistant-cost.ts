// 一次性回填：模型目录新增 deepseek-v4-pro 后，把中台助手历史用量事件中 cost=0 的记录按官方价重算。
// 运行顺序：停止 Hub → node scripts/backfill-assistant-cost.ts → 重启 Hub。
import { UsageLedgerStore } from '../src/usage-ledger-store.ts';
import { ensureModelProfiles, loadModelProfiles } from '../src/model-profile-store.ts';
import { estimateUsageCostCny } from '../src/model-pricing.ts';

ensureModelProfiles();
const profile = loadModelProfiles().profiles.find((item) => item.id === 'deepseek-v4-pro' && !item.followsDefault);
if (!profile) {
  console.error('模型目录缺少 deepseek-v4-pro，无法回填');
  process.exit(1);
}

const store = new UsageLedgerStore();
const snapshot = store.load();
let updated = 0;
const events = snapshot.events.map((event) => {
  if (event.modelId !== 'deepseek-v4-pro' || event.cost > 0) return event;
  const cost = estimateUsageCostCny(profile, {
    inputTokens: event.tokensIn,
    cachedInputTokens: event.cachedTokens,
    outputTokens: event.tokensOut,
  }, new Date(event.startedAt));
  if (cost > 0) updated += 1;
  return { ...event, cost };
});

if (updated > 0) {
  store.save({ ...snapshot, revision: snapshot.revision + 1, events });
}

console.log(JSON.stringify({
  updated,
  totalEvents: events.length,
  revision: snapshot.revision + (updated > 0 ? 1 : 0),
  model: profile.modelName,
  pricing: {
    inputPrice: profile.inputPrice,
    inputPriceCached: profile.inputPriceCached,
    outputPrice: profile.outputPrice,
    offPeakMultiplier: profile.offPeakMultiplier,
  },
}, null, 2));
