import { describe, expect, it } from 'vitest';
import {
  InvalidRecordingPathError,
  audioContentType,
  isAudioFileName,
  normalizeRecordingPath,
  resolveUnderRoot,
} from './recording-path.js';

const ROOT = '/var/spool/asterisk/monitor';

describe('normalizeRecordingPath', () => {
  it('normalizes directories', () => {
    expect(normalizeRecordingPath('', 'dir')).toBe('');
    expect(normalizeRecordingPath('/', 'dir')).toBe('');
    expect(normalizeRecordingPath('2026/11/17/', 'dir')).toBe('2026/11/17');
  });

  it('accepts Asterisk file names', () => {
    for (const name of [
      '2026/11/17/q-2020159-935361695-20260910-151650-1789035402.1487198.wav',
      '2026/11/17/external-101-998853802-20260910-145021-1789033821.wav',
      '2026/11/17/g101-20260910-133740-1789031860.1486300.WAV',
      '2026/11/17/out-+998901234567-101-20260910-1.mp3',
    ]) {
      expect(normalizeRecordingPath(name, 'file')).toBe(name);
    }
  });

  it.each([
    ['parent segment', '../etc/passwd.wav'],
    ['nested parent', '2026/11/../../../../etc/shadow.wav'],
    ['current dir', '2026/./11/a.wav'],
    ['absolute', '/etc/passwd.wav'],
    ['backslash', '2026\\..\\a.wav'],
    ['NUL byte', '2026/11/a.wav\u0000.txt'],
    ['encoded dots', '2026/%2e%2e/a.wav'],
    ['hidden file', '2026/11/.a.wav'],
    ['empty segment', '2026//a.wav'],
    ['newline', '2026/11/a\n.wav'],
    ['not audio', '2026/11/17/index.html'],
    ['svg', '2026/11/17/x.svg'],
    ['too deep', 'a/b/c/d/e/f/g.wav'],
  ])('rejects %s', (_label, input) => {
    expect(() => normalizeRecordingPath(input, 'file')).toThrow(InvalidRecordingPathError);
  });

  it('rejects non-strings and empty file paths', () => {
    expect(() => normalizeRecordingPath(undefined, 'dir')).toThrow(InvalidRecordingPathError);
    expect(() => normalizeRecordingPath('', 'file')).toThrow(InvalidRecordingPathError);
    expect(() => normalizeRecordingPath('../x', 'dir')).toThrow(InvalidRecordingPathError);
  });
});

describe('resolveUnderRoot', () => {
  it('joins inside the root', () => {
    expect(resolveUnderRoot(ROOT, '')).toBe(ROOT);
    expect(resolveUnderRoot(`${ROOT}/`, '2026/11')).toBe(`${ROOT}/2026/11`);
  });

  it('refuses to escape even with unnormalized input', () => {
    expect(() => resolveUnderRoot(ROOT, '../../../etc/passwd')).toThrow(InvalidRecordingPathError);
    expect(() => resolveUnderRoot(ROOT, '../monitor-other/x.wav')).toThrow(InvalidRecordingPathError);
  });
});

describe('helpers', () => {
  it('detects audio names and content types', () => {
    expect(isAudioFileName('a.WAV')).toBe(true);
    expect(isAudioFileName('wav')).toBe(false);
    expect(isAudioFileName('a.wav.html')).toBe(false);
    expect(audioContentType('a.mp3')).toBe('audio/mpeg');
    expect(audioContentType('a.wav')).toBe('audio/wav');
  });
});
