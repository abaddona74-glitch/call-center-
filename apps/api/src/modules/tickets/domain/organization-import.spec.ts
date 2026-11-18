import { describe, expect, it } from 'vitest';
import { normalizeOrgText, regionMatcher, searchTokens, toOrganizationRecord } from './organization-import.js';

const REGIONS = [
  { id: 1, code: 'toshkent-shahri', nameUz: 'Toshkent shahri' },
  { id: 2, code: 'toshkent-viloyati', nameUz: 'Toshkent viloyati' },
  { id: 5, code: 'fargona', nameUz: 'Fargʻona' },
  { id: 11, code: 'samarqand', nameUz: 'Samarqand' },
  { id: 14, code: 'qoraqalpogiston', nameUz: 'Qoraqalpogʻiston Respublikasi' },
];

const region = (latn: string, ru = '') => JSON.stringify({ id: 'x', name_uz: '', name_uz_latn: latn, name_ru: ru });

describe('organization registry import', () => {
  it('normalizes names and queries the same way (case, apostrophes, quotes, spaces)', () => {
    expect(normalizeOrgText('“O’zmilliybank”  AJ Qoʻqon')).toBe('ozmilliybank aj qoqon');
    expect(normalizeOrgText("O'ZMILLIYBANK aj qo‘qon")).toBe('ozmilliybank aj qoqon');
    expect(normalizeOrgText('"Ўзмиллийбанк" АЖ')).toBe('ўзмиллийбанк аж');
    expect(searchTokens("  o'zmilliy  a  qo‘qon bank xizmat markazi oltinchi ")).toEqual([
      'ozmilliy',
      'qoqon',
      'bank',
      'xizmat',
      'markazi',
    ]);
  });

  it('maps registry regions to ticket regions by code or name', () => {
    const regionOf = regionMatcher(REGIONS);
    expect(regionOf('Toshkent shahri')).toBe(1);
    expect(regionOf('Toshkent viloyati')).toBe(2);
    expect(regionOf('Fargʻona viloyati')).toBe(5);
    expect(regionOf('Samarqand viloyati')).toBe(11);
    expect(regionOf('Qoraqalpogʻiston Respublikasi')).toBe(14);
    expect(regionOf('Mars viloyati')).toBeNull();
    expect(regionOf('')).toBeNull();
    expect(regionOf(null)).toBeNull();
  });

  it('turns a registry row into a record: Latin name, digits-only INN, region, district, search text', () => {
    const rec = toOrganizationRecord(
      {
        id: '6ad0badf46ff240001a7c350',
        tin: ' 200 836 354 ',
        region_json: region('Fargʻona viloyati', 'Ферганская область'),
        district_json: JSON.stringify({ name_uz: 'Қўқон шаҳри', name_uz_latn: 'Qoʻqon shahri' }),
        name_uz: '"Ўзмиллийбанк" АЖ Қўқон банк хизматлари маркази',
        name_uz_latn: '“O’zmilliybank” AJ Qoʻqon bank xizmatlari markazi',
        name_ru: '"Ўзмиллийбанк" АЖ Қўқон банк хизматлари маркази',
      },
      regionMatcher(REGIONS),
    );
    expect(rec).toEqual({
      externalId: '6ad0badf46ff240001a7c350',
      tin: '200836354',
      name: '“O’zmilliybank” AJ Qoʻqon bank xizmatlari markazi',
      regionId: 5,
      district: 'Qoʻqon shahri',
      searchText:
        'ozmilliybank aj qoqon bank xizmatlari markazi ўзмиллийбанк аж қўқон банк хизматлари маркази qoqon shahri 200836354',
    });
  });

  it('falls back to the Cyrillic / Russian name; republic-level rows have no region; broken JSON is ignored', () => {
    const regionOf = regionMatcher(REGIONS);
    expect(toOrganizationRecord({ id: 'a', name_uz: 'Адлия вазирлиги', region_json: '' }, regionOf)).toMatchObject({
      name: 'Адлия вазирлиги',
      regionId: null,
      district: null,
      tin: null,
    });
    expect(toOrganizationRecord({ id: 'b', name_ru: 'ООО Тест', region_json: '{broken' }, regionOf)).toMatchObject({
      name: 'ООО Тест',
      regionId: null,
    });
    // Unknown Latin name, known Russian one.
    expect(
      toOrganizationRecord({ id: 'c', name_uz_latn: 'X', region_json: region('?', 'Toshkent shahri') }, regionOf)
        ?.regionId,
    ).toBe(1);
  });

  it('skips rows without an id or a name and caps very long names', () => {
    const regionOf = regionMatcher(REGIONS);
    expect(toOrganizationRecord({ id: '', name_uz_latn: 'Bor' }, regionOf)).toBeNull();
    expect(toOrganizationRecord({ id: 'x', name_uz_latn: '   ' }, regionOf)).toBeNull();
    expect(toOrganizationRecord({ id: 'y', name_uz_latn: 'a'.repeat(400) }, regionOf)?.name).toHaveLength(255);
  });
});
