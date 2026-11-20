import type { TFunction } from 'i18next';

/**
 * How long past the due date (SLA `due_at`), in ms: to the resolution when it was resolved late, to `now` while it is
 * still with the region. null without a due date or when in time.
 */
export function overdueMs(dueAt: string | null, resolvedAt: string | null, now: number): number | null {
  if (!dueAt) return null;
  const ms = (resolvedAt ? new Date(resolvedAt).getTime() : now) - new Date(dueAt).getTime();
  return ms > 0 ? ms : null;
}

/** Whole days / hours / minutes of a span (rounded down, at least one minute). */
export function spanParts(ms: number): { d: number; h: number; m: number } {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  return { d: Math.floor(minutes / 1440), h: Math.floor((minutes % 1440) / 60), m: minutes % 60 };
}

/** The two largest units: "2 kun 5 soat", "3 kun", "5 soat 12 daqiqa", "12 daqiqa". */
export function overdueText(ms: number, t: TFunction<'ticket'>): string {
  const { d, h, m } = spanParts(ms);
  if (d > 0) return h > 0 ? t('late.dh', { d, h }) : t('late.d', { d });
  if (h > 0) return m > 0 ? t('late.hm', { h, m }) : t('late.h', { h });
  return t('late.m', { m });
}
