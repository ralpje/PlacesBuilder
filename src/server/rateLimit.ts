/** Fixed-window request counter per key, held in memory (per server process). */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** Returns 0 when the request is allowed, otherwise the seconds to wait. */
  hit(key: string): number {
    if (!this.max) return 0;
    const t = this.now();
    if (this.windows.size > 5000) this.prune(t);
    let w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      w = { start: t, count: 0 };
      this.windows.set(key, w);
    }
    if (w.count >= this.max) return Math.max(1, Math.ceil((w.start + this.windowMs - t) / 1000));
    w.count++;
    return 0;
  }

  private prune(t: number) {
    for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k);
  }
}
