import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import { Icon } from '@/shared/ui/icon';

/**
 * Legacy "showCustomConfirm" look: red-bordered card, trash badge, Cancel / OK buttons
 * (legacy/public/index.html customConfirmModal). Extra fields (e.g. a reason) go in `children`.
 */
export function DangerConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  okText,
  cancelText,
  onConfirm,
  busy = false,
  okDisabled = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: ReactNode;
  okText: string;
  cancelText: string;
  onConfirm: () => void;
  busy?: boolean;
  okDisabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[400px] gap-0 rounded-2xl border-destructive/35 bg-[linear-gradient(145deg,var(--glass-2),var(--sidebar))] p-[22px] text-center shadow-[0_20px_40px_color-mix(in_srgb,var(--shadow-color)_60%,transparent),0_0_25px_rgba(239,68,68,0.15)] sm:max-w-[400px]"
      >
        <div className="mx-auto mb-3.5 flex size-[50px] items-center justify-center rounded-full border border-destructive/30 bg-destructive/15 text-destructive">
          <Icon name="trash" className="size-6" />
        </div>
        <DialogTitle className="mb-2 text-base font-bold text-ink">{title}</DialogTitle>
        <DialogDescription className="mb-5 text-[13px] leading-normal text-muted-foreground">
          {message}
        </DialogDescription>
        {children}
        <div className="flex justify-center gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            className="flex-1 rounded-[10px] border border-tint/15 bg-tint/[0.08] px-4 py-2.5 text-[13px] font-semibold text-ink-2 transition-all duration-150 hover:bg-tint/15"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={busy || okDisabled}
            onClick={onConfirm}
            className={cn(
              'flex-1 rounded-[10px] border border-danger bg-[linear-gradient(135deg,#ef4444,#dc2626)] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(239,68,68,0.35)] transition-all duration-150',
              'hover:-translate-y-px hover:shadow-[0_6px_16px_rgba(239,68,68,0.45)] disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            {okText}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
