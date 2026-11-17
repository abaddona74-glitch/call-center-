import type { CdrRow } from './cdr-row.js';
import { calls, inbound, internal, outbound } from './testing/cdr-fixtures.js';

// 2026-11-17 is a Tuesday, 2026-11-14 a Saturday.
describe('assembleCalls — inbound', () => {
  it('queue call answered after a ring-no-answer', () => {
    const [c] = calls(
      inbound({
        at: '2026-11-17 10:00:00',
        caller: '998901234567',
        ivrSec: 10,
        rung: ['101'],
        outcome: 'answered',
        answeredBy: '103',
        ringSec: 5,
        talk: 120,
      }),
    );
    expect(c).toMatchObject({
      direction: 'inbound',
      status: 'answered',
      clientNumber: '901234567',
      clientNumberRaw: '998901234567',
      hiddenNumber: false,
      firstOperator: '103',
      finalOperator: '103',
      operators: ['103'],
      missedBy: ['101'],
      talkSec: 120,
      // queue entry (10 s after start) → 15 s ring on 101 + 5 s ring on 103
      waitSec: 20,
      reachedQueue: true,
      inWorkingHours: true,
    });
    expect(c.recordingFile).toMatch(/^q-2020159-/);
    expect(c.operatorTalk).toEqual({ '103': 120 });
  });

  it('counts the IVR leg answer as no operator answer', () => {
    const [c] = calls(inbound({ at: '2026-11-17 10:00:00', caller: '901112233', outcome: 'ivr' }));
    expect(c.status).toBe('ivr');
    expect(c.talkSec).toBe(0);
    expect(c.operators).toEqual([]);
    expect(c.waitSec).toBeNull();
  });

  it('abandoned in the queue even though the queue leg is ANSWERED with billsec', () => {
    const [c] = calls(
      inbound({
        at: '2026-11-17 11:00:00',
        caller: '935551122',
        outcome: 'abandoned',
        rung: ['101', '106'],
        abandonAfter: 12,
      }),
    );
    expect(c.status).toBe('abandoned');
    expect(c.missedBy.sort()).toEqual(['101', '106']);
    expect(c.waitSec).toBe(42); // 2 × 15 s ringing + 12 s
    expect(c.talkSec).toBe(0);
  });

  it('after-hours: off-hours announcement, or outside the working calendar', () => {
    const [announcement] = calls(inbound({ at: '2026-11-17 22:10:00', caller: '977778899', outcome: 'after_hours' }));
    expect(announcement.status).toBe('after_hours');
    expect(announcement.inWorkingHours).toBe(false);
    const [saturday] = calls(inbound({ at: '2026-11-14 10:00:00', caller: '977778899', outcome: 'abandoned' }));
    expect(saturday.status).toBe('after_hours');
    // an answered Saturday call stays answered, just outside working hours
    const [answeredSat] = calls(
      inbound({ at: '2026-11-14 10:00:00', caller: '977778899', outcome: 'answered', answeredBy: '101' }),
    );
    expect(answeredSat).toMatchObject({ status: 'answered', inWorkingHours: false });
  });

  it('21:00:00 exactly is after hours (half-open window)', () => {
    const [c] = calls(inbound({ at: '2026-11-17 21:00:00', caller: '977778899', outcome: 'abandoned' }));
    expect(c.inWorkingHours).toBe(false);
    expect(c.status).toBe('after_hours');
  });

  it('hidden number', () => {
    const [a, b] = calls(
      inbound({ at: '2026-11-17 12:00:00', caller: 'anonymous', outcome: 'answered', answeredBy: '111' }),
      inbound({ at: '2026-11-17 12:05:00', caller: '', outcome: 'abandoned' }),
    );
    expect(a).toMatchObject({ hiddenNumber: true, clientNumber: null, status: 'answered' });
    expect(b).toMatchObject({ hiddenNumber: true, clientNumber: null, status: 'abandoned' });
  });

  it('two-hop blind transfer credits each hop to the right operator', () => {
    const [c] = calls(
      inbound({
        at: '2026-11-17 14:00:00',
        caller: '998901234567',
        outcome: 'answered',
        answeredBy: '101',
        talk: 60,
        transfers: [
          { to: '103', talk: 90 },
          { to: '106', talk: 30 },
        ],
      }),
    );
    expect(c.firstOperator).toBe('101');
    expect(c.finalOperator).toBe('106');
    expect(c.operators).toEqual(['101', '103', '106']);
    expect(c.transfers.map((t) => [t.from, t.to, t.answered])).toEqual([
      ['101', '103', true],
      ['103', '106', true],
    ]);
    // per-operator talk from each operator's own leg; the caller-side leg (180 s) is not double counted
    expect(c.operatorTalk).toEqual({ '101': 60, '103': 90, '106': 30 });
    expect(c.talkSec).toBe(180);
  });

  it('unanswered transfer leaves the call with the transferring operator', () => {
    const [c] = calls(
      inbound({
        at: '2026-11-17 15:00:00',
        caller: '901234567',
        outcome: 'answered',
        answeredBy: '101',
        talk: 40,
        transfers: [{ to: '103', talk: 0, answered: false }],
      }),
    );
    expect(c.finalOperator).toBe('101');
    expect(c.transfers).toEqual([expect.objectContaining({ from: '101', to: '103', answered: false })]);
    expect(c.missedBy).toEqual(['103']);
  });

  it('single-row (Asterisk 11 style) queue answer falls back to the member leg', () => {
    const row: CdrRow = {
      calldate: '2026-11-17 10:00:00',
      clid: '',
      src: '901234567',
      dst: '200',
      dcontext: 'ext-queues',
      channel: 'SIP/712020159-00000001',
      dstchannel: 'Local/101@from-queue-00000001;1',
      lastapp: 'Queue',
      lastdata: '200,t',
      duration: 185,
      billsec: 160,
      disposition: 'ANSWERED',
      uniqueid: '1763370000.1',
      linkedid: '1763370000.1',
      recordingfile: '',
    };
    const [c] = calls([row]);
    expect(c).toMatchObject({ status: 'answered', finalOperator: '101', talkSec: 160, waitSec: 25 });
  });

  it('groups by uniqueid when linkedid is empty', () => {
    const rows = inbound({ at: '2026-11-17 10:00:00', caller: '901234567', outcome: 'ivr' }).map((r) => ({
      ...r,
      linkedid: '',
    }));
    expect(calls(rows)).toHaveLength(1);
  });
});

