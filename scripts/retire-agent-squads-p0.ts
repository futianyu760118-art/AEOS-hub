// P0 小队退役迁移：剥离 agent-squad.json 中的四个业务小队外壳。
// 保留成员、独立记忆、动作与消息；默认干跑，加 --apply 写盘（需先停 Hub）。
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentSquadSnapshotSchema } from '../src/agent-squad-store.ts';
import { atomicWrite } from '../src/atomic-file.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map<string, string | true>();
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith('--')) continue;
  const [key, ...rest] = raw.slice(2).split('=');
  args.set(key, rest.length ? rest.join('=') : true);
}
const file = resolve(String(args.get('file') || join(root, 'data', 'agent-squad.json')));
const apply = args.get('apply') === true;

function hubListening(): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port: 8790 });
    const finish = (value: boolean) => { socket.destroy(); done(value); };
    socket.setTimeout(400);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

if (!existsSync(file)) {
  console.error(`未找到 Agent 小队数据：${file}`);
  process.exit(2);
}
if (apply && await hubListening()) {
  console.error('检测到 Hub 仍在 8790 监听：请先停止 Hub，再执行 --apply。');
  process.exit(2);
}

const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
const retired = {
  subSquads: Array.isArray(raw.subSquads) ? raw.subSquads.length : 0,
  squadMemories: Array.isArray(raw.squadMemories) ? raw.squadMemories.length : 0,
  squadActivities: Array.isArray(raw.squadActivities) ? raw.squadActivities.length : 0,
  memberSquadLinks: Array.isArray(raw.members)
    ? raw.members.filter((member) => member && typeof member === 'object' && 'squadId' in member).length
    : 0,
};

const { subSquads: _subSquads, squadMemories: _squadMemories, squadActivities: _squadActivities, ...rest } = raw;
const members = Array.isArray(rest.members)
  ? rest.members.map((member) => {
    if (member === null || typeof member !== 'object' || Array.isArray(member)) return member;
    const { squadId: _squadId, ...memberRest } = member as Record<string, unknown>;
    return memberRest;
  })
  : [];
const retiredAt = new Date().toISOString();
const next = AgentSquadSnapshotSchema.parse({
  ...rest,
  revision: Number(rest.revision) + 1,
  updatedAt: retiredAt,
  members,
});

console.log(`Agent 小队数据：${file}`);
console.log(`待退役：${retired.subSquads} 个业务小队、${retired.squadMemories} 条小队记忆、${retired.squadActivities} 条小队动作、${retired.memberSquadLinks} 个成员归属`);
console.log(`保留：${next.members.length} 个成员、${next.memories.length} 条独立记忆、${next.activities.length} 条动作、${next.messages.length} 条消息`);

if (!apply) {
  console.log('\n干跑结束；确认无误后加 --apply 写盘（需先停 Hub）。');
} else {
  const stamp = retiredAt.replace(/[:.]/g, '-');
  const backupFile = `${file}.pre-squad-retire-${stamp}.bak`;
  atomicWrite(backupFile, readFileSync(file, 'utf8'));
  atomicWrite(file, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\n已写入 ${file}（revision=${next.revision}），退役前备份：${backupFile}`);
}
