import { CALL_STATUSES, type CallListItem, hasRoleAtLeast } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { businessToday, calendarLabels, callHistoryQuery, type RangePresetId, rangePresets } from '@/entities/call';
import { useSessionUser } from '@/entities/session';
import { isHttpError } from '@/shared/api';
import { DateRangeModal } from '@/shared/ui/date-range-modal';
import { ModalButton } from '@/shared/ui/modal';
import { toDmy } from '@/shared/ui/range-calendar';
import { Icon } from '@/shared/ui/icon';
import { NativeSelect } from '@/shared/ui/native-select';
import { Pagination } from '@/shared/ui/pagination';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import { SearchBox } from '@/shared/ui/search-box';
import {
  CallDetailsDialog,
  CallHistoryTable,
  ColumnsMenu,
  usePersistedColumnVisibility,
} from '@/widgets/call-history-table';
import { HISTORY_PAGE_SIZE, type HistorySearch, historyParams } from '../model/search';
import '../i18n';

const route = getRouteApi('/_app/history');
const PRESETS: RangePresetId[] = ['today', 'week', 'month', 'prevMonth'];

/** "Qo'ng'iroqlar Tarixi" (legacy /history, server CDR source). */
export function HistoryPage() {
  const { t, i18n } = useTranslation('historyPage');
  const [rangeOpen, setRangeOpen] = useState(false);
  const { t: tc } = useTranslation('call');
  const user = useSessionUser();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const today = businessToday();
  const params = historyParams(search, today);
  const includesToday = !params.to || params.to >= today;
  const query = useQuery({
    ...callHistoryQuery(params),
    // legacy refreshed page 1 every 12 s while looking at today
    refetchInterval: includesToday && params.page === 1 ? 15_000 : false,
  });
  const [columns, setColumns] = usePersistedColumnVisibility();
  const [selected, setSelected] = useState<CallListItem | null>(null);

  // debounced search box → URL
  const [term, setTerm] = useState(search.search ?? '');
  useEffect(() => setTerm(search.search ?? ''), [search.search]);
  useEffect(() => {
    if (term === (search.search ?? '')) return;
    const id = setTimeout(
      () =>
        void navigate({ search: (s) => ({ ...s, search: term || undefined, page: undefined, allDays: undefined }) }),
      400,
    );
    return () => clearTimeout(id);
  }, [term, search.search, navigate]);

  const set = (patch: Partial<HistorySearch>) =>
    void navigate({ search: (s) => ({ ...s, ...patch, page: patch.page }) });
  const presets = rangePresets(today);
  const range = { from: params.from ?? today, to: params.to ?? today };
  const hasFilter = Boolean(
    search.status || search.direction || search.search || search.scope || search.from || search.to || search.allDays,
  );

  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / HISTORY_PAGE_SIZE)) : 1;
  const showDate = Boolean(data && (data.range.allDays || data.range.from !== data.range.to));

  let placeholder: React.ReactNode = null;
  if (query.isPending) {
    placeholder = (
      <div className="flex flex-col items-center gap-3 py-6">
        <div className="size-8 animate-spin rounded-full border-2 border-white/10 border-t-chart-4" />
        <div className="text-sm font-semibold tracking-[0.3px] text-muted-foreground">{t('callHistory:loading')}</div>
      </div>
    );
  } else if (query.isError) {
    placeholder = (
      <div className="text-destructive">
        {isHttpError(query.error, 503) ? t('callHistory:pbxDown') : t('callHistory:error')}
      </div>
    );
  } else if (data && data.items.length === 0) {
    placeholder =
      search.search && !search.allDays ? (
        <div className="flex flex-col items-center gap-1.5 py-4">
          <div className="text-2xl">🔍</div>
          <div className="text-sm font-semibold text-foreground">{t('notFoundForNumber')}</div>
          <div className="mb-2 text-xs">{t('notFoundHint')}</div>
          <button
            type="button"
            onClick={() => set({ allDays: true, from: undefined, to: undefined })}
            className="inline-flex items-center gap-1.5 rounded-md border border-chart-6/40 bg-chart-6/15 px-[18px] py-[7px] text-xs font-semibold text-chart-6"
          >
            ♾️ {t('searchAllDays')}
          </button>
        </div>
      ) : (
        t('callHistory:empty')
      );
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel className="relative z-10">
        <PanelHeader className="mb-0 flex-col items-start">
          <PanelTitle>
            <Icon name="clock" className="size-[18px] text-primary" />
            {t('title')}
          </PanelTitle>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setRangeOpen(true)}
              className="inline-flex h-8 items-center gap-[7px] rounded-lg border border-chart-6/40 bg-chart-6/15 px-3.5 text-xs font-semibold text-chart-4 transition-all hover:bg-chart-6/25"
            >
              <Icon name="calendar" className="size-[15px]" />
              {search.allDays && search.search
                ? t('allDaysLabel')
                : search.from || search.to
                  ? range.from === range.to
                    ? toDmy(range.from)
                    : `${toDmy(range.from)} — ${toDmy(range.to)}`
                  : t('range')}
            </button>
            <SearchBox
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="min-w-[220px]"
            />
            <NativeSelect
              aria-label={t('allStatuses')}
              value={search.status ?? 'all'}
              onChange={(e) =>
                set({ status: e.target.value === 'all' ? undefined : (e.target.value as HistorySearch['status']) })
              }
            >
              <option value="all">{t('allStatuses')}</option>
              <option value="answered" className="text-success">
                {t('answered')}
              </option>
              <option value="missed" className="text-destructive">
                {t('missed')}
              </option>
              {CALL_STATUSES.filter((s) => s !== 'answered').map((s) => (
                <option key={s} value={s}>
                  · {tc(`status.${s}`)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label={t('allDirections')}
              value={search.direction ?? 'all'}
              onChange={(e) =>
                set({
                  direction: e.target.value === 'all' ? undefined : (e.target.value as HistorySearch['direction']),
                })
              }
            >
              <option value="all">{t('allDirections')}</option>
              <option value="inbound" className="text-chart-4">
                {tc('direction.inbound')}
              </option>
              <option value="outbound" className="text-chart-3">
                {tc('direction.outbound')}
              </option>
              <option value="transfer" className="text-chart-4">
                {tc('direction.transfer')}
              </option>
              <option value="internal">{tc('direction.internal')}</option>
            </NativeSelect>
            <NativeSelect
              aria-label={t('scopeAll')}
              value={search.scope ?? 'all'}
              onChange={(e) => set({ scope: e.target.value === 'working' ? 'working' : undefined })}
            >
              <option value="all">{t('scopeAll')}</option>
              <option value="working">{t('scopeWorking')}</option>
            </NativeSelect>
            {hasFilter && (
              <button
                type="button"
                onClick={() => {
                  setTerm('');
                  void navigate({ search: {} });
                }}
                className="inline-flex h-8 items-center gap-[5px] rounded-lg border border-destructive/35 bg-destructive/15 px-2.5 text-[11px] font-semibold text-destructive transition-all hover:bg-destructive/25"
              >
                <Icon name="close" className="size-3.5" /> {t('clear')}
              </button>
            )}
            <ColumnsMenu visibility={columns} onChange={setColumns} />
          </div>
        </PanelHeader>
      </Panel>

      <Panel>
        <CallHistoryTable
          calls={data?.items ?? EMPTY}
          firstRowNumber={((params.page ?? 1) - 1) * HISTORY_PAGE_SIZE + 1}
          showDate={showDate}
          columnVisibility={columns}
          onColumnVisibilityChange={setColumns}
          onOpenDetails={setSelected}
          canListen={hasRoleAtLeast(user.role, 'admin')}
          placeholder={placeholder}
        />
        {data && data.total > 0 && (
          <Pagination
            page={params.page ?? 1}
            totalPages={totalPages}
            onPageChange={(page) => set({ page: page === 1 ? undefined : page })}
            summary={t('pageSummary', { page: params.page ?? 1, pages: totalPages, total: data.total })}
          />
        )}
      </Panel>

      <CallDetailsDialog call={selected} onClose={() => setSelected(null)} />

      <DateRangeModal
        open={rangeOpen}
        onOpenChange={setRangeOpen}
        initial={range}
        today={today}
        max={today}
        title={t('range')}
        subtitle={t('rangeSubtitle')}
        icon={<Icon name="calendar" className="size-5 text-white" />}
        presets={PRESETS.map((id) => ({ label: t(`presets.${id}`), ...presets[id] }))}
        labels={{
          quick: t('quick'),
          from: t('rangeFrom'),
          to: t('rangeTo'),
          summary: (r, days) => t('rangeSummary', { from: toDmy(r.from), to: toDmy(r.to), days }),
          monthNames: calendarLabels(i18n.language).months,
          weekdayNames: calendarLabels(i18n.language).weekdays,
        }}
      >
        {(r, valid) => (
          <>
            <ModalButton onClick={() => setRangeOpen(false)}>{t('cancel')}</ModalButton>
            {/* TODO(S5 recordings): "Ovozlarni yuklab olish (.zip)" for the chosen range belongs to the recordings module. */}
            <ModalButton
              tone="blueOutline"
              disabled={!valid}
              onClick={() => {
                set({ from: r.from, to: r.to, allDays: undefined });
                setRangeOpen(false);
              }}
            >
              <Icon name="calendar" className="size-4" /> {t('viewInTable')}
            </ModalButton>
          </>
        )}
      </DateRangeModal>
    </div>
  );
}

const EMPTY: CallListItem[] = [];
