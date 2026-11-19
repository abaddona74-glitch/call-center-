import {
  CALL_OUTCOMES,
  type CallDirection,
  KPI_CRITERIA,
  RED_FLAGS,
  SENTIMENTS,
  TRANSCRIPT_ROLES,
  type WorkerLeaseResponse,
} from '@cc/shared';
import type { RawSegment } from '../stt/transcribe.js';

/**
 * The prompt and the rubric. Any change here that can change results → bump CALL_ANALYSIS_PROMPT_VERSION in
 * @cc/shared (stored with every result) and update docs/rewrite/CALL-ANALYSIS.md.
 */
export type Topic = WorkerLeaseResponse['topics'][number];

export const SYSTEM_PROMPT = `You are a quality analyst of the Uniconsoft call center in Uzbekistan. The call center supports
government organisations that use the company's systems: EDO / ijro.uz (electronic document flow), Ijro intizomi
(execution discipline, reports and deadlines), E-Huquqshunos (legal services), ERI / E-imzo signature keys and Uzcrypto,
and the computers and browsers they run on. Operators answer with the call-center introduction
(e.g. "Assalomu alaykum, Unicon call-markaz…"), ask how they can help, explain, connect remotely, open requests.

You get an automatic transcript of ONE phone call. Speech recognition makes many mistakes (mostly Uzbek in Latin
script, some Russian). Each line is "[<speaker letter> mm:ss] text". Speaker letters come from automatic diarization
and can be imperfect.

Return ONE JSON object with exactly these fields:
- speaker_roles: object mapping EVERY speaker letter of the transcript to "operator", "client" or "unknown"
  (music, IVR, a third voice you cannot tell). The operator is the call-center employee: greets with the call-center
  name, asks how to help, gives instructions, says they will open a request or connect remotely. In an inbound call the
  client called the call center; in an outbound call the operator called the client. Normally exactly one speaker is
  the operator; a transferred call can have two.
- language: "uz", "ru" or "mixed" — the language mostly spoken.
- topic: one code from the topic list below; "other" only when nothing fits.
- subtopic_uz, subtopic_ru: a few words naming the specific issue.
- problem_uz, problem_ru: the client's problem or request in one short sentence.
- summary_uz, summary_ru: 2–4 sentences: what the client wanted, what the operator did, how the call ended.
- outcome: one of
    resolved — the operator solved the problem during the call;
    ticket_opened — a request/ticket (ariza, zayavka) was registered for another team;
    callback_promised — the operator promised that someone will call back or contact the client;
    transferred — the call was transferred to another extension or department;
    unresolved — the problem stayed unsolved and nothing was promised;
    info_only — the client only needed information or advice.
- scores: integers 1–5 for the OPERATOR:
    greeting — 5: greeted, named the call center, offered help; 3: partial; 1: none.
    politeness — 5: polite, patient, respectful throughout; 3: dry or somewhat impatient; 1: rude.
    understanding — 5: asked the right questions and understood the problem correctly; 1: misunderstood or ignored it.
    solution — 5: solved it or gave a correct, complete next step (a correct request/transfer counts when another team
      must act); 3: partial; 1: no help or wrong help.
    closing — 5: confirmed the result, asked if anything else is needed, said goodbye politely; 1: abrupt end.
- overall: integer 1–10, the operator's overall quality in this call.
- red_flags: list (usually empty) of { code, note_ru, at_sec } with code one of
    rudeness, wrong_information, interrupting, no_greeting, long_hold, refused_help, unprofessional.
  Only flags clearly supported by the transcript; note_ru is a short Russian description; at_sec is the second when it
  happens (from the line's mm:ss) or null.
- sentiment_start, sentiment_end: the client's mood at the beginning and at the end: positive, neutral or negative.
- recommendation_uz, recommendation_ru: one concrete tip for the operator (or what they did well).

Rules:
- Scores and flags judge the operator's behaviour only, never the client's.
- Recognition errors are not the operator's fault: do not flag wording that is probably a transcription error.
- NEVER write card numbers, passport numbers, PINFL/STIR, phone numbers, passwords, key or remote-access codes, addresses
  or people's full names into any text field. Describe instead ("the client dictated the remote-access ID").
- Uzbek texts in Latin script; Russian texts in Russian.
- If the call is too short or unintelligible to judge, still return the object: topic "wrong_call" or "other",
  scores 3, overall 5, and say so in the summary.`;

