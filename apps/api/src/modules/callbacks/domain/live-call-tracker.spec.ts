import { describe, expect, it } from 'vitest';
import { LiveCallTracker } from './live-call-tracker.js';

describe('LiveCallTracker', () => {
  it('keeps the earliest start and remembers rung operators', () => {
    const tr = new LiveCallTracker();
    tr.started('c1', new Date('2026-11-17T05:00:10Z'));
    tr.operatorRang('c1', '101', new Date('2026-11-17T05:00:20Z'));
    tr.started('c1', new Date('2026-11-17T05:00:00Z'));
    expect(tr.get('c1')).toEqual({ startedAt: new Date('2026-11-17T05:00:00Z'), operatorRang: true });
    expect(tr.get('unknown')).toBeNull();
  });

  it('forgets ended calls and sweeps stale ones', () => {
    const tr = new LiveCallTracker(1_000);
    tr.started('a', new Date(), 0);
    tr.started('b', new Date(), 500);
    tr.forget('a');
    expect(tr.size).toBe(1);
    expect(tr.sweep(1_400)).toBe(0);
    expect(tr.sweep(1_600)).toBe(1);
    expect(tr.size).toBe(0);
  });
});
