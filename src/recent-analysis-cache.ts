// 短时分析结果缓存：同一问题在 TTL 内重复提问时直接复用上次结果，避免重复调用执行面。
// 仅保存在内存（Hub 重启即清空）；数据新鲜度由 TTL 控制，默认 5 分钟。
export class RecentAnalysisCache<T> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(options: { ttlMs: number; maxEntries?: number; now?: () => number }) {
    this.ttlMs = Math.max(0, options.ttlMs);
    this.maxEntries = Math.max(1, options.maxEntries ?? 50);
    this.now = options.now ?? (() => Date.now());
  }

  get(key: string): T | null {
    this.prune();
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.prune();
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    this.prune();
    return this.entries.size;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
