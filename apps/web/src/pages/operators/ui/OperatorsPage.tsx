import { type LiveOperator, telephonyAccess } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSessionUser } from '@/entities/session';
import { liveSnapshotQuery, useLiveTelephonySync } from '@/entities/telephony';
import { ClickToCallForm } from '@/features/telephony/click-to-call';
import { cn } from '@/shared/lib/cn';
import { usePersistedState } from '@/shared/lib/use-persisted-state';
import { Icon } from '@/shared/ui/icon';
import { ActiveCalls } from '@/widgets/active-calls';
import { LiveMonitor, LiveMonitorReopen } from '@/widgets/live-monitor';
import { MyPhone } from '@/widgets/my-phone';
import { QueueWaiters } from '@/widgets/queues';
import { medals } from '../model/rating';
import { OperatorStatsCard } from './OperatorStatsCard';
import '../i18n';
import './operators-page.css';

const SORT = ['total', 'alpha'] as const;
const DENSITY = ['full', 'compact'] as const;
const MONITOR = ['open', 'collapsed'] as const;
const totalOf = (o: LiveOperator) => o.today.answered + o.today.outbound + o.today.transfersIn;

/**
 * Operators (legacy "/operators", admin-10): a card per operator with today's numbers.
 * Admins can pause/unpause anyone and place a call from any operator's phone.
 * (Desktop-agent logs, its chart and the CDR sync button belong to the agent module, S4.)
 */
export function OperatorsPage() {
  useLiveTelephonySync();
  const { t } = useTranslation('operatorsPage');
  const user = useSessionUser();
  const isAdmin = telephonyAccess(user).manageAll;
  const { data: operators } = useQuery({ ...liveSnapshotQuery, select: (s) => s.operators });
  const [sort, setSort] = usePersistedState('tabOperatorSortMode', 'total', SORT);
  const [density, setDensity] = usePersistedState('operators_tab_density', 'full', DENSITY);
  const [monitor, setMonitor] = usePersistedState('cc_sidebar_collapsed', 'open', MONITOR);
  const list = [...(operators ?? [])].sort(
    sort === 'alpha'
      ? (a, b) => a.name.localeCompare(b.name)
      : (a, b) =>
          Number(a.presence === 'offline') - Number(b.presence === 'offline') ||
          totalOf(b) - totalOf(a) ||
          Number(a.extension) - Number(b.extension),
  );
  const open = monitor === 'open';
  const medalOf = medals(list.map((o) => ({ extension: o.extension, total: totalOf(o) })));

  return (
    <div className={cn('grid items-start gap-6', open && 'xl:grid-cols-[minmax(0,1fr)_385px]')}>
      <div className="flex min-w-0 flex-col gap-6">
        <MyPhone />
        {isAdmin && (
          <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-tint/8 bg-muted px-5 py-4">
            <div className="text-sm font-semibold">{t('callFrom')}</div>
            <ClickToCallForm operators={operators ?? []} className="ml-auto" />
          </section>
        )}
        <section className="opp-panel" aria-label={t('title')}>
          <div className="opp-head">
            <h3 className="opp-title">
              <Icon name="headphone" className="size-5" />
              {t('title')}
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="opp-tool"
                aria-pressed={density === 'compact'}
                onClick={() => setDensity(density === 'compact' ? 'full' : 'compact')}
              >
                <Icon name="setting-4" className="size-3.5" />
                {t('density')}
              </button>
              <button
                type="button"
                className="opp-tool"
                aria-pressed={sort === 'alpha'}
                onClick={() => setSort(sort === 'alpha' ? 'total' : 'alpha')}
              >
                <Icon name="arrow-down" className="size-3" />
                A–Z
              </button>
            </div>
          </div>
          <div className={cn('opp-grid', density === 'compact' && 'compact')}>
            {list.map((op) => (
              <OperatorStatsCard key={op.extension} op={op} controls={isAdmin} medal={medalOf.get(op.extension)} />
            ))}
          </div>
        </section>
      </div>
      {open ? (
        <LiveMonitor onCollapse={() => setMonitor('collapsed')}>
          <QueueWaiters />
          <ActiveCalls />
        </LiveMonitor>
      ) : (
        <LiveMonitorReopen onClick={() => setMonitor('open')} />
      )}
    </div>
  );
}
