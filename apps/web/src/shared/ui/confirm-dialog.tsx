import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { SettingsButton } from '@/shared/ui/settings-panel';

/** Dark glass confirmation (legacy custom confirm). Esc / outside click cancel. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  tone?: 'danger' | 'primary';
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/12 bg-[linear-gradient(160deg,#1e293b_0%,#0f172a_100%)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#f8fafc]">{title}</DialogTitle>
          {description && <DialogDescription className="text-[#94a3b8]">{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <SettingsButton tone="ghost" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </SettingsButton>
          <SettingsButton tone={tone} disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </SettingsButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
