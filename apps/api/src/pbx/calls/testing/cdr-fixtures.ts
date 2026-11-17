/**
 * Builders of realistic CDR rows (Asterisk 13 + FreePBX/Issabel shapes, same as infra/dev-pbx/seed) for unit tests.
 * Times are Tashkent wall clock. Only for tests.
 */
import { parseWall } from '../../../common/time/business-time.js';
import { WorkingCalendar } from '../../../common/time/working-calendar.js';
import { assembleCalls } from '../call-assembler.js';
import type { CdrRow } from '../cdr-row.js';
import { DEFAULT_DIALPLAN } from '../dialplan.js';

export const TEST_CALENDAR = new WorkingCalendar({ days: [1, 2, 3, 4, 5], start: '08:00', end: '21:00' });
export const TEST_DIALPLAN = DEFAULT_DIALPLAN;

let counter = 0;
const hex = () => (0x1000 + counter++).toString(16).padStart(8, '0');
/** Asterisk uniqueid: "<epoch seconds of the channel>.<sequence>". */
const newId = (wall: string) => `${Math.floor(parseWall(wall).epochMs / 1000)}.${counter++}`;

function addSeconds(wall: string, sec: number): string {
  const [d, t] = wall.split(' ');
  const [h, m, s] = t.split(':').map(Number);
  const total = h * 3600 + m * 60 + s + sec;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d} ${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

function base(partial: Partial<CdrRow> & Pick<CdrRow, 'calldate' | 'uniqueid'>): CdrRow {
  return {
    clid: '',
    src: '',
    dst: '',
    dcontext: '',
    channel: '',
    dstchannel: '',
    lastapp: '',
    lastdata: '',
    duration: 0,
    billsec: 0,
    disposition: 'NO ANSWER',
    linkedid: partial.uniqueid,
    recordingfile: '',
    ...partial,
  };
}

export interface InboundSpec {
  at: string;
  caller: string;
  ivrSec?: number;
  outcome: 'answered' | 'abandoned' | 'ivr' | 'after_hours';
  /** Members rung before the answer (ring-no-answer), 15 s each. */
  rung?: string[];
  answeredBy?: string;
  ringSec?: number;
  talk?: number;
  transfers?: { to: string; talk: number; answered?: boolean }[];
  /** Seconds the caller stays in the queue before hanging up (abandoned). */
  abandonAfter?: number;
}

export function inbound(spec: InboundSpec): CdrRow[] {
  const id = newId(spec.at);
  const trunk = `SIP/712020159-${hex()}`;
  const ivr = spec.ivrSec ?? 10;
  const rows: CdrRow[] = [];
  const caller = spec.caller;
  if (spec.outcome === 'after_hours') {
    return [
      base({
        calldate: spec.at,
        uniqueid: id,
        src: caller,
        dst: 's',
        dcontext: 'ivr-4',
        channel: trunk,
        lastapp: 'Playback',
        lastdata: 'custom/music-working-time',
        duration: 20,
        billsec: 19,
        disposition: 'ANSWERED',
      }),
    ];
  }
  rows.push(
    base({
      calldate: spec.at,
      uniqueid: id,
      src: caller,
      dst: 's',
      dcontext: 'ivr-4',
      channel: trunk,
      lastapp: 'BackGround',
      lastdata: 'custom/welcome-menu',
      duration: ivr,
      billsec: ivr - 1,
      disposition: 'ANSWERED',
    }),
  );
  if (spec.outcome === 'ivr') return rows;

  let t = ivr;
  for (const ext of spec.rung ?? []) {
    const lc = `Local/${ext}@from-queue-${hex()};`;
    rows.push(
      base({
        calldate: addSeconds(spec.at, t),
        uniqueid: id,
        src: caller,
        dst: '2020159',
        dcontext: 'ext-queues',
        channel: trunk,
        dstchannel: `${lc}1`,
        lastapp: 'Queue',
        duration: 15,
        billsec: 0,
        disposition: 'NO ANSWER',
      }),
      base({
        calldate: addSeconds(spec.at, t),
        uniqueid: `${id}1${counter++}`,
        linkedid: id,
        src: caller,
        dst: ext,
        dcontext: 'from-queue',
        channel: `${lc}2`,
        dstchannel: `SIP/${ext}-${hex()}`,
        lastapp: 'Dial',
        duration: 15,
        billsec: 0,
        disposition: 'NO ANSWER',
      }),
    );
    t += 15;
  }
  if (spec.outcome === 'abandoned') {
    const wait = spec.abandonAfter ?? 30;
    rows.push(
      base({
        calldate: addSeconds(spec.at, ivr),
        uniqueid: id,
        src: caller,
        dst: '2020159',
        dcontext: 'ext-queues',
        channel: trunk,
        lastapp: 'Queue',
        duration: t - ivr + wait,
        billsec: t - ivr + wait,
        disposition: 'ANSWERED',
      }),
    );
    return rows;
  }
  const op = spec.answeredBy!;
  const ring = spec.ringSec ?? 5;
  const talk = spec.talk ?? 60;
  const transfers = spec.transfers ?? [];
  const totalTalk = talk + transfers.reduce((s, x) => s + (x.answered === false ? 0 : x.talk), 0);
  const lc = `Local/${op}@from-queue-${hex()};`;
  rows.push(
    base({
      calldate: addSeconds(spec.at, t),
      uniqueid: id,
      src: caller,
      dst: '2020159',
      dcontext: 'ext-queues',
      channel: trunk,
      dstchannel: `${lc}1`,
      lastapp: 'Queue',
      duration: ring + totalTalk,
      billsec: totalTalk,
      disposition: 'ANSWERED',
      recordingfile: `q-2020159-${caller}-rec-${id}.wav`,
    }),
    base({
      calldate: addSeconds(spec.at, t),
      uniqueid: `${id}2${counter++}`,
      linkedid: id,
      src: caller,
      dst: op,
      dcontext: 'from-queue',
      channel: `${lc}2`,
      dstchannel: `SIP/${op}-${hex()}`,
      lastapp: 'Dial',
      duration: ring + talk,
      billsec: talk,
      disposition: 'ANSWERED',
    }),
  );
  let tx = t + ring + talk;
  for (const x of transfers) {
    const answered = x.answered !== false;
    rows.push(
      base({
        calldate: addSeconds(spec.at, tx),
        uniqueid: `${id}3${counter++}`,
        linkedid: id,
        src: caller,
        dst: x.to,
        dcontext: 'from-internal-xfer',
        channel: `${lc}2`,
        dstchannel: `SIP/${x.to}-${hex()}`,
        lastapp: 'Dial',
        duration: 5 + (answered ? x.talk : 0),
        billsec: answered ? x.talk : 0,
        disposition: answered ? 'ANSWERED' : 'NO ANSWER',
      }),
    );
    if (!answered) break;
    tx += 5 + x.talk;
  }
  return rows;
}

export function outbound(spec: {
  at: string;
  ext: string;
  number: string;
  disposition: 'ANSWERED' | 'NO ANSWER' | 'BUSY' | 'FAILED';
  talk?: number;
}): CdrRow[] {
  const id = newId(spec.at);
  const talk = spec.disposition === 'ANSWERED' ? (spec.talk ?? 90) : 0;
  return [
    base({
      calldate: spec.at,
      uniqueid: id,
      src: spec.ext,
      dst: spec.number,
      dcontext: 'from-internal',
      channel: `SIP/${spec.ext}-${hex()}`,
      dstchannel: `SIP/712020159-${hex()}`,
      lastapp: 'Dial',
      duration: talk + 10,
      billsec: talk,
      disposition: spec.disposition,
      recordingfile: talk ? `out-${spec.number}-${spec.ext}-${id}.wav` : '',
    }),
  ];
}

export function internal(spec: { at: string; from: string; to: string; talk?: number }): CdrRow[] {
  const id = newId(spec.at);
  const talk = spec.talk ?? 30;
  return [
    base({
      calldate: spec.at,
      uniqueid: id,
      src: spec.from,
      dst: spec.to,
      dcontext: 'from-internal',
      channel: `SIP/${spec.from}-${hex()}`,
      dstchannel: `SIP/${spec.to}-${hex()}`,
      lastapp: 'Dial',
      duration: talk + 3,
      billsec: talk,
      disposition: talk ? 'ANSWERED' : 'NO ANSWER',
    }),
  ];
}

/** Assemble fixture rows with the test dialplan + calendar. */
export function calls(...rowSets: CdrRow[][]) {
  return assembleCalls(rowSets.flat(), TEST_DIALPLAN, TEST_CALENDAR);
}
