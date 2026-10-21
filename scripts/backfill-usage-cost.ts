// 一次性回填：执行面上报了 Token 但 cost 为 0 的历史用量，按模型目录补算成本。
// 只改 usage-ledger.json；UsageLedgerStore.save 会自动保留 .bak。
import { UsageLedgerStore } from '../src/usage-ledger-store.ts';
import { estimateUsageCostForModel } from '../src/usage-cost.ts';

const store = new UsageLedgerStore();
const snapshot = store.load();
let changed = 0;
let addedCost = 0;
const events = snapshot.events.map((event) => {
  if (event.cost > 0 || !event.modelId || (event.tokensIn <= 0 && event.tokensOut <= 0)) return event;
  const endedAt = new Date(event.endedAt || event.startedAt);
  const cost = estimateUsageCostForModel(event.modelId, {
    inputTokens: event.tokensIn,
    cachedInputTokens: event.cachedTokens,
    outputTokens: event.tokensOut,
  }, Number.isNaN(endedAt.getTime()) ? new Date() : endedAt);
  if (cost === null || cost <= 0) return event;
  changed += 1;
  addedCost += cost;
  return { ...event, cost };
});

if (changed > 0) {
  store.save({ ...snapshot, revision: snapshot.revision + 1, events });
}
console.log(JSON.stringify({ changed, addedCost: Number(addedCost.toFixed(6)), totalEvents: events.length }));
