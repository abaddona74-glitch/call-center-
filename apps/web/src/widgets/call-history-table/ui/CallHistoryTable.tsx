import type { CallListItem } from '@cc/shared';
import { CallRecordingButton } from '@/features/recordings/play-call';
import { CreateTicketButton } from '@/features/tickets/create-ticket';
import { columnVisibilityFeature, createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CallDirectionBadge, CallStatusBadge, DirectionMark, formatDuration, formatPhone } from '@/entities/call';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import '../i18n';

const features = tableFeatures({ columnVisibilityFeature });
const helper = createColumnHelper<typeof features, CallListItem>();

export type ColumnVisibility = Record<string, boolean>;

/** Legacy `.data-table`: centered cells except time, number (left) and actions (right). */
const ALIGN: Record<string, string> = {
  time: 'text-left',
  phone: 'text-left',
  action: 'text-right [&>div]:justify-end',
};

/** Legacy `.recent-calls-table` row tint + 3px left accent (miss / lost / xfer). */
/** Player title for a call's recording: the client's number (or the call id when hidden) and when. */
export function recordingLabel(c: CallListItem): string {
  return `${formatPhone(c.clientNumber ?? c.clientNumberRaw) || c.id} · ${c.date} ${c.time}`;
}

function rowTone(c: CallListItem): string {
  if (c.transferred) return 'xfer';
  if (c.status === 'busy' || c.status === 'no_answer' || c.status === 'failed') return 'miss';
  if (c.status !== 'answered') return 'lost';
  if (c.direction === 'outbound') return 'xfer';
  return '';
}

const ROW_TONES: Record<string, string> = {
  miss: 'bg-destructive/[0.06] [&>td:first-child]:shadow-[inset_3px_0_0_var(--destructive)]',
  lost: 'bg-warning/[0.07] [&>td:first-child]:shadow-[inset_3px_0_0_var(--warning)]',
  xfer: 'bg-primary/[0.06] [&>td:first-child]:shadow-[inset_3px_0_0_var(--primary)]',
};

/** Legacy `.recent-calls-table .btn` / `.btn.p`. */
export function TableButton({ primary, className, ...props }: React.ComponentProps<'button'> & { primary?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-[5px] whitespace-nowrap rounded-lg border border-border px-[11px] py-[5px] text-xs leading-[1.4] font-medium text-foreground transition-all hover:border-primary hover:bg-primary/10 hover:text-ink disabled:pointer-events-none disabled:opacity-40',
        primary && 'border-primary bg-primary font-semibold text-white hover:bg-primary hover:brightness-110',
        className,
      )}
      {...props}
    />
  );
}

function OperatorCell({ call, t }: { call: CallListItem; t: (k: string) => string }) {
  if (call.operators.length > 0) {
    return (
      <span className="font-semibold text-foreground">
        {call.operators.map((o, i) => (
          <span key={`${o.ext}-${i}`}>
            {i > 0 && <span className="px-1.5 text-muted-foreground">›</span>}
            {o.name ? `${o.name} (${o.ext})` : o.ext}
          </span>
        ))}
      </span>
    );
  }
  if (call.operator)
    return (
      <span className="font-semibold">
        {call.operator.name ? `${call.operator.name} (${call.operator.ext})` : call.operator.ext}
      </span>
    );
  const label = call.status === 'abandoned' ? t('queue') : call.direction === 'inbound' ? t('ivr') : '—';
  return <span className="text-muted-foreground">{label}</span>;
}

export interface CallHistoryTableProps {
  calls: CallListItem[];
  /** Number of the first row on this page (legacy № column). */
  firstRowNumber: number;
  /** Show the date above the time (range or all-days search). */
  showDate: boolean;
  columnVisibility: ColumnVisibility;
  onColumnVisibilityChange: (v: ColumnVisibility | ((prev: ColumnVisibility) => ColumnVisibility)) => void;
  onOpenDetails: (call: CallListItem) => void;
  canListen: boolean;
  /** Rendered instead of rows (loading / empty / error). */
  placeholder?: ReactNode;
}

/** Column ids in display order (labels: `callHistory:col.<id>`). `num` and `action` cannot be hidden. */
export const HISTORY_COLUMNS = [
  'num',
  'time',
  'phone',
  'operator',
  'dir',
  'dur',
  'wait',
  'status',
  'hangup',
  'host',
  'action',
] as const;
export const TOGGLEABLE_COLUMNS = HISTORY_COLUMNS.filter((c) => c !== 'num' && c !== 'action');

