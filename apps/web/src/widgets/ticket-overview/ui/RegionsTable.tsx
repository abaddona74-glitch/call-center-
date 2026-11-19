import { OVERVIEW_NO_REGION, type OverviewRegionRow } from '@cc/shared';
import { useMemo } from 'react';
import type { TicketListRequest } from '@/entities/overview';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { DataTable, type DataTableColumn, dataTableColumns } from '@/shared/ui/data-table';
import { Icon } from '@/shared/ui/icon';
import { NumberButton } from '@/shared/ui/number-button';
import { percentOf } from '../model/format';
import '../i18n';

/** Region value of the page filter: its code, or "none" for tickets without a region. */
export const regionKey = (row: Pick<OverviewRegionRow, 'code'>) => row.code ?? OVERVIEW_NO_REGION;

const col = dataTableColumns<OverviewRegionRow>();

/**
 * The map as a table (every region and "Hududsiz"): what the map colours, with names, for keyboard and screen
 * readers and for the regions too small to click on the map. A row click filters the page like a map
 * click; keyboard and screen readers use the region-name button. Phones: the "closed" column is left out.
 */
export function RegionsTable({
  rows,
  selected,
  onSelect,
  onOpenList,
}: {
  rows: readonly OverviewRegionRow[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** Opens the tickets behind a cell's number (the row's region). */
  onOpenList?: (request: TicketListRequest) => void;
}) {
  const { t, i18n } = useTranslation('ticketOverview');
  const ru = i18n.language === 'ru';
  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          Number(a.code === null) - Number(b.code === null) || b.received - a.received || b.overdueNow - a.overdueNow,
      ),
    [rows],
  );
  const columns = useMemo<DataTableColumn<OverviewRegionRow>[]>(
    () => [
      col.accessor('nameUz', {
        header: () => t('regions.region'),
        cell: ({ row }) => {
          const r = row.original;
          const name = r.code === null ? t('regions.noRegion') : ru ? r.nameRu : r.nameUz;
          const active = selected === regionKey(r);
          return (
            <button
              type="button"
              aria-pressed={active}
              title={name}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(active ? null : regionKey(r));
              }}
              className="block max-w-[112px] cursor-pointer truncate rounded-sm text-left font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary sm:max-w-[150px]"
            >
              {r.code === null && <Icon name="location" className="mr-1 inline size-3 text-caution" />}
              {name}
            </button>
          );
        },
      }),
      col.accessor('received', {
        header: () => t('regions.received'),
        cell: ({ row }) => num(row.original, 'received', row.original.received, 'font-bold text-ink'),
      }),
      col.accessor('closed', {
        header: () => <span className="max-sm:hidden">{t('regions.closed')}</span>,
        cell: ({ row }) => num(row.original, 'closed', row.original.closed, 'text-positive max-sm:hidden'),
      }),
      col.accessor('overdue', {
        header: () => <span title={t('regions.overdueHint')}>{t('regions.overdue')}</span>,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className={r.overdue ? 'text-danger' : 'text-mute'}>
              {num(r, 'overdue', r.overdue)}
              {r.received > 0 && (
                <span className="ml-1 inline-block w-[30px] text-left text-[10.5px] text-mute max-sm:hidden">
                  {percentOf(r.overdue, r.received)}%
                </span>
              )}
            </span>
          );
        },
      }),
      col.accessor('overdueNow', {
        header: () => <span title={t('regions.nowHint')}>{t('regions.now')}</span>,
        cell: ({ row }) =>
          num(
            row.original,
            'nowOverdue',
            row.original.overdueNow,
            cn('font-bold', row.original.overdueNow ? 'text-danger' : 'text-mute'),
          ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `num` reads the props listed here
    [t, ru, selected, onSelect, onOpenList],
  );

  /** A cell's number: opens the region's tickets behind it (zero stays plain). */
  function num(
    row: OverviewRegionRow,
    metric: 'received' | 'closed' | 'overdue' | 'nowOverdue',
    value: number,
    className?: string,
  ) {
    const name = row.code === null ? t('regions.noRegion') : ru ? row.nameRu : row.nameUz;
    const label = `${name} — ${t(`regions.${metric === 'nowOverdue' ? 'nowHint' : metric}`)}`;
    return (
      <NumberButton
        label={label}
        value={value}
        className={className}
        onOpen={onOpenList && value > 0 ? () => onOpenList({ metric, region: regionKey(row), value }) : undefined}
      />
    );
  }

  return (
    <DataTable
      variant="compact"
      columns={columns}
      data={sorted}
      getRowId={regionKey}
      onRowClick={(r) => onSelect(selected === regionKey(r) ? null : regionKey(r))}
      isRowActive={(r) => selected === regionKey(r)}
      className="max-h-[520px] overflow-y-auto xl:max-h-none"
    />
  );
}
