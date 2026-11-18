import { describe, expect, it } from 'vitest';
import { buildChoices, diffExtensions, withoutExcluded } from './excluded-operators.js';

describe('withoutExcluded', () => {
  const rows = [{ ext: '101' }, { ext: '118' }, { ext: '1111' }, { ext: '205' }];

  it('drops the excluded extensions and keeps the order', () => {
    expect(withoutExcluded(rows, new Set(['118', '1111']), (r) => r.ext)).toEqual([{ ext: '101' }, { ext: '205' }]);
  });

  it('matches whole extensions only', () => {
    expect(withoutExcluded(rows, new Set(['11', '1']), (r) => r.ext)).toEqual(rows);
  });

  it('returns a copy when nothing is excluded', () => {
    const out = withoutExcluded(rows, new Set(), (r) => r.ext);
    expect(out).toEqual(rows);
    expect(out).not.toBe(rows);
  });
});

describe('buildChoices', () => {
  it('lists the PBX directory with the excluded flag, adds unknown excluded numbers, sorts by number', () => {
    const choices = buildChoices(
      [
        { extension: '120', name: 'Navruzoy ' },
        { extension: '101', name: 'Oybek' },
        { extension: '205', name: '' },
        { extension: '101', name: 'duplicate' },
        { extension: 'abc', name: 'not an extension' },
        { extension: '7', name: 'too short' },
      ],
      ['118', '120', '1111'],
    );
    expect(choices).toEqual([
      { extension: '101', name: 'Oybek', excluded: false },
      { extension: '118', name: null, excluded: true },
      { extension: '120', name: 'Navruzoy', excluded: true },
      { extension: '205', name: null, excluded: false },
      { extension: '1111', name: null, excluded: true },
    ]);
  });

  it('without the PBX directory only the excluded numbers are offered', () => {
    expect(buildChoices([], ['1111', '118'])).toEqual([
      { extension: '118', name: null, excluded: true },
      { extension: '1111', name: null, excluded: true },
    ]);
  });
});

describe('diffExtensions', () => {
  it('reports added and removed extensions', () => {
    expect(diffExtensions(['118', '1111'], ['118', '205'])).toEqual({ added: ['205'], removed: ['1111'] });
    expect(diffExtensions([], [])).toEqual({ added: [], removed: [] });
  });
});
