import { formatUzPhone, isMaskedPhone } from '@cc/shared';

/** "02:05" / "1:02:05" (legacy formatSeconds). */
export function formatSeconds(total: number): string {
  const sec = Math.max(0, Math.round(total || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Phone for display: "+998 (90) 123-45-67", masked numbers as they come, null -> fallback text. */
export function displayPhone(phone: string | null, hidden: string): string {
  if (!phone) return hidden;
  return isMaskedPhone(phone) ? `+998 ${phone}` : formatUzPhone(phone);
}

export interface Carrier {
  name: string;
  color: string;
}

const CARRIERS: Array<[string[], Carrier]> = [
  [['90', '91'], { name: 'Beeline', color: '#f59e0b' }],
  [['93', '94', '50', '55'], { name: 'Ucell', color: '#a855f7' }],
  [['95', '99', '77', '71', '78', '70'], { name: 'Uzmobile', color: '#0284c7' }],
  [['97', '88'], { name: 'Mobiuz', color: '#ef4444' }],
  [['33'], { name: 'Humans', color: '#eab308' }],
  [['98', '80'], { name: 'Perfectum', color: '#ec4899' }],
  [['20'], { name: 'OQ', color: '#06b6d4' }],
];

/** Mobile operator from the number prefix (legacy getUzbekistanOperator). Works for masked numbers too. */
export function carrierOf(phone: string | null): Carrier | null {
  if (!phone) return null;
  const code = phone.replace(/[^\d•]/g, '').slice(0, 2);
  return CARRIERS.find(([codes]) => codes.includes(code))?.[1] ?? null;
}
