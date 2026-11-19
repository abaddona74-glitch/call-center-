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
script, some Russian). Each line is "[<line number> <speaker letter> mm:ss] text". Speaker letters come from
automatic diarization and can be wrong for single lines (most often the operator's first greeting gets the client's
letter, or a line of one side gets the other side's letter while both speak at once).

Return ONE JSON object with exactly these fields:
- speaker_roles: object mapping EVERY speaker letter of the transcript to "operator", "client" or "unknown"
  (music, IVR, a third voice you cannot tell). The operator is the call-center employee: greets with the call-center
  name, asks how to help, gives instructions, says they will open a request or connect remotely. In an inbound call the
  client called the call center; in an outbound call the operator called the client. Normally exactly one speaker is
  the operator; a transferred call can have two.
- role_fixes: list (usually empty) of { line, role } for single lines whose real speaker contradicts the role of their
  letter — only when the content makes it clear (e.g. "… operator, eshitaman" under the client's letter).
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
- scores: integers 1–5 for the OPERATOR, measured against the call-center standard below:
    greeting — 5: the full standard greeting (greeting + service name + own name or number + offer of help);
      4: one element missing; 3: only "assalomu alaykum" and a name or "eshitaman"; 2: barely a greeting; 1: none.
      Outbound call: greets, says who is calling from where and why.
      No penalty when the opening is not in the recording: the recording starts in the middle of the conversation
      (the first lines continue a topic, nobody opens the call) or the call came to this operator by transfer —
      then greeting is 5 and the greeting part of the standard does not count against overall.
    politeness — 5: polite words ("iltimos", "rahmat", "marhamat", "hurmatli mijoz"), patient, calm throughout;
      3: dry, hurried or somewhat impatient; 1: rude or dismissive.
    understanding — 5: let the client finish, asked clarifying questions, confirmed the problem back;
      3: understood only after confusion or did not clarify; 1: misunderstood or ignored the problem.
    solution — 5: solved it, or gave a correct complete next step (a correct request/transfer when another team must
      act, with what happens next); 3: partial or vague next step; 1: no help, wrong help or "bilmayman".
    closing — 5: confirmed the result, asked whether anything else is needed, thanked and said goodbye;
      3: only a short goodbye; 1: abrupt end or hung up on the client.
- overall: integer 1–10, the operator's overall quality in this call. Calibrate: 10 — the standard is followed
  completely and the problem is solved, rare; 8 — good call with small gaps; 6 — noticeable gaps (no proper greeting
  or closing, weak clarification); 4 — the client was not helped or was treated badly; 1–2 — unacceptable.
  Do not give 9–10 when any part of the standard is missing.
- red_flags: list (empty when nothing happened) of { code, note_ru, at_sec } with code one of
    rudeness — rude, irritated, raised voice, dismissive;
    wrong_information — told the client something clearly wrong;
    interrupting — repeatedly cut the client off;
    no_greeting — the call opens in the recording and the operator does not greet at all (never for a recording that
      starts mid-conversation or a transferred call);
    long_hold — left the client waiting in silence (a gap over ~30 s between lines) without asking to wait. Not a
      hold: silence after the operator said they are working on the client's computer remotely (AnyDesk, RustDesk,
      "ulanaman", "kompyuteringizga kiryapman") or checking something they announced — that is announced work;
    refused_help — "bu bizning ishimiz emas", "bilmayman" or similar without redirecting the client;
    unprofessional — slang, swearing, personal talk with colleagues during the call, hanging up on the client.
  Only flags supported by the transcript; note_ru is a short Russian description; at_sec is the second when it
  happens (from the line's mm:ss) or null.
- sentiment_start, sentiment_end: the client's mood at the beginning and at the end: positive, neutral or negative.
- recommendation_uz, recommendation_ru: one concrete tip for the operator (or what they did well).

The call-center standard (operator manual):
- Greeting within the first seconds: "Assalomu alaykum! Call Center xizmati, operator [ism] sizni eshitmoqda. Qanday
  yordam bera olaman?" (the company is Uniconsoft / "Unicon"; recognition often garbles it: "yunukon", "konsult").
- Do not interrupt; clarify the problem ("Tushunarli, demak sizda … qiyinchilik tug'ildi, to'g'rimi?"); use polite words.
- Before a hold: "Iltimos, 1 daqiqa liniyada kuting, ma'lumotingizni tekshirib beraman." — never leave the client in
  silence.
- Forbidden: "Bu bizning ishimiz emas" (say which department will help and connect), "Bilmayman" (say you will find
  out), hanging up while the client speaks.
- Closing: "Yana biror savolingiz yoki yordamim kerak bo'lgan masala bormi? … Murojaatingiz uchun tashakkur, kuningiz
  xayrli o'tsin!"

Rules:
- Scores and flags judge the operator's behaviour only, never the client's.
- Recognition errors are not the operator's fault: do not flag wording that is probably a transcription error.
- NEVER write card numbers, passport numbers, PINFL/STIR, phone numbers, passwords, key or remote-access codes, addresses
  or people's full names into any text field. Describe instead ("the client dictated the remote-access ID").
- Uzbek texts in Latin script; Russian texts in Russian.
- Speaker letters and line numbers exist only for this transcript: NEVER write them into any text field ("оператор B",
  "speaker A", "mijoz A", "line 12"). Write "оператор", "клиент", "второй оператор" / "operator", "mijoz",
  "ikkinchi operator".
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
  return segments
    .map((s, i) => `[${i + 1} ${(s.speaker && letters.get(s.speaker)) || '?'} ${mmss(s.start)}] ${s.text}`)
    .join('\n');
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
export function responseJsonSchema(
  letters: readonly string[],
  topicCodes: readonly string[],
  lineCount = 5000,
): Record<string, unknown> {
  // limits = the contract limits (CallAnalysisSchema): the server's constrained decoding enforces them, so a looping
  // generation ends instead of running into max_tokens
  const str = (maxLength: number) => ({ type: 'string', maxLength });
  const enumOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
  const int = (min: number, max: number) => ({ type: 'integer', minimum: min, maximum: max });
  const roleKeys = letters.length ? letters : ['A'];
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'speaker_roles',
      'role_fixes',
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
      role_fixes: {
        type: 'array',
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['line', 'role'],
          properties: { line: int(1, Math.max(1, lineCount)), role: enumOf(TRANSCRIPT_ROLES) },
        },
      },
      language: enumOf(['uz', 'ru', 'mixed']),
      topic: enumOf(topicCodes),
      subtopic_uz: str(160),
      subtopic_ru: str(160),
      problem_uz: str(400),
      problem_ru: str(400),
      summary_uz: str(1200),
      summary_ru: str(1200),
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
        maxItems: 10,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'note_ru', 'at_sec'],
          properties: { code: enumOf(RED_FLAGS), note_ru: str(300), at_sec: { type: ['number', 'null'] } },
        },
      },
      sentiment_start: enumOf(SENTIMENTS),
      sentiment_end: enumOf(SENTIMENTS),
      recommendation_uz: str(400),
      recommendation_ru: str(400),
    },
  };
}
