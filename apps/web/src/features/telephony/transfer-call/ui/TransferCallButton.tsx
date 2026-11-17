import type { LiveCall, LiveOperator } from '@cc/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PRESENCE_COLOR, compareForBoard } from '@/entities/operator';
import { telephonyActions } from '@/entities/telephony';
import { cn } from '@/shared/lib/cn';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import '../i18n';

/** "O'tkazish" → modal with operators (free ones first) → AMI Redirect of the citizen leg. */
export function TransferCallButton({
  call,
  operators,
  className,
}: {
  call: LiveCall;
  operators: LiveOperator[];
  className?: string;
}) {
  const { t } = useTranslation('telephonyActions');
  const { t: tp } = useTranslation('operator');
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: (target: string) => telephonyActions.transfer({ callId: call.id, target }),
    onSuccess: () => {
      toast.success(t('transfer.done'));
      setOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });
  const targets = operators
    .filter((o) => o.extension !== call.extension && o.presence !== 'offline')
    .sort(compareForBoard);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 10h13l-4-4M17 14H4l4 4" />
        </svg>
        <span>{t('transfer.button')}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-white/10 bg-[#0f172a] sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{t('transfer.title')}</DialogTitle>
            <DialogDescription>{t('transfer.description')}</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
            {targets.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">{t('transfer.empty')}</div>
            )}
            {targets.map((op) => (
              <button
                key={op.extension}
                type="button"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate(op.extension)}
                className={cn(
                  'flex items-center gap-3 rounded-lg border border-white/8 bg-[#1a2538] px-3 py-2 text-left transition-colors hover:border-[#60a5fa]/50 hover:bg-[#60a5fa]/8 disabled:opacity-50',
                )}
              >
                <span
                  className="grid size-9 place-items-center rounded-lg border border-white/10 bg-[#18223a] text-sm font-bold tabular-nums"
                  style={{ color: PRESENCE_COLOR[op.presence] }}
                >
                  {op.extension}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{op.name}</span>
                <span className="text-xs font-semibold" style={{ color: PRESENCE_COLOR[op.presence] }}>
                  {tp(`presence.${op.presence}`)}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
