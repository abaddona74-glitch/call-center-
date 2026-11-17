import { useLiveTelephonySync } from '@/entities/telephony';
import { ActiveCalls } from '@/widgets/active-calls';
import { LiveCounters } from '@/widgets/live-counters';
import { LiveMonitor } from '@/widgets/live-monitor';
import { MyPhone } from '@/widgets/my-phone';
import { OperatorsBoard } from '@/widgets/operators-board';
import { QueueWaiters } from '@/widgets/queues';

/**
 * Live dashboard (legacy "/"): KPI cards, operators board and the "Jonli Monitor" sidebar.
 * Initial state is loaded by the route loader; `useLiveTelephonySync` applies WS updates.
 */
export function DashboardPage() {
  useLiveTelephonySync();
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_385px]">
      <div className="flex min-w-0 flex-col gap-6">
        <MyPhone />
        <LiveCounters />
        <OperatorsBoard />
      </div>
      <LiveMonitor>
        <QueueWaiters />
        <ActiveCalls />
        {/*
          ── SLOT: callbacks panel (session S4) ────────────────────────────────
          Render `<CallbacksPanel />` from `@/widgets/callbacks-panel` here
          ("Qayta bog'lanish kerak", legacy #callbacksPanel under active calls).
        */}
      </LiveMonitor>
    </div>
  );
}
