import { describe, expect, it } from 'vitest';
import {
  type CallFact,
  type CdrLeg,
  callFactsFromCdr,
  isQueueMemberRingAttempt,
  operatorOfLeg,
  originatorOfLeg,
} from './cdr-calls.js';

const TZ = { timezone: 'Asia/Tashkent' };
const t = (local: string) => new Date(`${local}+05:00`);

function leg(over: Partial<CdrLeg>): CdrLeg {
  return {
    calldate: '2026-11-17 10:00:00',
    src: '901234567',
    dst: '200',
    dcontext: 'ext-queues',
    channel: 'SIP/712020159-00000001',
    dstchannel: '',
    lastdata: '',
    disposition: 'NO ANSWER',
    duration: 30,
    billsec: 0,
    uniqueid: '1763370000.1',
    linkedid: '1763370000.1',
    ...over,
  };
}

describe('operatorOfLeg / originatorOfLeg', () => {
  it.each([
    [{ dst: '200', dcontext: 'ext-queues', dstchannel: 'Local/101@from-queue-00000001;1' }, '101'],
    [{ dst: 's', dcontext: 'from-trunk', dstchannel: 'SIP/103-0000abcd' }, '103'],
    [{ dst: 's', dcontext: 'from-trunk', dstchannel: 'PJSIP/205-0000abcd' }, '205'],
    [{ dst: '114', dcontext: 'from-internal-xfer', dstchannel: '' }, '114'],
    // in a queue context dst is the queue number, not an operator
    [{ dst: '200', dcontext: 'ext-queues', dstchannel: '' }, null],
    // the trunk peer is named after the DID — never an operator
    [{ dst: '935551122', dcontext: 'from-internal', dstchannel: 'SIP/712020159-00000004' }, null],
    [{ dst: 's', dcontext: 'ivr-4', dstchannel: '' }, null],
  ])('%j → %s', (input, ext) => {
    expect(operatorOfLeg(input)).toBe(ext);
  });

  it('reads the originating operator from the channel', () => {
    expect(originatorOfLeg({ channel: 'SIP/103-00000003' })).toBe('103');
    expect(originatorOfLeg({ channel: 'SIP/712020159-00000001' })).toBeNull();
  });
});

