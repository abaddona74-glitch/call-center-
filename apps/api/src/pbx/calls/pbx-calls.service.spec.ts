import { describe, expect, it } from 'vitest';
import { parseWall } from '../../common/time/business-time.js';
import type { AppConfig } from '../../config/app-config.js';
import type { WorkingCalendarService } from '../../modules/working-calendar/working-calendar.service.js';
import type { CdrRow } from './cdr-row.js';
import type { CdrRepository } from './cdr.repository.js';
import { CdrSliceOverflowError, PbxCallsService } from './pbx-calls.service.js';
import { TEST_CALENDAR, inbound, outbound } from './testing/cdr-fixtures.js';

const CONFIG: Record<string, unknown> = {
  PBX_TRUNK_PEERS: ['712020159'],
  PBX_SERVICE_NUMBERS: ['2020159', '712020159'],
  PBX_INBOUND_CONTEXTS: ['ext-queues', 'from-trunk', 'ivr-4'],
  PBX_QUEUE_CONTEXTS: ['ext-queues'],
  PBX_OFF_HOURS_MARKERS: ['working-time', 'music-working-time'],
  PBX_EXTENSION_PATTERN: '^[0-9]{2,4}$',
  PBX_DIAL_PREFIXES: ['0', '9'],
  OPERATOR_GROUPS: [],
  CDR_HISTORY_MAX_DAYS: 31,
  STATS_MAX_DAYS: 366,
};

function service(rows: CdrRow[]) {
  const slices: Array<[string, string, number]> = [];
  const repo = {
    enabled: true,
    rowsSlice: async (from: string, to: string, limit: number) => {
      slices.push([from, to, limit]);
      return rows.filter((r) => r.calldate >= from && r.calldate < to).slice(0, limit);
    },
  } as unknown as CdrRepository;
  const calendar = { get: () => TEST_CALENDAR } as unknown as WorkingCalendarService;
  const config = { get: (key: string) => CONFIG[key] } as unknown as AppConfig;
  return { svc: new PbxCallsService(repo, calendar, config), slices };
}

const ms = (wall: string) => parseWall(wall).epochMs;

describe('PbxCallsService.callsFromSlices', () => {
  const rows = [
    ...inbound({ at: '2026-11-17 09:59:50', caller: '901111111', outcome: 'answered', answeredBy: '101', talk: 60 }),
    ...outbound({ at: '2026-11-17 10:30:00', ext: '103', number: '902222222', disposition: 'ANSWERED', talk: 20 }),
  ];

  it('reads consecutive capped slices and assembles calls across slice borders', async () => {
    const { svc, slices } = service(rows);
    const read = await svc.callsFromSlices(ms('2026-11-17 09:00:00'), ms('2026-11-17 11:30:00'), {
      sliceMs: 3_600_000,
      maxRowsPerSlice: 10,
    });
    expect(slices).toEqual([
      ['2026-11-17 09:00:00', '2026-11-17 10:00:00', 11],
      ['2026-11-17 10:00:00', '2026-11-17 11:00:00', 11],
      ['2026-11-17 11:00:00', '2026-11-17 11:30:00', 11],
    ]);
    expect(read.queries).toBe(3);
    expect(read.rows).toBe(rows.length);
    // the inbound call's IVR row is in the first slice, its queue rows in the second: still one call
    expect(read.calls.map((c) => [c.direction, c.status, c.start])).toEqual([
      ['inbound', 'answered', '2026-11-17 09:59:50'],
      ['outbound', 'answered', '2026-11-17 10:30:00'],
    ]);
  });

  it('refuses a window it cannot read whole', async () => {
    const { svc } = service(rows);
    await expect(
      svc.callsFromSlices(ms('2026-11-17 09:00:00'), ms('2026-11-17 11:00:00'), {
        sliceMs: 3_600_000,
        maxRowsPerSlice: 2,
      }),
    ).rejects.toBeInstanceOf(CdrSliceOverflowError);
  });
});
