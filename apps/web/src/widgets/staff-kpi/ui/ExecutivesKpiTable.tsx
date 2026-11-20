import type { KpiExecutiveFigures, KpiExecutiveRow, KpiExecutiveTicketMetric } from '@cc/shared';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { NumberButton } from '@/shared/ui/number-button';
import type { KpiDetailRequest } from '../model/details';
import { DANGER_TEXT, hoursText, orLast, percentText, shareTone } from '../model/format';
import { ExpandButton, type KpiColumn, type KpiGroupHeader, KpiTable, kpiColumns, rowDomId } from './KpiTable';
import '../i18n';

/** A table row: a person (with region sub-rows) or one of their regions. */
interface Row {
  id: string;
  kind: 'person' | 'region';
  name: string;
  userId: number;
  /** The person's name (a region row's own name is the region). */
  personName: string;
  /** Region rows: the region code (null = tickets without a region). */
  regionCode: string | null;
  /** person: number of regions; region: assigned or only acted in. */
  regionCount: number;
  assigned: boolean;
  figures: KpiExecutiveFigures;
  children?: Row[];
}

const col = kpiColumns<Row>();

function toRows(executives: readonly KpiExecutiveRow[], ru: boolean, noRegion: string): Row[] {
  return executives.map((e) => ({
    id: `u${e.userId}`,
    kind: 'person',
    name: e.name,
    userId: e.userId,
    personName: e.name,
    regionCode: null,
    regionCount: e.regions.filter((r) => r.assigned).length,
    assigned: true,
    figures: e.totals,
    children: e.regions.map(({ regionId, code, nameUz, nameRu, assigned, ...figures }) => ({
      id: `u${e.userId}-r${regionId ?? 'none'}`,
      kind: 'region',
      name: regionId === null ? noRegion : ru ? nameRu : nameUz,
      userId: e.userId,
      personName: e.name,
      regionCode: code,
      regionCount: 0,
      assigned,
      figures,
    })),
  }));
}

/**
 * "Mas'ul shaxslar" of the staff KPI page: one row per person — what they did with the tickets in the period and what
 * they hold now — opened per region with the button in the first cell. Sort by any column (regions sort inside their
 * person).
 */
