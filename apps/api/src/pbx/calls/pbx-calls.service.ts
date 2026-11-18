import { BadRequestException, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LRUCache } from 'lru-cache';
import { addDays, daysInRange, datesBetween, epochToWall, todayInZone } from '../../common/time/business-time.js';
import type { WorkingCalendar } from '../../common/time/working-calendar.js';
import { AppConfig } from '../../config/app-config.js';
import { type AssembledCall, assembleCalls } from './call-assembler.js';
import type { CdrRow } from './cdr-row.js';
import { CdrRepository } from './cdr.repository.js';
import type { PbxDialplan } from './dialplan.js';
import type { SurveyRating } from './survey-rating.js';
import { WORKING_CALENDAR_CHANGED, WorkingCalendarService } from '../../modules/working-calendar/working-calendar.service.js';
import { dialplanFromConfig, groupOf, type OperatorGroup } from './pbx-calls.config.js';

/** Legs of a call that started before midnight are still read up to this long after it. */
const DAY_OVERLAP_SEC = 2 * 3600;
const LOAD_CONCURRENCY = 4;
const DIRECTORY_TTL_MS = 60_000;

/**
 * Calls (assembled from CDR legs) for Asia/Tashkent calendar days, with a per-day cache:
 * today is re-read every 15 s, yesterday every 2 min, older days are stable for hours.
 * Shared by the cdr (history), stats and export modules.
 */
@Injectable()
export class PbxCallsService {
  readonly dialplan: PbxDialplan;
  readonly groups: OperatorGroup[];
  readonly maxHistoryDays: number;
  readonly maxStatsDays: number;

  private readonly cache = new LRUCache<string, AssembledCall[]>({ max: 500 });
  private readonly inflight = new Map<string, Promise<AssembledCall[]>>();
  private directory: { at: number; names: Map<string, string> } | null = null;

  constructor(
    private readonly repo: CdrRepository,
    private readonly workingCalendar: WorkingCalendarService,
    config: AppConfig,
  ) {
    this.dialplan = dialplanFromConfig(config);
    this.groups = config.get('OPERATOR_GROUPS');
    this.maxHistoryDays = config.get('CDR_HISTORY_MAX_DAYS');
    this.maxStatsDays = config.get('STATS_MAX_DAYS');
  }

  /** The shared working calendar (changes apply at once, see onCalendarChanged). */
  get calendar(): WorkingCalendar {
    return this.workingCalendar.get();
  }

  /** Cached days carry "in working hours" flags computed with the old calendar. */
  @OnEvent(WORKING_CALENDAR_CHANGED)
  onCalendarChanged(): void {
    this.cache.clear();
  }

  today(): string {
    return todayInZone(this.calendar.timezone);
  }

  groupOf(ext: string): string | null {
    return groupOf(ext, this.groups);
  }

  assertRange(from: string, to: string, maxDays: number): void {
    if (from > to) throw new BadRequestException('`from` must not be after `to`');
    if (daysInRange(from, to) > maxDays) throw new BadRequestException(`Date range is limited to ${maxDays} days`);
  }

  /** All calls that started on the given days, in time order. */
  async callsForDates(dates: readonly string[]): Promise<AssembledCall[]> {
    const results: AssembledCall[][] = Array.from({ length: dates.length }, () => []);
    let next = 0;
    const worker = async () => {
      while (next < dates.length) {
        const i = next++;
        results[i] = await this.callsForDay(dates[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, dates.length) }, worker));
    return results.flat().sort((a, b) => a.startEpochMs - b.startEpochMs);
  }

  callsForRange(from: string, to: string): Promise<AssembledCall[]> {
    return this.callsForDates(datesBetween(from, to));
  }

  async callsForDay(date: string): Promise<AssembledCall[]> {
    const today = this.today();
    if (date > today) return [];
    const cached = this.cache.get(date);
    if (cached) return cached;
    const running = this.inflight.get(date);
    if (running) return running;

    const load = (async () => {
      const rows = await this.repo.rowsBetween(...this.dayWindow(date));
      const calls = assembleCalls(rows, this.dialplan, this.calendar).filter((c) => c.date === date);
      const ttl = date === today ? 15_000 : date === addDays(today, -1) ? 120_000 : 6 * 3_600_000;
      this.cache.set(date, calls, { ttl });
      return calls;
    })();
    this.inflight.set(date, load);
    try {
      return await load;
    } finally {
      this.inflight.delete(date);
    }
  }

  /** A call and its raw legs, by linkedid/uniqueid. */
  async findCall(id: string): Promise<{ call: AssembledCall; legs: CdrRow[] } | null> {
    const tried = new Set<string>();
    for (const source of [() => this.epochDates(id), () => this.calldateDates(id)]) {
      for (const date of await source()) {
        if (tried.has(date)) continue;
        tried.add(date);
        const call = (await this.callsForDay(date)).find((c) => c.id === id);
        if (call) return { call, legs: await this.repo.callRows(id, ...this.dayWindow(date)) };
      }
    }
    return null;
  }

  /** Most recent days on which a number appears (all-days phone search). */
  daysWithNumbers(variants: string[], limit: number): Promise<string[]> {
    return this.repo.daysWithNumbers(variants, limit);
  }

  /**
   * Survey ratings given while calls of `from`..`to` could still be rated (the same window as the day loads,
   * so a call just before midnight keeps its rating). Callers match them to calls by id. null = no survey.
   */
  surveyRatingsForRange(from: string, to: string): Promise<SurveyRating[] | null> {
    return this.repo.surveyRatings(this.dayWindow(from)[0], this.dayWindow(to)[1]);
  }

  /** Extension → name from asterisk.users (refreshed every minute). */
  async operatorNames(): Promise<Map<string, string>> {
    if (this.directory && Date.now() - this.directory.at < DIRECTORY_TTL_MS) return this.directory.names;
    const rows = await this.repo.operatorNames();
    const names = new Map<string, string>();
    for (const r of rows) {
      const ext = String(r.extension ?? '').trim();
      if (!this.dialplan.extensionPattern.test(ext)) continue;
      const name = String(r.name ?? '').trim();
      if (name) names.set(ext, name);
    }
    this.directory = { at: Date.now(), names };
    return names;
  }

  private dayWindow(date: string): [string, string] {
    const pad = (n: number) => String(n).padStart(2, '0');
    const h = Math.floor(DAY_OVERLAP_SEC / 3600);
    return [`${addDays(date, -1)} ${pad(24 - h)}:00:00`, `${addDays(date, 1)} ${pad(h)}:00:00`];
  }

  /** Asterisk ids are "<epoch>.<n>": the epoch gives the day without a table scan. */
  private async epochDates(id: string): Promise<string[]> {
    const m = /^(\d{9,11})\.\d+$/.exec(id);
    if (!m) return [];
    const date = epochToWall(Number(m[1]) * 1000, this.calendar.timezone).slice(0, 10);
    return [date, addDays(date, -1), addDays(date, 1)];
  }

  /** Fallback: the leg's calldate through the uniqueid index. */
  private async calldateDates(id: string): Promise<string[]> {
    const calldate = await this.repo.calldateOf(id);
    return calldate ? [calldate.slice(0, 10)] : [];
  }
}
