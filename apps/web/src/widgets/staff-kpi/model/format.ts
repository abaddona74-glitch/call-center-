/** Formatting of the KPI figures (pure). */

/** Column groups of the operators table that the «Ko‘rinish» filter can show alone (the rating goes with calls). */
export const KPI_GROUPS = ['calls', 'tickets', 'quality', 'presence'] as const;
export type KpiGroup = (typeof KPI_GROUPS)[number];

/** "12:05" hours:minutes for online / pause time; "0:00" for nothing. */
export function hoursMinutes(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
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
