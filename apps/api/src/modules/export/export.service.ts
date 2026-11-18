import type { ExportExcelQuery } from '@cc/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PbxCallsService } from '../../pbx/calls/pbx-calls.service.js';
import type { AssembledCall } from '../../pbx/calls/call-assembler.js';
import { AuditService } from '../audit/audit.service.js';
import { ExcludedOperatorsService } from '../excluded-operators/excluded-operators.service.js';
import { operatorStats } from '../stats/domain/metrics.js';
import { buildExcelReport } from './domain/excel-report.js';

@Injectable()
export class ExportService {
  constructor(
    private readonly calls: PbxCallsService,
    private readonly audit: AuditService,
    private readonly excluded: ExcludedOperatorsService,
  ) {}

  async excel(q: ExportExcelQuery): Promise<{ buffer: Buffer; fileName: string }> {
    this.calls.assertRange(q.from, q.to, this.calls.maxStatsDays);
    const group = q.group === 'all' ? { id: 'all' } : this.calls.groups.find((g) => g.id === q.group);
    if (!group) throw new BadRequestException(`Unknown operator group "${q.group}"`);

    const [calls, names] = await Promise.all([this.calls.callsForRange(q.from, q.to), this.calls.operatorNames()]);
    const statsOpts = {
      scope: q.scope,
      names,
      groupOf: (ext: string) => this.calls.groupOf(ext),
      group: q.group,
      // Legacy exportService skipped excluded operators: no column, not in the day totals.
      excluded: this.excluded.extensions(),
    };

    const byDate = new Map<string, AssembledCall[]>();
    for (const c of calls) {
      let list = byDate.get(c.date);
      if (!list) byDate.set(c.date, (list = []));
      list.push(c);
    }
    const perDay = new Map<string, Map<string, { count: number; talkSec: number }>>();
    for (const [date, dayCalls] of byDate) {
      perDay.set(
        date,
        new Map(operatorStats(dayCalls, statsOpts).map((r) => [r.ext, { count: r.total, talkSec: r.talkSec }])),
      );
    }

    const summary = operatorStats(calls, { ...statsOpts, knownExtensions: names.keys() });
    // Columns: every known operator of the group plus anyone who had calls (sorted by extension).
    const operators = summary.map((r) => ({ ext: r.ext, name: r.name }));

    const { workbook, fileName } = buildExcelReport({
      from: q.from,
      to: q.to,
      today: this.calls.today(),
      lang: q.lang,
      group,
      operators,
      perDay,
      summary,
      isWorkingDay: (d) => this.calls.calendar.isWorkingDay(d),
    });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await this.audit.record('export.excel', {
      details: { from: q.from, to: q.to, group: q.group, lang: q.lang, scope: q.scope },
    });
    return { buffer, fileName };
  }
}
