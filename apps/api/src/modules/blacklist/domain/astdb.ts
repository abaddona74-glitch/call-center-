import type { BlacklistScope } from '@cc/shared';

/**
 * How blocked numbers map onto Asterisk AstDB (legacy semantics):
 *  - global scope → family `blacklist` (FreePBX blacklist, the call is rejected for everyone);
 *  - operator scope → family `blacklist_<ext>` (custom dialplan skips that operator only).
 * Each number is written under every caller-id form the trunk may deliver.
 */
export function astdbFamily(scope: BlacklistScope, extension: string | null): string {
  if (scope === 'global') return 'blacklist';
  if (!extension || !/^\d{2,6}$/.test(extension)) throw new RangeError('Operator scope needs a numeric extension');
  return `blacklist_${extension}`;
}

/** Keys for a normalized number: 9-digit national numbers also get the 998 form. */
export function astdbKeys(number: string): string[] {
  if (!/^\d{3,15}$/.test(number)) throw new RangeError('Number must be 3-15 digits');
  return number.length === 9 ? [number, `998${number}`] : [number];
}

/** AstDB value: letters, digits and a few separators only (legacy rule), never empty. */
export function astdbValue(note: string): string {
  const cleaned = note
    .normalize('NFC')
    .replace(/\s/g, ' ')
    .replace(/[^\p{L}\p{N} _.,:()-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return cleaned || '1';
}
