import { DateTime } from 'luxon';
import type { PresenceState } from './presence-state.js';

/**
 * Online / pause time per operator from the presence log (docs/rewrite/METRICS.md §11.1). Pure: no Nest, no DB.
 * Times are epoch milliseconds; the result is whole seconds.
 */

export interface PresenceIntervalFact {
  extension: string;
  state: PresenceState;
  pauseReason: string | null;
  startedAt: Date;
  /** null = still open: counts until `now`. */
  endedAt: Date | null;
}

/** [start, end) in epoch ms. */
export type Window = readonly [number, number];

export interface WorkingTime {
  timezone: string;
  isWorkingDay(date: string): boolean;
  /** "HH:mm" inclusive / exclusive ("24:00" = until midnight), like the working calendar. */
  start: string;
  end: string;
}

/** The working-time windows of the Tashkent days `from`..`to` (YYYY-MM-DD, inclusive), oldest first. */
export function workingWindows(from: string, to: string, cal: WorkingTime): Window[] {
  const [sh, sm] = cal.start.split(':').map(Number);
  const [eh, em] = cal.end.split(':').map(Number);
  const out: Window[] = [];
  let day = DateTime.fromISO(from, { zone: cal.timezone }).startOf('day');
  const last = DateTime.fromISO(to, { zone: cal.timezone }).startOf('day');
  for (let i = 0; day <= last && i < 4000; i++, day = day.plus({ days: 1 })) {
    if (!cal.isWorkingDay(day.toISODate() as string)) continue;
    const start = day.plus({ hours: sh, minutes: sm });
    const end = day.plus({ hours: eh, minutes: em });
    out.push([start.toMillis(), end.toMillis()]);
  }
  return out;
}

/** [start, end) of the Tashkent days `from`..`to` (inclusive). */
export function periodWindow(from: string, to: string, timezone: string): Window {
  return [
    DateTime.fromISO(from, { zone: timezone }).startOf('day').toMillis(),
    DateTime.fromISO(to, { zone: timezone }).startOf('day').plus({ days: 1 }).toMillis(),
  ];
}

export interface PresenceTotals {
  onlineSec: number;
  pauseSec: number;
  /** Pause seconds by reason (null = no reason), longest first. */
  pauses: Array<{ reason: string | null; sec: number }>;
}

function overlap(a: number, b: number, w: Window): number {
  return Math.max(0, Math.min(b, w[1]) - Math.max(a, w[0]));
}

/**
 * Online time = offline excluded, pauses included; pause time = `paused` intervals, also by reason. Each interval is
 * clipped to the period and, when `windows` is given (scope "working"), to working time. Open intervals run until
 * `now`; nothing is counted after `now`.
 */
export function summarizePresence(
  intervals: readonly PresenceIntervalFact[],
  opts: { period: Window; now: number; windows?: readonly Window[] },
): Map<string, PresenceTotals> {
  const [from, to] = [opts.period[0], Math.min(opts.period[1], opts.now)];
  const acc = new Map<string, { online: number; pause: number; reasons: Map<string | null, number> }>();
  for (const it of intervals) {
    if (it.state === 'offline') continue;
    const start = Math.max(it.startedAt.getTime(), from);
    const end = Math.min(it.endedAt?.getTime() ?? opts.now, to);
    if (end <= start) continue;
    const ms = opts.windows ? opts.windows.reduce((s, w) => s + overlap(start, end, w), 0) : end - start;
    if (ms <= 0) continue;
    let a = acc.get(it.extension);
    if (!a) {
      a = { online: 0, pause: 0, reasons: new Map() };
      acc.set(it.extension, a);
    }
    a.online += ms;
    if (it.state === 'paused') {
      a.pause += ms;
      a.reasons.set(it.pauseReason, (a.reasons.get(it.pauseReason) ?? 0) + ms);
    }
  }
  const sec = (ms: number) => Math.round(ms / 1000);
  return new Map(
    [...acc].map(([ext, a]) => [
      ext,
      {
        onlineSec: sec(a.online),
        pauseSec: sec(a.pause),
        pauses: [...a.reasons]
          .map(([reason, ms]) => ({ reason, sec: sec(ms) }))
          .filter((p) => p.sec > 0)
          .sort((x, y) => y.sec - x.sec || (x.reason ?? '').localeCompare(y.reason ?? '')),
      },
    ]),
  );
}
