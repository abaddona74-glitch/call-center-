import type { TFunction } from 'i18next';

/** Legacy shows callback numbers as plain national digits (998 stripped), e.g. 901234567. */
export function callbackPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length === 12 && d.startsWith('998') ? d.slice(3) : d;
}

/** "hozirgina" / "5 daq oldin" / "2 soat oldin" / "3 kun oldin" (legacy thresholds). */
export function relativeTime(iso: string, t: TFunction, now: number = Date.now()): string {
  const s = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(s) || s < 0) return '';
  if (s < 60) return t('callback:time.justNow');
  const min = Math.floor(s / 60);
  if (min < 60) return t('callback:time.minAgo', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('callback:time.hourAgo', { n: h });
  return t('callback:time.dayAgo', { n: Math.floor(h / 24) });
}
