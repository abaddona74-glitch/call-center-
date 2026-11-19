import { type CallListItem, canAccessCdr } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type CallListDialogProps, type CallListView, businessToday, callHistoryQuery } from '@/entities/call';
import { useSessionUser } from '@/entities/session';
import { isHttpError } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { Modal, ModalHeader } from '@/shared/ui/modal';
import { Pagination } from '@/shared/ui/pagination';
import { SearchBox } from '@/shared/ui/search-box';
import { Segmented } from '@/shared/ui/segmented';
import { CallDetailsDialog } from './CallDetailsDialog';
import { CallHistoryTable, type ColumnVisibility } from './CallHistoryTable';
import '../i18n';

const PAGE_SIZE = 25;
const noop = () => {};
const EMPTY: CallListItem[] = [];

/**
 * Today's calls behind a dashboard KPI card (legacy `openCallsDetail` modal): tabs, per-operator chips, search,
 * pages, call details and listening. Refreshed every 15 s while the first page is open, like "So'nggi qo'ng'iroqlar".
 */
export function CallListDialog({ view, onClose }: CallListDialogProps) {
  // Keep the last view on screen while the close animation runs.
  const [shown, setShown] = useState<CallListView | null>(view);
  if (view && view !== shown) setShown(view);
  return (
    <Modal
      open={view !== null}
      onOpenChange={(open) => !open && onClose()}
      glow="indigo"
      className="max-w-[1320px] sm:px-7"
    >
      {shown && <CallListBody key={shown.id} view={shown} />}
    </Modal>
  );
}

function CallListBody({ view }: { view: CallListView }) {
  const { t } = useTranslation('callList');
  const { t: th } = useTranslation('callHistory');
  const user = useSessionUser();
  const canListen = canAccessCdr(user, 'calls.recordings');
  const [tabId, setTabId] = useState(view.tabs[0]?.id ?? '');
  const [operator, setOperator] = useState<string | null>(null);
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

  const pickOperator = (ext: string | null) => {
    setOperator(ext);
    setPage(1);
  };
  const tab = view.tabs.find((x) => x.id === tabId) ?? view.tabs[0];
  const today = businessToday();
  const query = useQuery({
    ...callHistoryQuery({
      from: today,
      to: today,
      page,
      pageSize: PAGE_SIZE,
      search: search || undefined,
      ...tab?.filter,
      ...(operator ? { operator } : {}),
    }),
    refetchInterval: page === 1 ? 15_000 : false,
  });
  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const columns: ColumnVisibility = { missedBy: Boolean(view.showMissedBy), hangup: false, host: false };

  let placeholder: React.ReactNode = null;
  if (query.isPending) placeholder = th('loading');
  else if (query.isError)
    placeholder = (
      <span className="text-destructive">{isHttpError(query.error, 503) ? th('pbxDown') : th('error')}</span>
    );
  else if (data && data.items.length === 0) placeholder = th('empty');

  return (
    <>
      <ModalHeader
        icon={<Icon name={view.icon} className="size-5 text-primary" />}
        title={view.title}
        subtitle={t('subtitle')}
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {view.tabs.length > 1 ? (
          <Segmented
            value={tab?.id ?? ''}
            onChange={(id) => {
              setTabId(id);
              setPage(1);
            }}
            options={view.tabs.map((x) => ({
              value: x.id,
              label:
                x.count === undefined ? (
                  x.label
                ) : (
                  <>
                    {x.label} <b className="ml-1 tabular-nums">{x.count}</b>
                  </>
                ),
            }))}
          />
        ) : (
          <span />
        )}
        <SearchBox
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('search')}
          className="min-w-[220px]"
        />
      </div>

      {view.note && <p className="mb-3 text-xs text-mute">{view.note}</p>}

      {view.operators && view.operators.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={th('col.operator')}>
          <Chip active={operator === null} onClick={() => pickOperator(null)}>
            {t('allOperators')}
          </Chip>
          {view.operators.map((o) => (
            <Chip
              key={o.ext}
              active={operator === o.ext}
              onClick={() => pickOperator(operator === o.ext ? null : o.ext)}
            >
              {o.name} <span className="text-mute">({o.ext})</span>
              <b className="ml-1.5 tabular-nums text-info">{o.count}</b>
            </Chip>
          ))}
        </div>
      )}

      <CallHistoryTable
        calls={data?.items ?? EMPTY}
        firstRowNumber={(page - 1) * PAGE_SIZE + 1}
        showDate={false}
        columnVisibility={columns}
        onColumnVisibilityChange={noop}
        onOpenDetails={setSelected}
        canListen={canListen}
        placeholder={placeholder}
        operatorNames={view.operatorNames}
      />
      {data && data.total > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          summary={t('total', { total: data.total })}
        />
      )}
      <CallDetailsDialog call={selected} onClose={() => setSelected(null)} canListen={canListen} />
    </>
  );
}

/** Legacy operator summary pill (`renderOperatorSummaryPill`): click to narrow the list. */
function Chip({ active, className, ...props }: React.ComponentProps<'button'> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
        active
          ? 'border-primary/60 bg-primary/15 text-ink shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_35%,transparent)]'
          : 'border-tint/10 bg-tint/5 text-ink-2 hover:bg-tint/10',
        className,
      )}
      {...props}
    />
  );
}
