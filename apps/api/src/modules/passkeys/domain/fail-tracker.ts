/** Fixed-window failure counter kept in memory (max `max` failures per `windowMs` per key). */
export class FailTracker {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  isBlocked(key: string): boolean {
    const b = this.buckets.get(key);
    return Boolean(b && b.resetAt > this.now() && b.count >= this.max);
  }

  fail(key: string): void {
    const now = this.now();
    if (this.buckets.size > 10_000) {
      for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
    }
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, b);
    }
    b.count += 1;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}
