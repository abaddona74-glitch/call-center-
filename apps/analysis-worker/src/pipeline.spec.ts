import { CALL_ANALYSIS_PROMPT_VERSION, type SkipReason, type WorkerJob, type WorkerResult, WorkerResultSchema } from '@cc/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './api-client.js';
import type { ChatRequest, LlmClient } from './llm/llm-client.js';
import { maskPersonalData } from './llm/output.js';
import { processJob } from './pipeline.js';
import { ServiceError, type SttClient } from './stt/stt-client.js';
import { pcmWav } from './wav.fixture.js';

const job: WorkerJob = {
  callId: '1794544201.2101100',
  mode: 'full',
  startedAt: '2026-11-13T09:30:09+05:00',
  direction: 'inbound',
  operatorExt: '114',
  talkSec: 30,
  attempts: 1,
  leaseUntil: '2026-11-13T10:00:00Z',
};
const topics = [
  { code: 'eri_key', nameUz: 'ERI', nameRu: 'ЭЦП' },
  { code: 'other', nameUz: 'Boshqa', nameRu: 'Другое' },
];

const llmAnswer = {
  speaker_roles: { A: 'operator', B: 'client' },
  language: 'uz',
  topic: 'eri_key',
  subtopic_uz: 'Kalit',
  subtopic_ru: 'Ключ',
  problem_uz: 'Kalit ishlamaydi',
  problem_ru: 'Клиент продиктовал номер карты 8600 1234 5678 9012, ключ не работает',
  summary_uz: 'Operator yordam berdi',
  summary_ru: 'Оператор помог, паспорт AA 1234567, телефон +998 90 123 45 67',
  outcome: 'resolved',
  scores: { greeting: 5, politeness: 5, understanding: 4, solution: 4, closing: 3 },
  overall: 8,
  red_flags: [{ code: 'interrupting', note_ru: 'Перебил', at_sec: 12 }],
  sentiment_start: 'neutral',
  sentiment_end: 'positive',
  recommendation_uz: 'Yaxshi',
  recommendation_ru: 'Хорошо',
};

function fakeApi(audio: Buffer | Error = pcmWav(30)) {
  return {
    lease: vi.fn(),
    recording: vi.fn(async () => {
      if (audio instanceof Error) throw audio;
      return audio;
    }),
    transcript: vi.fn(async () => ({
      language: 'uz' as const,
      audioSec: 30,
      sttStrategy: 'turns' as const,
      sttModel: 'whisper-uz',
      sttMs: 12_345,
      sttRerun: false,
      segments: [
        { start: 0.5, end: 4, role: 'unknown' as const, speaker: 'SPEAKER_01', text: 'Assalomu alaykum, Call Center xizmati' },
        { start: 4.5, end: 9, role: 'unknown' as const, speaker: 'SPEAKER_00', text: 'Kalitim ishlamayapti' },
      ],
    })),
    submit: vi.fn(async (_callId: string, _result: WorkerResult) => ({ ok: true as const, status: 'done' as const })),
    fail: vi.fn(async (_callId: string, _error: string, _retryable: boolean) => ({ ok: true as const, status: 'queued' as const })),
    skip: vi.fn(async (_callId: string, _reason: SkipReason) => ({ ok: true as const, status: 'skipped' as const })),
  } satisfies ApiClient;
}

function fakeStt(): SttClient & { transcribe: ReturnType<typeof vi.fn>; diarize: ReturnType<typeof vi.fn> } {
  const texts = ['Assalomu alaykum, Unicon call-markaz, eshitaman', 'Kalitim ishlamayapti', 'Hozir tekshiramiz'];
  let i = 0;
  return {
    diarize: vi.fn(async () => ({
      segments: [
        { speaker: 'SPEAKER_01', start_seconds: 0.5, end_seconds: 4 },
        { speaker: 'SPEAKER_00', start_seconds: 4.5, end_seconds: 9 },
        { speaker: 'SPEAKER_01', start_seconds: 10, end_seconds: 14 },
      ],
    })),
    transcribe: vi.fn(async () => ({ text: texts[i++ % 3], segments: [], model_dir: '/models/whisper-uz' })),
  };
}

function fakeLlm(answers: string[]): LlmClient & { chat: ReturnType<typeof vi.fn> } {
  let i = 0;
  return {
    model: '/mnt/models/DeepSeek-V4-Flash',
    chat: vi.fn(async (_req: ChatRequest) => ({ content: answers[Math.min(i++, answers.length - 1)], finishReason: 'stop', promptTokens: 100, completionTokens: 50 })),
  };
}

