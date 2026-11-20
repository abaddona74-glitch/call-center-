import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { useNow } from '@/shared/lib/use-now';
import { overdueMs, overdueText } from '../lib/overdue';

/**
 * How long past the due date: "+2 kun 5 soat". Resolved late — the fixed time at the resolution; still with the
 * region (`resolvedAt` null) — a live clock up to now. Nothing when in time.
 */
export function OverdueFor({
  dueAt,
  resolvedAt,
  className,
}: {
  dueAt: string | null;
  resolvedAt: string | null;
  className?: string;
}) {
  if (resolvedAt) return <Span ms={overdueMs(dueAt, resolvedAt, 0)} running={false} className={className} />;
  return <Running dueAt={dueAt} className={className} />;
}

function Running({ dueAt, className }: { dueAt: string | null; className?: string }) {
  const now = useNow();
  return <Span ms={overdueMs(dueAt, null, now)} running className={className} />;
}

function Span({ ms, running, className }: { ms: number | null; running: boolean; className?: string }) {
  const { t } = useTranslation('ticket');
  if (ms === null) return null;
  return (
    <span
      title={t(running ? 'late.running' : 'late.resolved')}
      className={cn('font-semibold whitespace-nowrap text-danger tabular-nums', className)}
    >
      +{overdueText(ms, t)}
    </span>
  );
}
