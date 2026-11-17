import { describe, expect, it } from 'vitest';
import { type CdrRecordingRow, pickRecordingRow, recordingFileCandidates, rowInvolvesExtension } from './cdr-recording.js';

const ROOT = '/var/spool/asterisk/monitor';

function row(over: Partial<CdrRecordingRow>): CdrRecordingRow {
  return {
    calldate: '2026-11-17 10:00:00',
    uniqueid: '1763370000.1',
    linkedid: '1763370000.1',
    src: '901234567',
    dst: '200',
    cnum: '',
    channel: 'SIP/712020159-00000001',
    dstchannel: 'Local/101@from-queue-00000001;1',
    recordingfile: '',
    ...over,
  };
}

describe('pickRecordingRow', () => {
  it('uses only rows of the exact call', () => {
    const rows = [
      row({ uniqueid: '1763370000.1', recordingfile: '' }),
      row({ uniqueid: '1763370000.2', linkedid: '1763370000.1', recordingfile: 'q-200-other.wav' }),
    ];
    expect(pickRecordingRow(rows, '1763370000.1')).toBeNull();
  });

  it('prefers the max recordingfile like legacy', () => {
    const rows = [row({ recordingfile: 'a.wav' }), row({ recordingfile: 'b.wav' })];
    expect(pickRecordingRow(rows, '1763370000.1')?.recordingfile).toBe('b.wav');
  });
});

describe('recordingFileCandidates', () => {
  it('derives the day folder from calldate and the file name', () => {
    expect(recordingFileCandidates('q-200-901234567-20261117-100000-1763370000.1.wav', '2026-11-17 10:00:00', ROOT)).toEqual([
      '2026/11/17/q-200-901234567-20261117-100000-1763370000.1.wav',
    ]);
    // call after midnight but file stamped the previous day
    expect(recordingFileCandidates('q-1-2-20261116-235959-1.1.wav', '2026-11-17 00:00:03', ROOT)).toEqual([
      '2026/11/17/q-1-2-20261116-235959-1.1.wav',
      '2026/11/16/q-1-2-20261116-235959-1.1.wav',
    ]);
  });

  it('accepts full and relative paths inside the monitor root only', () => {
    expect(recordingFileCandidates(`${ROOT}/2026/11/17/a.wav`, null, ROOT)).toEqual(['2026/11/17/a.wav']);
    expect(recordingFileCandidates('2026/11/17/a.wav', null, ROOT)).toEqual(['2026/11/17/a.wav']);
    expect(recordingFileCandidates('/etc/passwd', null, ROOT)).toEqual([]);
    expect(recordingFileCandidates(`${ROOT}/../../../etc/passwd`, null, ROOT)).toEqual([]);
    expect(recordingFileCandidates('', '2026-11-17 10:00:00', ROOT)).toEqual([]);
  });

  it('adds .wav when the extension is missing', () => {
    expect(recordingFileCandidates('g101-20261116-153000-1763290200.7', '2026-11-16 15:30:00', ROOT)).toEqual([
      '2026/11/16/g101-20261116-153000-1763290200.7.wav',
    ]);
  });
});

describe('rowInvolvesExtension', () => {
  it('matches queue members, callers and callees', () => {
    expect(rowInvolvesExtension(row({}), '101')).toBe(true);
    expect(rowInvolvesExtension(row({ src: '103', channel: 'SIP/103-00000003', dstchannel: 'SIP/712020159-4' }), '103')).toBe(
      true,
    );
    expect(rowInvolvesExtension(row({ dst: '106', dstchannel: 'PJSIP/106-0000a' }), '106')).toBe(true);
  });

  it('does not match other extensions or prefixes', () => {
    expect(rowInvolvesExtension(row({}), '10')).toBe(false);
    expect(rowInvolvesExtension(row({}), '1011')).toBe(false);
    expect(rowInvolvesExtension(row({}), '103')).toBe(false);
    expect(rowInvolvesExtension(row({}), '.*')).toBe(false);
  });
});
