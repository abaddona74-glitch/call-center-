import {
  type ColumnDef,
  type ExpandedState,
  type RowData,
  type SortingState,
  createColumnHelper,
  createExpandedRowModel,
  createSortedRowModel,
  rowExpandingFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import '../i18n';

/** Per-column extras: the column group (second header row), a full description and a cell class. */
export interface KpiColumnMeta {
  group?: string;
  /** Long name of a short header (tooltip and screen readers). */
  title?: string;
  /** First column: stays in place while the figures scroll sideways. */
  sticky?: boolean;
  /** Starts a new group: a separator line on its left. */
  groupStart?: boolean;
}

export const kpiTableFeatures = tableFeatures({
  rowSortingFeature,
  rowExpandingFeature,
  sortedRowModel: createSortedRowModel(),
  expandedRowModel: createExpandedRowModel(),
  sortFns: { basic: sortFn_basic, alphanumeric: sortFn_alphanumeric },
  columnMeta: {} as KpiColumnMeta,
});
export type KpiTableFeatures = typeof kpiTableFeatures;
export type KpiColumn<T extends RowData> = ColumnDef<KpiTableFeatures, T, any>;

export function kpiColumns<T extends RowData>() {
  return createColumnHelper<KpiTableFeatures, T>();
}

export interface KpiGroupHeader {
  id: string;
  label: ReactNode;
  /** Colour dot of the group (a `bg-…` token class). */
  dot: string;
}

const TH =
  'border-b border-tint/8 bg-secondary px-2.5 py-2 text-[10.5px] leading-tight font-bold tracking-[0.4px] text-muted-foreground uppercase';
const TD = 'border-b border-tint/5 px-2.5 py-2 whitespace-nowrap tabular-nums text-foreground';
const STICKY = 'sticky left-0 z-[2] bg-muted shadow-[1px_0_0_var(--border)]';
const SEPARATOR = 'border-l border-l-tint/10';

/**
 * Wide comparison table of the staff KPI page (legacy `.data-table` look, TanStack Table): a group header row over
 * short column headers, sorting by any column (figures descending first, empty values always last), a sticky first
 * column and optional sub-rows (`getSubRows`) opened by a button in the first cell.
 * Sorting with `aria-sort`; the sort and expand controls are real buttons.
 */
export function KpiTable<T extends RowData>({
  columns,
  groups,
  data,
  getRowId,
  getSubRows,
  defaultSort,
  loading,
  empty,
  caption,
  rowClassName,
}: {
  columns: KpiColumn<T>[];
  groups: readonly KpiGroupHeader[];
  data: T[] | undefined;
  getRowId: (row: T) => string;
  getSubRows?: (row: T) => T[] | undefined;
  defaultSort: SortingState;
  loading?: boolean;
  empty: ReactNode;
  /** Accessible name of the table. */
  caption: string;
  rowClassName?: (row: T, depth: number) => string | undefined;
}) {
  const { t } = useTranslation('staffKpi');
  const [sorting, setSorting] = useState<SortingState>(defaultSort);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const table = useTable({
    features: kpiTableFeatures,
    columns,
    data: data ?? [],
    getRowId: (row: T) => getRowId(row),
    ...(getSubRows ? { getSubRows: (row: T) => getSubRows(row) } : {}),
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    enableSortingRemoval: false,
  });
  const leafHeaders = table.getHeaderGroups().at(-1)?.headers ?? [];
  const groupById = new Map(groups.map((g) => [g.id, g]));

  // Group header row: consecutive leaf columns of one group share a cell.
  const groupCells: Array<{ id: string; span: number; group: KpiGroupHeader | null; sticky: boolean }> = [];
  for (const h of leafHeaders) {
    const meta = h.column.columnDef.meta;
    const last = groupCells.at(-1);
    if (meta?.group && last?.group?.id === meta.group) last.span++;
    else
      groupCells.push({
        id: h.id,
        span: 1,
        group: meta?.group ? (groupById.get(meta.group) ?? null) : null,
        sticky: Boolean(meta?.sticky),
      });
  }
  const rows = table.getRowModel().rows;

  return (
    <div className={cn('overflow-x-auto rounded-xl border border-tint/8', loading && 'opacity-60')}>
      <table className="w-full border-collapse text-center text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {groupCells.map((c) =>
              c.group ? (
                <th
                  key={c.id}
                  scope="colgroup"
                  colSpan={c.span}
                  className={cn(TH, SEPARATOR, 'border-b-tint/5 py-1.5 text-[10px] tracking-[0.6px] text-ink-2')}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className={cn('size-2 rounded-full', c.group.dot)} />
                    {c.group.label}
                  </span>
                </th>
              ) : (
                <td key={c.id} colSpan={c.span} className={cn(TH, 'py-1.5', c.sticky && STICKY, c.sticky && 'z-[3]')} />
              ),
            )}
          </tr>
          <tr>
            {leafHeaders.map((h) => {
              const meta = h.column.columnDef.meta;
              const sorted = h.column.getIsSorted();
              const next = h.column.getNextSortingOrder();
              return (
                <th
                  key={h.id}
                  scope="col"
                  aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                  className={cn(
                    TH,
                    'align-bottom',
                    meta?.sticky && cn(STICKY, 'z-[3] text-left'),
                    meta?.groupStart && SEPARATOR,
                  )}
                >
                  {h.column.getCanSort() ? (
                    <button
                      type="button"
                      onClick={h.column.getToggleSortingHandler()}
                      title={meta?.title}
                      aria-label={`${meta?.title ?? ''}${meta?.title ? '. ' : ''}${t(next === 'asc' ? 'table.sortAsc' : 'table.sortDesc')}`}
                      className={cn(
                        'inline-flex min-h-8 items-center gap-1 rounded-md px-1 uppercase transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-primary',
                        sorted && 'text-ink',
                      )}
                    >
                      <span aria-hidden={meta?.title ? true : undefined}>
                        <table.FlexRender header={h} />
                      </span>
                      <Icon
                        name={sorted === 'asc' ? 'arrow-up' : 'arrow-down'}
                        className={cn('size-3 shrink-0', sorted ? 'text-primary' : 'opacity-0')}
                      />
                    </button>
                  ) : (
                    <span title={meta?.title}>
                      <table.FlexRender header={h} />
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              id={rowDomId(row.id)}
              className={cn('transition-colors hover:bg-tint/[0.03]', rowClassName?.(row.original, row.depth))}
            >
              {row.getAllCells().map((cell) => {
                const meta = cell.column.columnDef.meta;
                return (
                  <td
                    key={cell.id}
                    className={cn(
                      TD,
                      'align-middle',
                      meta?.sticky && cn(STICKY, 'text-left'),
                      meta?.groupStart && SEPARATOR,
                    )}
                  >
                    <table.FlexRender cell={cell} />
                  </td>
                );
              })}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={leafHeaders.length} className="px-4 py-8 text-center text-xs text-mute">
                {loading ? '…' : empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** DOM id of a table row (sub-rows are announced by `aria-controls` of their parent's expand button). */
export function rowDomId(rowId: string): string {
  return `kpi-row-${rowId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/** The expand button of a parent row: shows / hides its sub-rows (regions). */
export function ExpandButton({
  expanded,
  onToggle,
  controls,
  label,
}: {
  expanded: boolean;
  onToggle: () => void;
  /** DOM ids of the sub-rows. */
  controls: string[];
  label: string;
}) {
  const id = useId();
  return (
    <button
      id={id}
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={controls.join(' ') || undefined}
      aria-label={label}
      title={label}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-tint/10 bg-tint/5 text-mute transition-colors hover:bg-tint/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
    >
      <Icon name="arrow-down" className={cn('size-3.5 transition-transform', expanded ? 'rotate-0' : '-rotate-90')} />
    </button>
  );
}