const opts = { workerId: 'mac-1', strategy: 'turns' as const, turnConcurrency: 2, ruThreshold: 0.35, thinking: false, maxAudioSec: 1800 };

describe('processJob', () => {
  it('maps STT turns and the LLM answer to a valid result: roles by speaker, masked texts, versions', async () => {
    const api = fakeApi();
    const stt = fakeStt();
    const llm = fakeLlm([JSON.stringify(llmAnswer)]);
    const out = await processJob(job, topics, { api, stt, llm }, opts);
    expect(out.kind).toBe('done');
    expect(stt.diarize).toHaveBeenCalledOnce();
    expect(stt.transcribe).toHaveBeenCalledTimes(3);
    // the turn clips are cut locally and named neutrally (no caller number in the upload)
    const firstClip = stt.transcribe.mock.calls[0][0] as Buffer;
    expect(firstClip.length).toBeLessThan(pcmWav(30).length);

    const [callId, result] = api.submit.mock.calls[0];
    expect(callId).toBe(job.callId);
    const r = WorkerResultSchema.parse(result);
    expect(r.transcript.segments.map((s) => [s.role, s.speaker, s.start])).toEqual([
      ['operator', 'SPEAKER_01', 0.5],
      ['client', 'SPEAKER_00', 4.5],
      ['operator', 'SPEAKER_01', 10],
    ]);
    expect(r.analysis.topicCode).toBe('eri_key');
    expect(r.analysis.problem.ru).not.toMatch(/8600|1234 5678/);
    expect(r.analysis.summary.ru).not.toMatch(/1234567|90 123/);
    expect(r.analysis.redFlags).toEqual([{ code: 'interrupting', note: 'Перебил', at: 12 }]);
    expect(r.meta).toMatchObject({
      promptVersion: CALL_ANALYSIS_PROMPT_VERSION,
      sttStrategy: 'turns',
      sttModel: 'whisper-uz',
      llmModel: 'DeepSeek-V4-Flash',
      llmAttempts: 1,
      thinking: false,
      sttRerun: false,
    });
    // the prompt carries speaker letters and times, and the JSON schema lists them
    const req = llm.chat.mock.calls[0][0] as ChatRequest;
    expect(req.messages[1].content).toContain('[1 A 00:00] Assalomu alaykum');
    expect(req.messages[1].content).toContain('[2 B 00:04] Kalitim ishlamayapti');
    expect(JSON.stringify(req.jsonSchema)).toContain('"required":["A","B"]');
    expect(api.fail).not.toHaveBeenCalled();
  });

  it('applies the model’s per-line role fixes (diarization gave a line to the wrong side)', async () => {
    const api = fakeApi();
    const llm = fakeLlm([JSON.stringify({ ...llmAnswer, role_fixes: [{ line: 3, role: 'client' }, { line: 99, role: 'client' }] })]);
    await processJob(job, topics, { api, stt: fakeStt(), llm }, opts);
    const r = WorkerResultSchema.parse(api.submit.mock.calls[0][1]);
    expect(r.transcript.segments.map((x) => x.role)).toEqual(['operator', 'client', 'client']);
  });

  it('retries the LLM once with the validation errors, then succeeds; unknown topic → other', async () => {
    const api = fakeApi();
    const llm = fakeLlm([
      JSON.stringify({ ...llmAnswer, overall: 15 }),
      '```json\n' + JSON.stringify({ ...llmAnswer, topic: 'made_up' }) + '\n```',
    ]);
    const out = await processJob(job, topics, { api, stt: fakeStt(), llm }, opts);
    expect(out.kind).toBe('done');
    expect(llm.chat).toHaveBeenCalledTimes(2);
    const retry = (llm.chat.mock.calls[1][0] as ChatRequest).messages.at(-1)!.content;
    expect(retry).toContain('overall');
    const r = WorkerResultSchema.parse(api.submit.mock.calls[0][1]);
    expect(r.meta.llmAttempts).toBe(2);
    expect(r.analysis.topicCode).toBe('other');
  });

  it('a second invalid answer is a retryable failure (no values in the error)', async () => {
    const api = fakeApi();
    const out = await processJob(job, topics, { api, stt: fakeStt(), llm: fakeLlm(['not json', '{"overall": 99}']) }, opts);
    expect(out).toMatchObject({ kind: 'failed', retryable: true });
    expect(api.fail).toHaveBeenCalledWith(job.callId, expect.stringContaining('LLM output invalid'), true);
    expect(api.fail.mock.calls[0][1]).not.toContain('99');
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('STT busy → retryable failure; STT rejects the audio → final failure', async () => {
    const busy = fakeStt();
    busy.diarize.mockRejectedValueOnce(new ServiceError('stt', '/v1/diarizations HTTP 503', true, 503));
    const api = fakeApi();
    expect(await processJob(job, topics, { api, stt: busy, llm: fakeLlm(['{}']) }, opts)).toMatchObject({ kind: 'failed', retryable: true });
    const bad = fakeStt();
    bad.diarize.mockRejectedValueOnce(new ServiceError('stt', '/v1/diarizations HTTP 400', false, 400));
    expect(await processJob(job, topics, { api, stt: bad, llm: fakeLlm(['{}']) }, opts)).toMatchObject({ kind: 'failed', retryable: false });
    expect(api.fail).toHaveBeenLastCalledWith(job.callId, 'stt: /v1/diarizations HTTP 400', false);
  });

  it('skips empty, too long, non-WAV, missing recordings and calls without speech', async () => {
    const cases: Array<[ApiClient, string]> = [
      [fakeApi(pcmWav(0.5)), 'empty_recording'],
      [fakeApi(pcmWav(70)), 'too_long'],
      [fakeApi(Buffer.from('garbage-garbage-garbage')), 'unsupported_audio'],
      [fakeApi(new ServiceError('api', 'recording HTTP 404', false, 404)), 'no_recording'],
    ];
    for (const [api, reason] of cases) {
      const out = await processJob(job, topics, { api, stt: fakeStt(), llm: fakeLlm(['{}']) }, { ...opts, maxAudioSec: 60 });
      expect(out).toEqual({ kind: 'skipped', reason });
      expect(api.skip).toHaveBeenCalledWith(job.callId, reason);
    }
    const silent = fakeStt();
    silent.transcribe.mockResolvedValue({ text: 'musiqa', segments: [] });
    const api = fakeApi();
    expect(await processJob(job, topics, { api, stt: silent, llm: fakeLlm(['{}']) }, opts)).toEqual({ kind: 'skipped', reason: 'no_speech' });
  });

  it('Russian turns are transcribed again in Russian', async () => {
    const stt = fakeStt();
    stt.transcribe.mockImplementation(async (_audio: Buffer, o: { language: string }) =>
      o.language === 'ru'
        ? { text: 'Хорошо, сейчас посмотрю, подождите', segments: [] }
        : { text: 'xorosho seychas posmotryu podojdite', segments: [] },
    );
    const api = fakeApi();
    await processJob(job, topics, { api, stt, llm: fakeLlm([JSON.stringify({ ...llmAnswer, language: 'ru' })]) }, opts);
    const r = WorkerResultSchema.parse(api.submit.mock.calls[0][1]);
    expect(r.meta.sttRerun).toBe(true);
    expect(r.transcript.segments[0].text).toBe('Хорошо, сейчас посмотрю, подождите');
    expect(stt.transcribe).toHaveBeenCalledTimes(6);
  });
});

describe('processJob llm_only', () => {
  it('re-runs only the LLM on the stored transcript: no recording, no STT, the stored STT facts are kept', async () => {
    const api = fakeApi();
    const stt = fakeStt();
    const llm = fakeLlm([JSON.stringify(llmAnswer)]);
    const out = await processJob({ ...job, mode: 'llm_only' }, topics, { api, stt, llm }, opts);
    expect(out.kind).toBe('done');
    expect(api.recording).not.toHaveBeenCalled();
    expect(stt.diarize).not.toHaveBeenCalled();
    expect(stt.transcribe).not.toHaveBeenCalled();
    const r = WorkerResultSchema.parse(api.submit.mock.calls[0][1]);
    expect(r.transcript.segments.map((x) => x.role)).toEqual(['operator', 'client']);
    expect(r.meta).toMatchObject({ sttMs: 12_345, sttModel: 'whisper-uz', sttStrategy: 'turns', promptVersion: CALL_ANALYSIS_PROMPT_VERSION });
    expect(r.transcript.audioSec).toBe(30);
  });
});

describe('maskPersonalData', () => {
  it('masks cards, phones, passports and e-mails, keeps short numbers', () => {
    expect(maskPersonalData('karta 8600123456789012')).toBe('karta ***');
    expect(maskPersonalData('tel 90-123-45-67')).toBe('tel ***');
    expect(maskPersonalData('AB1234567 pasport')).toBe('*** pasport');
    expect(maskPersonalData('a.b@mail.uz')).toBe('***');
    expect(maskPersonalData('464-bog‘cha, 2 ta kalit, 2026 yil')).toBe('464-bog‘cha, 2 ta kalit, 2026 yil');
  });
});
