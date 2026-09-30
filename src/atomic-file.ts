import { mkdirSync, writeFileSync, renameSync, unlinkSync, copyFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function atomicWrite(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, content, { encoding: 'utf8', mode: 0o600, flush: true });
    if (existsSync(file)) copyFileSync(file, `${file}.bak`);
    renameSync(temp, file);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}
