import type { Generated } from 'kysely';

export interface OperatorGroupsTable {
  id: Generated<number>;
  name: string;
  description: string | null;
  /** Permissions flags (validated with PermissionsSchema on read; missing flags get defaults). */
  permissions: unknown;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

declare module '../../database/db.js' {
  interface DB {
    operatorGroups: OperatorGroupsTable;
  }
}
