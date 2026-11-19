import { CDR_ACCESS } from '@cc/shared';
import { usePermission, useSessionUser } from '@/entities/session';
import { useLiveTelephonySync } from '@/entities/telephony';
import { usePersistedState } from '@/shared/lib/use-persisted-state';
import { ActiveCalls } from '@/widgets/active-calls';
import { CallListDialog, RecentCallsPanel } from '@/widgets/call-history-table';
import { CallbacksPanel } from '@/widgets/callbacks-panel';
import { LiveCounters } from '@/widgets/live-counters';
import { LiveMonitor, LiveMonitorReopen } from '@/widgets/live-monitor';
import { MyPhone } from '@/widgets/my-phone';
import { OperatorsBoard } from '@/widgets/operators-board';
import { QueueWaiters } from '@/widgets/queues';
import { TicketCallbackQueue } from '@/widgets/ticket-callback-queue';

const MONITOR = ['open', 'collapsed'] as const;

/**
 * Live dashboard (legacy "/"): KPI cards, operators board and the collapsible "Jonli Monitor" sidebar.
 * Initial state is loaded by the route loader; `useLiveTelephonySync` applies WS updates.
 */
export function DashboardPage() {
  useLiveTelephonySync();
  const [monitor, setMonitor] = usePersistedState('cc_sidebar_collapsed', 'open', MONITOR);
  const open = monitor === 'open';
  const canSeeCallbacks = usePermission('callbacks.view');
  const canSeeRecent = usePermission(CDR_ACCESS['history.page']);
  const canReadCalls = usePermission(CDR_ACCESS['calls.read']);
  // Operators get the legacy operator-portal cards (Diamond / Gold / Silver), staff the dashboard cards.
  const isOperator = useSessionUser().role === 'operator';
  return (
    <div className="grid items-start gap-6">
      <div className="flex min-w-0 flex-col gap-6">
        <MyPhone />
        <TicketCallbackQueue />
        {/* The call cards open today's calls behind them (GET /cdr/calls). */}
        <LiveCounters CallListDialog={canReadCalls ? CallListDialog : undefined} />
        <OperatorsBoard variant={isOperator ? 'mockup' : 'classic'} />
        {canSeeRecent && <RecentCallsPanel />}
      </div>
      {open ? (
        <LiveMonitor onCollapse={() => setMonitor('collapsed')}>
          <QueueWaiters />
          <ActiveCalls />
          {canSeeCallbacks && <CallbacksPanel />}
        </LiveMonitor>
      ) : (
        <LiveMonitorReopen onClick={() => setMonitor('open')} />
      )}
    </div>
  );
}
