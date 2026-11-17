/** Formatting of instants in the business timezone (Asia/Tashkent), independent of the browser's zone. */
const TZ = 'Asia/Tashkent';

const parts = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** "YYYY-MM-DD HH:mm:ss" in Tashkent. */
export function tashkentDateTime(iso: string | Date): string {
  return parts.format(typeof iso === 'string' ? new Date(iso) : iso).replace('T', ' ');
}

/** "YYYY-MM-DD" in Tashkent. */
export function tashkentDate(iso: string | Date = new Date()): string {
  return tashkentDateTime(iso).slice(0, 10);
}

/** "HH:mm" if the instant is today in Tashkent, else "MM-DD HH:mm" (legacy callbacks time column). */
export function shortTashkentTime(iso: string, now: Date = new Date()): string {
  const full = tashkentDateTime(iso);
  return full.startsWith(tashkentDate(now)) ? full.slice(11, 16) : full.slice(5, 16);
}
