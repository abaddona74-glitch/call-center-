import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';

export type SqliteRow = Record<string, SQLOutputValue>;

/** The legacy `callcenter.db`, opened read-only. Nothing here can modify it. */
export class LegacySqlite {
  private readonly db: DatabaseSync;

  constructor(readonly filePath: string) {
    this.db = new DatabaseSync(filePath, { readOnly: true });
  }

  hasTable(name: string): boolean {
    return this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
  }

  columns(table: string): string[] {
    if (!this.hasTable(table)) return [];
    return this.db
      .prepare('SELECT name FROM pragma_table_info(?)')
      .all(table)
      .map((r) => String(r.name));
  }

  /** Row count of an existing table (the name is checked against sqlite_master first). */
  count(table: string): number {
    if (!this.hasTable(table)) throw new Error(`Legacy table ${table} does not exist`);
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM "${table.replaceAll('"', '""')}"`).get();
    return Number(row?.n ?? 0);
  }

  all(query: string, ...params: SQLInputValue[]): SqliteRow[] {
    return this.db.prepare(query).all(...params);
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}

export type JsonSource =
  | { status: 'ok'; path: string; data: unknown }
  | { status: 'missing'; path: string | null }
  | { status: 'invalid'; path: string; error: string };

export interface LegacySources {
  /** Null when `--sqlite` was not given. */
  sqlite: LegacySqlite | null;
  /** Null when `--data-dir` was not given. */
  dataDir: string | null;
  /**
   * Reads `<data-dir>/<fileName>`. A missing directory or file is `missing` (the mapper reports it),
   * unparsable JSON is `invalid`. `fileName` must be a bare file name.
   */
  readJson(fileName: string): JsonSource;
  close(): void;
}

export function openLegacySources(opts: { sqlitePath?: string; dataDir?: string }): LegacySources {
  const sqlite = opts.sqlitePath ? new LegacySqlite(opts.sqlitePath) : null;
  const dataDir = opts.dataDir ? path.resolve(opts.dataDir) : null;

  return {
    sqlite,
    dataDir,
    readJson(fileName: string): JsonSource {
      if (path.basename(fileName) !== fileName) throw new Error(`Expected a bare file name, got "${fileName}"`);
      if (!dataDir) return { status: 'missing', path: null };
      const file = path.join(dataDir, fileName);
      if (!existsSync(file)) return { status: 'missing', path: file };
      try {
        return { status: 'ok', path: file, data: JSON.parse(readFileSync(file, 'utf8')) as unknown };
      } catch (err) {
        return { status: 'invalid', path: file, error: err instanceof Error ? err.message : String(err) };
      }
    },
    close() {
      sqlite?.close();
    },
  };
}
