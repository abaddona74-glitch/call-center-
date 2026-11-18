import { readFirstSheet } from '../../common/files/xlsx-reader.js';

/**
 * Rows of the first worksheet as `{ header (lower case) → cell text }`; the first non-empty row is the
 * header. The registry has ~47 000 rows (≈ 13 MB of sheet XML and 30 MB of shared strings): read at once.
 */
export function xlsxRecords(buffer: Buffer): Array<Record<string, string>> {
  const rows = readFirstSheet(buffer);
  const start = rows.findIndex((r) => r.some((c) => c.trim() !== ''));
  if (start < 0) return [];
  const header = (rows[start] ?? []).map((h) => h.trim().toLowerCase());
  const out: Array<Record<string, string>> = [];
  for (const row of rows.slice(start + 1)) {
    if (!row.some((c) => c.trim() !== '')) continue;
    const record: Record<string, string> = {};
    header.forEach((name, i) => {
      if (name) record[name] = (row[i] ?? '').trim();
    });
    out.push(record);
  }
  return out;
}
