import { type ExcludedOperatorChoice, compareExtensions } from '@cc/shared';

/**
 * The server lists the PBX directory and every excluded number; operators seen only on the live board
 * (AMI peers missing from asterisk.users) are added so they can be excluded too.
 */
export function withLiveOperators(
  choices: readonly ExcludedOperatorChoice[],
  live: ReadonlyArray<{ extension: string; name: string }> | undefined,
): ExcludedOperatorChoice[] {
  const byExt = new Map(choices.map((c) => [c.extension, c]));
  for (const op of live ?? []) {
    if (!byExt.has(op.extension)) byExt.set(op.extension, { extension: op.extension, name: op.name, excluded: false });
  }
  return [...byExt.values()].sort((a, b) => compareExtensions(a.extension, b.extension));
}

/** Legacy filterExcludeOperators: by extension or name, case-insensitive. */
export function matchesSearch(choice: ExcludedOperatorChoice, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return choice.extension.includes(q) || (choice.name ?? '').toLowerCase().includes(q);
}
