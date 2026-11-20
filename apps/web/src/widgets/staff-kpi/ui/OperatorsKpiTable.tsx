import type { KpiOperatorRow } from '@cc/shared';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '@/entities/call';
import { cn } from '@/shared/lib/cn';
import { NumberButton } from '@/shared/ui/number-button';
import {
  DANGER_TEXT,
  type KpiGroup,
  hoursAndMinutes,
  orLast,
  percentText,
  scoreClass,
  shareTone,
  surveyTone,
} from '../model/format';
import { type KpiDetailRequest, handledCount } from '../model/details';
import { type KpiColumn, type KpiGroupHeader, KpiTable, kpiColumns } from './KpiTable';
import '../i18n';

const col = kpiColumns<KpiOperatorRow>();

/** Which «Ko‘rinish» filter shows a column group (the client rating goes with the calls). */
const FILTER_OF: Record<string, KpiGroup> = {
  calls: 'calls',
  rating: 'calls',
  tickets: 'tickets',
  quality: 'quality',
  presence: 'presence',
};

/** An average score (1–`max`), coloured like «Tahlil»; one decimal. */
function Score({ value, max }: { value: number; max: number }) {
  const { i18n } = useTranslation();
  return (
    <span className={cn('font-mono font-semibold', scoreClass(value, max))}>
      {value.toLocaleString(i18n.language === 'ru' ? 'ru-RU' : 'uz-UZ', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })}
    </span>
  );
}

/** What a number of an operator row opens (the row adds the operator); null = nothing to open. */
type OperatorDetail =
  | Omit<Extract<KpiDetailRequest, { kind: 'calls' }>, 'ext' | 'name'>
  | Omit<Extract<KpiDetailRequest, { kind: 'operatorTickets' }>, 'ext' | 'name'>
  | null;

const calls = (metric: Extract<KpiDetailRequest, { kind: 'calls' }>['metric'], value?: number): OperatorDetail => ({
  kind: 'calls',
  metric,
  value,
});
const tickets = (
  metric: Extract<KpiDetailRequest, { kind: 'operatorTickets' }>['metric'],
  value: number,
): OperatorDetail => (value > 0 ? { kind: 'operatorTickets', metric, value } : null);

const Muted = ({ children }: { children?: React.ReactNode }) => <span className="text-mute">{children ?? '—'}</span>;

/**
 * Operators of the staff KPI page: one row per operator, the figures in five groups (calls, client rating, tickets
 * and callbacks, AI quality, online time). No composite score — sort by any column. `group` narrows the table to
 * one group (phones); with the presence group alone the pause reasons get their own column.
 */
