import type { DailyPoint, HourlyPoint } from '@cc/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import { Segmented } from '@/shared/ui/segmented';
import { AXIS, GRID, TOOLTIP } from './chart-theme';
import { ChartLegend } from './ChartLegend';
import '../i18n';

type View = 'hour' | 'day';

/**
 * "Qo'ng'iroqlar Dinamikasi": legacy filled line chart (Jami Kiruvchi #6366f1, Javob berilgan #10b981, tension .35).
 * For a multi-day period it can also show the daily trend (legacy topic trend: areaspline ↔ column).
 */
export function CallDynamicsChart({ hourly, daily }: { hourly: HourlyPoint[]; daily: DailyPoint[] }) {
  const { t } = useTranslation('callStats');
  const [view, setView] = useState<View>(daily.length > 1 ? 'day' : 'hour');
  const [kind, setKind] = useState<'line' | 'column'>('line');
  const multiDay = daily.length > 1;
  const effective: View = multiDay ? view : 'hour';
  const data: { label: string; inbound: number; answered: number }[] =
    effective === 'hour'
      ? hourly.map((p) => ({
          label: `${String(p.hour).padStart(2, '0')}:00`,
          inbound: p.inbound,
          answered: p.answered,
        }))
      : daily.map((p) => ({
          label: `${p.date.slice(8)}.${p.date.slice(5, 7)}`,
          inbound: p.inbound,
          answered: p.answered,
        }));
  const series = [
    { key: 'inbound', name: t('series.inbound'), color: 'var(--chart-1)' },
    { key: 'answered', name: t('series.answered'), color: 'var(--chart-2)' },
  ];
  const fmt = (v: unknown, name: unknown) => [`${String(v)} ta`, String(name)] as [string, string];

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('dynamics')}</PanelTitle>
        <div className="flex items-center gap-1.5">
          {multiDay && (
            <Segmented
              size="xs"
              value={view}
              onChange={setView}
              options={[
                { value: 'hour', label: t('byHour') },
                { value: 'day', label: t('byDay') },
              ]}
            />
          )}
          {effective === 'day' && (
            <Segmented
              size="xs"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'line', label: t('line') },
                { value: 'column', label: t('column') },
              ]}
            />
          )}
        </div>
      </PanelHeader>
      <ChartLegend items={series.map((s) => ({ name: s.name, color: s.color }))} />
      <div className="h-[280px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          {effective === 'day' && kind === 'column' ? (
            <BarChart data={data} margin={{ top: 0, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" {...AXIS} />
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip
                {...TOOLTIP}
                formatter={fmt}
                cursor={{ fill: 'color-mix(in srgb, var(--tint) 4%, transparent)' }}
              />
              {series.map((s) => (
                <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[6, 6, 0, 0]} />
              ))}
            </BarChart>
          ) : (
            <AreaChart data={data} margin={{ top: 0, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" {...AXIS} />
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip {...TOOLTIP} formatter={fmt} />
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={s.color}
                  fillOpacity={0.15}
                  dot={false}
                  activeDot={{ r: 6, fill: s.color, stroke: '#ffffff', strokeWidth: 2 }}
                />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
