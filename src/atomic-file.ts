import { mkdirSync, writeFileSync, renameSync, unlinkSync, copyFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Windows 上目标文件被短暂占用时 rename 会返回这些错误；重试即可恢复。 */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const DEFAULT_RENAME_ATTEMPTS = 5;
const DEFAULT_RENAME_WAIT_MS = 20;

export interface AtomicWriteOptions {
  /** 测试注入：替换 renameSync。 */
  rename?: typeof renameSync;
  /** 测试注入：替换同步等待。 */
  wait?: (ms: number) => void;
  /** 可重试错误的最大尝试次数（含首次）。 */
  attempts?: number;
  /** 首次重试等待毫秒数，之后线性递增。 */
  waitMs?: number;
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function atomicWrite(file: string, content: string, options: AtomicWriteOptions = {}): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  const rename = options.rename ?? renameSync;
  const wait = options.wait ?? sleepSync;
  const attempts = Math.max(1, options.attempts ?? DEFAULT_RENAME_ATTEMPTS);
  const waitMs = Math.max(0, options.waitMs ?? DEFAULT_RENAME_WAIT_MS);
  try {
    writeFileSync(temp, content, { encoding: 'utf8', mode: 0o600, flush: true });
    if (existsSync(file)) {
      try {
        copyFileSync(file, `${file}.bak`);
      } catch (error) {
        // 备份失败不应阻断主写入；主文件仍有临时文件与重命名保护。
        console.warn(`[atomicWrite] backup failed: ${(error as Error).message}`);
      }
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        rename(temp, file);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? '';
        if (!RETRYABLE_RENAME_CODES.has(code) || attempt >= attempts) throw error;
        wait(waitMs * attempt);
      }
    }
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}
