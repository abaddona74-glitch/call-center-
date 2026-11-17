import path from 'node:path';
import { RECORDING_EXTENSIONS } from '@cc/shared';

/**
 * Path rules for the Asterisk monitor folder. Every path that reaches the storage goes through
 * `normalizeRecordingPath` (client input) and then `resolveUnderRoot` (containment check).
 * Fixes the legacy traversal issues: no "..", no absolute paths, no encoded tricks, no symlinks
 * (the storage layer uses lstat and refuses anything that is not a regular file/directory).
 */
export class InvalidRecordingPathError extends Error {
  constructor(message = 'Invalid recording path') {
    super(message);
    this.name = 'InvalidRecordingPathError';
  }
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
export const MAX_PATH_DEPTH = 6;
const AUDIO_EXTENSIONS = new Set<string>(RECORDING_EXTENSIONS);

export function isAudioFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && AUDIO_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * Validates a monitor-relative path from a client and returns it normalized
 * ("" for the root directory). Throws InvalidRecordingPathError.
 */
export function normalizeRecordingPath(input: unknown, kind: 'dir' | 'file'): string {
  if (typeof input !== 'string') throw new InvalidRecordingPathError();
  if (input.length > 255) throw new InvalidRecordingPathError('Path is too long');
  // NUL, backslashes, percent-encoding and control characters never appear in Asterisk paths.
  // oxlint-disable-next-line no-control-regex -- rejecting control characters on purpose
  if (/[\u0000-\u001f\\%]/.test(input)) throw new InvalidRecordingPathError();
  if (kind === 'file' && input.startsWith('/')) throw new InvalidRecordingPathError();

  const trimmed = input.replace(/^\/+|\/+$/g, '');
  if (trimmed === '') {
    if (kind === 'file') throw new InvalidRecordingPathError();
    return '';
  }
  const segments = trimmed.split('/');
  if (segments.length > MAX_PATH_DEPTH) throw new InvalidRecordingPathError('Path is too deep');
  for (const s of segments) {
    if (s === '.' || s === '..' || !SEGMENT.test(s)) throw new InvalidRecordingPathError();
  }
  if (kind === 'file' && !isAudioFileName(segments[segments.length - 1])) {
    throw new InvalidRecordingPathError('Not an audio file');
  }
  return segments.join('/');
}

/** Absolute path of a (normalized) relative path, asserting it stays inside `root`. */
export function resolveUnderRoot(root: string, relative: string): string {
  const normRoot = path.posix.normalize(root).replace(/\/+$/, '') || '/';
  const abs = path.posix.normalize(path.posix.join(normRoot, relative));
  const prefix = normRoot === '/' ? '/' : `${normRoot}/`;
  if (abs !== normRoot && !abs.startsWith(prefix)) throw new InvalidRecordingPathError();
  return abs;
}

export function audioContentType(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg';
    case 'ogg':
      return 'audio/ogg';
    case 'gsm':
      return 'audio/x-gsm';
    default:
      return 'audio/wav';
  }
}

/** Parent directory of a relative path ("" for top-level entries). */
export function parentDir(relative: string): string {
  const idx = relative.lastIndexOf('/');
  return idx < 0 ? '' : relative.slice(0, idx);
}

export function baseName(relative: string): string {
  return relative.slice(relative.lastIndexOf('/') + 1);
}
