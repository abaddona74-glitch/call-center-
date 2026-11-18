import type { ToolFileName } from '@cc/shared';

/** The installer package served by the API (`GET /api/tools/files/:name`). */
export const KEYBOARD_PACKAGE = 'uzb2026-klaviatura.zip' satisfies ToolFileName;

export interface KeyCombo {
  /** Letter key pressed together with the right Alt (AltGr). */
  key: string;
  shift: boolean;
  char: string;
}

/** Legacy cheat sheet (tools/uzb2026.html), in the same order. */
export const KEY_COMBOS: readonly KeyCombo[] = [
  { key: 'S', shift: false, char: 'ş' },
  { key: 'S', shift: true, char: 'Ş' },
  { key: 'C', shift: false, char: 'ç' },
  { key: 'C', shift: true, char: 'Ç' },
  { key: 'G', shift: false, char: 'ğ' },
  { key: 'G', shift: true, char: 'Ğ' },
  { key: 'O', shift: false, char: 'ö' },
  { key: 'O', shift: true, char: 'Ö' },
  { key: "'", shift: false, char: 'ʼ' },
];

/** Quick-insert buttons under the test area. */
export const QUICK_CHARS: readonly string[] = KEY_COMBOS.map((c) => c.char);

/** Legacy `insertChar`: replaces the selection with `ch`; returns the new text and caret position. */
export function insertAt(
  text: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
  ch: string,
): { text: string; caret: number } {
  const clamp = (n: number | null | undefined, fallback: number) => Math.max(0, Math.min(text.length, n ?? fallback));
  const start = clamp(selectionStart, text.length);
  const end = Math.max(start, clamp(selectionEnd, start));
  return { text: text.slice(0, start) + ch + text.slice(end), caret: start + ch.length };
}
