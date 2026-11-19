import type { SituationHeldTicket, SituationWorker } from '@cc/shared';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAge } from '@/entities/situation';
import { STATUS_STRIPE, refName } from '@/entities/ticket';
import { cn } from '@/shared/lib/cn';
import { serverClockOffset } from '@/shared/lib/server-clock';
import { useNow } from '@/shared/lib/use-now';
import { DataTable, type DataTableColumn, dataTableColumns } from '@/shared/ui/data-table';
import { Icon } from '@/shared/ui/icon';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import '../i18n';

const col = dataTableColumns<SituationWorker>();

/** Seconds since an ISO time, on the server clock. */
function useAgeOf(): (iso: string) => number {
  const now = useNow();
  return (iso) => (now + serverClockOffset() - Date.parse(iso)) / 1000;
}

/**
 * "TK-123 · 2 kun" chip: status colour on the left edge, red when past its deadline. `compact` (the table) shows the
 * code only; the age stays in the tooltip and for screen readers.
 */
function TicketChip({ ticket, age, compact = false }: { ticket: SituationHeldTicket; age: string; compact?: boolean }) {
  const { t } = useTranslation('ticket');
  const { t: ts } = useTranslation('situationTickets');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-l-[3px] px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap',
        ticket.overdue ? 'border-danger/45 bg-danger/[0.06] text-danger-soft' : 'border-tint/10 bg-tint/5 text-ink-2',
      )}
      style={{ borderLeftColor: STATUS_STRIPE[ticket.status] }}
      title={`${ticket.code} · ${t(`status.${ticket.status}`)} · ${ts('workers.since', { age })}${ticket.overdue ? ` · ${ts('workers.overdueOne')}` : ''}`}
    >
      {ticket.overdue && <Icon name="timer" className="size-3" />}
      {ticket.code}
      <span className={cn(compact && 'sr-only', !ticket.overdue && 'text-ink-2')}>· {age}</span>
      {ticket.overdue && <span className="sr-only">({ts('workers.overdueOne')})</span>}
    </span>
  );
}

/**
 * "Who works on tickets": every executive ("Mas’ul") and anyone else holding tickets, with the tickets they hold now
 * (oldest first) and what they finished today. Ticket codes and ages only — no contents.
 */
