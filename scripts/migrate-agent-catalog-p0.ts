// P0 归属迁移脚本：回填 Agent 的 systemId / primaryDomainId / domainIds / externalAgentId。
// 默认干跑；加 --apply 才写盘。写盘前检查 AI 港湾数据锁，并要求先停 Hub。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateAgentCatalog, type SquadMembershipRecord } from '../src/agent-catalog-migration.ts';
import { atomicWrite } from '../src/atomic-file.ts';
import { HarborSnapshotSchema } from '../src/harbor-store.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map<string, string | true>();
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith('--')) continue;
  const [key, ...rest] = raw.slice(2).split('=');
  args.set(key, rest.length ? rest.join('=') : true);
}

const harborFile = resolve(String(args.get('file') || join(root, 'data', 'ai-harbor.json')));
const squadFile = resolve(String(args.get('squad') || join(root, 'data', 'agent-squad.json')));
const apply = args.get('apply') === true;

if (apply && existsSync(`${harborFile}.lock`)) {
  console.error(`检测到数据锁 ${harborFile}.lock：请先停止 Hub，再执行迁移。`);
  process.exit(2);
}

const snapshot = HarborSnapshotSchema.parse(JSON.parse(readFileSync(harborFile, 'utf8')));
const members: SquadMembershipRecord[] = existsSync(squadFile)
  ? (JSON.parse(readFileSync(squadFile, 'utf8')) as { members?: SquadMembershipRecord[] }).members ?? []
  : [];

const { snapshot: migrated, report } = migrateAgentCatalog(snapshot, members);

console.log(`AI 港湾：${harborFile}`);
console.log(`小队成员：${members.length} 条（${squadFile}）`);
console.log(`Agent 总数：${report.agents.length}，待变更 ${report.changed}，已一致 ${report.unchanged}`);
for (const agent of report.agents) {
  console.log([
    agent.changed ? '*' : ' ',
    agent.name,
    `→ ${agent.after.systemId} / ${agent.after.primaryDomainId} / [${agent.after.domainIds.join(', ')}]`,
    agent.after.externalAgentId ? `/ 外部 ${agent.after.externalAgentId}` : '',
  ].join(' '));
}
for (const warning of report.warnings) console.log(`提示：${warning}`);

if (!apply) {
  console.log('\n干跑结束；确认无误后加 --apply 写盘。');
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `${harborFile}.pre-catalog-${stamp}.bak`;
  atomicWrite(backupFile, readFileSync(harborFile, 'utf8'));
  atomicWrite(harborFile, `${JSON.stringify(migrated, null, 2)}\n`);
  console.log(`\n已写入 ${harborFile}（revision=${migrated.revision}），迁移前备份：${backupFile}`);
}
