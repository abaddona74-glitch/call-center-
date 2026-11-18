import type { OperatorStatsResponse } from '@cc/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDuration } from '@/entities/call';
import { cn } from '@/shared/lib/cn';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import { Segmented } from '@/shared/ui/segmented';
import { AXIS, GRID, TOOLTIP } from './chart-theme';
import { ChartLegend } from './ChartLegend';
import { DT } from './data-table-classes';
import '../i18n';

/** Colour of an average client rating (1–5). */
function surveyTone(avg: number): string {
  if (avg >= 4.5) return 'text-success';
  if (avg >= 3.5) return '';
  if (avg >= 2.5) return 'text-warning';
  return 'text-destructive';
}

/**
 * Per-operator distribution: legacy grouped bar chart (Qabul qilingan #10b981, Chiquvchi #38bdf8,
 * O'tkazib yuborilgan #f59e0b) + the table with the same columns as the Excel summary sheet,
 * plus the clients' post-call rating when the PBX survey is installed (`surveyAvailable`).
 */
export function OperatorsSection({ data }: { data: OperatorStatsResponse | undefined }) {
  const { t } = useTranslation('callStats');
  const [group, setGroup] = useState<string>('all');
  const rows = (data?.operators ?? []).filter((r) => group === 'all' || r.group === group);
  const groups = data?.groups ?? [];
  const columns = [
    ...(['operator', 'answered', 'transfer', 'outbound', 'missed', 'total', 'talk', 'avg'] as const),
    ...(data?.surveyAvailable ? (['survey'] as const) : []),
  ];
  const chartRows = rows
    .filter((r) => r.total + r.missed > 0)
    .map((r) => ({
      label: r.name ? `${r.name.split(' ')[0]} (${r.ext})` : r.ext,
      accepted: r.answered + r.transferredIn,
      outbound: r.outbound,
      missed: r.missed,
    }));

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('operators')}</PanelTitle>
        <Segmented
          size="xs"
          value={group}
          onChange={setGroup}
          options={[
            ...groups.map((g) => ({
              value: g.id,
              label: `${t(`groups.${g.id}`, { defaultValue: g.id })} (${g.from}–${g.to})`,
            })),
            { value: 'all', label: t('groups.all') },
          ]}
        />
      </PanelHeader>
      <ChartLegend
        items={[
          { name: t('series.accepted'), color: 'var(--chart-2)' },
          { name: t('series.outbound'), color: 'var(--chart-4)' },
          { name: t('series.missed'), color: 'var(--chart-5)' },
        ]}
      />
      <div className="mb-5 h-[280px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows} margin={{ top: 0, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...AXIS} interval={0} tick={{ ...AXIS.tick, fontSize: 11 }} />
            <YAxis allowDecimals={false} {...AXIS} />
            <Tooltip {...TOOLTIP} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="accepted" name={t('series.accepted')} fill="var(--chart-2)" radius={6} />
            <Bar dataKey="outbound" name={t('series.outbound')} fill="var(--chart-4)" radius={6} />
            <Bar dataKey="missed" name={t('series.missed')} fill="var(--chart-5)" radius={6} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className={DT.wrap}>
        <table className={DT.table}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} className={cn(DT.th, c === 'operator' && 'text-left')}>
                  {t(`opCol.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className={cn(DT.td, 'py-6 text-muted-foreground')}>
                  {t('empty')}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.ext} className={cn(DT.tr, r.total === 0 && 'opacity-55')}>
                  <td className={cn(DT.td, 'text-left font-semibold')}>
                    <span className="mr-2 inline-flex size-7 items-center justify-center rounded-lg bg-primary/15 text-[11px] font-bold text-primary">
                      {r.ext}
                    </span>
                    {r.name ?? `Operator ${r.ext}`}
                  </td>
                  <td className={cn(DT.td, 'font-semibold text-success')}>{r.answered}</td>
                  <td className={DT.td}>
                    {r.transferredIn} / {r.transferredOut}
                  </td>
                  <td className={DT.td}>
                    <span className="font-semibold text-chart-4">{r.outbound}</span>
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      ({r.outboundAttempts} {t('attemptsShort')})
                    </span>
                  </td>
                  <td className={cn(DT.td, r.missed > 0 ? 'text-warning' : 'text-muted-foreground')}>{r.missed}</td>
                  <td className={cn(DT.td, 'text-[15px] font-bold')}>{r.total}</td>
                  <td className={cn(DT.td, 'font-mono')}>{formatDuration(r.talkSec)}</td>
                  <td className={cn(DT.td, 'font-mono text-muted-foreground')}>{formatDuration(r.avgTalkSec)}</td>
                  {data?.surveyAvailable && (
                    <td className={DT.td}>
                      {r.surveyAvg === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          <span className={cn('font-semibold', surveyTone(r.surveyAvg))}>
                            ★ {r.surveyAvg.toFixed(1)}
                          </span>
                          <span className="ml-1 text-[11px] text-muted-foreground">
                            ({t('surveyVotes', { n: r.surveyCount })})
                          </span>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
