import { z } from 'zod';

/** HTTP error of an AI service; `retryable` = worth another attempt later (busy, timeout, 5xx, network). */
export class ServiceError extends Error {
  constructor(
    readonly service: 'stt' | 'llm' | 'api',
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(`${service}: ${message}`);
    this.name = 'ServiceError';
  }
}

const SttSegmentSchema = z.object({
  start_seconds: z.number(),
  end_seconds: z.number(),
  text: z.string(),
  speaker: z.string().nullish(),
});
const DiarSegmentSchema = z.object({ speaker: z.string(), start_seconds: z.number(), end_seconds: z.number() });

export const TranscriptionSchema = z.object({
  text: z.string(),
  segments: z.array(SttSegmentSchema),
  language: z.string().optional(),
  duration_seconds: z.number().optional(),
  processing_seconds: z.number().optional(),
  model_dir: z.string().optional(),
  diarization: z.object({ segments: z.array(DiarSegmentSchema) }).nullish(),
});
export type Transcription = z.infer<typeof TranscriptionSchema>;

export const DiarizationSchema = z.object({
  segments: z.array(DiarSegmentSchema),
  speakers: z.array(z.string()).optional(),
  duration_seconds: z.number().optional(),
  model_id: z.string().optional(),
});
export type Diarization = z.infer<typeof DiarizationSchema>;

export interface SpeakerOptions {
  numSpeakers?: number;
  minSpeakers?: number;
  maxSpeakers?: number;
}

export interface SttClient {
  transcribe(
    audio: Buffer,
    opts: { language: 'uz' | 'ru'; maxNewTokens?: number; diarize?: boolean } & SpeakerOptions,
  ): Promise<Transcription>;
  diarize(audio: Buffer, opts: SpeakerOptions): Promise<Diarization>;
}

/**
 * The Uzbek Whisper + pyannote service (POST multipart). The upload is always named `call.wav`: the real file name
 * carries the caller's number.
 */
export class HttpSttClient implements SttClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async transcribe(
    audio: Buffer,
    opts: { language: 'uz' | 'ru'; maxNewTokens?: number; diarize?: boolean } & SpeakerOptions,
  ): Promise<Transcription> {
    const form = this.form(audio, opts);
    form.set('language', opts.language);
    form.set('task', 'transcribe');
    if (opts.maxNewTokens) form.set('max_new_tokens', String(opts.maxNewTokens));
    if (opts.diarize) form.set('diarize', 'true');
    return TranscriptionSchema.parse(await this.post('/v1/transcriptions', form));
  }

  async diarize(audio: Buffer, opts: SpeakerOptions): Promise<Diarization> {
    return DiarizationSchema.parse(await this.post('/v1/diarizations', this.form(audio, opts)));
  }

  private form(audio: Buffer, opts: SpeakerOptions): FormData {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'call.wav');
    if (opts.numSpeakers) form.set('num_speakers', String(opts.numSpeakers));
    if (opts.minSpeakers) form.set('min_speakers', String(opts.minSpeakers));
    if (opts.maxSpeakers) form.set('max_speakers', String(opts.maxSpeakers));
    return form;
  }

  private async post(path: string, form: FormData): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { method: 'POST', body: form, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw new ServiceError('stt', `${path} request failed (${(err as Error).name})`, true);
    }
    if (!res.ok) {
      // 503 busy, 504 timeout, 5xx: try later; 4xx: this audio is rejected
      throw new ServiceError('stt', `${path} HTTP ${res.status}`, res.status >= 500 || res.status === 429, res.status);
    }
    return res.json();
  }
}
