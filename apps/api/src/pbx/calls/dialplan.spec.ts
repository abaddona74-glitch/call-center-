import type { CdrRow } from './cdr-row.js';
import {
  DEFAULT_DIALPLAN as dp,
  extFromLocalChannel,
  extFromSipChannel,
  isInboundRow,
  isOutboundRow,
  isTransferRow,
  normalizeClientNumber,
  operatorLegOf,
  parseLocalChannel,
  storedNumberVariants,
} from './dialplan.js';

const row = (p: Partial<CdrRow>): CdrRow => ({
  calldate: '2026-11-17 10:00:00',
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
  disposition: 'ANSWERED',
  uniqueid: '1.1',
  linkedid: '1.1',
  recordingfile: '',
  ...p,
});

describe('channel parsing', () => {
  it('extracts extensions from SIP and Local channels', () => {
    expect(extFromSipChannel('SIP/101-0000abcd')).toBe('101');
    expect(extFromSipChannel('PJSIP/205-00000012')).toBe('205');
    expect(extFromSipChannel('SIP/712020159-0000abcd')).toBe('712020159');
    expect(extFromSipChannel('Local/101@from-queue-0000;1')).toBeNull();
    expect(extFromLocalChannel('Local/101@from-queue-0000abcd;2')).toBe('101');
    expect(parseLocalChannel('Local/103@from-queue-a1b2c3d4;1')).toEqual({ ext: '103', context: 'from-queue' });
    expect(parseLocalChannel('Local/101@from-queue/n')).toEqual({ ext: '101', context: 'from-queue' });
    expect(parseLocalChannel('Local/106@from-internal-xfer-0000ffff;1')?.context).toBe('from-internal-xfer');
  });
});

describe('row predicates', () => {
  it('recognizes an external inbound row (trunk channel, not internal src)', () => {
    expect(isInboundRow(row({ channel: 'SIP/712020159-0001', dcontext: 'ext-queues', src: '998901234567' }), dp)).toBe(
      true,
    );
    expect(isInboundRow(row({ channel: 'SIP/712020159-0001', dcontext: 'ivr-4', src: 'anonymous' }), dp)).toBe(true);
    // queue member legs and operator-dialled rows are not inbound rows
    expect(
      isInboundRow(row({ channel: 'Local/101@from-queue-01;2', dcontext: 'from-queue', src: '998901234567' }), dp),
    ).toBe(false);
    expect(isInboundRow(row({ channel: 'SIP/101-0001', dcontext: 'from-internal', src: '101', dst: '103' }), dp)).toBe(
      false,
    );
  });

  it('recognizes outbound rows only for external numbers', () => {
    expect(isOutboundRow(row({ channel: 'SIP/101-0001', dcontext: 'from-internal', dst: '901234567' }), dp)).toBe(true);
    expect(isOutboundRow(row({ channel: 'SIP/101-0001', dcontext: 'from-internal', dst: '103' }), dp)).toBe(false);
    expect(isOutboundRow(row({ channel: 'SIP/101-0001', dcontext: 'from-internal', dst: '2020159' }), dp)).toBe(false);
  });

  it('finds the operator a row connects to', () => {
    expect(operatorLegOf(row({ dstchannel: 'Local/101@from-queue-01;1', billsec: 10 }), dp)).toMatchObject({
      ext: '101',
      kind: 'member',
      answered: true,
    });
    expect(operatorLegOf(row({ dstchannel: 'SIP/103-0001', billsec: 0, disposition: 'NO ANSWER' }), dp)).toMatchObject({
      ext: '103',
      kind: 'phone',
      answered: false,
    });
    expect(operatorLegOf(row({ dstchannel: 'SIP/712020159-0001' }), dp)).toBeNull(); // trunk is not an operator
    expect(
      operatorLegOf(row({ dcontext: 'from-internal', channel: 'SIP/101-1', dstchannel: 'SIP/103-1' }), dp),
    ).toBeNull();
    expect(isTransferRow(row({ dcontext: 'from-internal-xfer', dst: '103' }), dp)).toBe(true);
  });
});

describe('client numbers', () => {
  it('normalizes every stored form to one canonical number', () => {
    expect(normalizeClientNumber('998901234567', dp)).toBe('901234567');
    expect(normalizeClientNumber('+998 90 123 45 67', dp)).toBe('901234567');
    expect(normalizeClientNumber('0901234567', dp)).toBe('901234567'); // outside-line prefix
    expect(normalizeClientNumber('8901234567', dp)).toBe('901234567');
    expect(normalizeClientNumber('712345678', dp)).toBe('712345678');
  });

  it('treats hidden, internal and service numbers as no client', () => {
    expect(normalizeClientNumber('anonymous', dp)).toBeNull();
    expect(normalizeClientNumber('', dp)).toBeNull();
    expect(normalizeClientNumber('101', dp)).toBeNull();
    expect(normalizeClientNumber('2020159', dp)).toBeNull();
    expect(normalizeClientNumber('712020159', dp)).toBeNull();
  });

  it('lists the stored variants for an indexed lookup', () => {
    expect(storedNumberVariants('901234567', dp)).toEqual(
      expect.arrayContaining(['901234567', '998901234567', '+998901234567', '0901234567', '8901234567']),
    );
  });
});
