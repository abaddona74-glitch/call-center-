import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { telephonyActions } from '@/entities/telephony';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu';
import '../i18n';

const REASONS = ['break', 'lunch', 'meeting', 'other'] as const;

/**
 * Pause / unpause a queue member through AMI QueuePause. `extension` is sent only for admins;
 * operators always act on their own extension (the server enforces it).
 */
export function PauseOperatorButton({
  extension,
  paused,
  className,
  compact = false,
}: {
  extension?: string;
  paused: boolean;
  className?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation('telephonyActions');
  const mutation = useMutation({
    mutationFn: (vars: { paused: boolean; reason?: string }) => telephonyActions.pause({ extension, ...vars }),
    onSuccess: (_d, vars) => toast.success(t(vars.paused ? 'pause.paused' : 'pause.unpaused')),
    onError: (err) => toast.error(err.message),
  });

  const base = cn(
    'inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-[filter] hover:brightness-125 disabled:opacity-50',
    className,
  );

  if (paused) {
    return (
      <button
        type="button"
        className={cn(base, 'border-positive/40 bg-positive/12 text-positive')}
        disabled={mutation.isPending}
        onClick={(e) => {
          e.stopPropagation();
          mutation.mutate({ paused: false });
        }}
      >
        <Icon name="play" className="size-3.5" />
        {!compact && t('pause.unpause')}
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(base, 'border-[#f59e0b]/40 bg-[#f59e0b]/12 text-caution')}
          disabled={mutation.isPending}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon name="pause" className="size-3.5" />
          {!compact && t('pause.pause')}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {REASONS.map((r) => (
          <DropdownMenuItem key={r} onSelect={() => mutation.mutate({ paused: true, reason: t(`pause.reasons.${r}`) })}>
            {t(`pause.reasons.${r}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