describe('callFactsFromCdr', () => {
  it('inbound answered by an operator → conversation with the operator and talk time', () => {
    const facts = callFactsFromCdr(
      [
        leg({
          dstchannel: 'Local/101@from-queue-00000001;1',
          disposition: 'ANSWERED',
          duration: 185,
          billsec: 160,
          src: '998901234567',
        }),
      ],
      TZ,
    );
    expect(facts).toEqual([
      {
        kind: 'conversation',
        callId: '1763370000.1',
        phone: '901234567',
        direction: 'inbound',
        extension: '101',
        endedAt: t('2026-11-17T10:03:05'),
        talkSeconds: 160,
      },
    ]);
  });

  it('inbound answered only by the IVR/queue (no operator leg) is still a missed call (legacy B18)', () => {
    const facts = callFactsFromCdr(
      [leg({ dst: '200', dstchannel: '', disposition: 'ANSWERED', duration: 42, billsec: 42, lastdata: '200,t' })],
      TZ,
    );
    expect(facts).toEqual([
      {
        kind: 'missed',
        callId: '1763370000.1',
        phone: '901234567',
        startedAt: t('2026-11-17T10:00:00'),
        operatorRang: false,
        ivrAfterHours: false,
      },
    ]);
  });

  it('inbound where operators were rung but nobody answered → operatorRang', () => {
    const facts = callFactsFromCdr(
      [
        leg({ dstchannel: '' }),
        leg({ calldate: '2026-11-17 10:00:05', dstchannel: 'Local/103@from-queue-0002;1', uniqueid: '1763370000.2' }),
      ],
      TZ,
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ kind: 'missed', operatorRang: true, startedAt: t('2026-11-17T10:00:00') });
  });

  it.each([
    ['NO ANSWER', 15, true], // rang out
    ['BUSY', 3, true], // declined after ringing
    ['BUSY', 1, true],
    ['BUSY', 0, false], // busy at once: already on a call, the phone did not ring
    ['CONGESTION', 0, false], // phone offline
    ['FAILED', 0, false],
  ])('a member leg %s of %i s: operatorRang = %s (the phone actually rang)', (disposition, duration, rang) => {
    const facts = callFactsFromCdr(
      [
        leg({ dstchannel: '' }),
        leg({
          calldate: '2026-11-17 10:00:05',
          dstchannel: 'Local/103@from-queue-0002;1',
          disposition,
          duration,
        }),
      ],
      TZ,
    );
    expect(facts).toMatchObject([{ kind: 'missed', operatorRang: rang }]);
  });

  it('marks the PBX off-hours announcement', () => {
    const facts = callFactsFromCdr([leg({ dcontext: 'ivr-4', lastdata: 'custom/music-working-time' })], TZ);
    expect(facts[0]).toMatchObject({ kind: 'missed', ivrAfterHours: true });
  });

  it('outbound answered → outbound conversation by the dialing operator', () => {
    const facts = callFactsFromCdr(
      [
        leg({
          src: '103',
          dst: '935551122',
          dcontext: 'from-internal',
          channel: 'SIP/103-00000003',
          dstchannel: 'SIP/712020159-00000004',
          disposition: 'ANSWERED',
          duration: 95,
          billsec: 80,
          uniqueid: '1763371200.3',
          linkedid: '1763371200.3',
        }),
      ],
      TZ,
    );
    expect(facts).toEqual([
      {
        kind: 'conversation',
        callId: '1763371200.3',
        phone: '935551122',
        direction: 'outbound',
        extension: '103',
        endedAt: t('2026-11-17T10:01:35'),
        talkSeconds: 80,
      },
    ]);
  });

  it.each([
    ['BUSY', 'busy'],
    ['NO ANSWER', 'no_answer'],
    ['CONGESTION', 'unavailable'],
  ])('outbound %s → failed attempt (%s)', (disposition, cause) => {
    const facts = callFactsFromCdr(
      [leg({ src: '103', dst: '8935551122', dcontext: 'from-internal', channel: 'SIP/103-00000009', disposition })],
      TZ,
    );
    expect(facts).toEqual([
      {
        kind: 'outbound_failed',
        callId: '1763370000.1',
        phone: '935551122',
        extension: '103',
        at: t('2026-11-17T10:00:00'),
        cause,
      },
    ]);
  });

  it('ignores internal calls, hidden callers and operator-originated inbound-looking rows', () => {
    const facts = callFactsFromCdr(
      [
        leg({ src: '101', dst: '103', dcontext: 'from-internal', channel: 'SIP/101-1', uniqueid: 'a', linkedid: 'a' }),
        leg({ src: '', uniqueid: 'b', linkedid: 'b' }),
        leg({ src: 'anonymous', uniqueid: 'c', linkedid: 'c' }),
        leg({ src: '120', uniqueid: 'd', linkedid: 'd' }),
      ],
      TZ,
    );
    expect(facts).toEqual([]);
  });

  it('groups legs by linkedid and falls back to uniqueid', () => {
    const facts = callFactsFromCdr(
      [
        leg({ uniqueid: 'u1', linkedid: '' }),
        leg({ uniqueid: 'u2', linkedid: '', src: '935551122', calldate: '2026-11-17 09:00:00' }),
      ],
      TZ,
    );
    expect(facts.map((f) => f.callId)).toEqual(['u2', 'u1']); // chronological
  });

  it('returns facts in chronological order of effect (conversations by their end)', () => {
    const facts = callFactsFromCdr(
      [
        leg({ uniqueid: 'm', linkedid: 'm', calldate: '2026-11-17 10:00:00' }),
        leg({
          uniqueid: 'c',
          linkedid: 'c',
          calldate: '2026-11-17 09:58:00',
          dstchannel: 'SIP/101-1',
          disposition: 'ANSWERED',
          duration: 600,
          billsec: 590,
        }),
      ],
      TZ,
    );
    expect(facts.map((f) => f.kind)).toEqual(['missed', 'conversation']);
  });
});

describe('callFactsFromCdr: calls only partly in the read window', () => {
  // Answered at 09:58, then transferred to a queue where nobody picked up.
  const head = leg({
    calldate: '2026-11-17 09:58:00',
    dstchannel: 'Local/101@from-queue-1;1',
    disposition: 'ANSWERED',
    duration: 300,
    billsec: 280,
  });
  const tail = leg({ calldate: '2026-11-17 10:03:00', dstchannel: 'Local/104@from-queue-2;1', disposition: 'BUSY' });
  const later = leg({ calldate: '2026-11-17 10:05:00', src: '935551122', uniqueid: 'y', linkedid: 'y' });
  const startedFrom = t('2026-11-17T10:00:00');

  it('leaves out a call that started before `startedFrom` (the guard before the window shows its start)', () => {
    expect(callFactsFromCdr([head, tail, later], { ...TZ, startedFrom }).map((f) => f.callId)).toEqual(['y']);
  });

  it('would judge such a call by its tail without the guard: a false missed call', () => {
    expect(callFactsFromCdr([tail], TZ)).toMatchObject([{ kind: 'missed', phone: '901234567' }]);
  });

  it('keeps a call that starts exactly at `startedFrom`', () => {
    const atStart = leg({ calldate: '2026-11-17 10:00:00', uniqueid: 'z', linkedid: 'z' });
    expect(callFactsFromCdr([atStart], { ...TZ, startedFrom }).map((f) => f.callId)).toEqual(['z']);
  });
});

