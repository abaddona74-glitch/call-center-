import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AmiStatusPill, liveSnapshotQuery } from '@/entities/telephony';
import { Icon } from '@/shared/ui/icon';
import '../i18n';

/**
 * Right sidebar "Jonli Monitor" (legacy aside.right-sidebar): header with a pulse dot and a
 * collapse button, scrollable body with the panels passed as children, footer with the AMI pill
 * and the "Queue Info" line (Asterisk callsTaken of online operators, lowest first).
 */
export function LiveMonitor({ children, onCollapse }: { children: ReactNode; onCollapse?: () => void }) {
  const { t } = useTranslation('liveMonitor');
  const { data } = useQuery({
    ...liveSnapshotQuery,
    select: (s) => ({
      ami: s.ami,
      taken: s.operators
        .filter((o) => o.presence !== 'offline' && o.queue)
        .map((o) => o.queue!.callsTaken)
        .sort((a, b) => a - b),
    }),
  });
  return (
    <aside className="flex max-h-[calc(100svh-6.5rem)] flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#0f172a] shadow-[-8px_0_24px_rgba(0,0,0,0.4)] xl:sticky xl:top-20">
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-[18px]">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <span className="inline-block size-[7px] rounded-full bg-[#10b981] shadow-[0_0_8px_#10b981]" />
          {t('title')}
        </h2>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            title={t('collapse')}
            aria-label={t('collapse')}
            className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/5 text-[#cbd5e1] hover:bg-white/10"
          >
            <Icon name="arrow-right" className="size-4" />
          </button>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3.5 [scrollbar-width:thin]">{children}</div>
      <div className="flex flex-col gap-2 border-t border-white/8 bg-[#0f172a]/85 px-4 py-3">
        <AmiStatusPill status={data?.ami} />
        <div
          className="flex items-center gap-2 rounded-lg border border-[#6366f1]/35 bg-[#6366f1]/12 px-3 py-[7px] text-[11px] font-semibold text-[#a5b4fc]"
          title={t('queueInfoTitle')}
        >
          <Icon name="chart" className="size-3.5" />
          <span>Queue Info</span>
          <span className="ml-auto truncate text-[11.5px] font-bold tracking-[0.8px] text-[#e2e8f0]">
            {data?.taken.length ? data.taken.join(' · ') : '—'}
          </span>
        </div>
      </div>
    </aside>
  );
}

/** Floating edge button that reopens the collapsed monitor (legacy .sidebar-floating-expand-btn). */
export function LiveMonitorReopen({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('liveMonitor');
  return (
    <button
      type="button"
      onClick={onClick}
      title={t('expand')}
      className="fixed top-1/2 right-0 z-40 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-xl border border-r-0 border-white/10 bg-[#0f172a] px-2 py-3 text-[11px] font-semibold text-[#cbd5e1] shadow-[-4px_0_16px_rgba(0,0,0,0.4)] hover:text-white"
    >
      <Icon name="arrow-left" className="size-4" />
      <span className="inline-block size-[7px] rounded-full bg-[#10b981] shadow-[0_0_8px_#10b981]" />
      <span className="[writing-mode:vertical-rl]">Monitor</span>
    </button>
  );
}
