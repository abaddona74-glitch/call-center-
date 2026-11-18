import { z } from 'zod';
import { ExtensionSchema } from './auth.js';

/**
 * Excluded operators (legacy `system_settings.excluded_operators`, owner decision 2026-11-18): extensions
 * that are hidden from the live operators board (and so from the rating), from the per-operator statistics
 * table and from the Excel report. As in legacy, their calls still count in the call-center totals
 * (KPI, hourly/daily charts) and in the call history. Edited with `settings.manage`.
 */

/** Most extensions the list may hold (the PBX has a few dozen). */
export const EXCLUDED_OPERATORS_MAX = 200;

export const ExcludedOperatorsInputSchema = z.object({
  /** Order and duplicates do not matter: the server stores a sorted, distinct list. */
  extensions: z.array(ExtensionSchema).max(EXCLUDED_OPERATORS_MAX),
});
export type ExcludedOperatorsInput = z.infer<typeof ExcludedOperatorsInputSchema>;

/** One checkbox of the settings screen. */
export const ExcludedOperatorChoiceSchema = z.object({
  extension: z.string(),
  /** From the PBX directory (`asterisk.users`); null when the PBX does not know the number. */
  name: z.string().nullable(),
  excluded: z.boolean(),
});
export type ExcludedOperatorChoice = z.infer<typeof ExcludedOperatorChoiceSchema>;

export const ExcludedOperatorsSchema = z.object({
  /** Sorted by number. */
  extensions: z.array(z.string()),
  /** PBX directory + every excluded extension, sorted by number (legacy GET /api/settings/exclude-list). */
  operators: z.array(ExcludedOperatorChoiceSchema),
  /** False when the PBX database could not be read: only the excluded extensions are listed. */
  directoryAvailable: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type ExcludedOperatorsInfo = z.infer<typeof ExcludedOperatorsSchema>;

/** Sort extensions as numbers ("99" before "101"), ties by text. */
export function compareExtensions(a: string, b: string): number {
  return Number(a) - Number(b) || a.localeCompare(b);
}

/** Trimmed, distinct, sorted by number. */
export function normalizeExtensions(list: Iterable<string>): string[] {
  return [...new Set([...list].map((e) => e.trim()).filter(Boolean))].sort(compareExtensions);
}
