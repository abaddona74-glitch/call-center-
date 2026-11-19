import type { OverviewTicketList, OverviewTicketListItem } from '@cc/shared';
import { type QueryKey, type UseQueryOptions, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type TicketListParams, overviewTicketListQuery } from '@/entities/overview';
import { TicketStatusBadge } from '@/entities/ticket';
import { tashkentDateTime } from '@/shared/lib/tashkent-time';
import { DataTable, type DataTableColumn, dataTableColumns } from '@/shared/ui/data-table';
import { Icon } from '@/shared/ui/icon';
import { MetricNote, TitleValue } from '@/shared/ui/metric-note';
import { Modal, ModalHeader } from '@/shared/ui/modal';
import { Pagination } from '@/shared/ui/pagination';
import { SearchBox } from '@/shared/ui/search-box';
import { listDateTime, overdueParts } from '../model/format';
import '../i18n';

const PAGE_SIZE = 25;
const col = dataTableColumns<OverviewTicketListItem>();

/** What the dialog shows: the number's title, how it is calculated, and the list filters (same as the number). */
export type TicketListDialogView = {
  /** Stable per number: the dialog starts over (page 1, no search) when another one opens. */
  id: string;
  title: string;
  /** One line: how the number is calculated (METRICS.md §9.1). */
  definition: string;
  /** The number clicked. */
  value: number;
} & (
  | { params: Omit<TicketListParams, 'page' | 'pageSize' | 'search'>; list?: undefined }
  | {
      params?: undefined;
      /**
       * Where the pages come from instead of `/overview/tickets/list` — another page's list of the same shape (the
       * staff KPI page: `/kpi/operators/tickets`, `/kpi/executives/tickets`).
       */
      list: (p: { page: number; pageSize: number; search?: string }) => TicketListQueryOptions;
    }
);

/** Query options of a ticket list page (any query key), e.g. `asTicketListQuery(queryOptions({...}))`. */
export type TicketListQueryOptions = UseQueryOptions<OverviewTicketList, Error, OverviewTicketList, QueryKey>;
export const asTicketListQuery = (options: { queryKey: QueryKey }): TicketListQueryOptions =>
  options as unknown as TicketListQueryOptions;

/**
 * The tickets behind a ticket number of the overview dashboard: definition line, search, pages; a ticket number
 * opens its read-only card (`onOpenTicket`, the page renders it). The total equals the number clicked.
 */
export function TicketListDialog({
  view,
  onClose,
  onOpenTicket,
}: {
  view: TicketListDialogView | null;
  onClose: () => void;
  onOpenTicket: (id: number) => void;
}) {
  // Keep the last view on screen while the close animation runs.
  const [shown, setShown] = useState<TicketListDialogView | null>(view);
  if (view && view !== shown) setShown(view);
  return (
    <Modal
      open={view !== null}
      onOpenChange={(open) => !open && onClose()}
      glow="indigo"
      className="max-w-[1180px] sm:px-7"
    >
      {shown && <Body key={shown.id} view={shown} onOpenTicket={onOpenTicket} />}
    </Modal>
  );
}

function Body({ view, onOpenTicket }: { view: TicketListDialogView; onOpenTicket: (id: number) => void }) {
  const { t, i18n } = useTranslation('ticketOverview');
  const ru = i18n.language === 'ru';
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(term.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(id);
  }, [term]);

  const pageParams = { page, pageSize: PAGE_SIZE, search: search || undefined };
  const query = useQuery(
    view.list === undefined
      ? asTicketListQuery(overviewTicketListQuery({ ...view.params, ...pageParams }))
      : view.list(pageParams),
  );
  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const columns = useMemo<DataTableColumn<OverviewTicketListItem>[]>(() => {
    const late = (hours: number | null) => {
      const p = overdueParts(hours);
      if (!p) return <span className="text-mute">—</span>;
      return (
        <span className="font-semibold text-danger">
          +{p.unit === 'days' ? t('list.days', { n: p.n }) : t('list.hours', { n: p.n })}
        </span>
      );
    };
    return [
      col.accessor('code', {
        header: () => t('list.code'),
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => onOpenTicket(row.original.id)}
            aria-haspopup="dialog"
            aria-label={t('list.open', { code: row.original.code })}
            className="cursor-pointer rounded-sm font-mono font-bold text-info underline-offset-[3px] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
          >
            {row.original.code}
          </button>
        ),
      }),
      col.accessor('createdAt', {
        header: () => t('list.created'),
        cell: ({ getValue }) => <span className="text-xs">{listDateTime(getValue(), tashkentDateTime)}</span>,
      }),
      col.accessor('regionNameUz', {
        header: () => t('list.region'),
        cell: ({ row }) => (
          <span className="block max-w-[170px] truncate text-left text-xs">
            {ru ? row.original.regionNameRu : row.original.regionNameUz}
          </span>
        ),
      }),
      col.accessor('executive', {
        header: () => t('list.executive'),
        cell: ({ getValue }) => (
          <span className="block max-w-[170px] truncate text-left text-xs">
            {getValue() ?? <span className="text-mute">{t('list.queue')}</span>}
          </span>
        ),
      }),
      col.accessor('status', {
        header: () => t('list.status'),
        cell: ({ getValue }) => <TicketStatusBadge status={getValue()} />,
      }),
      col.accessor('dueAt', {
        header: () => t('list.due'),
        cell: ({ getValue }) => <span className="text-xs">{listDateTime(getValue(), tashkentDateTime)}</span>,
      }),
      col.accessor('overdueHours', {
        header: () => t('list.overdueBy'),
        cell: ({ getValue }) => late(getValue()),
      }),
      col.accessor('closedAt', {
        header: () => t('list.closed'),
        cell: ({ getValue }) => <span className="text-xs">{listDateTime(getValue(), tashkentDateTime)}</span>,
      }),
    ];
  }, [t, ru, onOpenTicket]);

  return (
    <>
      <ModalHeader
        icon={<Icon name="clipboard-text" className="size-5 text-primary" />}
        title={<TitleValue title={view.title} value={view.value} />}
        subtitle={t('list.subtitle')}
      />
      <MetricNote>{view.definition}</MetricNote>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {/* Announced after a search; with pages the total is next to them. */}
        <span role="status" className="text-xs text-mute">
          {data && data.total <= PAGE_SIZE ? t('list.total', { n: data.total }) : ''}
        </span>
        <SearchBox
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t('list.searchPlaceholder')}
          aria-label={t('list.search')}
          className="w-full sm:w-[340px]"
        />
      </div>
      <DataTable
        variant="data"
        columns={columns}
        data={data?.items}
        getRowId={(r) => String(r.id)}
        loading={query.isPending}
        empty={query.isError ? <span className="text-destructive">{t('list.error')}</span> : t('list.empty')}
        className="max-h-[60svh] overflow-y-auto"
      />
      {data && data.total > PAGE_SIZE && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          summary={t('list.total', { n: data.total })}
        />
      )}
    </>
  );
}
