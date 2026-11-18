/**
 * Which part of the PBX CDR one reconciliation run reads and applies. Pure: no database, no Nest.
 * See `callbacks.reconciler.ts` for the constants and why they are what they are.
 */

export interface CdrWindow {
  /** Calls whose first leg is at or after this moment are applied. */
  applyFrom: Date;
  /** Rows are read from here: a guard before `applyFrom`, so a call that began earlier is recognised as such. */
  readFrom: Date;
  /** Exclusive end of the read. */
  to: Date;
}

export interface CdrWindowParams {
  now: Date;
  /** Calls started up to this long ago are applied (manual sync: its `hours`; periodic: the configured lookback). */
  lookbackMs: number;
  /** End of the last successful periodic run, or null (startup, manual sync): the whole lookback is read then. */
  lastEnd: Date | null;
  /** How far before `lastEnd` the next run re-applies, because CDR rows are written when a call ends. */
  overlapMs: number;
  guardMs: number;
  /** Read a bit past `now`: the PBX clock may be ahead of ours. */
  skewMs: number;
}

export function cdrWindow(p: CdrWindowParams): CdrWindow {
  const lookbackFrom = p.now.getTime() - p.lookbackMs;
  const applyFrom = p.lastEnd ? Math.max(lookbackFrom, p.lastEnd.getTime() - p.overlapMs) : lookbackFrom;
  return {
    applyFrom: new Date(applyFrom),
    readFrom: new Date(applyFrom - p.guardMs),
    to: new Date(p.now.getTime() + p.skewMs),
  };
}

/** Consecutive half-open slices `[from, to)` of at most `sliceMs` covering `[from, to)`; the last may be shorter. */
export function timeSlices(from: Date, to: Date, sliceMs: number): { from: Date; to: Date }[] {
  if (!(sliceMs > 0)) throw new RangeError('sliceMs must be positive');
  const slices: { from: Date; to: Date }[] = [];
  for (let start = from.getTime(); start < to.getTime(); start += sliceMs) {
    slices.push({ from: new Date(start), to: new Date(Math.min(start + sliceMs, to.getTime())) });
  }
  return slices;
}
