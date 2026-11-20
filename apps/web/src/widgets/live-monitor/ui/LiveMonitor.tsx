import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AmiStatusPill, liveSnapshotQuery } from '@/entities/telephony';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import '../i18n';

/**
 * Right sidebar "Jonli Monitor" (legacy aside.right-sidebar): header with a pulse dot and a
 * collapse button, scrollable body with the panels passed as children, footer with the AMI pill
 * and the "Queue Info" line (Asterisk callsTaken of online operators, lowest first).
 *
 * From `xl` up it is docked like the legacy one: fixed to the right edge, full viewport height,
 * next to the top header. `data-right-dock` makes the app shell reserve its width, so the header
 * and the page end where the sidebar starts. Below `xl` it is an ordinary card under the page.
 */
export function LiveMonitor({
  children,
  onCollapse,
  motion,
}: {
  children: ReactNode;
  onCollapse?: () => void;
  /** Slide in (after "open") or out (before unmount, 300 ms). On exit the shell stops reserving the width. */
  motion?: 'enter' | 'exit';
}) {
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
    <aside
      data-right-dock={motion === 'exit' ? undefined : true}
      data-dock-motion={motion}
      className={cn(
        'flex max-h-[calc(100svh-6.5rem)] flex-col overflow-hidden rounded-2xl border border-tint/8 bg-sidebar shadow-[-8px_0_24px_color-mix(in_srgb,var(--shadow-color)_40%,transparent)] xl:fixed xl:inset-y-0 xl:right-0 xl:z-40 xl:max-h-none xl:w-(--right-dock-width) xl:rounded-none xl:border-y-0 xl:border-r-0 xl:shadow-[-12px_0_36px_color-mix(in_srgb,var(--shadow-color)_65%,transparent)]',
        motion === 'enter' && 'animate-in duration-300 ease-out fade-in-0 slide-in-from-right',
        motion === 'exit' && 'animate-out duration-300 ease-in fill-mode-forwards fade-out-0 slide-out-to-right',
      )}
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-tint/8 px-5">
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
            className="grid size-7 place-items-center rounded-lg border border-tint/10 bg-tint/5 text-ink-2 hover:bg-tint/10"
          >
            <Icon name="arrow-right" className="size-4" />
          </button>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3.5 [scrollbar-width:thin]">{children}</div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-tint/8 bg-sidebar/85 px-4 py-3">
        <AmiStatusPill status={data?.ami} />
        <div
          className="flex items-center gap-2 rounded-lg border border-[#6366f1]/35 bg-[#6366f1]/12 px-3 py-[7px] text-[11px] font-semibold text-brand-pale"
          title={t('queueInfoTitle')}
        >
          <Icon name="chart" className="size-3.5" />
          <span>Queue Info</span>
          <span className="ml-auto truncate text-[11.5px] font-bold tracking-[0.8px] text-foreground">
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
      className="fixed top-1/2 right-0 z-40 flex -translate-y-1/2 animate-in duration-300 ease-out fade-in-0 slide-in-from-right flex-col items-center gap-2 rounded-l-xl border border-r-0 border-tint/10 bg-sidebar px-2 py-3 text-[11px] font-semibold text-ink-2 shadow-[-4px_0_16px_color-mix(in_srgb,var(--shadow-color)_40%,transparent)] hover:text-ink"
    >
      <Icon name="arrow-left" className="size-4" />
      <span className="inline-block size-[7px] rounded-full bg-[#10b981] shadow-[0_0_8px_#10b981]" />
      <span className="[writing-mode:vertical-rl]">Monitor</span>
    </button>
  );
}
