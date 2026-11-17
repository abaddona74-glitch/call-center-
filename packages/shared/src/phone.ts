/**
 * Phone number helpers shared by api and web.
 * Uzbekistan numbers are normalized to the 9-digit national form (e.g. "901234567").
 */

/** Digits only. */
export function digitsOnly(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/**
 * Normalize a caller number to the 9-digit national form when possible.
 * Returns null for internal extensions and garbage.
 *  "+998 (90) 123-45-67" -> "901234567"
 *  "998901234567"        -> "901234567"
 *  "8901234567"          -> "901234567"
 */
export function normalizeUzPhone(raw: unknown): string | null {
  let d = digitsOnly(raw);
  if (d.length === 12 && d.startsWith('998')) d = d.slice(3);
  else if (d.length === 10 && d.startsWith('8')) d = d.slice(1);
  if (d.length === 9) return d;
  // City numbers and other lengths are kept as-is (7-15 digits), shorter ones are extensions.
  if (d.length >= 7 && d.length <= 15) return d;
  return null;
}

/** Human readable: "+998 (90) 123-45-67" for 9-digit national numbers, otherwise as-is. */
export function formatUzPhone(raw: unknown): string {
  const n = normalizeUzPhone(raw);
  if (!n) return String(raw ?? '');
  if (n.length !== 9) return n;
  return `+998 (${n.slice(0, 2)}) ${n.slice(2, 5)}-${n.slice(5, 7)}-${n.slice(7, 9)}`;
}
