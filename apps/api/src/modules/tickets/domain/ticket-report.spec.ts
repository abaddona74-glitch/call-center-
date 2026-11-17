import { describe, expect, it } from 'vitest';
import { type ReportTicket, buildTicketReport } from './ticket-report.js';

const now = new Date('2026-11-30T12:00:00Z');
const names = {
  regions: new Map([
    [1, { nameUz: 'Toshkent shahri', nameRu: 'г. Ташкент' }],
    [11, { nameUz: 'Samarqand', nameRu: 'Самаркандская область' }],
  ]),
  categories: new Map([[1, { nameUz: 'ERI kaliti', nameRu: 'Ключ ЭЦП' }]]),
};
const t = (over: Partial<ReportTicket>): ReportTicket => ({
  status: 'new',
  regionId: 1,
  categoryId: 1,
  executiveUserId: null,
  executiveLabel: null,
  createdAt: new Date('2026-11-23T10:00:00Z'),
  dueAt: new Date('2026-11-26T10:00:00Z'),
  resolvedAt: null,
  ...over,
});

describe('buildTicketReport', () => {
  it('aggregates by region, category, status and executive', () => {
    const report = buildTicketReport(
      [
        // resolved in 24 h, in time
        t({ status: 'closed', executiveUserId: 5, executiveLabel: 'Ali', resolvedAt: new Date('2026-11-24T10:00:00Z') }),
        // resolved late (72 h → after due)
        t({ status: 'callback_pending', executiveUserId: 5, executiveLabel: 'Ali', resolvedAt: new Date('2026-11-26T10:00:00Z'), dueAt: new Date('2026-11-25T10:00:00Z') }),
        // still open past due → overdue
        t({ status: 'in_progress', regionId: 11, executiveUserId: 6, executiveLabel: 'Vali' }),
        // no region (legacy)
        t({ status: 'new', regionId: null, categoryId: null, dueAt: null }),
      ],
      names,
      { from: '2026-11-01', to: '2026-11-30' },
      now,
    );
    expect(report).toMatchObject({ total: 4, resolved: 2, closed: 1, overdue: 2, overdueShare: 0.5, avgResolutionHours: 48 });
    expect(report.byStatus.find((s) => s.status === 'new')?.count).toBe(1);
    expect(report.byStatus).toHaveLength(7);
    expect(report.byRegion[0]).toMatchObject({ id: 1, nameUz: 'Toshkent shahri', total: 2, resolved: 2, overdue: 1, avgResolutionHours: 48 });
    expect(report.byRegion.find((r) => r.id === null)).toMatchObject({ nameRu: 'Не указано', total: 1 });
    expect(report.byCategory.find((r) => r.id === 1)?.total).toBe(3);
    expect(report.byExecutive.map((e) => [e.nameUz, e.total, e.overdue])).toEqual([
      ['Ali', 2, 1],
      ['Vali', 1, 1],
    ]);
  });

  it('is empty-safe', () => {
    const r = buildTicketReport([], names, { from: '2026-11-01', to: '2026-11-30' }, now);
    expect(r).toMatchObject({ total: 0, overdueShare: 0, avgResolutionHours: null, byRegion: [] });
  });
});
