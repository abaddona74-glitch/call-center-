import { describe, expect, it } from 'vitest';
import { WorkerEnvSchema, loadConfig } from './config.js';
import { dropEchoedTurns } from './stt/transcribe.js';
import { maxTokensFor, buildTurns } from './stt/turns.js';
import { cleanText, collapseRepeats } from './text/cleanup.js';
import { callLanguage, russianShare } from './text/language.js';
import { pcmWav } from './wav.fixture.js';
import { WavError, parseWav, sliceWav } from './wav.js';

describe('wav', () => {
  it('parses PBX PCM and slices whole frames', () => {
    const buf = pcmWav(10);
    const info = parseWav(buf);
    expect(info).toMatchObject({ format: 1, channels: 1, sampleRate: 8000, bitsPerSample: 16, sliceable: true });
    expect(info.durationSec).toBeCloseTo(10);
    const clip = sliceWav(buf, info, 2, 3.5);
    const ci = parseWav(clip);
    expect(ci.durationSec).toBeCloseTo(1.5);
    expect(clip.readInt16LE(44)).toBe((2 * 8000) & 0x7fff); // first sample of second 2
    // clamped to the recording
    expect(parseWav(sliceWav(buf, info, -1, 99)).durationSec).toBeCloseTo(10);
    expect(parseWav(sliceWav(buf, info, 5, 4)).durationSec).toBe(0);
  });

  it('a data size of 0 (still recording) means "to the end"; other encodings are not sliceable', () => {
    const buf = pcmWav(2);
    buf.writeUInt32LE(0, 40);
    expect(parseWav(buf).durationSec).toBeCloseTo(2);
    const gsm = pcmWav(1);
    gsm.writeUInt16LE(49, 20);
    expect(parseWav(gsm).sliceable).toBe(false);
    expect(() => sliceWav(gsm, parseWav(gsm), 0, 1)).toThrow(WavError);
    expect(() => parseWav(Buffer.from('not a wav file at all'))).toThrow(WavError);
  });
});

describe('turns', () => {
  const seg = (speaker: string, s: number, e: number) => ({ speaker, start_seconds: s, end_seconds: e });

  it('merges a speaker’s close turns unless the other speaker talked in between', () => {
    expect(buildTurns([seg('A', 0, 2), seg('A', 2.5, 4), seg('B', 5, 7), seg('A', 7.2, 9), seg('A', 9.5, 10)])).toEqual([
      { speaker: 'A', start: 0, end: 4 },
      { speaker: 'B', start: 5, end: 7 },
      { speaker: 'A', start: 7.2, end: 10 },
    ]);
    expect(buildTurns([seg('A', 0, 2), seg('B', 2.1, 2.6), seg('A', 2.7, 4)]).map((t) => t.speaker)).toEqual(['A', 'B', 'A']);
  });

  it('drops blips and backchannels inside the other speaker’s turn', () => {
    const turns = buildTurns([seg('A', 0, 10), seg('B', 3, 3.8), seg('B', 12, 12.2), seg('B', 14, 16)]);
    expect(turns).toEqual([
      { speaker: 'A', start: 0, end: 10 },
      { speaker: 'B', start: 14, end: 16 },
    ]);
  });

  it('drops the later of two overlapping turns that recognised the same words', () => {
    const seg = (speaker: string, start: number, end: number, text: string) => ({ speaker, start, end, text });
    const out = dropEchoedTurns([
      seg('A', 7, 12, 'alo assalomu alaykum yaxshimisiz yuz uchinchi operatorman'),
      seg('B', 9, 11, 'assalomu alaykum yaxshimisiz yuz uchinchi operatorman'),
      seg('B', 12.5, 14, 'kalitim ishlamayapti'),
      seg('A', 13, 15, 'tushunarli tekshiraman'),
      // the later turn is the echo even when it is longer
      seg('A', 20, 21, 'hozir tekshirib beraman'),
      seg('B', 20.5, 26, 'hozir tekshirib beraman xo‘p'),
    ]);
    expect(out.map((x) => [x.speaker, x.start])).toEqual([
      ['A', 7],
      ['B', 12.5],
      ['A', 13],
      ['A', 20],
    ]);
  });

  it('token limit grows with the turn and stays within Whisper’s per-chunk 256', () => {
    expect(maxTokensFor(0.5)).toBe(32);
    expect(maxTokensFor(10)).toBe(106);
    expect(maxTokensFor(120)).toBe(256);
  });
});

describe('text', () => {
  it('collapses looped words and phrases, keeps normal repetition', () => {
    expect(collapseRepeats('qani, bu yerda mana bu yerda mana bu yerda mana bu yerda mana')).toBe('qani, bu yerda mana');
    expect(collapseRepeats('ha ha ha ha ha')).toBe('ha');
    expect(collapseRepeats('ha, ha. bo‘ldi')).toBe('ha, ha. bo‘ldi');
  });

  it('drops stock hallucinations', () => {
    expect(cleanText('musiqa')).toBe('');
    expect(cleanText('Rahmat.')).toBe('Rahmat.');
    expect(cleanText('telefon qilish')).toBe('');
    expect(cleanText('telefon qilish kerak')).toBe('telefon qilish kerak');
    expect(cleanText(' Продолжение следует... ')).toBe('');
    expect(cleanText('  assalomu   alaykum ')).toBe('assalomu alaykum');
  });

  it('tells Russian speech from Uzbek in Uzbek-mode output', () => {
    expect(russianShare('xorosho, seychas posmotryu, podojdite minutku')).toBe(1);
    expect(russianShare('assalomu alaykum, tizimga kirish ishlamayapti')).toBe(0);
    expect(russianShare('здравствуйте, ключ не работает')).toBe(1);
    expect(russianShare('12 34')).toBe(0);
    expect(callLanguage(['assalomu alaykum yaxshimisiz', 'rahmat'])).toBe('uz');
    expect(callLanguage(['xorosho seychas', 'ha rahmat bor kerak'])).toBe('mixed');
  });
});

describe('config', () => {
  const env = {
    CC_API_URL: 'http://localhost:3000/',
    CC_API_TOKEN: 'abcdefghijklmnop1234',
    CC_AI_STT_URL: 'http://stt:8666',
    CC_AI_LLM_URL: 'http://llm:30000',
    CC_AI_LLM_MODEL: '/models/x',
    CC_AI_LLM_API_KEY: 'secret-key',
  };
  it('defaults: 2 calls at a time, turns, thinking off', () => {
    const cfg = loadConfig(env);
    expect(cfg).toMatchObject({
      CC_API_URL: 'http://localhost:3000',
      CC_WORKER_CONCURRENCY: 2,
      CC_STT_STRATEGY: 'turns',
      CC_LLM_THINKING: false,
      CC_STT_RU_THRESHOLD: 1,
    });
  });
  it('errors name the variable, never the secret value', () => {
    expect(() => loadConfig({ ...env, CC_API_TOKEN: 'short' })).toThrow(/CC_API_TOKEN/);
    try {
      loadConfig({ ...env, CC_AI_LLM_URL: 'nope', CC_AI_LLM_API_KEY: 'super-secret' });
    } catch (err) {
      expect((err as Error).message).not.toContain('super-secret');
    }
    expect(WorkerEnvSchema.safeParse({ ...env, CC_WORKER_CONCURRENCY: '0' }).success).toBe(false);
  });
});
