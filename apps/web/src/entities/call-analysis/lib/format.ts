import type { TranscriptSegment } from '@cc/shared';

/** The UI language's half of a `{ uz, ru }` text written by the model; falls back to the other half. */
export function pickText(text: { uz: string; ru: string } | null | undefined, language: string): string {
  if (!text) return '';
  const primary = language.startsWith('ru') ? text.ru : text.uz;
  return primary || text.uz || text.ru;
}

/** Position in a recording: "m:ss", or "h:mm:ss" from one hour. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export type ScoreTone = 'success' | 'info' | 'warning' | 'danger' | 'muted';

/** Colour of a score on a 1–`max` scale (5 for criteria, 10 for the overall score). */
export function scoreTone(value: number | null | undefined, max: number): ScoreTone {
  if (value === null || value === undefined) return 'muted';
  const r = value / max;
  if (r >= 0.8) return 'success';
  if (r >= 0.6) return 'info';
  if (r >= 0.4) return 'warning';
  return 'danger';
}

/** Index of the segment being heard at `position` seconds (the last one that started; segments sorted by start), -1 before the first. */
export function activeSegmentIndex(
  segments: readonly Pick<TranscriptSegment, 'start' | 'end'>[],
  position: number,
): number {
  let found = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].start > position) break;
    found = i;
  }
  return found;
}

/** One decimal, "—" for no value. */
export function formatAvg(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? '—' : value.toFixed(digits);
}
