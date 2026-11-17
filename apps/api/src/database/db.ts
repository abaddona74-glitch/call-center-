import { Inject } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterKysely } from '@nestjs-cls/transactional-adapter-kysely';

/**
 * PostgreSQL schema as seen by Kysely (camelCase in TS, snake_case in SQL via CamelCasePlugin).
 *
 * Each module declares its own tables in `<module>.tables.ts` and merges them here:
 *
 *   declare module '../../database/db.js' {
 *     interface DB { users: UsersTable; sessions: SessionsTable }
 *   }
 *
 * so parallel work on different modules never edits this file.
 */
// oxlint-disable-next-line typescript/no-empty-object-type -- filled via declaration merging
export interface DB {}

/**
 * Database access for services. `txHost.tx` is the current transaction when the call
 * runs inside a `@Transactional()` method, otherwise the plain Kysely instance.
 *
 *   constructor(@InjectDb() private readonly txHost: DbHost) {}
 *   await this.txHost.tx.selectFrom('users').selectAll().execute();
 */
export type DbHost = TransactionHost<TransactionalAdapterKysely<DB>>;
export const InjectDb = () => Inject(TransactionHost);
