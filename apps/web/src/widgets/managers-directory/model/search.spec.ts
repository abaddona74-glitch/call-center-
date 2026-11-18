import type { ManagersDirectory } from '@cc/shared';
import { describe, expect, it } from 'vitest';
import {
  filterDirectory,
  filterExat,
  filterMinistries,
  filterRegions,
  filterTashkent,
  formatDisplayPhone,
  highlightParts,
  isManagersTab,
  nextFontScale,
  normalizeQuery,
  phoneMatches,
  tabCount,
  telHref,
} from './search';

const data: ManagersDirectory = {
  tashkent: [
    {
      org: "Toshkent shahar shartnoma bo'limi",
      name: "Shartnoma bo'limi (Ofis)",
      phone: '+998 71 202-46-46',
      isSpecial: true,
    },
    { org: 'Yunusobod tumani', name: 'Abdullayev Rixsitilla', phone: '+998 97 724-10-17', isSpecial: false },
    { org: 'Bektemir tumani', name: 'Begimqulov Shahzod', phone: '+998 93 895-09-97', isSpecial: false },
  ],
  ministries: [
    { name: "Abdumannonov A'zamjon", phone: '+998 99 488 38 38', ministries: ['Raqamli texnologiyalar vazirligi'] },
    { name: 'Sobirov Shohrux', phone: '+998 93 512 90 90', ministries: ['Sport vazirligi'] },
  ],
  regions: [
    {
      region: 'Toshkent viloyati',
      lead: 'Ibragimov Avaz',
      leadPhone: '+998 99 850-06-92',
      extraPhone: null,
      offices: ['998 95 507 46 46', '998 95 509 46 46'],
      head: "Axmedov Nabixo'ja",
      headPhone: '97 706-17-17',
    },
    {
      region: 'Buxoro viloyati',
      lead: 'Qudratov Alisher',
      leadPhone: '+998 90 635-44-33',
      extraPhone: '+998 99 700-01-85',
      offices: ['998 95 511-46-46'],
      head: 'Muzaffarov Hasan',
      headPhone: '99 846-12-07',
    },
  ],
  exat: [
    { title: 'E-XAT (Operator 1)', org: 'Unicon.uz', desc: 'Elektron pochta', phone: '+998 71 208-05-14' },
    { title: 'E-XAT (Operator 2)', org: 'Unicon.uz', desc: 'Kalit/parol', phone: '+998 71 208-02-34' },
  ],
};

describe('normalizeQuery', () => {
  it('trims and lower-cases like legacy handleSearch', () => {
    expect(normalizeQuery('  YunusOBOD ')).toBe('yunusobod');
    expect(normalizeQuery(undefined)).toBe('');
  });
});

describe('phoneMatches', () => {
  it('ignores spaces, dashes and plus signs on both sides', () => {
    expect(phoneMatches('+998 97 724-10-17', '724-10')).toBe(true);
    expect(phoneMatches('+998 97 724-10-17', '+998977241017')).toBe(true);
    expect(phoneMatches('+998 97 724-10-17', '97 724 10 17')).toBe(true);
    expect(phoneMatches('+998 97 724-10-17', '555')).toBe(false);
  });

  it('does not match everything for a separator-only query or a missing phone', () => {
    expect(phoneMatches('+998 97 724-10-17', '-')).toBe(false);
    expect(phoneMatches(null, '97')).toBe(false);
  });
});

