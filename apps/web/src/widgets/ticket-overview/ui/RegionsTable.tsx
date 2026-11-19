import { OVERVIEW_NO_REGION, type OverviewRegionRow } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { percentOf } from '../model/format';
import '../i18n';

/** Region value of the page filter: its code, or "none" for tickets without a region. */
export const regionKey = (row: Pick<OverviewRegionRow, 'code'>) => row.code ?? OVERVIEW_NO_REGION;

const TH = 'px-2 py-2 text-[10px] leading-tight font-bold tracking-[0.4px] text-muted-foreground uppercase';
const TD = 'px-2 py-[7px] whitespace-nowrap tabular-nums';

/**
 * The map as a table (every region and "Hududsiz"): what the map colours, with names, for keyboard and screen
 * readers and for the regions too small to click on the map. A row click filters the page like a map click.
 */
export function RegionsTable({
  rows,
  selected,
  onSelect,
}: {
  rows: readonly OverviewRegionRow[];
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const { t, i18n } = useTranslation('ticketOverview');
  const ru = i18n.language === 'ru';
  const sorted = [...rows].sort(
    (a, b) =>
      Number(a.code === null) - Number(b.code === null) || b.received - a.received || b.overdueNow - a.overdueNow,
  );
  return (
    <div className="max-h-[520px] overflow-auto rounded-xl border border-tint/8 xl:max-h-none">
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="sticky top-0 z-[1] bg-secondary">
          <tr>
            <th className={cn(TH, 'text-left')}>{t('regions.region')}</th>
            <th className={cn(TH, 'text-right')}>{t('regions.received')}</th>
            <th className={cn(TH, 'text-right max-sm:hidden')}>{t('regions.closed')}</th>
            <th className={cn(TH, 'text-right')}>{t('regions.overdue')}</th>
            <th className={cn(TH, 'text-right')} title={t('regions.nowHint')}>
              {t('regions.now')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const key = regionKey(r);
            const active = selected === key;
            const name = r.code === null ? t('regions.noRegion') : ru ? r.nameRu : r.nameUz;
            return (
              <tr
                key={key}
                tabIndex={0}
                aria-selected={active}
                onClick={() => onSelect(active ? null : key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(active ? null : key);
                  }
                }}
                className={cn(
                  'cursor-pointer border-b border-tint/5 outline-none transition-colors hover:bg-tint/[0.05] focus-visible:bg-tint/[0.08]',
                  active && 'bg-primary/14 hover:bg-primary/18',
                  r.received === 0 && r.overdueNow === 0 && !active && 'opacity-60',
                )}
              >
                <td
                  className={cn(TD, 'max-w-[112px] truncate text-left font-semibold text-ink sm:max-w-[150px]')}
                  title={name}
                >
                  {r.code === null && <Icon name="location" className="mr-1 inline size-3 text-caution" />}
                  {name}
                </td>
                <td className={cn(TD, 'text-right font-bold text-ink')}>{r.received}</td>
                <td className={cn(TD, 'text-right text-positive max-sm:hidden')}>{r.closed}</td>
                <td className={cn(TD, 'text-right', r.overdue ? 'text-danger' : 'text-mute')}>
                  {r.overdue}
                  {r.received > 0 && (
                    <span className="ml-1 inline-block w-[30px] text-[10.5px] text-mute max-sm:hidden">
                      {percentOf(r.overdue, r.received)}%
                    </span>
                  )}
                </td>
                <td className={cn(TD, 'text-right font-bold', r.overdueNow ? 'text-danger' : 'text-mute')}>
                  {r.overdueNow}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
