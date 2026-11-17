import { normalizeUzPhone } from '@cc/shared';

/** One CDR aggregate row per raw caller id (the same citizen may appear as 9xx… and 998 9xx…). */
export interface CallerAggregateRow {
  src: string;
  calls: number;
  answered: number;
  talkSeconds: number;
  /** PBX wall-clock "YYYY-MM-DD HH:mm:ss". */
  lastCall: string;
}

export interface TopCaller {
  phone: string;
  totalCalls: number;
  answeredCalls: number;
  totalTalkSeconds: number;
  lastCall: string;
}

/** Merges raw caller ids by normalized phone and returns the most active ones. */
export function topCallers(rows: readonly CallerAggregateRow[], limit: number): TopCaller[] {
  const byPhone = new Map<string, TopCaller>();
  for (const r of rows) {
    const phone = normalizeUzPhone(r.src);
    if (!phone) continue;
    const cur = byPhone.get(phone);
    if (cur) {
      cur.totalCalls += r.calls;
      cur.answeredCalls += r.answered;
      cur.totalTalkSeconds += r.talkSeconds;
      if (r.lastCall > cur.lastCall) cur.lastCall = r.lastCall;
    } else {
      byPhone.set(phone, {
        phone,
        totalCalls: r.calls,
        answeredCalls: r.answered,
        totalTalkSeconds: r.talkSeconds,
        lastCall: r.lastCall,
      });
    }
  }
  return [...byPhone.values()]
    .sort((a, b) => b.totalCalls - a.totalCalls || b.lastCall.localeCompare(a.lastCall))
    .slice(0, limit);
}
