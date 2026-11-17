import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AmiStatusPill, liveSnapshotQuery } from '@/entities/telephony';
import '../i18n';

/**
 * Right sidebar "Jonli Monitor" (legacy aside.right-sidebar): header with a pulse dot, scrollable
 * body with the panels passed as children, footer with connection pills.
 */
export function LiveMonitor({ children }: { children: ReactNode }) {
  const { t } = useTranslation('liveMonitor');
  const { data: ami } = useQuery({ ...liveSnapshotQuery, select: (s) => s.ami });
  return (
    <aside className="flex max-h-[calc(100svh-6.5rem)] flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#0f172a] shadow-[-8px_0_24px_rgba(0,0,0,0.4)] xl:sticky xl:top-20">
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-[18px]">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <span className="inline-block size-[7px] rounded-full bg-[#10b981] shadow-[0_0_8px_#10b981]" />
          {t('title')}
        </h2>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3.5 [scrollbar-width:thin]">{children}</div>
      <div className="flex gap-2 border-t border-white/8 bg-[#0f172a]/85 px-4 py-3">
        <AmiStatusPill status={ami} className="flex-1" />
      </div>
    </aside>
  );
}
