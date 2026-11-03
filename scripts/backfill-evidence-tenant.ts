// 单租户迁移：把 Evidence 当前文件与归档中的旧租户统一为 tenant-demo。
// 默认干跑，--apply 写盘（需先停 Hub）。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from '../src/atomic-file.ts';
import { DEFAULT_TENANT_ID } from '../src/tenant-registry.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
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

if (apply && await hubListening()) {
  console.error('检测到 Hub 仍在 8790 监听：请先停止 Hub，再执行 --apply。');
  process.exit(2);
}

const archiveDir = join(root, 'data', 'evidence-archive');
const files = [
  join(root, 'data', 'evidence.jsonl'),
  ...(existsSync(archiveDir)
    ? readdirSync(archiveDir).filter((name) => name.endsWith('.jsonl')).sort().map((name) => join(archiveDir, name))
    : []),
];

let totalChanged = 0;
let totalLines = 0;
for (const file of files) {
  if (!existsSync(file)) continue;
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/);
  let changed = 0;
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    totalLines += 1;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry.tenant_id === DEFAULT_TENANT_ID) return line;
      changed += 1;
      return JSON.stringify({ ...entry, tenant_id: DEFAULT_TENANT_ID });
    } catch {
      return line;
    }
  });
  if (changed) {
    totalChanged += changed;
    console.log(`${file}: ${changed} 条改租户`);
    if (apply) {
      atomicWrite(`${file}.pre-tenant-${stamp}.bak`, raw);
      atomicWrite(file, next.join('\n'));
    }
  }
}

console.log(`Evidence 文件 ${files.length} 个，事件 ${totalLines} 条，待改租户 ${totalChanged} 条`);
console.log(apply ? '\n完成。' : '\n干跑结束；确认无误后加 --apply 写盘（需先停 Hub）。');
