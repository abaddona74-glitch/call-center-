import { describe, expect, it } from 'vitest';
import { diffPresence, normalizeReason, type OpenInterval, type PresenceSample, sampleOf } from './presence-state.js';
import { periodWindow, type PresenceIntervalFact, summarizePresence, workingWindows } from './presence-summary.js';

const TZ = 'Asia/Tashkent';
/** Tashkent wall time → Date (UTC+5, no DST). */
const tk = (wall: string) => new Date(`${wall}+05:00`);
const ms = (wall: string) => tk(wall).getTime();

describe('sampleOf', () => {
  it('maps the live presence to the logged state', () => {
    expect(sampleOf({ presence: 'offline', paused: true, pauseReason: 'Tushlik' })).toEqual({
      state: 'offline',
      reason: null,
    });
    expect(sampleOf({ presence: 'idle', paused: false, pauseReason: null })).toEqual({ state: 'online', reason: null });
    expect(sampleOf({ presence: 'paused', paused: true, pauseReason: "  Yig'ilish " })).toEqual({
      state: 'paused',
      reason: "Yig'ilish",
    });
    expect(sampleOf({ presence: 'talking', paused: false, pauseReason: null }).state).toBe('online');
    expect(sampleOf({ presence: 'ringing', paused: false, pauseReason: null }).state).toBe('online');
  });

  it('keeps a pause while the operator talks (outbound call during a pause)', () => {
    expect(sampleOf({ presence: 'talking', paused: true, pauseReason: 'Tushlik' })).toEqual({
      state: 'paused',
      reason: 'Tushlik',
    });
  });

  it('normalizes reasons: trimmed, inner spaces collapsed, blank = none', () => {
    expect(normalizeReason('  ')).toBeNull();
    expect(normalizeReason(null)).toBeNull();
    expect(normalizeReason('Texnik   nosozlik')).toBe('Texnik nosozlik');
  });
});

describe('diffPresence', () => {
  const open = (ext: string, s: PresenceSample, id = ext): OpenInterval => ({ id, extension: ext, ...s });
  const online: PresenceSample = { state: 'online', reason: null };
  const offline: PresenceSample = { state: 'offline', reason: null };
  const lunch: PresenceSample = { state: 'paused', reason: 'Tushlik' };

  it('opens rows for new phones and leaves unchanged ones alone', () => {
    const d = diffPresence(
      new Map([['101', open('101', online)]]),
      new Map([
        ['101', online],
        ['102', offline],
      ]),
    );
    expect(d.close).toEqual([]);
    expect(d.open).toEqual([{ extension: '102', ...offline }]);
  });

  it('closes and reopens on a state or reason change', () => {
    const d = diffPresence(
      new Map([
        ['101', open('101', online)],
        ['102', open('102', lunch)],
      ]),
      new Map<string, PresenceSample>([
        ['101', lunch],
        ['102', { state: 'paused', reason: "Yig'ilish" }],
      ]),
    );
    expect(d.close.map((c) => c.extension)).toEqual(['101', '102']);
    expect(d.open).toEqual([
      { extension: '101', ...lunch },
      { extension: '102', state: 'paused', reason: "Yig'ilish" },
    ]);
  });

  it('closes a phone that left the live state without opening anything (unknown, not offline)', () => {
    const d = diffPresence(new Map([['101', open('101', online)]]), new Map());
    expect(d.close.map((c) => c.extension)).toEqual(['101']);
    expect(d.open).toEqual([]);
  });
});

describe('workingWindows', () => {
  const cal = {
    timezone: TZ,
    start: '08:00',
    end: '21:00',
    isWorkingDay: (d: string) => ![6, 7].includes(new Date(`${d}T12:00:00Z`).getUTCDay() || 7) && d !== '2026-11-18',
  };

  it('one window per working day, holidays and weekends skipped', () => {
    // Mon 16 .. Sun 22 Nov 2026; the 18th is a holiday here.
    const w = workingWindows('2026-11-16', '2026-11-22', cal);
    expect(w.map(([a]) => new Date(a).toISOString())).toEqual([
      '2026-11-16T03:00:00.000Z',
      '2026-11-17T03:00:00.000Z',
      '2026-11-19T03:00:00.000Z',
      '2026-11-20T03:00:00.000Z',
    ]);
    expect(w[0][1] - w[0][0]).toBe(13 * 3_600_000);
  });

  it('periodWindow covers whole Tashkent days', () => {
    const [a, b] = periodWindow('2026-11-16', '2026-11-17', TZ);
    expect(new Date(a).toISOString()).toBe('2026-11-15T19:00:00.000Z');
    expect(b - a).toBe(2 * 86_400_000);
  });
});

describe('summarizePresence', () => {
  const day = periodWindow('2026-11-16', '2026-11-16', TZ);
  const iv = (
    extension: string,
    state: PresenceIntervalFact['state'],
    from: string,
    to: string | null,
    pauseReason: string | null = null,
  ): PresenceIntervalFact => ({
    extension,
    state,
    pauseReason,
    startedAt: tk(`2026-11-16T${from}`),
    endedAt: to ? tk(`2026-11-16T${to}`) : null,
  });

  it('online includes pauses, pauses by reason, offline ignored', () => {
    const out = summarizePresence(
      [
        iv('101', 'offline', '00:00:00', '08:00:00'),
        iv('101', 'online', '08:00:00', '12:00:00'),
        iv('101', 'paused', '12:00:00', '13:00:00', 'Tushlik'),
        iv('101', 'online', '13:00:00', '17:00:00'),
        iv('101', 'paused', '17:00:00', '17:30:00', null),
        iv('101', 'paused', '17:30:00', '17:45:00', 'Tushlik'),
      ],
      { period: day, now: ms('2026-11-17T00:00:00') },
    );
    expect(out.get('101')).toEqual({
      onlineSec: 9.75 * 3600,
      pauseSec: 1.75 * 3600,
      pauses: [
        { reason: 'Tushlik', sec: 1.25 * 3600 },
        { reason: null, sec: 0.5 * 3600 },
      ],
    });
  });

  it('clips to the period and counts an open interval until now', () => {
    const out = summarizePresence(
      [{ extension: '102', state: 'online', pauseReason: null, startedAt: tk('2026-11-15T20:00:00'), endedAt: null }],
      { period: day, now: ms('2026-11-16T10:00:00') },
    );
    expect(out.get('102')?.onlineSec).toBe(10 * 3600);
  });

  it('scope "working": only the working-time part counts', () => {
    const windows = [[ms('2026-11-16T08:00:00'), ms('2026-11-16T21:00:00')] as const];
    const out = summarizePresence(
      [iv('103', 'online', '07:00:00', '09:00:00'), iv('103', 'paused', '20:30:00', '22:00:00', 'Tushlik')],
      { period: day, now: ms('2026-11-17T00:00:00'), windows },
    );
    expect(out.get('103')).toEqual({
      onlineSec: 1.5 * 3600,
      pauseSec: 0.5 * 3600,
      pauses: [{ reason: 'Tushlik', sec: 0.5 * 3600 }],
    });
  });

  it('nothing outside working time: no row', () => {
    const out = summarizePresence([iv('104', 'online', '22:00:00', '23:00:00')], {
      period: day,
      now: ms('2026-11-17T00:00:00'),
      windows: [],
    });
    expect(out.has('104')).toBe(false);
  });
});
