import type { OverviewExecutiveRow } from '@cc/shared';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { DataTable, type DataTableColumn, dataTableColumns } from '@/shared/ui/data-table';
import { Icon } from '@/shared/ui/icon';
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
}: {
  rows: readonly OverviewExecutiveRow[] | undefined;
  /** Region code → display name. */
  regionName: (code: string) => string;
  loading?: boolean;
}) {
  const { t } = useTranslation('ticketOverview');
  const columns = useMemo<DataTableColumn<OverviewExecutiveRow>[]>(() => {
    const hours = (n: number | null) => (n === null ? t('executives.none') : t('executives.hours', { n }));
    const count = (key: 'taken' | 'done' | 'rejected' | 'overdue', tone: (v: number) => string) =>
      col.accessor(key, {
        header: () => t(`executives.${key}`),
        cell: ({ getValue }) => <span className={tone(getValue())}>{getValue()}</span>,
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
        cell: ({ getValue }) => <span className="font-mono text-xs text-ink-2">{hours(getValue())}</span>,
      }),
      col.accessor('holdingNow', {
        header: () => <span title={t('executives.holdingHint')}>{t('executives.holding')}</span>,
        cell: ({ row }) => (
          <span className="font-bold text-ink">
            {row.original.holdingNow}
            {row.original.overdueNow > 0 && (
              <span className="ml-1 text-xs font-semibold text-danger" title={t('executives.overdueNowHint')}>
                ({row.original.overdueNow})
              </span>
            )}
          </span>
        ),
      }),
    ];
  }, [t, regionName]);

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