export function TicketWorkers({ rows }: { rows: readonly SituationWorker[] | undefined }) {
  const { t, i18n } = useTranslation('situationTickets');
  const lang = i18n.language;
  const ageOf = useAgeOf();
  const columns = useMemo<DataTableColumn<SituationWorker>[]>(
    () => [
      col.accessor('username', {
        header: () => t('workers.name'),
        cell: ({ row }) => {
          const regions = row.original.regions.map((r) => refName(r, lang)).join(', ');
          return (
            <div className="max-w-[240px] min-w-[150px]">
              <div className="truncate font-semibold text-ink">{row.original.username}</div>
              <div className="truncate text-[11px] text-mute" title={regions}>
                {regions || t('workers.noRegions')}
              </div>
            </div>
          );
        },
      }),
      col.accessor('holding', {
        header: () => t('workers.holding'),
        cell: ({ row }) => {
          const w = row.original;
          if (w.holding === 0) return <span className="text-mute">0</span>;
          return (
            <div className="flex flex-col items-center leading-tight">
              <span className="text-lg font-bold text-ink">{w.holding}</span>
              {w.overdue > 0 && (
                <span className="max-w-[130px] text-center text-[11px] leading-tight font-semibold text-danger-soft">
                  {t('workers.overdue', { n: w.overdue })}
                </span>
              )}
            </div>
          );
        },
      }),
      col.display({
        id: 'oldest',
        header: () => t('workers.oldest'),
        cell: ({ row }) => {
          const oldest = row.original.tickets[0];
          if (!oldest) return <span className="text-xs text-mute">{t('workers.idle')}</span>;
          return (
            <div className="flex flex-col items-center gap-0.5 leading-tight">
              <span className={cn('font-mono text-xs font-semibold', oldest.overdue ? 'text-danger-soft' : 'text-ink')}>
                {oldest.code}
                {oldest.overdue && <span className="sr-only"> ({t('workers.overdueOne')})</span>}
              </span>
              <span
                className={cn(
                  'max-w-[150px] text-center text-[11px] leading-tight',
                  oldest.overdue ? 'text-danger-soft' : 'text-ink-2',
                )}
              >
                {t('workers.since', { age: formatAge(ageOf(oldest.since), lang) })}
              </span>
            </div>
          );
        },
      }),
      col.display({
        id: 'tickets',
        header: () => t('workers.tickets'),
        cell: ({ row }) => {
          const w = row.original;
          const rest = w.tickets.slice(1);
          if (rest.length === 0) return <span className="text-mute">—</span>;
          return (
            <div className="flex max-w-[300px] min-w-[150px] flex-wrap gap-1">
              {rest.map((tk) => (
                <TicketChip key={tk.id} ticket={tk} age={formatAge(ageOf(tk.since), lang)} compact />
              ))}
              {w.holding > w.tickets.length && (
                <span className="self-center text-[11px] text-mute">
                  {t('workers.more', { n: w.holding - w.tickets.length })}
                </span>
              )}
            </div>
          );
        },
      }),
      col.accessor('resolvedToday', {
        header: () => t('workers.resolvedToday'),
        cell: ({ getValue }) => (
          <span className={getValue() ? 'font-semibold text-positive' : 'text-mute'}>{getValue()}</span>
        ),
      }),
    ],
    [t, lang, ageOf],
  );

  return (
    <Panel>
      <PanelHeader className="mb-3.5">
        <div>
          <PanelTitle>
            <Icon name="user" className="size-[18px] text-primary" />
            {t('workers.title')}
            {rows && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-brand-soft">
                {rows.reduce((n, w) => n + w.holding, 0)}
              </span>
            )}
          </PanelTitle>
          <p className="mt-1 text-xs text-mute">{t('workers.subtitle')}</p>
        </div>
      </PanelHeader>
      {/* Phones: one card per person (a five-column table would scroll sideways); the table from md up. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {rows?.length === 0 && <li className="py-4 text-center text-xs text-mute">{t('workers.empty')}</li>}
        {rows?.map((w) => (
          <WorkerCard key={w.userId} worker={w} ageOf={ageOf} />
        ))}
      </ul>
      <DataTable
        variant="data"
        columns={columns}
        data={rows as SituationWorker[] | undefined}
        getRowId={(w) => String(w.userId)}
        loading={!rows}
        empty={t('workers.empty')}
        className="hidden max-h-[620px] overflow-y-auto md:block"
      />
    </Panel>
  );
}

function WorkerCard({ worker: w, ageOf }: { worker: SituationWorker; ageOf: (iso: string) => number }) {
  const { t, i18n } = useTranslation('situationTickets');
  const lang = i18n.language;
  const regions = w.regions.map((r) => refName(r, lang)).join(', ');
  return (
    <li className="rounded-xl border border-tint/8 bg-tint/[0.03] px-3.5 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">{w.username}</div>
          <div className="truncate text-[11px] text-mute">{regions || t('workers.noRegions')}</div>
        </div>
        <div className="text-right leading-tight">
          <div className={cn('text-lg font-bold', w.holding ? 'text-ink' : 'text-mute')}>{w.holding}</div>
          <div className="text-[11px] text-mute">{t('workers.holding')}</div>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {w.overdue > 0 && (
          <span className="font-semibold text-danger-soft">{t('workers.overdue', { n: w.overdue })}</span>
        )}
        <span className={w.resolvedToday ? 'text-positive' : 'text-mute'}>
          {t('workers.resolvedToday')}: {w.resolvedToday}
        </span>
      </div>
      {w.tickets.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {w.tickets.map((tk) => (
            <TicketChip key={tk.id} ticket={tk} age={formatAge(ageOf(tk.since), lang)} />
          ))}
          {w.holding > w.tickets.length && (
            <span className="self-center text-[11px] text-mute">
              {t('workers.more', { n: w.holding - w.tickets.length })}
            </span>
          )}
        </div>
      )}
    </li>
  );
}
