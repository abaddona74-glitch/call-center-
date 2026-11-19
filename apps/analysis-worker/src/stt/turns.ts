/** Speaker turns from pyannote diarization, prepared for per-turn transcription (strategy "turns"). */
export interface Turn {
  speaker: string;
  start: number;
  end: number;
}

export interface TurnOptions {
  /** Same-speaker turns closer than this are one turn. */
  mergeGapSec: number;
  /** Shorter turns are dropped (breaths, clicks). */
  minTurnSec: number;
  /** A turn this short that lies inside another speaker's turn is a backchannel ("ha", "aha"): dropped. */
  backchannelSec: number;
}

export const DEFAULT_TURN_OPTIONS: TurnOptions = { mergeGapSec: 0.8, minTurnSec: 0.4, backchannelSec: 1.5 };

export function buildTurns(
  segments: readonly { speaker: string; start_seconds: number; end_seconds: number }[],
  opts: TurnOptions = DEFAULT_TURN_OPTIONS,
): Turn[] {
  const sorted = segments
    .map((s) => ({ speaker: s.speaker, start: s.start_seconds, end: s.end_seconds }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  // merge each speaker's close turns (other speakers' overlapping turns do not break the run)
  const merged: Turn[] = [];
  const lastOf = new Map<string, Turn>();
  for (const s of sorted) {
    const last = lastOf.get(s.speaker);
    const interrupted = last ? merged.some((m) => m !== last && m.start > last.end && m.start < s.start) : false;
    if (last && !interrupted && s.start - last.end <= opts.mergeGapSec) {
      last.end = Math.max(last.end, s.end);
      continue;
    }
    const turn = { ...s };
    merged.push(turn);
    lastOf.set(s.speaker, turn);
  }

  return merged
    .filter((t) => t.end - t.start >= opts.minTurnSec)
    .filter(
      (t, _, all) =>
        t.end - t.start >= opts.backchannelSec ||
        !all.some((o) => o !== t && o.speaker !== t.speaker && o.start <= t.start && o.end >= t.end),
    )
    .sort((a, b) => a.start - b.start);
}

/** Whisper's token limit for a turn: roughly 9 tokens per second of speech, per ≤ 29.5 s server chunk. */
export function maxTokensFor(durationSec: number): number {
  return Math.min(256, Math.max(32, Math.ceil(Math.min(durationSec, 29.5) * 9) + 16));
}
