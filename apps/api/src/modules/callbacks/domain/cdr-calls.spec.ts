import { describe, expect, it } from 'vitest';
import { type CdrLeg, callFactsFromCdr, operatorOfLeg, originatorOfLeg } from './cdr-calls.js';

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