describe('assembleCalls — outbound and internal', () => {
  it('outbound statuses from the disposition', () => {
    const result = calls(
      outbound({ at: '2026-11-17 10:00:00', ext: '101', number: '0901234567', disposition: 'ANSWERED', talk: 75 }),
      outbound({ at: '2026-11-17 10:01:00', ext: '101', number: '901234567', disposition: 'NO ANSWER' }),
      outbound({ at: '2026-11-17 10:02:00', ext: '103', number: '901234567', disposition: 'BUSY' }),
      outbound({ at: '2026-11-17 10:03:00', ext: '103', number: '901234567', disposition: 'FAILED' }),
    );
    expect(result.map((c) => c.status)).toEqual(['answered', 'no_answer', 'busy', 'failed']);
    expect(result[0]).toMatchObject({
      direction: 'outbound',
      clientNumber: '901234567',
      firstOperator: '101',
      talkSec: 75,
      waitSec: null,
    });
  });

  it('operator-to-operator calls are internal, never inbound', () => {
    const [c] = calls(internal({ at: '2026-11-17 10:00:00', from: '101', to: '103', talk: 20 }));
    expect(c).toMatchObject({
      direction: 'internal',
      status: 'answered',
      operators: ['101', '103'],
      clientNumber: null,
    });
  });

  it('skips system rows (feature codes)', () => {
    const featureCode: CdrRow = {
      calldate: '2026-11-17 10:00:00',
      clid: '',
      src: '101',
      dst: '*97',
      dcontext: 'app-vmmain',
      channel: 'SIP/101-1',
      dstchannel: '',
      lastapp: 'VoiceMailMain',
      lastdata: '',
      duration: 5,
      billsec: 5,
      disposition: 'ANSWERED',
      uniqueid: '9.9',
      linkedid: '9.9',
      recordingfile: '',
    };
    expect(calls([featureCode])).toEqual([]);
  });

  it('sorts calls by start time', () => {
    const result = calls(
      outbound({ at: '2026-11-17 12:00:00', ext: '101', number: '901234567', disposition: 'ANSWERED' }),
      inbound({ at: '2026-11-17 09:00:00', caller: '901234567', outcome: 'ivr' }),
    );
    expect(result.map((c) => c.direction)).toEqual(['inbound', 'outbound']);
  });
});
