import { useLiveTelephonySync } from '@/entities/telephony';
import { cn } from '@/shared/lib/cn';
import { usePersistedState } from '@/shared/lib/use-persisted-state';
import { ActiveCalls } from '@/widgets/active-calls';
import { LiveCounters } from '@/widgets/live-counters';
import { LiveMonitor, LiveMonitorReopen } from '@/widgets/live-monitor';
import { MyPhone } from '@/widgets/my-phone';
import { OperatorsBoard } from '@/widgets/operators-board';
import { QueueWaiters } from '@/widgets/queues';

const MONITOR = ['open', 'collapsed'] as const;

/**
 * Live dashboard (legacy "/"): KPI cards, operators board and the collapsible "Jonli Monitor" sidebar.
 * Initial state is loaded by the route loader; `useLiveTelephonySync` applies WS updates.
 */
export function DashboardPage() {
  useLiveTelephonySync();
  const [monitor, setMonitor] = usePersistedState('cc_sidebar_collapsed', 'open', MONITOR);
  const open = monitor === 'open';
  return (
    <div className={cn('grid items-start gap-6', open && 'xl:grid-cols-[minmax(0,1fr)_385px]')}>
      <div className="flex min-w-0 flex-col gap-6">
        <MyPhone />
        <LiveCounters />
        <OperatorsBoard />
        {/*
          ── SLOT: recent calls "So'nggi qo'ng'iroqlar" (CDR history, session S2) ──────────
          Legacy shows it under the operators (docs/rewrite/design/admin-02c-dashboard-recent-calls.png).
        */}
      </div>
      {open ? (
        <LiveMonitor onCollapse={() => setMonitor('collapsed')}>
          <QueueWaiters />
          <ActiveCalls />
          {/*
            ── SLOT: callbacks panel (session S4) ────────────────────────────────
            Render `<CallbacksPanel />` from `@/widgets/callbacks-panel` here
            ("Qayta bog'lanish kerak", legacy #callbacksPanel under active calls).
          */}
        </LiveMonitor>
      ) : (
        <LiveMonitorReopen onClick={() => setMonitor('open')} />
      )}
    </div>
  );
}
