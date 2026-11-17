/**
 * Linking a call's recording to a ticket (pure scheduling rules). The recording appears in the CDR only
 * after the call ends, so the linker retries: every RETRY_MS until a deadline, then gives up ("none").
 */

/** Check again this long after a miss. */
export const RECORDING_RETRY_MS = 30_000;
/** A call that is still running may last; until its end is known we keep the row alive this long. */
export const RECORDING_OPEN_CALL_MS = 4 * 3_600_000;
/** After the call ended (or for a past call) keep looking this long. */
export const RECORDING_LOOKUP_MS = 10 * 60_000;

export interface RecordingSchedule {
  nextAt: Date;
  deadline: Date;
}

/** A call that is still going on (ticket opened during the call, or a callback just placed). */
export function scheduleForRunningCall(now: Date): RecordingSchedule {
  return { nextAt: new Date(now.getTime() + RECORDING_RETRY_MS), deadline: new Date(now.getTime() + RECORDING_OPEN_CALL_MS) };
}

/** The call has ended (AMI) or is a past call from the history: look now, keep trying for a while. */
export function scheduleForEndedCall(now: Date, lookupMs = RECORDING_LOOKUP_MS): RecordingSchedule {
  return { nextAt: new Date(now.getTime() + 5_000), deadline: new Date(now.getTime() + lookupMs) };
}

export type RecordingCheckResult = { kind: 'found'; path: string } | { kind: 'missing' } | { kind: 'unavailable' };

/** After one lookup: final state, or when to look again. */
export function afterCheck(
  result: RecordingCheckResult,
  deadline: Date,
  now: Date,
): { status: 'found' | 'none' | 'unavailable' | 'pending'; nextAt: Date | null; path: string | null } {
  if (result.kind === 'found') return { status: 'found', nextAt: null, path: result.path };
  if (now.getTime() >= deadline.getTime()) {
    return { status: result.kind === 'unavailable' ? 'unavailable' : 'none', nextAt: null, path: null };
  }
  return { status: 'pending', nextAt: new Date(now.getTime() + RECORDING_RETRY_MS), path: null };
}
