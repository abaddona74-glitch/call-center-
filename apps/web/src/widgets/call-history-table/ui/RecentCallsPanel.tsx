import { type CallListItem, canAccessCdr } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type CallHistoryParams, businessToday, callHistoryQuery } from '@/entities/call';
import { useSessionUser } from '@/entities/session';
import { isHttpError } from '@/shared/api';
import { Icon } from '@/shared/ui/icon';
import { Pagination } from '@/shared/ui/pagination';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import { SearchBox } from '@/shared/ui/search-box';
import { Segmented } from '@/shared/ui/segmented';
import { CallDetailsDialog } from './CallDetailsDialog';
import { CallHistoryTable, type ColumnVisibility } from './CallHistoryTable';
import '../i18n';

type Segment = 'all' | 'missed' | 'abandoned' | 'transfer';
const SEGMENTS: Segment[] = ['all', 'missed', 'abandoned', 'transfer'];
const SEGMENT_FILTER: Record<Segment, Pick<CallHistoryParams, 'status' | 'direction'>> = {
  all: {},
  missed: { status: 'missed' },
  abandoned: { status: 'abandoned' },
  transfer: { direction: 'transfer' },
};
const PAGE_SIZE = 20;
/** Legacy dashboard columns: time, number, operator, duration, wait, status, action. */
const COLUMNS: ColumnVisibility = { num: false, dir: false, hangup: false, host: false };
const noop = () => {};

/**
 * "So'nggi qo'ng'iroqlar" — today's calls under the operators board on the dashboard
 * (legacy index.html recent-calls table): segment filter, search by number or operator, details, listening.
 * Refreshed every 15 s while the first page is open (the CDR is the source, as on the History screen).
 */
export function RecentCallsPanel() {
  const { t } = useTranslation('recentCalls');
  const user = useSessionUser();
  const [segment, setSegment] = useState<Segment>('all');
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CallListItem | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(term.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(id);
  }, [term]);

  const today = businessToday();
  const params: CallHistoryParams = {
    from: today,
    to: today,
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    ...SEGMENT_FILTER[segment],
  };
  const query = useQuery({ ...callHistoryQuery(params), refetchInterval: page === 1 ? 15_000 : false });
  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  let placeholder: React.ReactNode = null;
  if (query.isPending) placeholder = t('callHistory:loading');
  else if (query.isError)
    placeholder = (
      <span className="text-destructive">
        {isHttpError(query.error, 503) ? t('callHistory:pbxDown') : t('callHistory:error')}
      </span>
    );
  else if (data && data.items.length === 0) placeholder = t('callHistory:empty');

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>
          <Icon name="clock" className="size-[18px] text-primary" />
          {t('title')}
        </PanelTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            value={segment}
            onChange={(s) => {
              setSegment(s);
              setPage(1);
            }}
            options={SEGMENTS.map((s) => ({ value: s, label: t(`segment.${s}`) }))}
          />
          <SearchBox
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="min-w-[200px]"
          />
        </div>
      </PanelHeader>
      <CallHistoryTable
        calls={data?.items ?? EMPTY}
        firstRowNumber={(page - 1) * PAGE_SIZE + 1}
        showDate={false}
        columnVisibility={COLUMNS}
        onColumnVisibilityChange={noop}
        onOpenDetails={setSelected}
        canListen={canAccessCdr(user, 'calls.recordings')}
        placeholder={placeholder}
      />
      {data && data.total > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          summary={t('total', { total: data.total })}
        />
      )}
      <CallDetailsDialog call={selected} onClose={() => setSelected(null)} />
    </Panel>
  );
}

const EMPTY: CallListItem[] = [];
