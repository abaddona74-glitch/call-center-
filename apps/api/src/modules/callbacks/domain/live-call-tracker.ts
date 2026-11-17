/**
 * Remembers, per live call (Asterisk linkedid), when it started and whether an operator's phone rang,
 * so that `call.abandoned` / `call.ended` can be classified (operator_missed vs abandoned, after-hours
 * by start time). In memory only; entries expire so a lost `call.ended` cannot leak memory.
 */
export class LiveCallTracker {
  private readonly calls = new Map<string, { startedAt: Date; rang: Set<string>; touchedAt: number }>();

  constructor(private readonly ttlMs = 6 * 3_600_000) {}

  started(callId: string, at: Date, now = Date.now()): void {
    const c = this.calls.get(callId);
    if (c) {
      if (at < c.startedAt) c.startedAt = at;
      c.touchedAt = now;
    } else {
      this.calls.set(callId, { startedAt: at, rang: new Set(), touchedAt: now });
    }
  }

  operatorRang(callId: string, extension: string, at: Date, now = Date.now()): void {
    this.started(callId, at, now);
    this.calls.get(callId)?.rang.add(extension);
  }

  get(callId: string): { startedAt: Date; operatorRang: boolean } | null {
    const c = this.calls.get(callId);
    return c ? { startedAt: c.startedAt, operatorRang: c.rang.size > 0 } : null;
  }

  forget(callId: string): void {
    this.calls.delete(callId);
  }

  /** Drops entries not touched within the TTL; returns how many were dropped. */
  sweep(now = Date.now()): number {
    let dropped = 0;
    for (const [id, c] of this.calls) {
      if (now - c.touchedAt > this.ttlMs) {
        this.calls.delete(id);
        dropped++;
      }
    }
    return dropped;
  }

  get size(): number {
    return this.calls.size;
  }
}
