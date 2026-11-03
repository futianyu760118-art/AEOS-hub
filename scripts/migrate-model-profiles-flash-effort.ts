// 一次性迁移（2026-10）：DeepSeek-only 模型目录
// - 三档统一走 deepseek-flash，仅以 effort(low/high/max) 区分；
// - 价格切换为 DeepSeek 官方峰谷/缓存价目（高峰：输入 ¥2/M、缓存命中 ¥0.04/M、输出 ¥8/M；空闲五折）；
// - 删除不在当前范围内的 GPT 档（gpt-4o），保留 local-llama（脱敏任务）与 followsDefault 档。
//
// 运行顺序（模型目录是 .strict() schema，旧 Hub 进程会拒绝新字段）：
//   1. 停止 Hub（scripts/stop-m01-demo.ps1 或 taskkill 顶层 powershell）
//   2. node scripts/migrate-model-profiles-flash-effort.ts
//   3. 重启 Hub（scripts/start-m01-demo.ps1）
// 用法：node scripts/migrate-model-profiles-flash-effort.ts [--dry-run]
import { loadModelProfiles, saveModelProfiles, getSeedProfiles } from '../src/model-profile-store.ts';

const OBSOLETE_IDS = new Set(['gpt-4o']);
const dryRun = process.argv.includes('--dry-run');

const snapshot = loadModelProfiles();
const seeds = new Map(getSeedProfiles().map((profile) => [profile.id, profile]));
const before = snapshot.profiles.map((profile) => profile.id);

const next = snapshot.profiles
  .filter((profile) => !OBSOLETE_IDS.has(profile.id))
  .map((profile) => seeds.get(profile.id) ?? profile);

// 补齐缺失的 DeepSeek 种子档（例如新增的 deepseek-flash-max）。
const present = new Set(next.map((profile) => profile.id));
for (const [id, profile] of seeds) {
  if (!present.has(id)) next.push(profile);
}

const after = next.map((profile) => profile.id);
const summary = {
  dryRun,
  removed: [...OBSOLETE_IDS].filter((id) => before.includes(id)),
  updated: seeds.size ? [...seeds.keys()].filter((id) => before.includes(id)) : [],
  added: after.filter((id) => !before.includes(id)),
  before,
  after,
};

if (dryRun) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const saved = saveModelProfiles({ version: 1, revision: snapshot.revision + 1, profiles: next });
console.log(JSON.stringify({ ...summary, revision: saved.revision }, null, 2));
