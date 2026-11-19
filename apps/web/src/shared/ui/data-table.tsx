import { type ColumnDef, type RowData, createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Data table on TanStack Table v9 with the legacy looks:
 *  - `boxed` (default): "sessions-table" — framed, uppercase muted header on a darker strip;
 *  - `plain`: "settings-users-table" — no frame, normal-case header, roomier rows;
 *  - `data`: the dashboard/statistics `.data-table` — framed, bold uppercase header on slate, figures centred
 *    (first column left);
 *  - `compact`: the same, denser (side panels).
 * `onRowClick` makes the whole row clickable with the mouse (put a real button in a cell for the keyboard);
 * `isRowActive` highlights the selected row.
 *
 *   const col = dataTableColumns<User>();
 *   const columns = [col.accessor('username', { header: 'Login' }), col.display({ id: 'actions', cell: ... })];
 *   <DataTable columns={columns} data={users} getRowId={(u) => String(u.id)} />
 *
 * Keep `columns` stable (module scope or useMemo).
 */
export const dataTableFeatures = tableFeatures({});
export type DataTableFeatures = typeof dataTableFeatures;
export type DataTableColumn<T extends RowData> = ColumnDef<DataTableFeatures, T, any>;

export function dataTableColumns<T extends RowData>() {
  return createColumnHelper<DataTableFeatures, T>();
}

const EMPTY: never[] = [];

export interface DataTableProps<T extends RowData> {
  columns: DataTableColumn<T>[];
  data: T[] | undefined;
  getRowId?: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  className?: string;
  variant?: 'boxed' | 'plain' | 'data' | 'compact';
  /** Row click (mouse convenience; the row must also hold a focusable control for the same action). */
  onRowClick?: (row: T) => void;
  /** The selected row of an interactive table. */
  isRowActive?: (row: T) => boolean;
}

const LOOK = {
  boxed: {
    wrap: 'rounded-xl border border-tint/8 bg-glass/50',
    table: 'text-xs',
    th: 'border-b border-tint/8 bg-glass-2/70 px-3.5 py-2.5 text-[11px] font-semibold tracking-[0.5px] uppercase',
    td: 'border-b border-tint/[0.04] px-3.5 py-2.5',
  },
  plain: {
    wrap: '',
    table: 'text-[13px]',
    th: 'border-b border-tint/8 px-2.5 py-2 text-xs font-semibold',
    td: 'border-b border-tint/5 px-2.5 py-2.5',
  },
  data: {
    wrap: 'rounded-xl border border-tint/8',
    table: 'text-center text-[13px] [&_td:first-child]:text-left [&_th:first-child]:text-left',
    th: 'sticky top-0 z-[1] border-b border-tint/8 bg-secondary px-2.5 py-2.5 text-[10.5px] leading-tight font-bold tracking-[0.5px] text-muted-foreground uppercase',
    td: 'border-b border-tint/5 px-2.5 py-2 whitespace-nowrap tabular-nums text-foreground',
  },
  compact: {
    wrap: 'rounded-xl border border-tint/8',
    table: 'text-center text-[12.5px] [&_td:first-child]:text-left [&_th:first-child]:text-left',
    th: 'sticky top-0 z-[1] bg-secondary px-2 py-2 text-[10px] leading-tight font-bold tracking-[0.4px] text-muted-foreground uppercase',
    td: 'border-b border-tint/5 px-2 py-[7px] whitespace-nowrap tabular-nums text-foreground',
  },
} as const;
/** The legacy looks align by column; `boxed` / `plain` keep the last column right-aligned. */
const LEGACY_EDGE = { boxed: 'last:text-right', plain: 'last:text-right', data: '', compact: '' } as const;

export function DataTable<T extends RowData>({
  columns,
  data,
  getRowId,
  loading,
  empty,
  rowClassName,
  className,
  variant = 'boxed',
  onRowClick,
  isRowActive,
}: DataTableProps<T>) {
  const look = LOOK[variant];
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data: data ?? (EMPTY as T[]),
    ...(getRowId ? { getRowId: (row: T) => getRowId(row) } : {}),
  });
  const rows = table.getRowModel().rows;

  return (
    <div className={cn('scrollbar-visible overflow-x-auto', look.wrap, className)}>
      <table className={cn('w-full border-collapse text-left', look.table)}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  className={cn(
                    variant === 'data' || variant === 'compact' ? '' : 'whitespace-nowrap text-mute',
                    LEGACY_EDGE[variant],
                    look.th,
                  )}
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row) => {
            const active = isRowActive?.(row.original) ?? false;
            // Mouse convenience only: keyboard and screen-reader users act through a real control in the row
            // (a <tr> has no button semantics and `aria-selected` is valid only in grids).
            const interactive = onRowClick ? { onClick: () => onRowClick(row.original) } : {};
            return (
              <tr
                key={row.id}
                {...interactive}
                className={cn(
                  'transition-colors hover:bg-tint/[0.03]',
                  onRowClick &&
                    'cursor-pointer outline-none hover:bg-tint/[0.05] focus-visible:bg-tint/[0.08] focus-visible:shadow-[inset_3px_0_0_var(--primary)]',
                  active && 'bg-primary/14 shadow-[inset_3px_0_0_var(--primary)] hover:bg-primary/18',
                  rowClassName?.(row.original),
                )}
              >
                {row.getAllCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cn(
                      'align-middle',
                      variant === 'data' || variant === 'compact' ? '' : 'text-ink-2',
                      LEGACY_EDGE[variant],
                      look.td,
                    )}
                  >
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-xs text-mute">
                {loading ? '…' : empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
