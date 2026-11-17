import { emptyReport, type Mapper, type MapperReport } from '../mapper.js';

export interface StubSources {
  /** Legacy SQLite tables this mapper will read. */
  sqliteTables?: readonly string[];
  /** JSON files expected in `--data-dir`, with how to count their records. */
  jsonFiles?: readonly { file: string; count: (data: unknown) => number }[];
}

/** Counts records of a JSON file that is either an array or `{ [key]: [...] }`. */
export function countArray(key?: string) {
  return (data: unknown): number => {
    const value =
      key && data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>)[key] : data;
    return Array.isArray(value) ? value.length : 0;
  };
}

/**
 * Placeholder for a mapper another session owns. It migrates nothing, but reports how many
 * legacy records are waiting and which sources are missing, so a dry-run shows the whole picture.
 * Replace it with a real implementation (same `Mapper` interface, see users.mapper.ts).
 */
export function notImplementedMapper(meta: { name: string; owner: string }, sources: StubSources): Mapper {
  return {
    ...meta,
    async run(ctx): Promise<MapperReport> {
      const report = emptyReport(meta, 'not-implemented');
      report.notes.push(`not implemented — owned by ${meta.owner}; nothing is migrated`);

      for (const table of sources.sqliteTables ?? []) {
        if (!ctx.legacy.sqlite) report.notes.push(`${table}: --sqlite not given`);
        else if (!ctx.legacy.sqlite.hasTable(table)) report.notes.push(`${table}: legacy table not found`);
        else {
          const n = ctx.legacy.sqlite.count(table);
          report.read += n;
          report.notes.push(`${table}: ${n} rows waiting`);
        }
      }

      for (const { file, count } of sources.jsonFiles ?? []) {
        const src = ctx.legacy.readJson(file);
        if (src.status === 'missing') {
          report.notes.push(`${file}: ${src.path ? 'not found in --data-dir' : '--data-dir not given'}`);
        } else if (src.status === 'invalid') {
          report.notes.push(`${file}: not valid JSON (${src.error})`);
        } else {
          const n = count(src.data);
          report.read += n;
          report.notes.push(`${file}: ${n} records waiting`);
        }
      }
      return report;
    },
  };
}
