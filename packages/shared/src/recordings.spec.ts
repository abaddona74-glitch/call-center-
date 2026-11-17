import { describe, expect, it } from 'vitest';
import {
  CreateZipJobRequestSchema,
  RecordingDirPathSchema,
  RecordingFilePathSchema,
  estimateRecordingSeconds,
  recordingKind,
} from './recordings.js';

describe('recordingKind (legacy classifyAudioFile)', () => {
  it('header-only files are empty', () => {
    expect(recordingKind('q-200-1-20261117-100000-1.1.wav', 44)).toBe('empty');
    expect(recordingKind('x.wav', 0)).toBe('empty');
  });
  it('short queue recordings and abandoned calls are robot', () => {
    expect(recordingKind('q-200-901234567-20261117-100000-1.1.wav', 200_000)).toBe('robot');
    expect(recordingKind('out-abandon-1.wav', 5_000_000)).toBe('robot');
  });
  it('long queue recordings and other calls are talk', () => {
    expect(recordingKind('q-200-901234567-20261117-100000-1.1.wav', 720_044)).toBe('talk');
    expect(recordingKind('out-935551122-103-20261117-102000-1.3.wav', 100_000)).toBe('talk');
  });
});

describe('estimateRecordingSeconds', () => {
  it('uses (size - 44) / 16000', () => {
    expect(estimateRecordingSeconds(44)).toBe(0);
    expect(estimateRecordingSeconds(720_044)).toBe(45);
  });
});

describe('recording path schemas', () => {
  it('accepts monitor-relative paths', () => {
    expect(RecordingDirPathSchema.parse('/2026/11/17/')).toBe('2026/11/17');
    expect(RecordingDirPathSchema.parse('')).toBe('');
    expect(RecordingFilePathSchema.parse('2026/11/17/q-200-1-x.1.wav')).toBe('2026/11/17/q-200-1-x.1.wav');
  });
  it.each(['../etc/passwd', '2026/../../etc', '2026/./11', '..', '2026\\11', '2026/11/%2e%2e', '.hidden', '2026//11'])(
    'rejects %s',
    (p) => {
      expect(RecordingDirPathSchema.safeParse(p).success).toBe(false);
    },
  );
  it('rejects non-audio and absolute file paths', () => {
    expect(RecordingFilePathSchema.safeParse('2026/11/17/a.html').success).toBe(false);
    expect(RecordingFilePathSchema.safeParse('/etc/passwd.wav').success).toBe(false);
    expect(RecordingFilePathSchema.safeParse('2026/11/17/a.wav\u0000.txt').success).toBe(false);
  });
});

describe('CreateZipJobRequestSchema', () => {
  it('validates each source', () => {
    expect(CreateZipJobRequestSchema.safeParse({ source: 'files', paths: ['2026/11/17/a.wav'] }).success).toBe(true);
    expect(CreateZipJobRequestSchema.safeParse({ source: 'calls', uniqueids: ['1763370000.1'] }).success).toBe(true);
    expect(CreateZipJobRequestSchema.safeParse({ source: 'range', from: '2026-11-01', to: '2026-11-17' }).success).toBe(true);
    expect(CreateZipJobRequestSchema.safeParse({ source: 'files', paths: [] }).success).toBe(false);
    expect(CreateZipJobRequestSchema.safeParse({ source: 'calls', uniqueids: ['1; drop'] }).success).toBe(false);
  });
  it('sanitizes zip names', () => {
    const r = CreateZipJobRequestSchema.parse({ source: 'files', paths: ['a/b.wav'], zipName: '../x<y>.zip' });
    expect(r.zipName).toBe('.._x_y_.zip');
  });
});