/**
 * Production (no cdr.linkedid, legs keyed by uniqueid): CdrLegsReader drops the queue members' own ring attempts
 * in SQL. These tests prove that dropping them never changes the facts.
 */
describe("queue members' own ring attempts, legs keyed by uniqueid", () => {
  /** As CdrLegsReader returns rows from a PBX without linkedid. */
  const byUid = (l: CdrLeg): CdrLeg => ({ ...l, linkedid: l.uniqueid });
  const at = (hms: string) => `2026-11-17 ${hms}`;
  const caller = { src: '998901234567', channel: 'SIP/712020159-00000a00', dcontext: 'ext-queues', dst: '200' };

  /** A morning of calls the way the production PBX writes the caller side and the operators' phones. */
  const morning: CdrLeg[] = [
    // answered via the queue after two busy operators (caller-side attempts share the caller's uniqueid)
    leg({
      ...caller,
      uniqueid: 'in1',
      calldate: at('10:00:00'),
      dcontext: 'ivr-3',
      dst: 's',
      lastdata: 'custom/welcome',
      disposition: 'ANSWERED',
      duration: 12,
      billsec: 12,
    }),
    leg({
      ...caller,
      uniqueid: 'in1',
      calldate: at('10:00:12'),
      dstchannel: 'Local/101@from-queue-00000a01;1',
      disposition: 'BUSY',
      duration: 0,
    }),
    leg({
      ...caller,
      uniqueid: 'in1',
      calldate: at('10:00:12'),
      dstchannel: 'Local/102@from-queue-00000a02;1',
      disposition: 'CONGESTION',
      duration: 0,
    }),
    leg({
      ...caller,
      uniqueid: 'in1',
      calldate: at('10:00:20'),
      dstchannel: 'Local/103@from-queue-00000a03;1',
      disposition: 'ANSWERED',
      duration: 200,
      billsec: 180,
    }),
    // abandoned in the queue: one phone busy at once, one offline → missed, and no operator's phone rang
    leg({
      ...caller,
      src: '935551122',
      channel: 'SIP/712020159-00000a10',
      uniqueid: 'ab1',
      calldate: at('10:05:00'),
      dstchannel: 'Local/101@from-queue-00000a11;1',
      disposition: 'BUSY',
      duration: 0,
    }),
    leg({
      ...caller,
      src: '935551122',
      channel: 'SIP/712020159-00000a10',
      uniqueid: 'ab1',
      calldate: at('10:05:03'),
      dstchannel: 'Local/104@from-queue-00000a12;1',
      disposition: 'CONGESTION',
      duration: 0,
    }),
    // after hours: the announcement, nobody rung
    leg({
      ...caller,
      src: '977778899',
      channel: 'SIP/712020159-00000a20',
      uniqueid: 'ah1',
      calldate: at('10:07:00'),
      dcontext: 'ivr-4',
      dst: 's',
      lastdata: 'custom/music-working-time',
      disposition: 'ANSWERED',
      duration: 20,
      billsec: 20,
    }),
    // operators calling out: answered and busy
    leg({
      uniqueid: 'out1',
      calldate: at('10:10:00'),
      src: '105',
      dst: '935551122',
      dcontext: 'from-internal',
      channel: 'SIP/105-00000b01',
      dstchannel: 'SIP/712020159-00000b02',
      disposition: 'ANSWERED',
      duration: 70,
      billsec: 60,
    }),
    leg({
      uniqueid: 'out2',
      calldate: at('10:12:00'),
      src: '106',
      dst: '8977778899',
      dcontext: 'from-internal',
      channel: 'SIP/106-00000b03',
      dstchannel: 'SIP/712020159-00000b04',
      disposition: 'BUSY',
      duration: 0,
    }),
    // internal call between operators
    leg({
      uniqueid: 'int1',
      calldate: at('10:15:00'),
      src: '101',
      dst: '103',
      dcontext: 'from-internal',
      channel: 'SIP/101-00000b05',
      dstchannel: 'SIP/103-00000b06',
      disposition: 'ANSWERED',
      duration: 30,
      billsec: 25,
    }),
  ].map(byUid);

  /** Deterministic pseudo-random numbers (mulberry32), so a failure is reproducible. */
  function random(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let r = Math.imul(a ^ (a >>> 15), 1 | a);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
    };
  }

  /** `count` ring attempts of the members' `Local/<ext>@from-queue-…;2` halves, each with its own uniqueid. */
  function memberAttempts(count: number, rnd: () => number): CdrLeg[] {
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
    return Array.from({ length: count }, (_, i) => {
      const ext = pick(['101', '102', '103', '104', '105', '106', '114']);
      const disposition = pick(['BUSY', 'CONGESTION', 'NO ANSWER', 'FAILED', 'ANSWERED']);
      const second = Math.floor(rnd() * 40 * 60); // 09:55 .. 10:35
      const time = new Date(Date.UTC(2026, 10, 17, 9, 55, 0) + second * 1000).toISOString().slice(11, 19);
      return byUid(
        leg({
          calldate: at(time),
          src: pick(['998901234567', '935551122', '977778899', '', ext]),
          dst: ext,
          dcontext: 'from-internal',
          channel: `Local/${ext}@from-queue-${(0xc000 + i).toString(16).padStart(8, '0')};2`,
          dstchannel: '',
          lastdata: `SIP/${ext},,trM(auto-blkvm)`,
          disposition,
          duration: Math.floor(rnd() * 30),
          billsec: disposition === 'ANSWERED' ? Math.floor(rnd() * 30) : 0,
          uniqueid: `1763370${String(i).padStart(3, '0')}.${4000 + i}`,
        }),
      );
    });
  }

  /** Puts every extra leg at a random position; the original legs keep their order (ties stay as the DB gave them). */
  function interleave(base: readonly CdrLeg[], extra: readonly CdrLeg[], rnd: () => number): CdrLeg[] {
    const out = [...base];
    for (const l of extra) out.splice(Math.floor(rnd() * (out.length + 1)), 0, l);
    return out;
  }

  const byCallId = (facts: CallFact[]) => [...facts].sort((a, b) => a.callId.localeCompare(b.callId));

  it('the morning yields the facts it should (sanity check of the fixture)', () => {
    expect(byCallId(callFactsFromCdr(morning, TZ)).map((f) => [f.callId, f.kind])).toEqual([
      ['ab1', 'missed'],
      ['ah1', 'missed'],
      ['in1', 'conversation'],
      ['out1', 'conversation'],
      ['out2', 'outbound_failed'],
    ]);
  });

  it("match the reader's SQL filter (channel Local/…, dcontext from-internal, no peer channel)", () => {
    for (const l of memberAttempts(50, random(1))) expect(isQueueMemberRingAttempt(l)).toBe(true);
    for (const l of morning) expect(isQueueMemberRingAttempt(l)).toBe(false);
  });

  it('on their own never yield a fact', () => {
    expect(callFactsFromCdr(memberAttempts(500, random(2)), TZ)).toEqual([]);
  });

  it.each([3, 4, 5, 6, 7])('mixed into real calls never change the facts (seed %i)', (seed) => {
    const rnd = random(seed);
    const expected = byCallId(callFactsFromCdr(morning, TZ));
    const withAttempts = interleave(morning, memberAttempts(300, rnd), rnd);
    expect(byCallId(callFactsFromCdr(withAttempts, TZ))).toEqual(expected);
    expect(byCallId(callFactsFromCdr(withAttempts, { ...TZ, startedFrom: t('2026-11-17T10:00:00') }))).toEqual(
      expected,
    );
  });

  it('a member leg that reached a phone is kept: a transfer adds a row to its Local channel', () => {
    const channel = 'Local/103@from-queue-00000a03;2';
    const answered = byUid(
      leg({
        calldate: at('10:00:20'),
        src: '998901234567',
        dst: '103',
        dcontext: 'from-internal',
        channel,
        dstchannel: 'SIP/103-00000c01',
        lastdata: 'SIP/103,,tr',
        disposition: 'ANSWERED',
        duration: 200,
        billsec: 180,
        uniqueid: '1763370020.7',
      }),
    );
    // operator 103 blind-transfers the citizen to 107, who does not answer
    const transfer = byUid(
      leg({
        calldate: at('10:03:20'),
        src: '998901234567',
        dst: '107',
        dcontext: 'from-internal-xfer',
        channel,
        dstchannel: 'SIP/107-00000c02',
        lastdata: 'SIP/107,,tr',
        disposition: 'NO ANSWER',
        duration: 25,
        uniqueid: '1763370020.7',
      }),
    );
    expect(isQueueMemberRingAttempt(answered)).toBe(false); // the reader keeps it…
    expect(callFactsFromCdr([answered, transfer], TZ)).toEqual([]); // …so the Local channel's rows stay silent
    // Dropped, the transfer row alone would be a false missed call (the citizen's own uniqueid has the real one).
    expect(callFactsFromCdr([transfer], TZ)).toMatchObject([{ kind: 'missed', phone: '901234567' }]);
  });
});
