// 打印某系统的控制面派生令牌（与 src/system-token.ts 用同一函数，杜绝推导漂移）。
// 用法：node scripts/mint-system-token.ts <systemId>
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveSystemToken } from '../src/system-token.ts';

const here = dirname(fileURLToPath(import.meta.url));
const systemId = process.argv[2]?.trim();
if (!systemId) {
  console.error('用法: node scripts/mint-system-token.ts <systemId>');
  process.exit(1);
}

let rootSecret = process.env.EXECUTION_PLANE_TOKEN?.trim() ?? '';
if (!rootSecret) {
  const envFile = join(here, '..', 'deploy', 'm01', '.env');
  try {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*EXECUTION_PLANE_TOKEN=(.*)$/);
      if (match) { rootSecret = (match[1] ?? '').trim(); break; }
    }
  } catch {
    rootSecret = '';
  }
}
if (!rootSecret) {
  console.error('未找到 EXECUTION_PLANE_TOKEN（先运行 scripts/provision-execution-plane-token.ps1，或设置 EXECUTION_PLANE_TOKEN 环境变量）。');
  process.exit(1);
}
console.log(deriveSystemToken(rootSecret, systemId));
