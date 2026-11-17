import { describe, expect, it } from 'vitest';
import { parseRangeHeader } from './http-range.js';

describe('parseRangeHeader', () => {
  const size = 1000;

  it('returns full without a header or with an unsupported one', () => {
    expect(parseRangeHeader(undefined, size)).toEqual({ kind: 'full' });
    expect(parseRangeHeader('', size)).toEqual({ kind: 'full' });
    expect(parseRangeHeader('items=0-1', size)).toEqual({ kind: 'full' });
    expect(parseRangeHeader('bytes=0-1,5-9', size)).toEqual({ kind: 'full' });
    expect(parseRangeHeader('bytes=-', size)).toEqual({ kind: 'full' });
    expect(parseRangeHeader('bytes=9-1', size)).toEqual({ kind: 'full' });
  });

  it('parses open and closed ranges', () => {
    expect(parseRangeHeader('bytes=0-', size)).toEqual({ kind: 'partial', range: { start: 0, end: 999 } });
    expect(parseRangeHeader('bytes=100-199', size)).toEqual({ kind: 'partial', range: { start: 100, end: 199 } });
    expect(parseRangeHeader('bytes=900-5000', size)).toEqual({ kind: 'partial', range: { start: 900, end: 999 } });
  });

  it('parses suffix ranges', () => {
    expect(parseRangeHeader('bytes=-100', size)).toEqual({ kind: 'partial', range: { start: 900, end: 999 } });
    expect(parseRangeHeader('bytes=-5000', size)).toEqual({ kind: 'partial', range: { start: 0, end: 999 } });
  });

  it('reports unsatisfiable ranges', () => {
    expect(parseRangeHeader('bytes=1000-', size)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=-0', size)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' });
  });
});