describe('filters', () => {
  it('returns everything for an empty query', () => {
    expect(filterTashkent(data.tashkent, '')).toHaveLength(3);
  });

  it('tashkent: org, name and phone', () => {
    expect(filterTashkent(data.tashkent, 'bektemir').map((e) => e.org)).toEqual(['Bektemir tumani']);
    expect(filterTashkent(data.tashkent, 'rixsi').map((e) => e.org)).toEqual(['Yunusobod tumani']);
    expect(filterTashkent(data.tashkent, '202-46').map((e) => e.org)).toEqual(["Toshkent shahar shartnoma bo'limi"]);
  });

  it('ministries: name, phone and ministry names', () => {
    expect(filterMinistries(data.ministries, 'sport').map((e) => e.name)).toEqual(['Sobirov Shohrux']);
    expect(filterMinistries(data.ministries, '4883838').map((e) => e.name)).toEqual(["Abdumannonov A'zamjon"]);
  });

  it('regions: region, lead, head, and every phone in the row', () => {
    expect(filterRegions(data.regions, 'buxoro')).toHaveLength(1);
    expect(filterRegions(data.regions, 'axmedov').map((e) => e.region)).toEqual(['Toshkent viloyati']);
    expect(filterRegions(data.regions, '95 509').map((e) => e.region)).toEqual(['Toshkent viloyati']);
    expect(filterRegions(data.regions, '700-01-85').map((e) => e.region)).toEqual(['Buxoro viloyati']);
    expect(filterRegions(data.regions, '846-12-07').map((e) => e.region)).toEqual(['Buxoro viloyati']);
  });

  it('exat: title, org, description and phone', () => {
    expect(filterExat(data.exat, 'parol').map((e) => e.title)).toEqual(['E-XAT (Operator 2)']);
    expect(filterExat(data.exat, 'unicon')).toHaveLength(2);
    expect(filterExat(data.exat, '208-05')).toHaveLength(1);
  });

  it('counts the rows of the active tab', () => {
    const filtered = filterDirectory(data, 'unicon');
    expect(tabCount(filtered, 'exat')).toBe(2);
    expect(tabCount(filtered, 'tashkent')).toBe(0);
    expect(tabCount(filterDirectory(data, ''), 'regions')).toBe(2);
  });
});

describe('highlightParts', () => {
  it('splits case-insensitively and keeps the original letters', () => {
    expect(highlightParts('Yunusobod tumani', 'yunus')).toEqual([
      { text: 'Yunus', match: true },
      { text: 'obod tumani', match: false },
    ]);
    expect(highlightParts('a-b-a', 'a')).toEqual([
      { text: 'a', match: true },
      { text: '-b-', match: false },
      { text: 'a', match: true },
    ]);
  });

  it('treats the query literally (no regex injection)', () => {
    expect(highlightParts('Kalit/parol (2)', '(2)')).toEqual([
      { text: 'Kalit/parol ', match: false },
      { text: '(2)', match: true },
    ]);
    expect(highlightParts('abc', '.*')).toEqual([{ text: 'abc', match: false }]);
  });

  it('returns the whole text when there is no query', () => {
    expect(highlightParts('Sport', '')).toEqual([{ text: 'Sport', match: false }]);
    expect(highlightParts('', 'x')).toEqual([]);
  });
});

describe('phone formatting', () => {
  it('drops the +998 code for display (legacy formatDisplayPhone)', () => {
    expect(formatDisplayPhone('+998 71 202-46-46')).toBe('71 202-46-46');
    expect(formatDisplayPhone('998 95 507 46 46')).toBe('95 507 46 46');
    expect(formatDisplayPhone('97 706-17-17')).toBe('97 706-17-17');
    expect(formatDisplayPhone(null)).toBe('');
  });

  it('builds tel: links with the country code', () => {
    expect(telHref('+998 71 202-46-46')).toBe('tel:+998712024646');
    expect(telHref('998 95 507 46 46')).toBe('tel:+998955074646');
    expect(telHref('97 706-17-17')).toBe('tel:+998977061717');
  });
});

describe('nextFontScale', () => {
  it('steps by 10% within 80%–180%', () => {
    expect(nextFontScale(1, 0.1)).toBe(1.1);
    expect(nextFontScale(0.8, -0.1)).toBe(0.8);
    expect(nextFontScale(1.8, 0.1)).toBe(1.8);
    expect(nextFontScale(1.2, -0.1)).toBe(1.1);
  });
});

describe('isManagersTab', () => {
  it('accepts only the four legacy tabs', () => {
    expect(isManagersTab('regions')).toBe(true);
    expect(isManagersTab('admin')).toBe(false);
    expect(isManagersTab(undefined)).toBe(false);
  });
});
