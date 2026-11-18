import type { StatsSummary } from '@cc/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/entities/call';
import { cn } from '@/shared/lib/cn';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import '../i18n';

const R = 15.915; // circumference = 100, so dash lengths are percentages (legacy dist2DSvg)

/** Legacy 2D distribution donut (custom SVG + legend with % and value), fed with CDR outcomes. */
export function DistributionDonut({ summary }: { summary: StatsSummary | undefined }) {
  const { t, i18n } = useTranslation('callStats');
  const [focus, setFocus] = useState<number | null>(null);
  const s = summary;
  const slices = [
    { label: t('slices.answered'), value: s?.inbound.answered ?? 0, color: 'var(--chart-2)' },
    { label: t('slices.abandoned'), value: s?.inbound.abandoned ?? 0, color: 'var(--chart-5)' },
    {
      label: t('slices.notReached'),
      value: (s?.inbound.ivr ?? 0) + (s?.inbound.afterHours ?? 0),
      color: 'var(--chart-8)',
    },
    { label: t('slices.outboundConnected'), value: s?.outbound.connected ?? 0, color: 'var(--chart-3)' },
    { label: t('slices.outboundFailed'), value: s?.outbound.notConnected ?? 0, color: 'var(--chart-4)' },
  ];
  const total = slices.reduce((a, x) => a + x.value, 0);
  let offset = 25; // start at 12 o'clock
  const n = (v: number) => formatNumber(v, i18n.language === 'ru' ? 'ru-RU' : 'uz-UZ');

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{t('distribution')}</PanelTitle>
      </PanelHeader>
      <div className="flex h-[280px] items-center justify-center">
        <div className="flex w-full max-w-[520px] flex-wrap items-center justify-center gap-6">
          <svg
            viewBox="0 0 42 42"
            className="size-[170px] flex-none overflow-visible"
            role="img"
            aria-label={t('distribution')}
          >
            <circle cx="21" cy="21" r={R} fill="none" stroke="color-mix(in srgb, var(--tint) 6%, transparent)" strokeWidth="4.8" />
            {slices.map((x, i) => {
              const pct = total ? (x.value / total) * 100 : 0;
              const el = (
                <circle
                  key={i}
                  cx="21"
                  cy="21"
                  r={R}
                  fill="none"
                  stroke={x.color}
                  strokeWidth={focus === i ? 6 : 4.8}
                  strokeDasharray={`${pct} ${100 - pct}`}
                  strokeDashoffset={offset}
                  className="transition-[stroke-width,opacity] duration-200"
                  opacity={focus === null || focus === i ? 1 : 0.35}
                  onMouseEnter={() => setFocus(i)}
                  onMouseLeave={() => setFocus(null)}
                />
              );
              offset -= pct;
              return el;
            })}
            <text x="21" y="21.5" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="var(--ink)">
              {n(total)}
            </text>
            <text x="21" y="26.2" fontSize="2.7" fontWeight="500" textAnchor="middle" fill="var(--muted-foreground)">
              {t('totalCalls')}
            </text>
          </svg>
          <ul className="m-0 min-w-[190px] flex-1 list-none p-0">
            {slices.map((x, i) => (
              <li
                key={i}
                onMouseEnter={() => setFocus(i)}
                onMouseLeave={() => setFocus(null)}
                className={cn(
                  'flex items-center gap-2 py-[4.5px] text-[12.5px]',
                  i > 0 && 'border-t border-tint/8',
                  focus === i && 'text-ink',
                )}
              >
                <i className="size-2.5 shrink-0 rounded-[3px]" style={{ background: x.color }} />
                <span className="flex-1 text-foreground/85">{x.label}</span>
                <span className="w-[50px] text-right text-muted-foreground tabular-nums">
                  {total ? ((x.value / total) * 100).toFixed(1) : '0.0'}%
                </span>
                <b className="w-10 text-right text-ink tabular-nums">{n(x.value)}</b>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
