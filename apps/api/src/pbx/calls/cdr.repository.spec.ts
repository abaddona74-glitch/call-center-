import type { AppConfig } from '../../config/app-config.js';
import type { PbxDb } from '../pbx-db.module.js';
import { CdrRepository } from './cdr.repository.js';

/** Just enough of Kysely's select chain for surveyRatings(): every builder call returns itself. */
function fakeDb(execute: () => Promise<unknown[]>): PbxDb {
  const chain = { select: () => chain, where: () => chain, limit: () => chain, execute };
  return { selectFrom: () => chain } as unknown as PbxDb;
}
const config = { get: () => true } as unknown as AppConfig;
const mysqlError = (code: string) => Object.assign(new Error(code), { code });

describe('CdrRepository.surveyRatings', () => {
  it('maps rows of asteriskcdrdb.operator_baho', async () => {
    const repo = new CdrRepository(
      fakeDb(async () => [{ uniqueid: '1794993024.1', linkedid: null, operator_ext: ' 111 ', baho: 4 }]),
      config,
    );
    await expect(repo.surveyRatings('2026-11-18 00:00:00', '2026-11-19 00:00:00')).resolves.toEqual([
      { uniqueid: '1794993024.1', linkedid: '', operatorExt: '111', score: 4 },
    ]);
  });

  it.each([
    'ER_NO_SUCH_TABLE', // survey not installed on the PBX
    'ER_TABLEACCESS_DENIED_ERROR', // installed, but cc_readonly has no GRANT yet (DEPLOY.md §11.1)
    'ER_COLUMNACCESS_DENIED_ERROR',
    'ER_BAD_FIELD_ERROR', // a different table layout
  ])('%s → null (column hidden), never an error', async (code) => {
    const repo = new CdrRepository(
      fakeDb(async () => {
        throw mysqlError(code);
      }),
      config,
    );
    await expect(repo.surveyRatings('2026-11-18 00:00:00', '2026-11-19 00:00:00')).resolves.toBeNull();
    await expect(repo.surveyRatings('2026-11-18 00:00:00', '2026-11-19 00:00:00')).resolves.toBeNull();
  });

  it('any other failure → null as well: the survey must not take the CDR statistics down', async () => {
    const repo = new CdrRepository(
      fakeDb(async () => {
        throw mysqlError('ECONNRESET');
      }),
      config,
    );
    await expect(repo.surveyRatings('2026-11-18 00:00:00', '2026-11-19 00:00:00')).resolves.toBeNull();
  });
});
