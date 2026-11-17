import { type Kysely, sql } from 'kysely';

/**
 * Ticket directories (docs/rewrite/TICKETS.md): regions (14 of Uzbekistan, seeded), cities/districts
 * per region, ticket categories, and which executive works for which regions (many-to-many).
 * Rows are deactivated rather than deleted once tickets reference them (FKs are RESTRICT).
 */
const REGIONS: Array<[code: string, uz: string, ru: string]> = [
  ['toshkent-shahri', 'Toshkent shahri', 'г. Ташкент'],
  ['toshkent-viloyati', 'Toshkent viloyati', 'Ташкентская область'],
  ['andijon', 'Andijon', 'Андижанская область'],
  ['buxoro', 'Buxoro', 'Бухарская область'],
  ['fargona', 'Fargʻona', 'Ферганская область'],
  ['jizzax', 'Jizzax', 'Джизакская область'],
  ['xorazm', 'Xorazm', 'Хорезмская область'],
  ['namangan', 'Namangan', 'Наманганская область'],
  ['navoiy', 'Navoiy', 'Навоийская область'],
  ['qashqadaryo', 'Qashqadaryo', 'Кашкадарьинская область'],
  ['samarqand', 'Samarqand', 'Самаркандская область'],
  ['sirdaryo', 'Sirdaryo', 'Сырдарьинская область'],
  ['surxondaryo', 'Surxondaryo', 'Сурхандарьинская область'],
  ['qoraqalpogiston', 'Qoraqalpogʻiston Respublikasi', 'Республика Каракалпакстан'],
];

const CATEGORIES: Array<[uz: string, ru: string, sort: number]> = [
  ['ERI (EDS) kaliti', 'Ключ ЭЦП', 10],
  ['EDO (elektron hujjat almashinuvi)', 'ЭДО', 20],
  ['E-Huquqshunos', 'E-Huquqshunos', 30],
  ['Boshqa', 'Другое', 1000],
];

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('ticket_regions')
    .addColumn('id', 'integer', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('code', 'text', (c) => c.notNull().unique())
    .addColumn('name_uz', 'text', (c) => c.notNull())
    .addColumn('name_ru', 'text', (c) => c.notNull())
    .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(100))
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('ticket_cities')
    .addColumn('id', 'integer', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('region_id', 'integer', (c) => c.notNull().references('ticket_regions.id').onDelete('restrict'))
    .addColumn('name_uz', 'text', (c) => c.notNull())
    .addColumn('name_ru', 'text', (c) => c.notNull())
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('ticket_cities_region_name_uq', ['region_id', 'name_uz'])
    .execute();

  await db.schema
    .createTable('ticket_categories')
    .addColumn('id', 'integer', (c) => c.generatedAlwaysAsIdentity().primaryKey())
    .addColumn('name_uz', 'text', (c) => c.notNull().unique())
    .addColumn('name_ru', 'text', (c) => c.notNull())
    .addColumn('sort_order', 'integer', (c) => c.notNull().defaultTo(100))
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('ticket_executive_regions')
    .addColumn('user_id', 'bigint', (c) => c.notNull().references('users.id').onDelete('cascade'))
    .addColumn('region_id', 'integer', (c) => c.notNull().references('ticket_regions.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('ticket_executive_regions_pk', ['user_id', 'region_id'])
    .execute();
  await db.schema
    .createIndex('ticket_executive_regions_region_idx')
    .on('ticket_executive_regions')
    .column('region_id')
    .execute();

  await db
    .insertInto('ticket_regions')
    .values(
      REGIONS.map(([code, nameUz, nameRu], i) => ({
        code,
        name_uz: nameUz,
        name_ru: nameRu,
        sort_order: (i + 1) * 10,
      })),
    )
    .execute();
  await db
    .insertInto('ticket_categories')
    .values(CATEGORIES.map(([nameUz, nameRu, sort]) => ({ name_uz: nameUz, name_ru: nameRu, sort_order: sort })))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('ticket_executive_regions').execute();
  await db.schema.dropTable('ticket_categories').execute();
  await db.schema.dropTable('ticket_cities').execute();
  await db.schema.dropTable('ticket_regions').execute();
}
