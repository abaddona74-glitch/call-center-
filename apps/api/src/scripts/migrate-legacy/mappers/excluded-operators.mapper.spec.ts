import { describe, expect, it } from 'vitest';
import { parseLegacyExcluded, planExcluded } from './excluded-operators.mapper.js';

describe('parseLegacyExcluded', () => {
  it('reads the production value', () => {
    expect(parseLegacyExcluded('["118","1111"]')).toEqual({ extensions: ['118', '1111'], skipped: [], read: 2 });
  });

  it('accepts numbers and padded strings like legacy String(x).trim(), skips the rest', () => {
    const r = parseLegacyExcluded('[118, " 1111 ", "", null, "SIP/120", "1", {"id":"5"}]');
    expect(r.extensions).toEqual(['118', '1111']);
    expect(r.read).toBe(7);
    expect(r.skipped.map((s) => s.key)).toEqual([
      'excluded_operators[2]',
      'excluded_operators[3]',
      'excluded_operators[4]',
      'excluded_operators[5]',
      'excluded_operators[6]',
    ]);
  });

  it('fails on anything but a JSON array', () => {
    expect(() => parseLegacyExcluded('118,1111')).toThrow();
    expect(() => parseLegacyExcluded('{"a":1}')).toThrow(/not a JSON array/);
  });
});

describe('planExcluded', () => {
  it('fills an empty list', () => {
    expect(planExcluded({ extensions: [], editedInNewSystem: false }, ['1111', '118', '118'])).toEqual({
      next: ['118', '1111'],
      added: ['118', '1111'],
      present: [],
      notAdded: [],
    });
  });

  it('adds only what is missing and never removes', () => {
    expect(planExcluded({ extensions: ['205', '118'], editedInNewSystem: false }, ['118', '1111'])).toEqual({
      next: ['118', '205', '1111'],
      added: ['1111'],
      present: ['118'],
      notAdded: [],
    });
  });

  it('is a no-op on a re-run', () => {
    expect(planExcluded({ extensions: ['118', '1111'], editedInNewSystem: false }, ['118', '1111'])).toMatchObject({
      next: null,
      added: [],
      present: ['118', '1111'],
    });
  });

  it('leaves a list edited in the new system alone and reports what it did not add', () => {
    expect(planExcluded({ extensions: ['118'], editedInNewSystem: true }, ['118', '1111'])).toEqual({
      next: null,
      added: [],
      present: ['118'],
      notAdded: ['1111'],
    });
  });
});
