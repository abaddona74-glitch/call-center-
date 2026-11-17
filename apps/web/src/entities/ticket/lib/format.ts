import type { TicketStatus } from '@cc/shared';
import type { TFunction } from 'i18next';

/** Legacy `formatTimeAgo`: seconds/minutes/hours ago, then "DD.MM HH:mm". */
export function timeAgo(iso: string | null, t: TFunction<'ticket'>, now = Date.now()): string {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  const s = Math.floor((now - ts) / 1000);
  if (s < 60) return t('ago.seconds', { n: Math.max(1, s) });
  const m = Math.floor(s / 60);
  if (m < 60) return t('ago.minutes', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('ago.hours', { n: h });
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Legacy file size: B / KB / MB with one decimal. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Status colors of the legacy board (pending / in_progress / completed / rejected). */
export const STATUS_STRIPE: Record<TicketStatus, string> = {
  open: '#38bdf8',
  accepted: '#f59e0b',
  completed: '#10b981',
  rejected: '#ef4444',
};
