import type { Generated } from 'kysely';

/** One row (id = 1): the extensions hidden from the operators board and per-operator statistics. */
export interface ExcludedOperatorsTable {
  id: Generated<number>;
  extensions: string[];
  updatedAt: Generated<Date>;
  updatedByUserId: number | null;
}

declare module '../../database/db.js' {
  interface DB {
    excludedOperators: ExcludedOperatorsTable;
  }
}
