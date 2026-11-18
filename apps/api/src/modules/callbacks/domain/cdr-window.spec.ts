import { describe, expect, it } from 'vitest';
import { cdrWindow, timeSlices } from './cdr-window.js';

const H = 3_600_000;
const now = new Date('2026-11-18T19:00:00+05:00');
const at = (local: string) => new Date(`${local}+05:00`);
const params = { now, lookbackMs: 48 * H, overlapMs: 2 * H, guardMs: H, skewMs: 60_000 };

describe('cdrWindow', () => {
  it('without a previous run reads the whole lookback plus the guard', () => {
    expect(cdrWindow({ ...params, lastEnd: null })).toEqual({
      applyFrom: at('2026-11-16T19:00:00'),
      readFrom: at('2026-11-16T18:00:00'),
      to: at('2026-11-18T19:01:00'),
    });
  });

  it('after a run starts at its end minus the overlap', () => {
    expect(cdrWindow({ ...params, lastEnd: at('2026-11-18T18:56:00') })).toEqual({
      applyFrom: at('2026-11-18T16:56:00'),
      readFrom: at('2026-11-18T15:56:00'),
      to: at('2026-11-18T19:01:00'),
    });
  });

  it('never applies further back than the lookback', () => {
    expect(cdrWindow({ ...params, lastEnd: at('2026-11-10T10:00:00') }).applyFrom).toEqual(at('2026-11-16T19:00:00'));
  });
});

describe('timeSlices', () => {
  it('cuts consecutive half-open slices; the last one may be shorter', () => {
    expect(timeSlices(at('2026-11-18T10:00:00'), at('2026-11-18T12:30:00'), H)).toEqual([
      { from: at('2026-11-18T10:00:00'), to: at('2026-11-18T11:00:00') },
      { from: at('2026-11-18T11:00:00'), to: at('2026-11-18T12:00:00') },
      { from: at('2026-11-18T12:00:00'), to: at('2026-11-18T12:30:00') },
    ]);
  });

  it('returns nothing for an empty window and rejects a non-positive slice', () => {
    expect(timeSlices(now, now, H)).toEqual([]);
    expect(() => timeSlices(now, new Date(now.getTime() + H), 0)).toThrow(RangeError);
  });
});
