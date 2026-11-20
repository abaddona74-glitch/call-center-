import { CDR_ACCESS } from '@cc/shared';
import { usePermission, useSessionUser } from '@/entities/session';
import { useLiveTelephonySync } from '@/entities/telephony';
import { ActiveCalls } from '@/widgets/active-calls';
import { CallListDialog, RecentCallsPanel } from '@/widgets/call-history-table';
import { CallbacksPanel } from '@/widgets/callbacks-panel';
import { LiveCounters } from '@/widgets/live-counters';
import { LiveMonitor, LiveMonitorReopen, useLiveMonitorDock } from '@/widgets/live-monitor';
import { MyPhone } from '@/widgets/my-phone';
import { OperatorsBoard } from '@/widgets/operators-board';
import { QueueWaiters } from '@/widgets/queues';
import { TicketCallbackQueue } from '@/widgets/ticket-callback-queue';

/**
 * Live dashboard (legacy "/"): KPI cards, operators board and the collapsible "Jonli Monitor" sidebar.
 * Initial state is loaded by the route loader; `useLiveTelephonySync` applies WS updates.
 */
export function DashboardPage() {
  useLiveTelephonySync();
  const { open, motion, collapse, expand } = useLiveMonitorDock();
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
        {/* Staff cards open the operator's calls today in the same dialog. */}
        <OperatorsBoard
          variant={isOperator ? 'mockup' : 'classic'}
          CallListDialog={canReadCalls ? CallListDialog : undefined}
        />
        {canSeeRecent && <RecentCallsPanel />}
      </div>
      {open ? (
        <LiveMonitor onCollapse={collapse} motion={motion}>
          <QueueWaiters />
          <ActiveCalls />
          {canSeeCallbacks && <CallbacksPanel />}
        </LiveMonitor>
      ) : (
        <LiveMonitorReopen onClick={expand} />
      )}
    </div>
  );
}
