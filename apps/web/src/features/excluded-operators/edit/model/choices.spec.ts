import { describe, expect, it } from 'vitest';
import { matchesSearch, withLiveOperators } from './choices';

const server = [
  { extension: '101', name: 'Aziza', excluded: false },
  { extension: '118', name: null, excluded: true },
];

describe('withLiveOperators', () => {
  it('adds operators known only to the live board, keeps the server entries, sorts by number', () => {
    expect(
      withLiveOperators(server, [
        { extension: '101', name: 'Operator 101' },
        { extension: '99', name: 'Kassa' },
        { extension: '1111', name: 'Test' },
      ]),
    ).toEqual([
      { extension: '99', name: 'Kassa', excluded: false },
      { extension: '101', name: 'Aziza', excluded: false },
      { extension: '118', name: null, excluded: true },
      { extension: '1111', name: 'Test', excluded: false },
    ]);
  });

  it('works without the live board', () => {
    expect(withLiveOperators(server, undefined)).toEqual(server);
  });
});

describe('matchesSearch', () => {
  it('finds by extension or name, case-insensitive', () => {
    expect(matchesSearch(server[0], ' azi ')).toBe(true);
    expect(matchesSearch(server[0], '10')).toBe(true);
    expect(matchesSearch(server[1], 'aziza')).toBe(false);
    expect(matchesSearch(server[1], '')).toBe(true);
  });
});
