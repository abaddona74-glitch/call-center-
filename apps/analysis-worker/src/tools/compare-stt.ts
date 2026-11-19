/**
 * Pilot tool: compares the STT strategies ("chunks" = transcriptions?diarize=true, "turns" = diarize then transcribe
 * each turn) and LLM thinking on/off on local WAV files, without the API. Writes one JSON per call plus summary.json
 * into an output folder OUTSIDE the repository (recordings and transcripts are personal data).
 *
 *   node --env-file=~/.config/cc-analysis/worker.env dist/tools/compare-stt.js \
 *     --calls ~/Documents/call-center-pilot/calls.json --monitor <monitor dir> --out ~/Documents/call-center-pilot/compare --n 10
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { LlmOutputError, analyzeTranscript } from '../analyze.js';
import { existsSync } from 'node:fs';
import { HttpLlmClient } from '../llm/llm-client.js';
import { speakerLetters, transcriptForPrompt } from '../llm/prompt.js';
import { HttpSttClient } from '../stt/stt-client.js';
import { transcribeCall } from '../stt/transcribe.js';
import { parseWav } from '../wav.js';

const TOPICS = [
  ['edo', 'ЭДО (ijro.uz): документооборот', 'EDO (ijro.uz): hujjat aylanishi'],
  ['ijro_discipline', 'Исполнительская дисциплина: отчёты и сроки', 'Ijro intizomi: hisobotlar va muddatlar'],
  ['e_huquqshunos', 'E-Huquqshunos: юридические услуги', 'E-Huquqshunos: yuridik xizmatlar'],
  ['eri_key', 'Ключ ЭЦП (E-imzo), Uzcrypto', 'ERI kaliti (E-imzo), Uzcrypto'],
  ['login_access', 'Вход в систему, пароль, учётная запись', 'Tizimga kirish, parol, akkaunt'],
  ['system_error', 'Ошибка или сбой системы', 'Tizim xatosi, ishlamayapti'],
  ['pc_setup', 'Настройка компьютера и браузера', 'Kompyuter va brauzer sozlamalari'],
  ['consultation', 'Консультация по работе в системе', 'Foydalanish bo‘yicha maslahat'],
  ['contract_payment', 'Договор и оплата', 'Shartnoma va to‘lov'],
  ['request_status', 'Статус обращения', 'Murojaat holati'],
  ['complaint', 'Жалоба', 'Shikoyat'],
  ['wrong_call', 'Ошибочный или прерванный звонок', 'Noto‘g‘ri qo‘ng‘iroq yoki aloqa uzildi'],
  ['other', 'Другое', 'Boshqa'],
].map(([code, nameRu, nameUz]) => ({ code, nameRu, nameUz }));

const CallsSchema = z.object({
  calls: z.array(
    z.object({
      callId: z.string(),
      direction: z.enum(['inbound', 'outbound', 'internal']),
      talkSec: z.number(),
      recordings: z.array(z.string()).min(1),
    }),
  ),
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      calls: { type: 'string' },
      monitor: { type: 'string' },
      out: { type: 'string' },
      n: { type: 'string', default: '10' },
      ids: { type: 'string' },
      /** Which runs: chunks, turns, turns_think (thinking costs 4–10× the time). */
      modes: { type: 'string', default: 'chunks,turns,turns_think' },
    },
  });
  if (!values.calls || !values.monitor || !values.out) throw new Error('--calls, --monitor and --out are required');
  const env = z
    .object({
      CC_AI_STT_URL: z.url(),
      CC_AI_LLM_URL: z.url(),
      CC_AI_LLM_MODEL: z.string(),
      CC_AI_LLM_API_KEY: z.string(),
    })
    .parse(process.env);
  const stt = new HttpSttClient(env.CC_AI_STT_URL.replace(/\/+$/, ''), 900_000);
  const llm = new HttpLlmClient(
    env.CC_AI_LLM_URL.replace(/\/+$/, ''),
    env.CC_AI_LLM_MODEL,
    env.CC_AI_LLM_API_KEY,
    600_000,
  );

  const all = CallsSchema.parse(JSON.parse(await readFile(values.calls, 'utf8'))).calls;
  let picked;
  if (values.ids) {
    const ids = new Set(values.ids.split(','));
    picked = all.filter((c) => ids.has(c.callId));
  } else {
    // spread over talk length: every k-th call of the sorted list, skipping very long ones
    const sorted = [...all].filter((c) => c.talkSec < 1500).sort((a, b) => a.talkSec - b.talkSec);
    const n = Number(values.n);
    picked = Array.from({ length: n }, (_, i) => sorted[Math.floor(((i + 0.5) * sorted.length) / n)]);
  }
  await mkdir(values.out, { recursive: true, mode: 0o700 });

  const summary = [];
  for (const call of picked) {
    const file = path.join(values.out, `${call.callId}.json`);
    if (existsSync(file)) {
      const prev = JSON.parse(await readFile(file, 'utf8')) as { row?: Record<string, unknown> };
      if (prev.row) {
        summary.push(prev.row);
        continue;
      }
    }
    const audio = await readFile(path.join(values.monitor, call.recordings[0]));
    const wav = parseWav(audio);
    const row: Record<string, unknown> = {
      callId: call.callId,
      direction: call.direction,
      audioSec: Math.round(wav.durationSec),
    };
    const detail: Record<string, unknown> = { ...row };
    const modesWanted = new Set(values.modes.split(','));
    for (const strategy of ['chunks', 'turns'] as const) {
      if (!modesWanted.has(strategy) && !modesWanted.has(`${strategy}_think`)) continue;
      const t0 = Date.now();
      const run = await transcribeCall(stt, audio, wav, {
        strategy,
        turnConcurrency: 3,
        ruThreshold: 0.35,
        speakers: { minSpeakers: 2, maxSpeakers: 3 },
      });
      const sttMs = Date.now() - t0;
      const letters = speakerLetters(run.segments);
      const modes = [false, true].filter((th) => modesWanted.has(`${strategy}${th ? '_think' : ''}`));
      for (const thinking of modes) {
        const key = `${strategy}${thinking ? '_think' : ''}`;
        row[`${key}_sttMs`] = sttMs;
        row[`${key}_segments`] = run.segments.length;
        row[`${key}_requests`] = run.requests;
        try {
          const res = await analyzeTranscript(llm, {
            segments: run.segments,
            letters,
            topics: TOPICS,
            direction: call.direction,
            audioSec: wav.durationSec,
            thinking,
          });
          row[`${key}_llmMs`] = res.ms;
          row[`${key}_llmAttempts`] = res.attempts;
          row[`${key}_overall`] = res.analysis.overall;
          row[`${key}_topic`] = res.analysis.topicCode;
          row[`${key}_outcome`] = res.analysis.outcome;
          row[`${key}_roles`] = JSON.stringify(res.roles);
          row[`${key}_tokens`] = `${res.promptTokens}/${res.completionTokens}`;
          detail[key] = { sttMs, llm: res, rerun: run.rerun, transcript: transcriptForPrompt(run.segments, letters) };
        } catch (err) {
          row[`${key}_error`] = (err as Error).message;
          detail[key] = {
            sttMs,
            error: (err as Error).message,
            raw: err instanceof LlmOutputError ? err.lastContent : undefined,
            transcript: transcriptForPrompt(run.segments, letters),
          };
        }
      }
    }
    await writeFile(file, JSON.stringify({ ...detail, row }, null, 1), { mode: 0o600 });
    summary.push(row);
    process.stdout.write(`${JSON.stringify(row)}\n`);
  }
  await writeFile(path.join(values.out, 'summary.json'), JSON.stringify(summary, null, 1), { mode: 0o600 });
}

main().catch((err: unknown) => {
  process.stderr.write(`compare-stt failed: ${(err as Error).message}\n`);
  process.exit(1);
});
