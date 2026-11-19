import type { OverviewExecutiveRow } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import '../i18n';

const TH =
  'border-b border-tint/8 bg-secondary/85 px-2.5 py-2.5 text-[10.5px] leading-tight font-bold tracking-[0.5px] text-muted-foreground uppercase';
const TD = 'border-b border-tint/5 px-2.5 py-2 whitespace-nowrap tabular-nums';

/**
 * "Mas'ul shaxslar" (executives) of the whole country or of the selected region: what they did with the period's
 * tickets and what they hold right now (legacy `.data-table` look).
 */
export function ExecutivesTable({
  rows,
  regionName,
  loading,
}: {
  rows: readonly OverviewExecutiveRow[] | undefined;
  /** Region code → display name. */
  regionName: (code: string) => string;
  loading?: boolean;
}) {
  const { t } = useTranslation('ticketOverview');
  const hours = (n: number | null) => (n === null ? t('executives.none') : t('executives.hours', { n }));
  return (
    <Panel>
      <PanelHeader className="mb-3.5">
        <div>
          <PanelTitle>
            <Icon name="user" className="size-[18px] text-primary" />
            {t('executives.title')}
            {rows && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">{rows.length}</span>}
          </PanelTitle>
          <p className="mt-1 text-xs text-mute">{t('executives.subtitle')}</p>
        </div>
      </PanelHeader>
      <div className={cn('w-full overflow-x-auto rounded-xl border border-tint/8', loading && 'opacity-60')}>
        <table className="w-full border-collapse text-center text-[13px]">
          <thead>
            <tr>
              <th className={cn(TH, 'text-left')}>{t('executives.name')}</th>
              <th className={TH}>{t('executives.taken')}</th>
              <th className={TH}>{t('executives.done')}</th>
              <th className={TH}>{t('executives.rejected')}</th>
              <th className={TH}>{t('executives.overdue')}</th>
              <th className={TH}>{t('executives.avg')}</th>
              <th className={TH} title={t('executives.holdingHint')}>
                {t('executives.holding')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td colSpan={7} className={cn(TD, 'py-6 text-mute')}>
                  {t('executives.empty')}
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr
                key={r.userId}
                className={cn('transition-colors hover:bg-tint/[0.04]', r.taken + r.holdingNow === 0 && 'opacity-60')}
              >
                <td className={cn(TD, 'max-w-[260px] text-left')}>
                  <div className="truncate font-semibold text-ink">{r.name}</div>
                  <div className="truncate text-[11px] text-mute" title={r.regions.map(regionName).join(', ')}>
                    {r.regions.length ? r.regions.map(regionName).join(', ') : t('executives.noRegions')}
                  </div>
                </td>
                <td className={cn(TD, 'font-bold text-ink')}>{r.taken}</td>
                <td className={cn(TD, 'font-semibold text-positive')}>{r.done}</td>
                <td className={cn(TD, r.rejected ? 'text-caution' : 'text-mute')}>{r.rejected}</td>
                <td className={cn(TD, 'font-semibold', r.overdue ? 'text-danger' : 'text-mute')}>{r.overdue}</td>
                <td className={cn(TD, 'font-mono text-xs text-ink-2')}>{hours(r.avgResolutionHours)}</td>
                <td className={cn(TD, 'font-bold text-ink')}>
                  {r.holdingNow}
                  {r.overdueNow > 0 && <span className="ml-1 text-xs font-semibold text-danger">({r.overdueNow})</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
