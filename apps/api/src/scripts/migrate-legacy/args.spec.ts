import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCliArgs } from './args.js';
import { parseLegacyLocalTime, parseLegacyUtcTime } from './time.js';

const NAMES = ['users', 'tickets'] as [string, ...string[]];

describe('parseCliArgs', () => {
  let dir: string;
  let sqlite: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'cc-migrate-args-'));
    sqlite = path.join(dir, 'callcenter.db');
    writeFileSync(sqlite, '');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('accepts the documented flags', () => {
    expect(
      parseCliArgs(['--sqlite', sqlite, '--data-dir', dir, '--dry-run', '--only', 'users, tickets'], NAMES),
    ).toEqual({
      ok: true,
      args: { sqlite, dataDir: dir, dryRun: true, only: ['users', 'tickets'] },
    });
    expect(parseCliArgs(['--sqlite', sqlite], NAMES)).toEqual({ ok: true, args: { sqlite, dryRun: false } });
  });

  it('rejects bad input with a message naming the flag', () => {
    const fail = (argv: string[]) => {
      const r = parseCliArgs(argv, NAMES);
      return r.ok ? 'ok' : r.error;
    };
    expect(fail([])).toBe('--sqlite: pass --sqlite and/or --data-dir');
    expect(fail(['--sqlite', path.join(dir, 'nope.db')])).toBe('--sqlite: file not found');
    expect(fail(['--data-dir', sqlite])).toBe('--data-dir: directory not found');
    expect(fail(['--sqlite', sqlite, '--only', 'users,passwords'])).toMatch(/^--only: /);
    expect(fail(['--sqlite', sqlite, '--only', ','])).toBe('--only: expected at least one mapper name');
    expect(fail(['--sqlite', sqlite, '--database-url', 'x'])).toMatch(/Unknown option '--database-url'/);
  });

  it('recognises --help', () => {
    expect(parseCliArgs(['-h'], NAMES)).toEqual({ ok: false, help: true, error: '' });
  });
});

describe('legacy time parsing', () => {
  it('reads wall-clock text as Asia/Tashkent (UTC+5)', () => {
    expect(parseLegacyLocalTime('2026-01-05 09:30:00')?.toISOString()).toBe('2026-01-05T04:30:00.000Z');
    expect(parseLegacyLocalTime('2026-01-05T09:30:00Z')?.toISOString()).toBe('2026-01-05T09:30:00.000Z');
  });

  it('reads CURRENT_TIMESTAMP text as UTC', () => {
    expect(parseLegacyUtcTime('2026-01-05 09:30:00')?.toISOString()).toBe('2026-01-05T09:30:00.000Z');
  });

  it('returns null for empty or unparsable values', () => {
    expect(parseLegacyLocalTime(null)).toBeNull();
    expect(parseLegacyLocalTime('  ')).toBeNull();
    expect(parseLegacyLocalTime('yesterday')).toBeNull();
  });
});