/** Speaker labels → short letters in order of first appearance (SPEAKER_01 → A …). */
export function speakerLetters(segments: readonly RawSegment[]): Map<string, string> {
  const letters = new Map<string, string>();
  for (const s of segments) {
    if (s.speaker && !letters.has(s.speaker)) letters.set(s.speaker, String.fromCharCode(65 + letters.size));
  }
  return letters;
}

export function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function transcriptForPrompt(segments: readonly RawSegment[], letters: ReadonlyMap<string, string>): string {
  return segments.map((s) => `[${(s.speaker && letters.get(s.speaker)) || '?'} ${mmss(s.start)}] ${s.text}`).join('\n');
}

export function buildMessages(input: {
  segments: readonly RawSegment[];
  letters: ReadonlyMap<string, string>;
  topics: readonly Topic[];
  direction: CallDirection;
  audioSec: number;
}): Array<{ role: 'system' | 'user'; content: string }> {
  const topics = input.topics.map((t) => `${t.code} — ${t.nameRu} / ${t.nameUz}`).join('\n');
  const letters = [...input.letters.values()];
  const user = [
    `Topic list (code — ru / uz):\n${topics}`,
    `Call: ${input.direction === 'outbound' ? 'outbound (the operator called the client)' : 'inbound (the client called the call center)'}, ` +
      `recording ${Math.round(input.audioSec)} s, speakers: ${letters.length ? letters.join(', ') : 'unknown'}.`,
    `Transcript:\n${transcriptForPrompt(input.segments, input.letters)}`,
  ].join('\n\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

/** JSON schema for `response_format` (constrained decoding on the server); zod re-validates the answer. */
export function responseJsonSchema(letters: readonly string[], topicCodes: readonly string[]): Record<string, unknown> {
  const str = { type: 'string' };
  const enumOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
  const int = (min: number, max: number) => ({ type: 'integer', minimum: min, maximum: max });
  const roleKeys = letters.length ? letters : ['A'];
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'speaker_roles',
      'language',
      'topic',
      'subtopic_uz',
      'subtopic_ru',
      'problem_uz',
      'problem_ru',
      'summary_uz',
      'summary_ru',
      'outcome',
      'scores',
      'overall',
      'red_flags',
      'sentiment_start',
      'sentiment_end',
      'recommendation_uz',
      'recommendation_ru',
    ],
    properties: {
      speaker_roles: {
        type: 'object',
        additionalProperties: false,
        required: roleKeys,
        properties: Object.fromEntries(roleKeys.map((l) => [l, enumOf(TRANSCRIPT_ROLES)])),
      },
      language: enumOf(['uz', 'ru', 'mixed']),
      topic: enumOf(topicCodes),
      subtopic_uz: str,
      subtopic_ru: str,
      problem_uz: str,
      problem_ru: str,
      summary_uz: str,
      summary_ru: str,
      outcome: enumOf(CALL_OUTCOMES),
      scores: {
        type: 'object',
        additionalProperties: false,
        required: [...KPI_CRITERIA],
        properties: Object.fromEntries(KPI_CRITERIA.map((k) => [k, int(1, 5)])),
      },
      overall: int(1, 10),
      red_flags: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'note_ru', 'at_sec'],
          properties: { code: enumOf(RED_FLAGS), note_ru: str, at_sec: { type: ['number', 'null'] } },
        },
      },
      sentiment_start: enumOf(SENTIMENTS),
      sentiment_end: enumOf(SENTIMENTS),
      recommendation_uz: str,
      recommendation_ru: str,
    },
  };
}
