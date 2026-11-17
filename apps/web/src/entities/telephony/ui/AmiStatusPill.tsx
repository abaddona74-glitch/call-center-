import type { AmiStatus } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

/** Footer pill "AMI: Ulangan" (legacy sidebar footer). */
export function AmiStatusPill({ status, className }: { status: AmiStatus | undefined; className?: string }) {
  const { t } = useTranslation('telephony');
  const state = status?.state ?? 'connecting';
  const ok = state === 'connected';
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium',
        className,
      )}
      title={status?.lastError ?? undefined}
    >
      <span
        className={cn(
          'size-2 rounded-full',
          ok
            ? 'animate-pulse bg-[#10b981] shadow-[0_0_10px_rgba(16,185,129,0.6)]'
            : state === 'disabled'
              ? 'bg-muted-foreground'
              : 'bg-destructive',
        )}
      />
      <span>AMI: {t(`ami.${state}`)}</span>
    </div>
  );
}
