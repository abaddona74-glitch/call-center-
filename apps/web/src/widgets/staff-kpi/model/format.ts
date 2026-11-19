/** Formatting of the KPI figures (pure). */

/** Column groups of the operators table that the «Ko‘rinish» filter can show alone (the rating goes with calls). */
export const KPI_GROUPS = ['calls', 'tickets', 'quality', 'presence'] as const;
export type KpiGroup = (typeof KPI_GROUPS)[number];

/** Online / pause time split for display: whole hours and minutes ("50 s 51 daq" / "50 ч 51 мин"). */
export function hoursAndMinutes(sec: number): { h: number; m: number } {
  const s = Math.max(0, Math.round(sec));
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) };
}

/** "92%" / "92.5%", one decimal at most; null → null. */
export function percentText(value: number | null, locale: string): string | null {
  if (value === null) return null;
  return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
}

/** Hours with one decimal ("1,5"), locale-aware; null → null. */
export function hoursText(value: number | null, locale: string): string | null {
  return value === null ? null : value.toLocaleString(locale, { maximumFractionDigits: 1 });
}

/** Colour of an on-time / handled share: green from 90 %, amber below 70 %. */
export function shareTone(value: number | null): string {
  if (value === null) return 'text-mute';
  if (value >= 90) return 'font-semibold text-positive';
  if (value < 70) return 'font-semibold text-caution';
  return 'text-ink';
}

/** Colour of an average client rating (1–5), like the statistics page. */
export function surveyTone(avg: number): string {
  if (avg >= 4.5) return 'text-positive';
  if (avg >= 3.5) return '';
  if (avg >= 2.5) return 'text-caution';
  return 'text-danger';
}

/** Sort value: null (no data) → undefined, which the table always sorts last. */
export const orLast = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

/**
 * Text colour of an average score (1–`max`, same thresholds as «Tahlil»'s scoreTone) that keeps 4.5:1 on the table
 * in both themes (the light theme needs the deeper variants).
 */
export function scoreClass(value: number, max: number): string {
  const r = value / max;
  if (r >= 0.8) return 'text-positive';
  if (r >= 0.6) return 'text-info light:text-link';
  if (r >= 0.4) return 'text-caution';
  return 'text-danger light:text-danger-soft';
}

/** Red figures (late, overdue, red flags): the light theme's red needs the deeper shade at 13 px. */
export const DANGER_TEXT = 'text-danger light:text-danger-soft';
