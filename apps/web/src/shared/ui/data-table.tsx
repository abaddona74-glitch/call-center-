import { type ColumnDef, type RowData, createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Data table on TanStack Table v9 with the legacy looks:
 *  - `boxed` (default): "sessions-table" — framed, uppercase muted header on a darker strip;
 *  - `plain`: "settings-users-table" — no frame, normal-case header, roomier rows.
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
  variant?: 'boxed' | 'plain';
}

const LOOK = {
  boxed: {
    wrap: 'rounded-xl border border-white/8 bg-[rgba(15,23,42,0.5)]',
    table: 'text-xs',
    th: 'border-b border-white/8 bg-[rgba(30,41,59,0.7)] px-3.5 py-2.5 text-[11px] font-semibold tracking-[0.5px] uppercase',
    td: 'border-b border-white/[0.04] px-3.5 py-2.5',
  },
  plain: {
    wrap: '',
    table: 'text-[13px]',
    th: 'border-b border-white/8 px-2.5 py-2 text-xs font-semibold',
    td: 'border-b border-white/5 px-2.5 py-2.5',
  },
} as const;

export function DataTable<T extends RowData>({
  columns,
  data,
  getRowId,
  loading,
  empty,
  rowClassName,
  className,
  variant = 'boxed',
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
    <div className={cn('overflow-x-auto', look.wrap, className)}>
      <table className={cn('w-full border-collapse text-left', look.table)}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} className={cn('whitespace-nowrap text-[#94a3b8] last:text-right', look.th)}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={cn('transition-colors hover:bg-white/[0.03]', rowClassName?.(row.original))}>
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className={cn('align-middle text-[#cbd5e1] last:text-right', look.td)}>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-xs text-[#94a3b8]">
                {loading ? '…' : empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
