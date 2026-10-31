import { realpath, open } from 'node:fs/promises';
import { isAbsolute, relative, extname, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon' };
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
export async function serveRuntimeImage(requested: string, roots: string[], res: ServerResponse): Promise<void> {
  if (!requested || requested.length > 4096 || !isAbsolute(requested) || !IMAGE_TYPES[extname(requested).toLowerCase()]) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  try {
    const file = await realpath(requested);
    const allowed = await Promise.all(roots.map((root) => realpath(root).catch(() => '')));
    const mime = IMAGE_TYPES[extname(file).toLowerCase()];
    if (!mime || !allowed.some((root) => root && inside(root, file))) { res.writeHead(403); res.end('forbidden'); return; }
    const handle = await open(file, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024) { res.writeHead(404); res.end('not found'); return; }
      const buffer = await handle.readFile();
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" });
      res.end(buffer);
    } finally { await handle.close(); }
  } catch { if (!res.headersSent) res.writeHead(404); res.end('not found'); }
}

export function validOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // CLI clients authenticate using the access token.
  try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && url.host === host; }
  catch { return false; }
}

export function boundedLimit(raw: string | null, fallback = 100): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error('limit 必须为 1 至 1000 的整数');
  return value;
}
