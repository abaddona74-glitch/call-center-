import { useNow } from '@/shared/lib/use-now';
import { cn } from '@/shared/lib/cn';
import { serverClockOffset } from '../api/telephony.api';
import { formatSeconds } from '../lib/format';
import './live-timer.css';

/** Seconds elapsed since an ISO time (server clock). */
export function useElapsed(since: string | null | undefined): number {
  const now = useNow();
  if (!since) return 0;
  return Math.max(0, Math.floor((now + serverClockOffset - Date.parse(since)) / 1000));
}

/**
 * Live stopwatch. With `thresholds` it turns yellow at 3 min and red (pulsing) at 7 min,
 * like the legacy talking timers.
 */
export function LiveTimer({
  since,
  thresholds = false,
  className,
}: {
  since: string | null | undefined;
  thresholds?: boolean;
  className?: string;
}) {
  const sec = useElapsed(since);
  const level = !thresholds ? undefined : sec >= 420 ? 'danger' : sec >= 180 ? 'warning' : undefined;
  return (
    <span className={cn('live-timer', level && `live-timer--${level}`, className)} data-level={level ?? 'normal'}>
      {formatSeconds(sec)}
    </span>
  );
}
