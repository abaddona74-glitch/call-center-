import type { TopClientRow } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { formatDuration, formatPhone } from '@/entities/call';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import { DT } from './data-table-classes';
import '../i18n';

/** Most active client numbers in the period (legacy /api/contacts/top-active, now CDR-only). */
export function TopClientsTable({
  clients,
  onOpenNumber,
}: {
  clients: TopClientRow[] | undefined;
  onOpenNumber?: (number: string) => void;
}) {
  const { t } = useTranslation('callStats');
  const rows = clients ?? [];
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>
          <Icon name="user" className="size-[18px] text-chart-4" />
          {t('topClients')}
        </PanelTitle>
      </PanelHeader>
      <div className={DT.wrap}>
        <table className={DT.table}>
          <thead>
            <tr>
              {(['num', 'number', 'inbound', 'answered', 'missed', 'outbound', 'talk', 'last'] as const).map((c) => (
                <th key={c} className={cn(DT.th, c === 'number' && 'text-left')}>
                  {t(`tcCol.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className={cn(DT.td, 'py-6 text-muted-foreground')}>
                  {t('empty')}
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.number} className={DT.tr}>
                  <td className={cn(DT.td, 'text-xs font-semibold text-muted-foreground')}>{i + 1}</td>
                  <td className={cn(DT.td, 'text-left font-semibold tracking-[0.2px]')}>
                    {onOpenNumber ? (
                      <button
                        type="button"
                        className="hover:text-chart-4 hover:underline"
                        onClick={() => onOpenNumber(r.number)}
                      >
                        {formatPhone(r.number)}
                      </button>
                    ) : (
                      formatPhone(r.number)
                    )}
                  </td>
                  <td className={cn(DT.td, 'text-base font-bold')}>{r.inbound}</td>
                  <td className={cn(DT.td, 'text-success')}>{r.answered}</td>
                  <td className={cn(DT.td, r.missed ? 'text-warning' : 'text-muted-foreground')}>{r.missed}</td>
                  <td className={cn(DT.td, 'text-outbound')}>{r.outbound}</td>
                  <td className={cn(DT.td, 'font-mono')}>{formatDuration(r.talkSec)}</td>
                  <td className={cn(DT.td, 'font-mono text-xs text-muted-foreground')}>
                    {r.lastCallAt.slice(0, 16).replace('T', ' ')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
