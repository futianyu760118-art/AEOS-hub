// 回填助手事件/执行步骤事件的 tenantId：默认干跑，--apply 写盘（需先停 Hub）。
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite } from '../src/atomic-file.ts';
import { AssistantEventSchema } from '../src/assistant-event-store.ts';
import { ExecutionEventSchema } from '../src/execution-event-store.ts';
import { listSystems } from '../src/system-registry.ts';
import { resolveTenantId } from '../src/tenant-registry.ts';

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

function rewrite(file: string, systemOf: (row: Record<string, unknown>) => string, schema: { parse: (value: unknown) => Record<string, unknown> }): void {
  if (!existsSync(file)) {
    console.log(`${file}: 不存在，跳过`);
    return;
  }
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/);
  let changed = 0;
  let kept = 0;
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const validated = schema.parse(parsed);
      kept += 1;
      if (typeof parsed.tenantId === 'string' && parsed.tenantId.trim()) return line;
      changed += 1;
      return JSON.stringify({
        ...validated,
        tenantId: resolveTenantId(systemOf(parsed), listSystems()),
      });
    } catch {
      return line;
    }
  });
  console.log(`${file}: 有效事件 ${kept}，回填 tenantId ${changed}`);
  if (!apply || changed === 0) return;
  atomicWrite(`${file}.pre-event-tenant-${stamp}.bak`, raw);
  atomicWrite(file, next.join('\n'));
}

if (apply && await hubListening()) {
  console.error('检测到 Hub 仍在 8790 监听：请先停止 Hub，再执行 --apply。');
  process.exit(2);
}

rewrite(join(root, 'data', 'assistant-events.jsonl'), (row) => String(row.systemId ?? ''), AssistantEventSchema);
rewrite(join(root, 'data', 'execution-events.jsonl'), (row) => String(row.sourceSystem ?? ''), ExecutionEventSchema);

console.log(apply ? '\n完成。' : '\n干跑结束；确认无误后加 --apply 写盘（需先停 Hub）。');
