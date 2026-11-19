import { describe, expect, it } from 'vitest';
import { matchCity, organizationPlace } from './organization-place';

const city = (id: number, nameUz: string, nameRu = '', isActive = true) => ({ id, nameUz, nameRu, isActive });

describe('matchCity', () => {
  it('matches the same name whatever apostrophe the registry used', () => {
    expect(matchCity('Qoʻqon shahri', [city(1, 'Fargʻona shahri'), city(2, "Qo'qon shahri")])).toBe(2);
    expect(matchCity('Mirzo Ulugʻbek tumani', [city(3, 'Mirzo Ulug‘bek tumani')])).toBe(3);
  });

  it('matches a short or abbreviated city name', () => {
    expect(matchCity('Chilonzor tumani', [city(1, 'Chilonzor')])).toBe(1);
    expect(matchCity('Chilonzor tumani', [city(1, 'Chilonzor t.')])).toBe(1);
    expect(matchCity('Margʻilon shahri', [city(1, 'Margilon sh.')])).toBe(1);
    expect(matchCity('  CHILONZOR   TUMANI ', [city(1, 'Chilonzor')])).toBe(1);
  });

  it('tells a city from the district of the same name', () => {
    const cities = [city(1, 'Qarshi shahri'), city(2, 'Qarshi tumani')];
    expect(matchCity('Qarshi shahri', cities)).toBe(1);
    expect(matchCity('Qarshi tumani', cities)).toBe(2);
    expect(matchCity('Qarshi', cities)).toBeNull();
  });

  it('prefers the city of the same kind over a name without one', () => {
    expect(matchCity('Qarshi shahri', [city(1, 'Qarshi'), city(2, 'Qarshi shahri')])).toBe(2);
  });

  it('matches Cyrillic names and the Russian name', () => {
    expect(matchCity('Қўқон шаҳри', [city(1, 'Qoʻqon shahri', 'Қўқон')])).toBe(1);
    expect(matchCity('г. Коканд', [city(1, 'Qoʻqon shahri', 'Коканд')])).toBe(1);
  });

  it('does not match other names, inactive cities or an empty district', () => {
    expect(matchCity('Bektemir tumani', [city(1, 'Chilonzor tumani')])).toBeNull();
    expect(matchCity('Chilonzor tumani', [city(1, 'Chilonzor tumani', '', false)])).toBeNull();
    expect(matchCity(null, [city(1, 'Chilonzor tumani')])).toBeNull();
    expect(matchCity('  ', [city(1, 'Chilonzor')])).toBeNull();
  });
});

describe('organizationPlace', () => {
  const regions = [
    { id: 1, nameUz: 'Toshkent shahri', nameRu: '', isActive: true, cities: [city(10, 'Chilonzor tumani')] },
    { id: 2, nameUz: 'Andijon', nameRu: '', isActive: false, cities: [] },
  ];

  it('gives the region and the matching city', () => {
    expect(organizationPlace({ regionId: 1, district: 'Chilonzor tumani' }, regions)).toEqual({
      regionId: 1,
      cityId: 10,
    });
  });

  it('gives the region alone when the district matches no city', () => {
    expect(organizationPlace({ regionId: 1, district: 'Yashnobod tumani' }, regions)).toEqual({
      regionId: 1,
      cityId: null,
    });
    expect(organizationPlace({ regionId: 1, district: null }, regions)).toEqual({ regionId: 1, cityId: null });
  });

  it('gives nothing for republic-level organizations and inactive or unknown regions', () => {
    expect(organizationPlace({ regionId: null, district: 'Chilonzor tumani' }, regions)).toBeNull();
    expect(organizationPlace({ regionId: 2, district: null }, regions)).toBeNull();
    expect(organizationPlace({ regionId: 99, district: null }, regions)).toBeNull();
  });
});
