import { CDR_ACCESS } from '@cc/shared';
import { useEffect, useRef, useState } from 'react';
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
/** Slide of the "Jonli Monitor" dock; keep in sync with `duration-300` in LiveMonitor and AppShell. */
const DOCK_MS = 300;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Live dashboard (legacy "/"): KPI cards, operators board and the collapsible "Jonli Monitor" sidebar.
 * Initial state is loaded by the route loader; `useLiveTelephonySync` applies WS updates.
 */
export function DashboardPage() {
  useLiveTelephonySync();
  const [monitor, setMonitor] = usePersistedState('cc_sidebar_collapsed', 'open', MONITOR);
  const open = monitor === 'open';
  // The dock slides out before it unmounts (and in after a click), so closing is not an instant jump.
  const [motion, setMotion] = useState<'enter' | 'exit' | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const after = (fn: () => void) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, DOCK_MS);
  };
  const collapse = () => {
    if (reducedMotion()) return setMonitor('collapsed');
    setMotion('exit');
    after(() => {
      setMonitor('collapsed');
      setMotion(null);
    });
  };
  const expand = () => {
    setMonitor('open');
    if (reducedMotion()) return;
    setMotion('enter');
    after(() => setMotion(null));
  };
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
        <LiveMonitor onCollapse={collapse} motion={motion ?? undefined}>
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
