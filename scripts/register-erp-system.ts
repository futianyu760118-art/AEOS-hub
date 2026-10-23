// 幂等登记历史借调单来源 erp：默认干跑，--apply 写盘（需先停 Hub）。
// 目的：让 5 张历史 erp 借调单有正式系统归属，不再显示“未登记系统”。
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SystemRegistry } from '../src/system-registry.ts';
import { atomicWrite } from '../src/atomic-file.ts';
import { DEFAULT_TENANT_ID } from '../src/tenant-registry.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map<string, string | true>();
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith('--')) continue;
  const [key, ...rest] = raw.slice(2).split('=');
  args.set(key, rest.length ? rest.join('=') : true);
}
const file = resolve(String(args.get('file') || join(root, 'data', 'systems.json')));
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
  console.error(`未找到系统登记文件：${file}`);
  process.exit(2);
}
if (apply && await hubListening()) {
  console.error('检测到 Hub 仍在 8790 监听：请先停止 Hub，再执行 --apply。');
  process.exit(2);
}

const registry = new SystemRegistry({ file });
const existing = registry.get('erp');
if (existing) {
  console.log(`erp 已登记：${existing.name}（${existing.systemId}）`);
  console.log('无需变更。');
  process.exit(0);
}

const input = {
  systemId: 'erp',
  name: 'ERP（历史接入）',
  tenantId: DEFAULT_TENANT_ID,
  owner: '待确认',
  description: '历史借调单来源，待正式接入',
  status: 'active' as const,
  sourceSystemAliases: ['erp'],
};

console.log(`系统登记文件：${file}`);
console.log(`将新增系统：${input.systemId} / ${input.name} / tenantId=${input.tenantId}`);
if (!apply) {
  console.log('\n干跑结束；确认无误后加 --apply 写盘（需先停 Hub）。');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = `${file}.pre-erp-${stamp}.bak`;
atomicWrite(backupFile, readFileSync(file, 'utf8'));
const record = registry.upsert(input);
console.log(`\n已登记 ${record.systemId}（${record.name}），变更前备份：${backupFile}`);
