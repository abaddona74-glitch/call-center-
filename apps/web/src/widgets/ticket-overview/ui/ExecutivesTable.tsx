import type { OverviewExecutiveRow } from '@cc/shared';
import type * as React from 'react';
import { useMemo } from 'react';
import type { TicketListRequest } from '@/entities/overview';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { DataTable, type DataTableColumn, dataTableColumns } from '@/shared/ui/data-table';
import { Icon } from '@/shared/ui/icon';
import { NumberButton } from '@/shared/ui/number-button';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import '../i18n';

const col = dataTableColumns<OverviewExecutiveRow>();

/**
 * "Mas'ul shaxslar" (executives) of the whole country or of the selected region: what they did with the period's
 * tickets and what they hold right now (shared DataTable, legacy `.data-table` look).
 */
export function ExecutivesTable({
  rows,
  regionName,
  loading,
  onOpenList,
}: {
  rows: readonly OverviewExecutiveRow[] | undefined;
  /** Region code → display name. */
  regionName: (code: string) => string;
  loading?: boolean;
  /** Opens the tickets behind a cell's number (this Mas'ul, the page's region filter). */
  onOpenList?: (request: TicketListRequest) => void;
}) {
  const { t } = useTranslation('ticketOverview');
  const columns = useMemo<DataTableColumn<OverviewExecutiveRow>[]>(() => {
    const hours = (n: number | null) => (n === null ? t('executives.none') : t('executives.hours', { n }));
    const METRIC = { taken: 'exTaken', done: 'exDone', rejected: 'exRejected', overdue: 'exOverdue' } as const;
    /** A number that opens this Mas'ul's tickets behind it (zero stays plain). */
    const open = (
      r: OverviewExecutiveRow,
      metric: TicketListRequest['metric'],
      value: number,
      label: string,
      className: string,
      shown?: React.ReactNode,
    ) => (
      <NumberButton
        label={`${r.name} — ${label}`}
        // Read out what is shown (an average is not the count of its tickets).
        value={typeof shown === 'string' ? shown : value}
        className={className}
        onOpen={
          onOpenList && value > 0
            ? () => onOpenList({ metric, executive: r.userId, executiveName: r.name, value })
            : undefined
        }
      >
        {shown}
      </NumberButton>
    );
    const count = (key: 'taken' | 'done' | 'rejected' | 'overdue', tone: (v: number) => string) =>
      col.accessor(key, {
        header: () => t(`executives.${key}`),
        cell: ({ row }) =>
          open(row.original, METRIC[key], row.original[key], t(`executives.${key}`), tone(row.original[key])),
      });
    return [
      col.accessor('name', {
        header: () => t('executives.name'),
        cell: ({ row }) => {
          const regions = row.original.regions.map(regionName).join(', ');
          return (
            <div className="max-w-[260px]">
              <div className="truncate font-semibold text-ink">{row.original.name}</div>
              <div className="truncate text-[11px] text-mute" title={regions}>
                {regions || t('executives.noRegions')}
              </div>
            </div>
          );
        },
      }),
      count('taken', () => 'font-bold text-ink'),
      count('done', () => 'font-semibold text-positive'),
      count('rejected', (v) => (v ? 'text-caution' : 'text-mute')),
      count('overdue', (v) => (v ? 'font-semibold text-danger' : 'text-mute')),
      col.accessor('avgResolutionHours', {
        header: () => t('executives.avg'),
        cell: ({ row }) =>
          open(
            row.original,
            'exResolved',
            row.original.done + row.original.rejected,
            t('executives.avg'),
            'font-mono text-xs text-ink-2',
            hours(row.original.avgResolutionHours),
          ),
      }),
      col.accessor('holdingNow', {
        header: () => <span title={t('executives.holdingHint')}>{t('executives.holding')}</span>,
        cell: ({ row }) => (
          <span className="font-bold text-ink">
            {open(row.original, 'exHolding', row.original.holdingNow, t('executives.holding'), 'font-bold text-ink')}
            {row.original.overdueNow > 0 && (
              <span className="ml-1 text-xs font-semibold text-danger" title={t('executives.overdueNowHint')}>
                (
                {open(
                  row.original,
                  'exOverdueNow',
                  row.original.overdueNow,
                  t('executives.overdueNowHint'),
                  'text-danger',
                )}
                )
              </span>
            )}
          </span>
        ),
      }),
    ];
  }, [t, regionName, onOpenList]);

  return (
    <Panel>
      <PanelHeader className="mb-3.5">
        <div>
          <PanelTitle>
            <Icon name="user" className="size-[18px] text-primary" />
            {t('executives.title')}
            {rows && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">{rows.length}</span>}
          </PanelTitle>
          <p className="mt-1 text-xs text-mute">{t('executives.subtitle')}</p>
        </div>
      </PanelHeader>
      <DataTable
        variant="data"
        columns={columns}
        data={rows as OverviewExecutiveRow[] | undefined}
        getRowId={(r) => String(r.userId)}
        loading={loading && !rows}
        empty={t('executives.empty')}
        // Long lists scroll inside (sticky header) so the deadlines panel next to it stays level.
        className={cn('max-h-[760px] overflow-y-auto', loading && 'opacity-60')}
      />
    </Panel>
  );
}
