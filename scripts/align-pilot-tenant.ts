// 单租户迁移：把系统登记、用量台账、借调单的 pilot-default 统一为 M01 的 tenant-demo。
// 默认干跑，--apply 写盘（需先停 Hub）。Evidence 历史不在此脚本改写。
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from '../src/atomic-file.ts';
import { BorrowOrderSnapshotSchema } from '../src/borrow-order-store.ts';
import { SystemSnapshotSchema } from '../src/system-registry.ts';
import { DEFAULT_TENANT_ID } from '../src/tenant-registry.ts';
import { UsageLedgerSnapshotSchema } from '../src/usage-ledger-store.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map<string, string | true>();
for (const raw of process.argv.slice(2)) {
  if (!raw.startsWith('--')) continue;
  const [key, ...rest] = raw.slice(2).split('=');
  args.set(key, rest.length ? rest.join('=') : true);
}
const apply = args.get('apply') === true;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

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

function rewrite<T>(file: string, transform: (raw: string) => { next: T; changed: number; summary: string }): void {
  if (!existsSync(file)) {
    console.log(`${file}: 不存在，跳过`);
    return;
  }
  const raw = readFileSync(file, 'utf8');
  const { next, changed, summary } = transform(raw);
  console.log(`${file}: ${summary}`);
  if (!apply || changed === 0) return;
  atomicWrite(`${file}.pre-tenant-align-${stamp}.bak`, raw);
  atomicWrite(file, `${JSON.stringify(next, null, 2)}\n`);
}

if (apply && await hubListening()) {
  console.error('检测到 Hub 仍在 8790 监听：请先停止 Hub，再执行 --apply。');
  process.exit(2);
}

rewrite(join(root, 'data', 'systems.json'), (raw) => {
  const snapshot = SystemSnapshotSchema.parse(JSON.parse(raw));
  let changed = 0;
  for (const system of snapshot.systems) {
    if (system.tenantId !== DEFAULT_TENANT_ID) {
      system.tenantId = DEFAULT_TENANT_ID;
      changed += 1;
    }
  }
  if (changed) snapshot.revision += 1;
  return { next: SystemSnapshotSchema.parse(snapshot), changed, summary: `系统 ${snapshot.systems.length} 个，改租户 ${changed}` };
});

rewrite(join(root, 'data', 'usage-ledger.json'), (raw) => {
  const snapshot = UsageLedgerSnapshotSchema.parse(JSON.parse(raw));
  let changed = 0;
  for (const event of snapshot.events) {
    if (event.tenantId !== DEFAULT_TENANT_ID) {
      event.tenantId = DEFAULT_TENANT_ID;
      changed += 1;
    }
  }
  if (changed) snapshot.revision += 1;
  return { next: UsageLedgerSnapshotSchema.parse(snapshot), changed, summary: `用量 ${snapshot.events.length} 条，改租户 ${changed}` };
});

rewrite(join(root, 'data', 'borrow-orders.json'), (raw) => {
  const snapshot = BorrowOrderSnapshotSchema.parse(JSON.parse(raw));
  let changed = 0;
  for (const order of snapshot.orders) {
    if (order.tenantId !== DEFAULT_TENANT_ID) {
      order.tenantId = DEFAULT_TENANT_ID;
      changed += 1;
    }
  }
  if (changed) snapshot.revision += 1;
  return { next: BorrowOrderSnapshotSchema.parse(snapshot), changed, summary: `借调单 ${snapshot.orders.length} 条，改租户 ${changed}` };
});

console.log(apply ? '\n完成。' : '\n干跑结束；确认无误后加 --apply 写盘（需先停 Hub）。');
