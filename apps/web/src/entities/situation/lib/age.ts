/**
 * Coarse age of a ticket for the situation board: "2 kun 3 soat" / "2 д 3 ч", "3 soat 5 daq" / "3 ч 5 мин",
 * "12 daq" / "12 мин", "<1 daq" / "<1 мин". Minutes are enough for tickets (calls use the mm:ss stopwatches).
 */
const UNITS = {
  uz: { d: 'kun', h: 'soat', m: 'daq' },
  ru: { d: 'д', h: 'ч', m: 'мин' },
} as const;

export function formatAge(seconds: number, lang: string): string {
  const u = lang === 'ru' ? UNITS.ru : UNITS.uz;
  const total = Math.max(0, Math.floor(seconds / 60));
  if (total < 1) return `<1 ${u.m}`;
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return h > 0 ? `${d} ${u.d} ${h} ${u.h}` : `${d} ${u.d}`;
  if (h > 0) return m > 0 ? `${h} ${u.h} ${m} ${u.m}` : `${h} ${u.h}`;
  return `${m} ${u.m}`;
}
