/** National 9 digits → +998…; other numbers as digits. */
function internationalDigits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 9) return `998${d}`;
  return d;
}

/** Telegram deep link by phone number (works from any account). */
export function telegramByPhoneUrl(phone: string): string | null {
  const d = internationalDigits(phone);
  return d.length >= 7 ? `https://t.me/+${d}` : null;
}

/**
 * Legacy openTelegramUser: @username → https://t.me/username; numeric id → tg://user?id=…
 * (the numeric link only opens from an account that already knows the user).
 */
export function telegramUrl(telegram: string | null | undefined, phone?: string): string | null {
  const v = (telegram ?? '').trim();
  if (v.startsWith('@')) return `https://t.me/${encodeURIComponent(v.slice(1))}`;
  if (/^\d{5,15}$/.test(v)) return `tg://user?id=${v}`;
  return phone ? telegramByPhoneUrl(phone) : null;
}
