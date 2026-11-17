import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import './kds-modal.css';

/**
 * Modal chrome of the legacy tickets board (`.tk-modal-overlay` / `.tk-box-modal`) on top of Radix Dialog:
 * focus trap, Esc closes only the topmost modal, nested modals stack above their parent.
 * Backdrop clicks close it only when `closeOnBackdrop` (legacy: reject modal and document viewer).
 */
export function KdsModal({
  open,
  onOpenChange,
  title,
  description,
  width = 780,
  closeOnBackdrop = false,
  className,
  overlayClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible title (visually hidden; the visible header is part of `children`). */
  title: string;
  description?: string;
  /** Panel width in px; null = size via className. */
  width?: number | null;
  closeOnBackdrop?: boolean;
  className?: string;
  overlayClassName?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[1100] bg-[rgba(3,7,18,0.8)] backdrop-blur-[12px]',
            'data-[state=open]:animate-[kdsBackdropIn_280ms_cubic-bezier(0.23,1,0.32,1)_forwards]',
            'data-[state=closed]:animate-[kdsBackdropOut_200ms_cubic-bezier(0.2,0,0,1)_forwards]',
            overlayClassName,
          )}
        />
        <div className="pointer-events-none fixed inset-0 z-[1100] flex items-center justify-center p-5">
          <DialogPrimitive.Content
            onPointerDownOutside={(e) => {
              if (!closeOnBackdrop) e.preventDefault();
            }}
            onInteractOutside={(e) => {
              if (!closeOnBackdrop) e.preventDefault();
            }}
            style={width ? { width } : undefined}
            className={cn(
              'pointer-events-auto flex max-h-[90vh] max-w-[95vw] flex-col overflow-hidden rounded-[18px] border border-[rgba(59,130,246,0.35)] bg-[#0f172a] text-[#f8fafc] outline-none',
              'shadow-[0_25px_60px_rgba(0,0,0,0.8),0_0_30px_rgba(56,189,248,0.15)]',
              'data-[state=open]:animate-[kdsPanelIn_280ms_cubic-bezier(0.23,1,0.32,1)_forwards]',
              'data-[state=closed]:animate-[kdsPanelOut_200ms_cubic-bezier(0.2,0,0,1)_forwards]',
              className,
            )}
          >
            <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">{description ?? title}</DialogPrimitive.Description>
            {children}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** `.tk-box-header` */
export function KdsModalHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between border-b border-white/8 bg-[rgba(15,23,42,0.95)] px-6 py-[18px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** `.tk-box-body` */
export function KdsModalBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-1 flex-col gap-[18px] overflow-y-auto px-[26px] py-[22px]', className)}>{children}</div>;
}

/** `.tk-box-actions` */
export function KdsModalActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-t border-white/8 bg-[rgba(15,23,42,0.95)] px-6 py-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** `.tk-box-id` badge */
export function KdsIdBadge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'rounded-md border border-[rgba(56,189,248,0.3)] bg-[rgba(56,189,248,0.15)] px-2 py-[3px] font-mono text-sm font-extrabold text-[#38bdf8]',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** `.tk-btn-icon` close button */
export function KdsCloseButton({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <DialogPrimitive.Close asChild>
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={onClick}
        className="inline-flex size-8 items-center justify-center rounded-lg border border-white/12 bg-white/7 text-[#94a3b8] transition hover:-translate-y-px hover:border-[rgba(56,189,248,0.45)] hover:bg-white/15 hover:text-white active:scale-[0.96]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </DialogPrimitive.Close>
  );
}
