// 幂等迁移：把 HarborAgent.model（纯展示字符串）升级为 modelProfileId（外键到模型目录），
// 并为 data/model-profiles.json 补齐种子档。保留 model 作为展示名，不动其它字段。
// 用法：node scripts/ensure-model-profiles.ts
import { loadHarbor, saveHarbor } from '../src/harbor-store.ts';
import { ensureModelProfiles } from '../src/model-profile-store.ts';

const catalog = ensureModelProfiles();
const knownProfileIds = new Set(catalog.profiles.map((profile) => profile.id));

const snapshot = loadHarbor();
const backfilled: string[] = [];
const dangling: string[] = [];

for (const agent of snapshot.agents) {
  if (agent.modelProfileId) continue;
  // 既有 Agent 的 model 字符串就是档 id（deepseek-chat / account-default / provider-default）。
  agent.modelProfileId = agent.model;
  backfilled.push(`${agent.name} → ${agent.model}`);
  if (!knownProfileIds.has(agent.model)) dangling.push(`${agent.name} → ${agent.model}`);
}

if (backfilled.length) saveHarbor(snapshot);

console.log(JSON.stringify({
  catalogProfiles: catalog.profiles.map((profile) => profile.id),
  backfilled,
  dangling,
  totalAgents: snapshot.agents.length,
}, null, 2));

if (dangling.length) {
  console.warn('⚠ 以下 Agent 的 model 没有对应模型档，modelProfileId 将是悬空引用，请补档：');
  for (const item of dangling) console.warn(`  - ${item}`);
}
