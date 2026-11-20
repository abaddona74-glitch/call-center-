import type { OverviewRegionRow } from '@cc/shared';
import { type KeyboardEvent, type PointerEvent, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import geo from '../model/uz-regions.json';
import { type MapMetric, binFill, binLabels, binOf, metricValue, thresholdsFor } from '../model/scale';
import '../i18n';

interface RegionShape {
  code: string;
  d: string;
  label: [number, number];
}
const MAP = geo as unknown as { viewBox: string; regions: RegionShape[] };
const CITY = 'toshkent-shahri';
/** Label nudges (viewBox units) where the inner point sits awkwardly for text. */
const LABEL_SHIFT: Record<string, [number, number]> = {
  'toshkent-viloyati': [30, -54],
  namangan: [-4, -8],
  fargona: [-6, 12],
  sirdaryo: [-8, 10],
  andijon: [-6, 0],
};
/** Tashkent city is a few pixels wide: a round marker makes it visible and clickable. */
const CITY_RADIUS = 15;
/** Region borders: a tint of the ink colour, so the shapes stand out from the panel even in the lightest step. */
const BORDER = 'color-mix(in oklab, var(--tint) 30%, var(--muted))';

interface Tip {
  code: string;
  x: number;
  y: number;
}

/**
 * Choropleth of Uzbekistan's 14 regions (Natural Earth admin-1, simplified; bundled, no tiles or CDNs).
 * One hue per metric, five steps mixed into the panel surface (works in both themes); a region without tickets
 * stays neutral. Hover / focus shows the figures, click (or Enter) filters the page by the region.
 */
export function RegionMap({
  rows,
  metric,
  selected,
  onSelect,
}: {
  rows: readonly OverviewRegionRow[];
  metric: MapMetric;
  /** Region code the page is filtered by. */
  selected: string | null;
  onSelect: (code: string | null) => void;
}) {
  const { t, i18n } = useTranslation('regionMap');
  const ru = i18n.language === 'ru';
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const tipId = useId();

  const byCode = useMemo(() => new Map(rows.filter((r) => r.code).map((r) => [r.code as string, r])), [rows]);
  const values = useMemo(
    () => MAP.regions.map((s) => (byCode.get(s.code) ? metricValue(byCode.get(s.code)!, metric) : null)),
    [byCode, metric],
  );
  const thresholds = useMemo(() => thresholdsFor(metric, values), [metric, values]);
  const labels = binLabels(metric, thresholds);
  const [vbW, vbH] = MAP.viewBox.split(' ').slice(2).map(Number);

  const format = (v: number | null) => (v === null ? '—' : metric === 'overdueShare' ? `${v}%` : String(v));
  const fillOf = (code: string) => {
    const row = byCode.get(code);
    return binFill(metric, row ? binOf(metricValue(row, metric), metric, thresholds) : null, labels.length);
  };
  const toggle = (code: string) => onSelect(selected === code ? null : code);
  const tipAtPointer = (code: string) => (e: PointerEvent<SVGElement>) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setTip({ code, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const tipAtLabel = (s: RegionShape) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setTip({ code: s.code, x: (s.label[0] / vbW) * r.width, y: (s.label[1] / vbH) * r.height });
  };
  const onKey = (code: string) => (e: KeyboardEvent<SVGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(code);
    } else if (e.key === 'Escape') {
      setTip(null); // the tooltip can be dismissed without moving focus (WCAG 1.4.13)
    }
  };
  const regionProps = (s: RegionShape) => {
    const row = byCode.get(s.code);
    const name = row ? (ru ? row.nameRu : row.nameUz) : t(`short.${s.code}`);
    return {
      role: 'button',
      tabIndex: 0,
      'aria-label': `${name}: ${t(`metric.${metric}`)} ${format(row ? metricValue(row, metric) : null)}`,
      'aria-pressed': selected === s.code,
      'aria-describedby': tip?.code === s.code ? tipId : undefined,
      className:
        'cursor-pointer outline-none transition-[opacity] duration-150 focus-visible:[stroke-width:7] focus-visible:[stroke:var(--primary)]',
      onClick: () => toggle(s.code),
      onKeyDown: onKey(s.code),
      onPointerMove: tipAtPointer(s.code),
      onPointerLeave: () => setTip(null),
      onFocus: () => tipAtLabel(s),
      onBlur: () => setTip(null),
    };
  };

  // Regions keep a fixed DOM (= Tab) order; the selected outline is drawn on top by a separate, inert copy.
  const city = MAP.regions.find((s) => s.code === CITY);
  const selectedShape = selected && selected !== CITY ? MAP.regions.find((s) => s.code === selected) : undefined;
  const tipRow = tip ? byCode.get(tip.code) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div ref={box} className="relative">
        <svg
          viewBox={MAP.viewBox}
          role="group"
          aria-label={t('mapLabel')}
          className="block h-auto w-full select-none"
          onPointerLeave={() => setTip(null)}
        >
          {MAP.regions.map((s) => (
            <path
              key={s.code}
              d={s.d}
              fillRule="evenodd"
              fill={fillOf(s.code)}
              stroke={BORDER}
              strokeWidth={1.6}
              strokeLinejoin="round"
              opacity={selected && selected !== s.code ? 0.55 : 1}
              {...regionProps(s)}
            />
          ))}
          {selectedShape && (
            <path
              d={selectedShape.d}
              fillRule="evenodd"
              fill="none"
              stroke="var(--primary)"
              strokeWidth={5}
              strokeLinejoin="round"
              className="pointer-events-none"
              aria-hidden="true"
            />
          )}
          {city && (
            <circle
              cx={city.label[0]}
              cy={city.label[1]}
              r={CITY_RADIUS}
              fill={fillOf(CITY)}
              stroke={selected === CITY ? 'var(--primary)' : 'var(--ink-2)'}
              strokeWidth={selected === CITY ? 5 : 2}
              opacity={selected && selected !== CITY ? 0.55 : 1}
              {...regionProps(city)}
            />
          )}
          {/* Labels: value (bold) and short name; pointer events go to the regions underneath. */}
          <g className="pointer-events-none" style={{ paintOrder: 'stroke' }} aria-hidden="true">
            {MAP.regions.map((s) => {
              const row = byCode.get(s.code);
              const isCity = s.code === CITY;
              const [dx, dy] = LABEL_SHIFT[s.code] ?? [0, 0];
              const x = isCity ? s.label[0] - CITY_RADIUS - 8 : s.label[0] + dx;
              const y = isCity ? s.label[1] - CITY_RADIUS - 6 : s.label[1] + dy;
              return (
                <text
                  key={s.code}
                  x={x}
                  y={y}
                  textAnchor={isCity ? 'end' : 'middle'}
                  stroke="var(--muted)"
                  strokeWidth={5}
                  strokeLinejoin="round"
                  opacity={selected && selected !== s.code ? 0.6 : 1}
                >
                  <tspan x={x} dy="-0.2em" className="fill-ink-2 text-[19px] font-semibold max-sm:hidden">
                    {t(`short.${s.code}`)}
                  </tspan>
                  <tspan x={x} dy="1.15em" className="fill-ink text-[26px] font-extrabold max-sm:text-[34px]">
                    {format(row ? metricValue(row, metric) : null)}
                  </tspan>
                </text>
              );
            })}
          </g>
        </svg>

        {tip && (
          <div
            id={tipId}
            role="tooltip"
            className="pointer-events-none absolute z-20 w-[230px] rounded-xl border border-tint/10 bg-glass/95 px-3.5 py-3 text-xs shadow-[0_10px_30px_color-mix(in_srgb,var(--shadow-color)_45%,transparent)] backdrop-blur"
            style={{
              left: Math.min(Math.max(tip.x + 14, 4), (box.current?.clientWidth ?? 0) - 236),
              top: Math.max(tip.y - 20, 4),
            }}
          >
            <div className="mb-2 text-[13px] font-bold text-ink">
              {tipRow ? (ru ? tipRow.nameRu : tipRow.nameUz) : t(`short.${tip.code}`)}
            </div>
            {tipRow ? <TipRows row={tipRow} /> : <div className="text-mute">{t('legendNone')}</div>}
            <div className="mt-2 text-[10.5px] text-mute">
              {selected === tip.code ? t('tooltip.clickToClear') : t('tooltip.clickToFilter')}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-mute">
        <span className="font-semibold text-ink-2">{t(`metric.${metric}`)}</span>
        {labels.map((label, i) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span
              className="size-3 rounded-[3px] border border-tint/10"
              style={{ background: binFill(metric, i, labels.length) }}
            />
            <span className="tabular-nums">{label}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-[3px] border border-tint/15" style={{ background: binFill(metric, null) }} />
          {t('legendZero')}
        </span>
        <span className="ml-auto text-[10px] text-mute">{t('attribution')}</span>
      </div>
    </div>
  );
}

function TipRows({ row }: { row: OverviewRegionRow }) {
  const { t } = useTranslation('regionMap');
  const share = metricValue(row, 'overdueShare');
  const items: [string, string, string?][] = [
    // The regions table's columns (owner, 20.11.2026), then the region's Mas'ul count and average time.
    [t('tooltip.received'), String(row.received)],
    [t('tooltip.inWork'), String(row.inWork)],
    [t('tooltip.done'), String(row.done)],
    [t('tooltip.rejected'), String(row.rejected)],
    [t('tooltip.overdue'), `${row.overdue}${share === null ? '' : ` · ${share}%`}`, row.overdue ? 'text-danger' : ''],
    [t('tooltip.executives'), String(row.executives)],
    [
      t('tooltip.avgResolution'),
      row.avgResolutionHours === null ? t('tooltip.none') : t('tooltip.hours', { n: row.avgResolutionHours }),
    ],
  ];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
      {items.map(([label, value, tone]) => (
        <div key={label} className="contents">
          <dt className="text-mute">{label}</dt>
          <dd className={cn('text-right font-bold text-ink tabular-nums', tone)}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