export function ExecutivesKpiTable({
  rows,
  loading,
  onOpen,
}: {
  rows: KpiExecutiveRow[] | undefined;
  loading?: boolean;
  /** Opens the tickets behind a number (keep it stable: the columns depend on it). */
  onOpen?: (request: KpiDetailRequest) => void;
}) {
  const { t, i18n } = useTranslation('staffKpi');
  const ru = i18n.language === 'ru';
  const locale = ru ? 'ru-RU' : 'uz-UZ';
  const data = useMemo(() => (rows ? toRows(rows, ru, t('ex.noRegion')) : undefined), [rows, ru, t]);

  const groups = useMemo<KpiGroupHeader[]>(
    () => [
      { id: 'period', label: t('groups.period'), dot: 'bg-chart-6' },
      { id: 'now', label: t('groups.now'), dot: 'bg-chart-5' },
    ],
    [t],
  );

  const columns = useMemo(() => {
    const request = (r: Row, metric: KpiExecutiveTicketMetric, value: number): KpiDetailRequest => ({
      kind: 'executiveTickets',
      userId: r.userId,
      name: r.personName,
      region: r.kind === 'region' ? { code: r.regionCode, name: r.name } : null,
      metric,
      value,
    });
    const label = (r: Row, id: string) =>
      r.kind === 'region' ? `${r.personName}, ${r.name}, ${t(`ex.${id}Title`)}` : `${r.name}, ${t(`ex.${id}Title`)}`;
    const num = (
      id: keyof KpiExecutiveFigures | 'onTime' | 'avgTake' | 'avgResolve' | 'holding',
      groupId: string,
      value: (f: KpiExecutiveFigures) => number | null,
      render: (v: number, f: KpiExecutiveFigures, r: Row) => React.ReactNode,
      opts: {
        groupStart?: boolean;
        /** The tickets behind the number and how many there are. */
        open?: (f: KpiExecutiveFigures) => { metric: KpiExecutiveTicketMetric; count: number };
        spoken?: (v: number) => string;
      } = {},
    ): KpiColumn<Row> =>
      col.accessor((r) => orLast(value(r.figures)), {
        id,
        header: () => t(`ex.${id}`),
        sortFn: 'basic',
        sortUndefined: 'last',
        sortDescFirst: true,
        meta: { group: groupId, title: t(`ex.${id}Title`), groupStart: opts.groupStart },
        cell: ({ row }) => {
          const r = row.original;
          const v = value(r.figures);
          if (v === null) return <span className="text-mute">—</span>;
          const content = render(v, r.figures, r);
          const target = onOpen ? opts.open?.(r.figures) : undefined;
          if (!target || target.count === 0) return content;
          return (
            <NumberButton
              label={label(r, id)}
              value={opts.spoken?.(v) ?? v}
              onOpen={() => onOpen?.(request(r, target.metric, target.count))}
            >
              {content}
            </NumberButton>
          );
        },
      });
    const count = (tone?: string) => (v: number) => (
      <span className={cn(v === 0 ? 'text-mute' : (tone ?? 'font-semibold text-ink'))}>{v}</span>
    );
    const hours = (v: number) => (
      <span className="font-mono text-xs text-ink-2">{t('ex.hours', { n: hoursText(v, locale) })}</span>
    );

    const list: KpiColumn<Row>[] = [
      col.accessor('name', {
        id: 'name',
        header: () => t('ex.name'),
        sortFn: 'alphanumeric',
        meta: { sticky: true, title: t('ex.name') },
        cell: ({ row }) => {
          const r = row.original;
          if (r.kind === 'region')
            return (
              <div className="flex max-w-[170px] items-center gap-2 pl-10 sm:max-w-[240px]">
                <span className="truncate text-ink-2">{r.name}</span>
                {!r.assigned && (
                  <span
                    title={t('ex.notAssignedTitle')}
                    className="shrink-0 rounded-md border border-caution/30 bg-caution/10 px-1.5 text-[10.5px] text-caution"
                  >
                    {t('ex.notAssigned')}
                  </span>
                )}
              </div>
            );
          const label = t(row.getIsExpanded() ? 'ex.collapse' : 'ex.expand', { name: r.name });
          return (
            <div className="flex max-w-[170px] items-center gap-2 sm:max-w-[240px]">
              {row.getCanExpand() ? (
                <ExpandButton
                  expanded={row.getIsExpanded()}
                  onToggle={() => row.toggleExpanded()}
                  controls={row.getIsExpanded() ? (r.children ?? []).map((c) => rowDomId(c.id)) : []}
                  label={label}
                />
              ) : (
                <span className="size-8 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="truncate font-semibold text-ink">{r.name}</div>
                <div className="truncate text-[11px] text-mute">
                  {r.regionCount ? t('ex.regions', { count: r.regionCount }) : t('ex.noRegions')}
                </div>
              </div>
            </div>
          );
        },
      }),
      num('arrived', 'period', (f) => f.arrived, count(), {
        groupStart: true,
        open: (f) => ({ metric: 'arrived', count: f.arrived ?? 0 }),
      }),
      num('taken', 'period', (f) => f.taken, count(), { open: (f) => ({ metric: 'taken', count: f.taken }) }),
      num('done', 'period', (f) => f.done, count('font-semibold text-positive'), {
        open: (f) => ({ metric: 'done', count: f.done }),
      }),
      num('rejected', 'period', (f) => f.rejected, count('text-caution'), {
        open: (f) => ({ metric: 'rejected', count: f.rejected }),
      }),
      num('released', 'period', (f) => f.released, count('text-ink-2'), {
        open: (f) => ({ metric: 'released', count: f.released }),
      }),
      num('forwarded', 'period', (f) => f.forwarded, count('text-ink-2'), {
        open: (f) => ({ metric: 'forwarded', count: f.forwarded }),
      }),
      num('late', 'period', (f) => f.late, count(`font-semibold ${DANGER_TEXT}`), {
        open: (f) => ({ metric: 'late', count: f.late }),
      }),
      num(
        'onTime',
        'period',
        (f) => f.onTimeRate,
        (v) => <span className={shareTone(v)}>{percentText(v, locale)}</span>,
        {
          open: (f) => ({ metric: 'resolved', count: f.done + f.rejected }),
          spoken: (v) => percentText(v, locale) ?? '',
        },
      ),
      num('avgTake', 'period', (f) => f.avgTakeHours, hours, {
        open: (f) => ({ metric: 'taken', count: f.taken }),
        spoken: (v) => t('ex.hours', { n: hoursText(v, locale) }),
      }),
      num('avgResolve', 'period', (f) => f.avgResolveHours, hours, {
        open: (f) => ({ metric: 'resolved', count: f.done + f.rejected }),
        spoken: (v) => t('ex.hours', { n: hoursText(v, locale) }),
      }),
      num(
        'holding',
        'now',
        (f) => f.holdingNow,
        // Two numbers in one cell, each its own button: what the person holds, and how many of them are overdue.
        (v, f, r) => (
          <span className={cn(v ? 'font-bold text-ink' : 'text-mute')}>
            <NumberButton
              label={label(r, 'holding')}
              value={v}
              onOpen={onOpen && v > 0 ? () => onOpen(request(r, 'holding', v)) : undefined}
            />
            {f.overdueNow > 0 && (
              <span
                className={cn('ml-1 text-xs font-semibold', DANGER_TEXT)}
                title={t('ex.overdueNow', { n: f.overdueNow })}
              >
                (
                <NumberButton
                  label={`${label(r, 'holding')}, ${t('ex.overdueNow', { n: f.overdueNow })}`}
                  value={f.overdueNow}
                  onOpen={onOpen ? () => onOpen(request(r, 'overdueNow', f.overdueNow)) : undefined}
                />
                )
              </span>
            )}
          </span>
        ),
        { groupStart: true },
      ),
    ];
    return list;
  }, [t, locale, onOpen]);

  return (
    <KpiTable
      caption={t('ex.caption')}
      columns={columns}
      groups={groups}
      data={data}
      getRowId={(r) => r.id}
      getSubRows={(r) => r.children}
      defaultSort={[{ id: 'taken', desc: true }]}
      loading={loading}
      empty={t('ex.empty')}
      rowClassName={(r) => (r.kind === 'region' ? 'bg-tint/[0.02] text-[12.5px]' : undefined)}
    />
  );
}
