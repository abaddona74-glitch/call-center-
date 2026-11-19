import type { SttStrategy } from '@cc/shared';
import { cleanText } from '../text/cleanup.js';
import { russianShare } from '../text/language.js';
import { type WavInfo, sliceWav } from '../wav.js';
import type { SpeakerOptions, SttClient } from './stt-client.js';
import { DEFAULT_TURN_OPTIONS, type Turn, type TurnOptions, buildTurns, maxTokensFor } from './turns.js';

/** One recognised piece of speech, before roles are known. */
export interface RawSegment {
  start: number;
  end: number;
  speaker: string | null;
  text: string;
  language: 'uz' | 'ru';
}

export interface SttRun {
  strategy: SttStrategy;
  segments: RawSegment[];
  model: string;
  /** Some turns (or the whole call) were re-transcribed in Russian. */
  rerun: boolean;
  requests: number;
}

export interface TranscribeOptions {
  strategy: SttStrategy;
  turnConcurrency: number;
  /** Re-run in Russian at this Russian share (see text/language.ts); ≥ 1 disables. */
  ruThreshold: number;
  speakers: SpeakerOptions;
  turnOptions?: TurnOptions;
}

/** Turn padding so word edges are not cut. */
const PAD_SEC = 0.2;
/** A turn is re-run alone in Russian only when it has enough marker words to judge. */
const MIN_WORDS_FOR_TURN_RERUN = 3;

const wordsOf = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);

/**
 * When both sides talk at once, the clip of one speaker's turn also carries the other voice, and the same words are
 * recognised twice. Of two time-overlapping turns of different speakers whose words are mostly the same (Jaccard ≥ 0.5,
 * ≥ 2 words each), the one that started later is dropped: the other speaker's turn began while the words were already
 * being said (the same start: the shorter one goes). Pilot 2026-11-19: ~1 % of turns.
 */
export function dropEchoedTurns<T extends { start: number; end: number; speaker: string | null; text: string }>(
  segments: readonly T[],
): T[] {
  const drop = new Set<number>();
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length && segments[j].start < segments[i].end; j++) {
      const a = segments[i];
      const b = segments[j];
      if (drop.has(i) || drop.has(j) || a.speaker === b.speaker) continue;
      const wa = wordsOf(a.text);
      const wb = wordsOf(b.text);
      if (wa.size < 2 || wb.size < 2) continue;
      const common = [...wa].filter((w) => wb.has(w)).length;
      if (common / (wa.size + wb.size - common) < 0.5) continue;
      // segments are in start order: b started at the same time or later
      drop.add(a.start === b.start && a.end - a.start < b.end - b.start ? i : j);
    }
  }
  return segments.filter((_, i) => !drop.has(i));
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

function modelName(dir: string | undefined): string {
  return dir ? (dir.split('/').filter(Boolean).at(-1) ?? 'whisper') : 'whisper';
}

/**
 * Strategy "chunks": one request with `diarize=true`. The server cuts the audio into ≤ 29.5 s chunks and gives each
 * chunk ONE speaker label, so a dialogue turns into mixed paragraphs. Cheap; kept for comparison and as the fallback
 * for recordings that cannot be sliced locally.
 */
async function runChunks(stt: SttClient, audio: Buffer, opts: TranscribeOptions): Promise<SttRun> {
  let language: 'uz' | 'ru' = 'uz';
  let res = await stt.transcribe(audio, { language, diarize: true, ...opts.speakers });
  let requests = 1;
  if (opts.ruThreshold < 1 && russianShare(res.text) >= opts.ruThreshold) {
    language = 'ru';
    res = await stt.transcribe(audio, { language, diarize: true, ...opts.speakers });
    requests++;
  }
  return {
    strategy: 'chunks',
    model: modelName(res.model_dir),
    rerun: language === 'ru',
    requests,
    segments: res.segments
      .map((s) => ({
        start: s.start_seconds,
        end: s.end_seconds,
        speaker: s.speaker ?? null,
        text: cleanText(s.text),
        language,
      }))
      .filter((s) => s.text),
  };
}

/**
 * Strategy "turns": diarize the whole call, merge each speaker's turns, cut them locally and transcribe each turn
 * on its own — real dialogue turns with the right speaker. Turns that read as Russian (or all of them, when the
 * call does) are transcribed again with language=ru.
 */
async function runTurns(stt: SttClient, audio: Buffer, wav: WavInfo, opts: TranscribeOptions): Promise<SttRun> {
  const diar = await stt.diarize(audio, opts.speakers);
  const turns = buildTurns(diar.segments, opts.turnOptions ?? DEFAULT_TURN_OPTIONS);
  let requests = 1;
  let model = 'whisper';

  const recognise = async (t: Turn, language: 'uz' | 'ru') => {
    const clip = sliceWav(audio, wav, t.start - PAD_SEC, t.end + PAD_SEC);
    const res = await stt.transcribe(clip, { language, maxNewTokens: maxTokensFor(t.end - t.start) });
    requests++;
    model = modelName(res.model_dir);
    return cleanText(res.text);
  };

  const texts = await mapLimit(turns, opts.turnConcurrency, (t) => recognise(t, 'uz'));
  const languages: Array<'uz' | 'ru'> = turns.map(() => 'uz');

  const callIsRussian = opts.ruThreshold < 1 && russianShare(texts.join(' ')) >= opts.ruThreshold;
  const rerun = turns
    .map((_, i) => i)
    .filter((i) => {
      if (!texts[i]) return callIsRussian;
      if (callIsRussian) return true;
      return texts[i].split(/\s+/).length >= MIN_WORDS_FOR_TURN_RERUN && russianShare(texts[i]) >= 0.5;
    });
  if (opts.ruThreshold < 1 && rerun.length) {
    const ruTexts = await mapLimit(rerun, opts.turnConcurrency, (i) => recognise(turns[i], 'ru'));
    rerun.forEach((i, k) => {
      if (ruTexts[k]) {
        texts[i] = ruTexts[k];
        languages[i] = 'ru';
      }
    });
  }

  return {
    strategy: 'turns',
    model,
    rerun: languages.includes('ru'),
    requests,
    segments: turns
      .map((t, i) => ({ start: t.start, end: t.end, speaker: t.speaker, text: texts[i], language: languages[i] }))
      .filter((s) => s.text),
  };
}

export async function transcribeCall(
  stt: SttClient,
  audio: Buffer,
  wav: WavInfo,
  opts: TranscribeOptions,
): Promise<SttRun> {
  if (opts.strategy === 'turns' && wav.sliceable) return runTurns(stt, audio, wav, opts);
  return runChunks(stt, audio, opts);
}
