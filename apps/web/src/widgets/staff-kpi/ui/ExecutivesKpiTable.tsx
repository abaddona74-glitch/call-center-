import type { KpiExecutiveFigures, KpiExecutiveRow } from '@cc/shared';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { hoursText, orLast, percentText, shareTone } from '../model/format';
import { ExpandButton, type KpiColumn, type KpiGroupHeader, KpiTable, kpiColumns, rowDomId } from './KpiTable';
import '../i18n';

/** A table row: a person (with region sub-rows) or one of their regions. */
interface Row {
  id: string;
  kind: 'person' | 'region';
  name: string;
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
    regionCount: e.regions.filter((r) => r.assigned).length,
    assigned: true,
    figures: e.totals,
    children: e.regions.map(({ regionId, code: _code, nameUz, nameRu, assigned, ...figures }) => ({
      id: `u${e.userId}-r${regionId ?? 'none'}`,
      kind: 'region',
      name: regionId === null ? noRegion : ru ? nameRu : nameUz,
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
export function ExecutivesKpiTable({ rows, loading }: { rows: KpiExecutiveRow[] | undefined; loading?: boolean }) {
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
    const num = (
      id: keyof KpiExecutiveFigures | 'onTime' | 'avgTake' | 'avgResolve' | 'holding',
      groupId: string,
      value: (f: KpiExecutiveFigures) => number | null,
      render: (v: number, f: KpiExecutiveFigures) => React.ReactNode,
      groupStart = false,
    ): KpiColumn<Row> =>
      col.accessor((r) => orLast(value(r.figures)), {
        id,
        header: () => t(`ex.${id}`),
        sortFn: 'basic',
        sortUndefined: 'last',
        sortDescFirst: true,
        meta: { group: groupId, title: t(`ex.${id}Title`), groupStart },
        cell: ({ row }) => {
          const v = value(row.original.figures);
          return v === null ? <span className="text-mute">—</span> : render(v, row.original.figures);
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
        meta: { sticky: true },
        cell: ({ row }) => {
          const r = row.original;
          if (r.kind === 'region')
            return (
              <div className="flex max-w-[240px] items-center gap-2 pl-10">
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
            <div className="flex max-w-[240px] items-center gap-2">
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
      num('arrived', 'period', (f) => f.arrived, count(), true),
      num('taken', 'period', (f) => f.taken, count()),
      num('done', 'period', (f) => f.done, count('font-semibold text-positive')),
      num('rejected', 'period', (f) => f.rejected, count('text-caution')),
      num('released', 'period', (f) => f.released, count('text-ink-2')),
      num('forwarded', 'period', (f) => f.forwarded, count('text-ink-2')),
      num('late', 'period', (f) => f.late, count('font-semibold text-danger')),
      num(
        'onTime',
        'period',
        (f) => f.onTimeRate,
        (v) => <span className={shareTone(v)}>{percentText(v, locale)}</span>,
      ),
      num('avgTake', 'period', (f) => f.avgTakeHours, hours),
      num('avgResolve', 'period', (f) => f.avgResolveHours, hours),
      num(
        'holding',
        'now',
        (f) => f.holdingNow,
        (v, f) => (
          <span className={cn(v ? 'font-bold text-ink' : 'text-mute')}>
            {v}
            {f.overdueNow > 0 && (
              <span className="ml-1 text-xs font-semibold text-danger" title={t('ex.overdueNow', { n: f.overdueNow })}>
                ({f.overdueNow})
              </span>
            )}
          </span>
        ),
        true,
      ),
    ];
    return list;
  }, [t, locale]);

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