function useCallHistoryTable(props: CallHistoryTableProps) {
  const { t, i18n } = useTranslation('callHistory');
  const { t: tc } = useTranslation('call');
  const { firstRowNumber, showDate, onOpenDetails, canListen } = props;

  const columns = useMemo(
    () =>
      helper.columns([
        helper.display({
          id: 'num',
          header: () => t('col.num'),
          cell: ({ row }) => (
            <span className="text-xs font-semibold text-muted-foreground">{firstRowNumber + row.index}</span>
          ),
        }),
        helper.accessor('time', {
          id: 'time',
          header: () => t('col.time'),
          cell: ({ row: { original: c } }) =>
            showDate ? (
              <div>
                <div className="text-[11px] font-bold tracking-[0.3px] text-shade-chart-6">{c.date}</div>
                <div className="font-mono text-[11px] text-muted-foreground">{c.time}</div>
              </div>
            ) : (
              <span className="font-mono text-xs text-muted-foreground" title={`${c.date} ${c.time}`}>
                {c.time}
              </span>
            ),
        }),
        helper.accessor('clientNumber', {
          id: 'phone',
          header: () => t('col.phone'),
          cell: ({ row: { original: c } }) => (
            <div className="flex items-center gap-2">
              <DirectionMark call={c} />
              <span className="text-sm font-semibold tracking-[0.2px] text-ink">
                {c.clientNumber
                  ? c.clientNumber
                  : c.hiddenNumber && c.direction !== 'internal'
                    ? tc('hidden')
                    : (c.operators[1]?.ext ?? '—')}
              </span>
            </div>
          ),
        }),
        helper.display({
          id: 'operator',
          header: () => t('col.operator'),
          cell: ({ row }) => <OperatorCell call={row.original} t={t} />,
        }),
        helper.display({
          id: 'dir',
          header: () => t('col.direction'),
          cell: ({ row }) => <CallDirectionBadge call={row.original} />,
        }),
        helper.accessor('talkSec', {
          id: 'dur',
          header: () => t('col.duration'),
          cell: ({ row: { original: c } }) => (
            <span
              className={cn(
                'font-mono font-semibold',
                c.status === 'answered' ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {formatDuration(c.talkSec)}
            </span>
          ),
        }),
        helper.accessor('waitSec', {
          id: 'wait',
          header: () => t('col.wait'),
          cell: ({ row: { original: c } }) => {
            if (c.direction !== 'inbound' || c.waitSec === null)
              return (
                <span className="text-muted-foreground" title={t('waitNone')}>
                  —
                </span>
              );
            return (
              <span className={cn('font-mono font-semibold', c.waitSec > 0 ? 'text-warning' : 'text-muted-foreground')}>
                {formatDuration(c.waitSec)}
              </span>
            );
          },
        }),
        helper.display({
          id: 'status',
          header: () => t('col.status'),
          cell: ({ row }) => <CallStatusBadge call={row.original} />,
        }),
        helper.display({
          id: 'hangup',
          header: () => t('col.hangup'),
          // CDR has no hang-up side; the live module (AMI) will provide it (ROADMAP decision: unknown, not "client").
          cell: () => (
            <span className="text-xs text-muted-foreground" title={t('hangupUnknown')}>
              —
            </span>
          ),
        }),
        // Desktop-agent host name: comes with the agent module, not in CDR.
        helper.display({
          id: 'host',
          header: () => t('col.host'),
          cell: () => <span className="text-xs text-muted-foreground">—</span>,
        }),
        helper.display({
          id: 'action',
          header: () => t('col.action'),
          cell: ({ row: { original: c } }) => (
            <div className="flex items-center justify-end gap-1.5">
              <CreateTicketButton callId={c.id} variant="table" />
              {c.hasRecording ? (
                <>
                  {canListen && <CallRecordingButton uniqueid={c.id} label={recordingLabel(c)} />}
                  <TableButton onClick={() => onOpenDetails(c)}>
                    <Icon name="search-normal" className="size-3" /> {t('detail')}
                  </TableButton>
                </>
              ) : (
                <>
                  <TableButton disabled title={t('noAudioTitle')}>
                    <Icon name="close-circle" className="size-3" /> {t('noAudio')}
                  </TableButton>
                  <TableButton onClick={() => onOpenDetails(c)} aria-label={t('detail')}>
                    <Icon name="search-normal" className="size-3" />
                  </TableButton>
                </>
              )}
            </div>
          ),
        }),
      ]),
    // i18n.language: re-render headers on language switch
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [t, tc, i18n.language, firstRowNumber, showDate, onOpenDetails, canListen],
  );

  return useTable({
    features,
    columns,
    data: props.calls,
    getRowId: (c) => c.id,
    state: { columnVisibility: props.columnVisibility },
    onColumnVisibilityChange: props.onColumnVisibilityChange,
  });
}

export function CallHistoryTable(props: CallHistoryTableProps) {
  const table = useCallHistoryTable(props);
  const visibleCount = table.getVisibleLeafColumns().length;
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-tint/8">
      <table className="w-full min-w-[760px] border-collapse text-[13px]">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  className={cn(
                    'border-b border-tint/8 bg-secondary/70 px-3.5 py-3 text-[11px] font-bold tracking-[0.6px] whitespace-nowrap text-muted-foreground uppercase select-none',
                    ALIGN[header.column.id] ?? 'text-center',
                  )}
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {props.placeholder ? (
            <tr>
              <td colSpan={visibleCount} className="px-5 py-8 text-center whitespace-normal text-muted-foreground">
                {props.placeholder}
              </td>
            </tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onDoubleClick={() => props.onOpenDetails(row.original)}
                className={cn('transition-colors [&>td]:hover:bg-tint/[0.035]', ROW_TONES[rowTone(row.original)])}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cn(
                      'border-b border-tint/5 px-3.5 py-[14px] whitespace-nowrap tabular-nums text-foreground',
                      ALIGN[cell.column.id] ?? 'text-center',
                    )}
                  >
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
