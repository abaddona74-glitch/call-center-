import { existsSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';

export const USAGE = `Usage:
  node dist/scripts/migrate-legacy/main.js --sqlite <legacy callcenter.db> [--data-dir <dir with legacy JSON files>]
                                           [--dry-run] [--only users,passkeys,...]

  --sqlite     legacy SQLite database (opened read-only); at least one of --sqlite / --data-dir is required
  --data-dir   directory holding the legacy JSON files (tickets.json, stt_custom_rules.json, ...);
               a missing file is reported, not fatal
  --dry-run    read and plan only, inside a READ ONLY transaction that is rolled back
  --only       comma-separated mapper names (default: all)

The target is DATABASE_URL (environment, or .env.local / .env in the current directory).`;

const FLAG_BY_KEY: Record<string, string> = {
  sqlite: '--sqlite',
  dataDir: '--data-dir',
  dryRun: '--dry-run',
  only: '--only',
};

const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

export function cliArgsSchema(mapperNames: readonly [string, ...string[]]) {
  return z
    .object({
      sqlite: z.string().min(1).refine(isFile, 'file not found').optional(),
      dataDir: z.string().min(1).refine(isDir, 'directory not found').optional(),
      dryRun: z.boolean(),
      only: z
        .string()
        .transform((v) =>
          v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
        .pipe(z.array(z.enum(mapperNames)).min(1, 'expected at least one mapper name'))
        .optional(),
    })
    .refine((a) => a.sqlite !== undefined || a.dataDir !== undefined, {
      message: 'pass --sqlite and/or --data-dir',
      path: ['sqlite'],
    });
}
export type CliArgs = z.infer<ReturnType<typeof cliArgsSchema>>;

export type ParseResult = { ok: true; args: CliArgs } | { ok: false; help: boolean; error: string };

export function parseCliArgs(argv: readonly string[], mapperNames: readonly [string, ...string[]]): ParseResult {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        sqlite: { type: 'string' },
        'data-dir': { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        only: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (err) {
    return { ok: false, help: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (values.help) return { ok: false, help: true, error: '' };

  const parsed = cliArgsSchema(mapperNames).safeParse({
    sqlite: values.sqlite,
    dataDir: values['data-dir'],
    dryRun: values['dry-run'],
    only: values.only,
  });
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${FLAG_BY_KEY[String(i.path[0])] ?? String(i.path[0] ?? 'args')}: ${i.message}`)
      .join('\n');
    return { ok: false, help: false, error };
  }
  return { ok: true, args: parsed.data };
}
