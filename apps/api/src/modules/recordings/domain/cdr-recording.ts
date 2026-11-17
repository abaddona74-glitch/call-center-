import path from 'node:path';
import { isAudioFileName, normalizeRecordingPath } from './recording-path.js';

/** The CDR columns needed to find a call's recording and to check who took part in it. */
export interface CdrRecordingRow {
  calldate: string;
  uniqueid: string;
  linkedid: string;
  src: string;
  dst: string;
  cnum: string;
  channel: string;
  dstchannel: string;
  recordingfile: string;
}

/**
 * The recording of the call with this exact uniqueid: the CDR `recordingfile` of that call's own rows.
 * There is deliberately no fallback (no "closest file for this caller"): legacy attached another
 * person's recording when its fuzzy search scored zero.
 */
export function pickRecordingRow(rows: readonly CdrRecordingRow[], uniqueid: string): CdrRecordingRow | null {
  const own = rows
    .filter((r) => r.uniqueid === uniqueid && r.recordingfile.trim() !== '')
    // legacy: MAX(recordingfile) per uniqueid
    .sort((a, b) => (a.recordingfile < b.recordingfile ? 1 : a.recordingfile > b.recordingfile ? -1 : 0));
  return own[0] ?? null;
}

/**
 * Monitor-relative paths where `recordingfile` may live, most likely first.
 * Asterisk stores either a bare file name (in YYYY/MM/DD of the call) or a full path.
 * Every candidate is a valid relative audio path; unsafe values yield [].
 */
export function recordingFileCandidates(recordingfile: string, calldate: string | null, monitorRoot: string): string[] {
  let raw = recordingfile.trim();
  // oxlint-disable-next-line no-control-regex -- rejecting control characters on purpose
  if (!raw || /[\u0000-\u001f\\]/.test(raw) || raw.split('/').includes('..')) return [];
  if (!isAudioFileName(raw)) raw = `${raw}.wav`;

  const root = path.posix.normalize(monitorRoot).replace(/\/+$/, '');
  const candidates: string[] = [];
  if (raw.startsWith('/')) {
    if (!raw.startsWith(`${root}/`)) return [];
    candidates.push(raw.slice(root.length + 1));
  } else if (raw.includes('/')) {
    candidates.push(raw);
  } else {
    const fromName = /-(\d{4})(\d{2})(\d{2})-\d{6}-/.exec(raw);
    const fromDate = calldate ? /^(\d{4})-(\d{2})-(\d{2})/.exec(calldate) : null;
    for (const m of [fromDate, fromName]) {
      if (m) candidates.push(`${m[1]}/${m[2]}/${m[3]}/${raw}`);
    }
  }

  const valid: string[] = [];
  for (const c of candidates) {
    try {
      const norm = normalizeRecordingPath(c, 'file');
      if (!valid.includes(norm)) valid.push(norm);
    } catch {
      /* skip unsafe candidate */
    }
  }
  return valid;
}

/**
 * Whether the operator with this extension took part in the CDR row: placed it (src/cnum),
 * was dialed (dst) or owns one of its channels (SIP/101-…, PJSIP/101-…, Local/101@from-queue…).
 */
export function rowInvolvesExtension(row: CdrRecordingRow, extension: string): boolean {
  if (!/^\d{2,6}$/.test(extension)) return false;
  const channel = new RegExp(`^(?:SIP|PJSIP|IAX2|Local|Agent)/${extension}(?:[-@;/]|$)`);
  return (
    row.src === extension ||
    row.dst === extension ||
    row.cnum === extension ||
    channel.test(row.channel) ||
    channel.test(row.dstchannel)
  );
}
