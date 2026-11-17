import {
  type CallDetailsResponse,
  type CallHistoryQuery,
  type CallHistoryResponse,
  hasRoleAtLeast,
  type SessionUser,
} from '@cc/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { datesBetween, wallToIso } from '../../common/time/business-time.js';
import { storedNumberVariants } from '../../pbx/calls/dialplan.js';
import { PbxCallsService } from '../../pbx/calls/pbx-calls.service.js';
import { matchesFilter, paginate, parseSearch, toCallListItem } from './domain/call-filter.js';

/** How many most recent days an all-days phone search looks at. */
const ALL_DAYS_SEARCH_LIMIT = 60;

@Injectable()
export class CdrService {
  constructor(private readonly calls: PbxCallsService) {}

  async history(q: CallHistoryQuery, user: SessionUser): Promise<CallHistoryResponse> {
    const dp = this.calls.dialplan;
    const search = parseSearch(q.search, dp);
    const today = this.calls.today();

    let dates: string[];
    let range: CallHistoryResponse['range'];
    if (!q.from && !q.to && search.kind === 'phone') {
      // "search all days" (legacy hist_search_all_days): find the days through the indexed src/dst columns
      dates = await this.calls.daysWithNumbers(storedNumberVariants(search.number, dp), ALL_DAYS_SEARCH_LIMIT);
      const sorted = [...dates].sort();
      range = { from: sorted[0] ?? today, to: sorted.at(-1) ?? today, allDays: true };
    } else {
      const from = q.from ?? q.to ?? today;
      const to = q.to ?? q.from ?? today;
      this.calls.assertRange(from, to, this.calls.maxHistoryDays);
      range = { from, to, allDays: false };
      dates = from > today ? [] : datesBetween(from, to < today ? to : today);
    }

    const [all, names] = await Promise.all([this.calls.callsForDates(dates), this.calls.operatorNames()]);
    const filtered = all.filter((c) =>
      matchesFilter(
        c,
        { direction: q.direction, status: q.status, operator: q.operator, scope: q.scope, search },
        names,
      ),
    );
    const page = paginate(filtered, q.page, q.pageSize);
    const includeRecording = canSeeRecordings(user);
    return {
      items: page.items.map((c) => toCallListItem(c, names, { includeRecording, toIso: wallToIso })),
      page: q.page,
      pageSize: q.pageSize,
      total: page.total,
      range,
    };
  }

  async details(id: string, user: SessionUser): Promise<CallDetailsResponse> {
    const found = await this.calls.findCall(id);
    if (!found) throw new NotFoundException('Call not found');
    const names = await this.calls.operatorNames();
    return {
      call: toCallListItem(found.call, names, { includeRecording: canSeeRecordings(user), toIso: wallToIso }),
      legs: found.legs.map((l) => ({
        calldate: l.calldate,
        src: l.src,
        dst: l.dst,
        dcontext: l.dcontext,
        channel: l.channel,
        dstchannel: l.dstchannel,
        lastapp: l.lastapp,
        lastdata: l.lastdata,
        disposition: l.disposition,
        duration: l.duration,
        billsec: l.billsec,
        uniqueid: l.uniqueid,
      })),
    };
  }
}

/** Legacy never exposed recordings to operators (viewer `sanitizeCalls`); the recordings module decides later. */
function canSeeRecordings(user: SessionUser): boolean {
  return hasRoleAtLeast(user.role, 'admin');
}
