// 回填用量台账 tenantId：默认干跑，--apply 写盘（需先停 Hub）。
// 旧事件按 systemId/别名解析系统租户；解析不到时回落 tenant-demo。
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from '../src/atomic-file.ts';
import { listSystems } from '../src/system-registry.ts';
import { resolveTenantId } from '../src/tenant-registry.ts';
import { UsageLedgerSnapshotSchema } from '../src/usage-ledger-store.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map<string, string | true>();
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith('--')) continue;
  const [key, ...rest] = raw.slice(2).split('=');
  args.set(key, rest.length ? rest.join('=') : true);
}
const file = resolve(String(args.get('file') || join(root, 'data', 'usage-ledger.json')));
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
  console.error(`未找到用量台账：${file}`);
  process.exit(2);
}
if (apply && await hubListening()) {
  console.error('检测到 Hub 仍在 8790 监听：请先停止 Hub，再执行 --apply。');
  process.exit(2);
}

const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> & { events?: Array<Record<string, unknown>> };
const systems = listSystems();
let filled = 0;
const events = (raw.events ?? []).map((event) => {
  if (typeof event.tenantId === 'string' && event.tenantId.trim()) return event;
  filled += 1;
  return {
    ...event,
    tenantId: resolveTenantId(String(event.systemId ?? ''), systems),
  };
});
const next = UsageLedgerSnapshotSchema.parse({
  ...raw,
  revision: filled > 0 ? Number(raw.revision ?? 0) + 1 : Number(raw.revision ?? 0),
  events,
});

console.log(`用量台账：${file}`);
console.log(`事件总数：${events.length}；本次回填 tenantId：${filled}`);
for (const event of events.filter((item) => item.tenantId !== 'tenant-demo')) {
  console.log(`- ${String(event.id)} → ${String(event.tenantId)}`);
}

if (!apply) {
  console.log('\n干跑结束；确认无误后加 --apply 写盘（需先停 Hub）。');
} else if (!filled) {
  console.log('\n无需回填，未写盘。');
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `${file}.pre-tenant-${stamp}.bak`;
  atomicWrite(backupFile, readFileSync(file, 'utf8'));
  atomicWrite(file, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`\n已写入 ${file}（revision=${next.revision}），回填前备份：${backupFile}`);
}
