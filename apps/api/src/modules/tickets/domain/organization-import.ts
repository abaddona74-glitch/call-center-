import { TICKET_ORGANIZATION_NAME_MAX } from '@cc/shared';

/**
 * The organization registry export (.xlsx, one row per organization), as the owner gave it on 18.11.2026:
 *   id | created_at | updated_at | tin | region_json | district_json | name_uz | name_uz_latn | name_ru | …
 * `name_uz` is Cyrillic, `name_uz_latn` Latin; region/district are JSON objects with the same name fields.
 */
export const ORGANIZATION_COLUMNS = {
  id: 'id',
  tin: 'tin',
  region: 'region_json',
  district: 'district_json',
  nameCyr: 'name_uz',
  nameLatin: 'name_uz_latn',
  nameRu: 'name_ru',
} as const;

export interface OrganizationRecord {
  externalId: string;
  tin: string | null;
  name: string;
  searchText: string;
  regionId: number | null;
  district: string | null;
}

/** Apostrophes and quotes as they appear in Uzbek names: Oʻzbekiston, O‘zbekiston, O'zbekiston, “…”. */
const MARKS = /[ʻʼʹ'‘’`´"“”«»]/g;

/** The same form for stored names and typed queries: lower case, no apostrophes/quotes, single spaces. */
export function normalizeOrgText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(MARKS, '').replace(/\s+/g, ' ').trim();
}

/** Words of a search query (at most 5, each at least 2 characters). */
export function searchTokens(query: string): string[] {
  return normalizeOrgText(query)
    .split(' ')
    .filter((w) => w.length >= 2)
    .slice(0, 5);
}

const slug = (text: string) =>
  normalizeOrgText(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Registry region name → ticket region id. Ticket regions are matched by code or Uzbek name, so
 * "Samarqand viloyati" → `samarqand`, "Toshkent shahri" → `toshkent-shahri`,
 * "Qoraqalpogʻiston Respublikasi" → `qoraqalpogiston`. Unknown names → null.
 */
export function regionMatcher(
  regions: ReadonlyArray<{ id: number; code: string; nameUz: string }>,
): (registryName: string | null | undefined) => number | null {
  const byKey = new Map<string, number>();
  for (const r of regions) {
    byKey.set(r.code, r.id);
    byKey.set(slug(r.nameUz), r.id);
  }
  return (name) => {
    if (!name) return null;
    const key = slug(name);
    return byKey.get(key) ?? byKey.get(key.replace(/-(viloyati|respublikasi)$/, '')) ?? null;
  };
}

const clean = (value: string | undefined, max = TICKET_ORGANIZATION_NAME_MAX): string =>
  (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

interface RegistryPlace {
  name_uz?: unknown;
  name_uz_latn?: unknown;
  name_ru?: unknown;
}

function place(json: string | undefined): RegistryPlace | null {
  const text = json?.trim();
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as RegistryPlace) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? clean(v, 120) : '');

/** One registry row (column name → cell text) → a record, or null when it has no id or no name. */
export function toOrganizationRecord(
  row: Readonly<Record<string, string>>,
  regionOf: (registryName: string | null | undefined) => number | null,
): OrganizationRecord | null {
  const c = ORGANIZATION_COLUMNS;
  const externalId = clean(row[c.id], 64);
  const latin = clean(row[c.nameLatin]);
  const cyr = clean(row[c.nameCyr]);
  const ru = clean(row[c.nameRu]);
  const name = latin || cyr || ru;
  if (!externalId || !name) return null;

  const tin = (row[c.tin] ?? '').replace(/\D/g, '').slice(0, 20) || null;
  const region = place(row[c.region]);
  const districtPlace = place(row[c.district]);
  const district = str(districtPlace?.name_uz_latn) || str(districtPlace?.name_uz) || null;
  const regionId = regionOf(str(region?.name_uz_latn)) ?? regionOf(str(region?.name_ru));

  // Latin name first: a query that matches the start of the name ranks first (strpos in the repository).
  const parts = [latin, cyr, ru, district ?? '', tin ?? ''].filter(Boolean);
  const searchText = normalizeOrgText([...new Set(parts)].join(' '));
  return { externalId, tin, name, searchText, regionId, district };
}
