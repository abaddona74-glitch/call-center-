import { useTranslation } from 'react-i18next';
import { useRealtimeStatus } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { tashkentDateTime } from '@/shared/lib/tashkent-time';
import { useNow } from '@/shared/lib/use-now';
import '../i18n';

/** The server pushes tickets every 30 s: three missed pushes on an open socket = something is wrong. */
const STALE_MS = 90_000;

type LiveState = 'live' | 'connecting' | 'lost' | 'stale';

const TONE: Record<LiveState, { pill: string; dot: string }> = {
  live: {
    pill: 'border-positive/35 bg-positive/[0.05] text-positive',
    dot: 'motion-safe:animate-pulse bg-[#10b981] shadow-[0_0_10px_rgba(16,185,129,0.6)]',
  },
  connecting: { pill: 'border-caution/35 bg-caution/[0.06] text-caution-soft', dot: 'bg-caution' },
  stale: { pill: 'border-caution/35 bg-caution/[0.06] text-caution-soft', dot: 'bg-caution' },
  lost: { pill: 'border-danger/35 bg-danger/[0.06] text-danger-soft', dot: 'bg-danger' },
};

/**
 * "● Jonli · yangilandi 17:20:05": the WS connection and the time of the last data (REST or push). Only the state word
 * is a live region, so screen readers hear "connection lost", not every update.
 */
export function SituationLiveStatus({ updatedAt, className }: { updatedAt: number; className?: string }) {
  const { t } = useTranslation('situation');
  const status = useRealtimeStatus();
  const now = useNow();
  const state: LiveState =
    status === 'open'
      ? updatedAt > 0 && now - updatedAt > STALE_MS
        ? 'stale'
        : 'live'
      : status === 'closed'
        ? 'lost'
        : 'connecting';
  const tone = TONE[state];
  return (
    <div
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12.5px] font-semibold whitespace-nowrap',
        tone.pill,
        className,
      )}
      title={t('live.hint')}
    >
      <span className={cn('size-2 shrink-0 rounded-full', tone.dot)} aria-hidden="true" />
      <span role="status">{t(`live.${state}`)}</span>
      {updatedAt > 0 && (
        <span className="font-medium text-ink-2">
          · {t('live.updated', { time: tashkentDateTime(new Date(updatedAt)).slice(11, 19) })}
        </span>
      )}
    </div>
  );
}
