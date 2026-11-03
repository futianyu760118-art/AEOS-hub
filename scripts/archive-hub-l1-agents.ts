// 归档 AEOS Hub 名下 L1 演示 Agent：默认干跑，--apply 写盘（需先停 Hub）。
// 不删除任何 Agent、记忆、会话或用量；仅把生命周期置为 retired、状态置为 archived。
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveHubL1Agents } from '../src/hub-agent-archive.ts';
import { atomicWrite } from '../src/atomic-file.ts';
import { HarborSnapshotSchema } from '../src/harbor-store.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map<string, string | true>();
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith('--')) continue;
  const [key, ...rest] = raw.slice(2).split('=');
  args.set(key, rest.length ? rest.join('=') : true);
}
const file = resolve(String(args.get('file') || join(root, 'data', 'ai-harbor.json')));
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
  console.error(`未找到 AI 港湾数据：${file}`);
  process.exit(2);
}
if (apply && await hubListening()) {
  console.error('检测到 Hub 仍在 8790 监听：请先停止 Hub，再执行 --apply。');
  process.exit(2);
}

const snapshot = HarborSnapshotSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
const { snapshot: next, report, changed } = archiveHubL1Agents(snapshot);

console.log(`AI 港湾：${file}`);
console.log(`Hub 名下 L1 候选：${report.candidates} 个；本次归档 ${report.archivedNow}，已归档 ${report.alreadyArchived}`);
for (const agent of report.agents) {
  console.log(`- ${agent.name}（${agent.primaryDomainId}）${agent.alreadyArchived ? ' · 已归档' : ''}`);
}

if (!apply) {
  console.log('\n干跑结束；确认无误后加 --apply 写盘（需先停 Hub）。');
} else if (!changed) {
  console.log('\n没有需要变更的 Agent，未写盘。');
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `${file}.pre-archive-l1-${stamp}.bak`;
  atomicWrite(backupFile, readFileSync(file, 'utf8'));
  atomicWrite(file, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\n已写入 ${file}（revision=${next.revision}），归档前备份：${backupFile}`);
}
