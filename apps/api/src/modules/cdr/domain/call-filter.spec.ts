import { wallToIso } from '../../../common/time/business-time.js';
import { DEFAULT_DIALPLAN as dp } from '../../../pbx/calls/dialplan.js';
import { calls, inbound, outbound } from '../../../pbx/calls/testing/cdr-fixtures.js';
import { matchesFilter, paginate, parseSearch, toCallListItem } from './call-filter.js';

const day = calls(
  inbound({ at: '2026-11-17 09:00:00', caller: '998901234567', outcome: 'answered', answeredBy: '101', talk: 50 }),
  inbound({ at: '2026-11-17 09:30:00', caller: '935551122', outcome: 'abandoned', rung: ['103'] }),
  inbound({
    at: '2026-11-17 10:00:00',
    caller: '901234567',
    outcome: 'answered',
    answeredBy: '103',
    transfers: [{ to: '106', talk: 20 }],
  }),
  outbound({ at: '2026-11-17 11:00:00', ext: '106', number: '0935551122', disposition: 'BUSY' }),
  inbound({ at: '2026-11-17 22:00:00', caller: '977778899', outcome: 'after_hours' }),
);
const names = new Map([
  ['101', 'Aziza Karimova'],
  ['103', 'Bobur'],
  ['106', 'Dilnoza'],
]);
const run = (f: Partial<Parameters<typeof matchesFilter>[1]>) =>
  day.filter((c) => matchesFilter(c, { scope: 'all', search: { kind: 'none' }, ...f }, names)).map((c) => c.time);

describe('parseSearch', () => {
  it('detects extensions, phones in any format, partial numbers and names', () => {
    expect(parseSearch('101', dp)).toEqual({ kind: 'extension', ext: '101' });
    expect(parseSearch('+998 (90) 123-45-67', dp)).toEqual({ kind: 'phone', number: '901234567' });
    expect(parseSearch('0901234567', dp)).toEqual({ kind: 'phone', number: '901234567' });
    expect(parseSearch('45-67', dp)).toEqual({ kind: 'partialPhone', digits: '4567' });
    expect(parseSearch('  Aziza ', dp)).toEqual({ kind: 'text', text: 'aziza' });
    expect(parseSearch('', dp)).toEqual({ kind: 'none' });
  });
});

describe('matchesFilter', () => {
  it('phone search is an exact match on the normalized number (no LIKE %digits%)', () => {
    expect(run({ search: parseSearch('901234567', dp) })).toEqual(['09:00:00', '10:00:00']);
    expect(run({ search: parseSearch('998935551122', dp) })).toEqual(['09:30:00', '11:00:00']);
  });

  it('extension and name search find every call the operator took part in', () => {
    expect(run({ search: parseSearch('106', dp) })).toEqual(['10:00:00', '11:00:00']);
    expect(run({ search: parseSearch('bobur', dp) })).toEqual(['10:00:00']);
    expect(run({ operator: '101' })).toEqual(['09:00:00']);
  });

  it('direction, transfer and status filters', () => {
    expect(run({ direction: 'outbound' })).toEqual(['11:00:00']);
    expect(run({ direction: 'transfer' })).toEqual(['10:00:00']);
    expect(run({ status: 'missed' })).toEqual(['09:30:00', '11:00:00', '22:00:00']);
    expect(run({ status: 'busy' })).toEqual(['11:00:00']);
    expect(run({ scope: 'working', status: 'missed' })).toEqual(['09:30:00', '11:00:00']);
  });

  it('"external" is inbound + outbound, without internal calls', () => {
    const internal = { ...day[0], id: 'internal-1', time: '12:00:00', direction: 'internal' as const };
    const all = [...day, internal];
    const times = all
      .filter((c) => matchesFilter(c, { scope: 'all', search: { kind: 'none' }, direction: 'external' }, names))
      .map((c) => c.time);
    expect(times).toEqual(['09:00:00', '09:30:00', '10:00:00', '11:00:00', '22:00:00']);
  });

  it('operator miss: any reason, one reason, and only the given operator`s misses', () => {
    // 09:30 rang 103 (no answer); 09:00 was answered by 101 after 103 rang and 106 declined.
    const withMisses = day.map((c) =>
      c.time === '09:00:00'
        ? {
            ...c,
            missedBy: [
              { ext: '103', reason: 'no_answer' as const },
              { ext: '106', reason: 'rejected' as const },
            ],
          }
        : c,
    );
    const runMiss = (f: Partial<Parameters<typeof matchesFilter>[1]>) =>
      withMisses
        .filter((c) => matchesFilter(c, { scope: 'all', search: { kind: 'none' }, ...f }, names))
        .map((c) => c.time);
    expect(runMiss({ operatorMiss: 'any' })).toEqual(['09:00:00', '09:30:00']);
    expect(runMiss({ operatorMiss: 'rejected' })).toEqual(['09:00:00']);
    expect(runMiss({ operatorMiss: 'no_answer' })).toEqual(['09:00:00', '09:30:00']);
    expect(runMiss({ operatorMiss: 'any', operator: '106' })).toEqual(['09:00:00']);
    expect(runMiss({ operatorMiss: 'no_answer', operator: '106' })).toEqual([]);
    // 101 took the 09:00 call but missed nothing.
    expect(runMiss({ operatorMiss: 'any', operator: '101' })).toEqual([]);
    expect(runMiss({ operator: '101' })).toEqual(['09:00:00']);
  });
});

describe('paginate and map', () => {
  it('sorts newest first and slices a page', () => {
    const { total, items } = paginate(day, 2, 2);
    expect(total).toBe(5);
    expect(items.map((c) => c.time)).toEqual(['10:00:00', '09:30:00']);
  });

  it('hides the recording file unless allowed', () => {
    const call = day[0];
    const forOperator = toCallListItem(call, names, { includeRecording: false, toIso: wallToIso });
    expect(forOperator).toMatchObject({
      startedAt: '2026-11-17T09:00:00+05:00',
      operator: { ext: '101', name: 'Aziza Karimova' },
      hasRecording: true,
      recordingFile: null,
      hangupBy: 'unknown',
    });
    expect(toCallListItem(call, names, { includeRecording: true, toIso: wallToIso }).recordingFile).toMatch(/\.wav$/);
  });
});