export function OperatorsKpiTable({
  rows,
  group,
  surveyAvailable,
  loading,
  onOpen,
}: {
  rows: KpiOperatorRow[] | undefined;
  group: KpiGroup | 'all';
  surveyAvailable: boolean;
  loading?: boolean;
  /** Opens the records behind a number (keep it stable: the columns depend on it). */
  onOpen?: (request: KpiDetailRequest) => void;
}) {
  const { t, i18n } = useTranslation('staffKpi');
  const locale = i18n.language === 'ru' ? 'ru-RU' : 'uz-UZ';

  const groups = useMemo<KpiGroupHeader[]>(
    () => [
      { id: 'calls', label: t('groups.calls'), dot: 'bg-chart-2' },
      { id: 'rating', label: t('groups.rating'), dot: 'bg-chart-5' },
      { id: 'tickets', label: t('groups.tickets'), dot: 'bg-chart-6' },
      { id: 'quality', label: t('groups.quality'), dot: 'bg-chart-3' },
      { id: 'presence', label: t('groups.presence'), dot: 'bg-chart-4' },
    ],
    [t],
  );

  const columns = useMemo(() => {
    const reasonName = (r: string | null) => r ?? t('op.noReason');
    const hm = (sec: number) => t('op.hm', hoursAndMinutes(sec));
    const num = (
      id: string,
      groupId: string,
      value: (r: KpiOperatorRow) => number | null | undefined,
      render: (v: number, r: KpiOperatorRow) => React.ReactNode,
      opts: {
        groupStart?: boolean;
        /** The records behind the number (null: nothing to open, e.g. zero). */
        open?: (r: KpiOperatorRow, v: number) => OperatorDetail;
        /** How a screen reader reads the value (times, shares). */
        spoken?: (v: number) => string;
      } = {},
    ): KpiColumn<KpiOperatorRow> =>
      col.accessor((r) => orLast(value(r)), {
        id,
        header: () => t(`op.${id}`),
        sortFn: 'basic',
        sortUndefined: 'last',
        sortDescFirst: true,
        meta: { group: groupId, title: t(`op.${id}Title`), groupStart: opts.groupStart },
        cell: ({ row }) => {
          const r = row.original;
          const v = value(r);
          if (v === null || v === undefined) return <Muted />;
          const content = render(v, r);
          const detail = onOpen && v > 0 ? opts.open?.(r, v) : null;
          if (!detail) return content;
          const name = r.name ?? `Operator ${r.ext}`;
          return (
            <NumberButton
              label={`${name}, ${t(`op.${id}Title`)}`}
              value={opts.spoken?.(v) ?? v}
              onOpen={() => onOpen?.({ ...detail, ext: r.ext, name } as KpiDetailRequest)}
            >
              {content}
            </NumberButton>
          );
        },
      });
    const count = (tone?: (v: number) => string) => (v: number) => (
      <span className={cn(v === 0 ? 'text-mute' : (tone?.(v) ?? 'font-semibold text-ink'))}>{v}</span>
    );

    const all: KpiColumn<KpiOperatorRow>[] = [
      col.accessor('ext', {
        id: 'operator',
        header: () => t('op.operator'),
        sortFn: 'alphanumeric',
        meta: { sticky: true, title: t('op.operator') },
        cell: ({ row }) => (
          <div className="flex max-w-[150px] items-center gap-2 sm:max-w-[220px]">
            <span className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 px-1 text-[11px] font-bold text-ink">
              {row.original.ext}
            </span>
            <span className="truncate font-semibold text-ink" title={row.original.name ?? undefined}>
              {row.original.name ?? `Operator ${row.original.ext}`}
            </span>
          </div>
        ),
      }),
      // --- calls
      num(
        'answered',
        'calls',
        (r) => (r.calls ? r.calls.answered + r.calls.transferredIn : null),
        count(() => 'font-semibold text-positive'),
        { groupStart: true, open: (_r, v) => calls('answered', v) },
      ),
      num(
        'missed',
        'calls',
        (r) => r.calls?.missed,
        (v, r) => (
          <span
            title={t('op.missedSplit', { noAnswer: r.calls?.missedNoAnswer, rejected: r.calls?.missedRejected })}
            className={v ? 'text-caution' : 'text-mute'}
          >
            <span className="font-semibold">{v}</span>
            {v > 0 && (
              <span className="ml-1 text-[11px] text-mute">
                ({r.calls?.missedNoAnswer} / {r.calls?.missedRejected})
              </span>
            )}
          </span>
        ),
        { open: (_r, v) => calls('missed', v) },
      ),
      num(
        'outbound',
        'calls',
        (r) => r.calls?.outbound,
        (v, r) => (
          <span>
            <span className={cn('font-semibold', v ? 'text-shade-chart-4' : 'text-mute')}>{v}</span>
            {(r.calls?.outboundAttempts ?? 0) > v && (
              <span className="ml-1 text-[11px] text-mute">({r.calls?.outboundAttempts})</span>
            )}
          </span>
        ),
        { open: (_r, v) => calls('outbound', v) },
      ),
      num(
        'talk',
        'calls',
        (r) => r.calls?.talkSec,
        (v) => <span className={cn('font-mono', !v && 'text-mute')}>{v ? formatDuration(v) : '0:00'}</span>,
        { open: () => calls('talked'), spoken: formatDuration },
      ),
      num(
        'avgTalk',
        'calls',
        (r) => r.calls?.avgTalkSec,
        (v) => (
          <span className={cn('font-mono', v ? 'text-ink-2' : 'text-mute')}>{v ? formatDuration(v) : '0:00'}</span>
        ),
        { open: () => calls('talked'), spoken: formatDuration },
      ),
      // --- client rating
      num(
        'survey',
        'rating',
        (r) => r.survey.avg,
        (v, r) => (
          <span>
            <span className={cn('font-semibold', surveyTone(v))}>★ {v.toFixed(1)}</span>
            <span className="ml-1 text-[11px] text-mute">({t('op.surveyVotes', { n: r.survey.count })})</span>
          </span>
        ),
        { groupStart: true, open: (r) => calls('rated', r.survey.count) },
      ),
      // --- tickets
      num('created', 'tickets', (r) => r.tickets.created, count(), {
        groupStart: true,
        open: (_r, v) => tickets('created', v),
      }),
      num(
        'callbacks',
        'tickets',
        (r) => r.tickets.callbacks,
        (v, r) => (
          <span>
            {count()(v)}
            {r.tickets.callbackAttempts > v && (
              <span className="ml-1 text-[11px] text-mute" title={t('op.callbackAttemptsTitle')}>
                ({r.tickets.callbackAttempts})
              </span>
            )}
          </span>
        ),
        { open: (_r, v) => tickets('callbacks', v) },
      ),
      num(
        'closed',
        'tickets',
        (r) => r.tickets.closed,
        count(() => 'font-semibold text-positive'),
        { open: (_r, v) => tickets('closed', v) },
      ),
      num(
        'closedLate',
        'tickets',
        (r) => r.tickets.closedLate,
        count(() => `font-semibold ${DANGER_TEXT}`),
        { open: (_r, v) => tickets('closedLate', v) },
      ),
      // --- AI quality (current prompt version)
      num('analysed', 'quality', (r) => r.quality?.analysed, count(), {
        groupStart: true,
        open: (_r, v) => calls('analysed', v),
      }),
      num(
        'overall',
        'quality',
        (r) => r.quality?.avgOverall,
        (v) => <Score value={v} max={10} />,
        { open: (r) => calls('analysed', r.quality?.analysed) },
      ),
      ...(['politeness', 'understanding', 'solution', 'closing'] as const).map((k) =>
        num(
          k,
          'quality',
          (r) => r.quality?.avgScores[k],
          (v) => <Score value={v} max={5} />,
          { open: (r) => calls('analysed', r.quality?.analysed) },
        ),
      ),
      num(
        'redFlags',
        'quality',
        (r) => r.quality?.redFlagCalls,
        count(() => `font-semibold ${DANGER_TEXT}`),
        { open: (_r, v) => calls('flagged', v) },
      ),
      num(
        'handled',
        'quality',
        (r) => r.quality?.handledRate,
        (v) => <span className={shareTone(v)}>{percentText(v, locale)}</span>,
        {
          open: (r) => {
            const n = handledCount(r.quality?.handledRate ?? null, r.quality?.analysed ?? 0);
            return n > 0 ? calls('handled', n) : null;
          },
          spoken: (v) => percentText(v, locale) ?? '',
        },
      ),
      // --- online time
      num(
        'online',
        'presence',
        (r) => r.presence.onlineSec,
        (v) => <span className={cn(v ? 'font-semibold text-ink' : 'text-mute')}>{hm(v)}</span>,
        { groupStart: true },
      ),
      num(
        'pause',
        'presence',
        (r) => r.presence.pauseSec,
        (v, r) => {
          const top = r.presence.pauses[0];
          const list = r.presence.pauses.map((p) => `${reasonName(p.reason)} ${hm(p.sec)}`).join(', ');
          return (
            <div className="flex flex-col items-center leading-tight" title={list || undefined}>
              <span className={cn(v ? 'text-ink-2' : 'text-mute')}>{hm(v)}</span>
              {group !== 'presence' && top && (
                <span className="max-w-[140px] truncate text-[11px] text-mute">
                  {reasonName(top.reason)}
                  {r.presence.pauses.length > 1 ? ` +${r.presence.pauses.length - 1}` : ''}
                </span>
              )}
            </div>
          );
        },
      ),
      num(
        'talkShare',
        'presence',
        (r) => r.presence.talkShare,
        (v) => <span className="text-ink-2">{percentText(v, locale)}</span>,
      ),
      ...(group === 'presence'
        ? [
            col.display({
              id: 'pauses',
              header: () => t('op.pauses'),
              meta: { group: 'presence' },
              cell: ({ row }) =>
                row.original.presence.pauses.length ? (
                  <ul className="flex gap-1">
                    {row.original.presence.pauses.map((p) => (
                      <li
                        key={p.reason ?? ''}
                        className="rounded-md border border-tint/10 bg-tint/5 px-1.5 py-0.5 text-[11px] text-ink-2"
                      >
                        {reasonName(p.reason)} <span className="text-mute">{hm(p.sec)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Muted />
                ),
            }),
          ]
        : []),
    ];
    return all.filter((c) => {
      const g = c.meta?.group;
      if (g === 'rating' && !surveyAvailable) return false;
      return !g || group === 'all' || FILTER_OF[g] === group;
    });
  }, [t, locale, group, surveyAvailable, onOpen]);

  return (
    <KpiTable
      caption={t('op.caption')}
      columns={columns}
      groups={groups}
      data={rows}
      getRowId={(r) => r.ext}
      defaultSort={[{ id: 'operator', desc: false }]}
      loading={loading}
      empty={t('op.empty')}
    />
  );
}
