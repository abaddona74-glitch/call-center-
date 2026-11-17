import type { MapperReport, RowIssue } from './mapper.js';

const STATUS_LABEL: Record<MapperReport['status'], string> = {
  ok: 'ok',
  'not-implemented': 'NOT IMPLEMENTED',
  'source-missing': 'SOURCE MISSING',
  failed: 'FAILED',
};

function issues(label: string, list: readonly RowIssue[]): string[] {
  return list.map((i) => `    ${label.padEnd(8)} ${i.key}: ${i.reason}`);
}

/** Plain-text report printed by the CLI. Contains usernames, never hashes or emails. */
export function formatReport(reports: readonly MapperReport[], opts: { dryRun: boolean }): string {
  const lines: string[] = [];
  lines.push(
    opts.dryRun
      ? '=== Legacy migration: DRY RUN (read-only transaction, nothing was written) ==='
      : '=== Legacy migration: APPLIED ===',
  );

  for (const r of reports) {
    lines.push('', `${r.name} [owner ${r.owner}] ${STATUS_LABEL[r.status]}`);
    if (r.status === 'not-implemented' || r.status === 'source-missing') {
      lines.push(`    read ${r.read} (not migrated)`);
    } else {
      const would = opts.dryRun ? 'would ' : '';
      lines.push(
        `    read ${r.read} | ${would}insert ${r.inserted} | ${would}update ${r.updated} | unchanged ${r.unchanged}` +
          ` | skipped ${r.skipped.length} | warnings ${r.warnings.length} | errors ${r.errors.length}`,
      );
    }
    lines.push(...issues('error', r.errors), ...issues('skipped', r.skipped), ...issues('warning', r.warnings));
    lines.push(...r.notes.map((n) => `    ${'note'.padEnd(8)} ${n}`));
  }

  const count = (s: MapperReport['status']) => reports.filter((r) => r.status === s).length;
  lines.push(
    '',
    `Summary: ${count('ok')} ok, ${count('not-implemented')} not implemented, ` +
      `${count('source-missing')} source missing, ${count('failed')} failed`,
  );
  return lines.join('\n');
}
