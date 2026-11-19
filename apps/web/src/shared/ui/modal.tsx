import { Dialog as DialogPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/shared/lib/cn';
import { useReturnFocus } from '@/shared/lib/use-return-focus';
import { Icon } from './icon';

/**
 * Legacy modal look (tokens.md §1.1, §4, §5): glass panel on #0f172a, radius 20px, colored glow border,
 * darkened + blurred backdrop, scale(.96) → 1 in 280ms.
 */
export function Modal({
  open,
  onOpenChange,
  glow = 'sky',
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  glow?: 'sky' | 'indigo';
  className?: string;
  children: React.ReactNode;
}) {
  const returnFocus = useReturnFocus();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[16px] backdrop-brightness-[.28] light:bg-black/35 light:backdrop-brightness-[.85] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-[280ms]" />
        <DialogPrimitive.Content
          {...returnFocus}
          aria-describedby={undefined}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 max-h-[92svh] w-[calc(100%-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[20px] border bg-sidebar/95 px-6 pt-6 pb-6 shadow-[0_25px_60px_color-mix(in_srgb,var(--shadow-color)_80%,transparent)] backdrop-blur-[16px] outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[.96] data-[state=open]:slide-in-from-bottom-3 data-[state=open]:duration-[280ms] data-[state=open]:ease-[var(--ease-out)]',
            glow === 'sky'
              ? 'border-chart-4/35 shadow-[0_25px_60px_color-mix(in_srgb,var(--shadow-color)_80%,transparent),0_0_30px_rgba(56,189,248,0.15)]'
              : 'border-primary/45 shadow-[0_25px_60px_color-mix(in_srgb,var(--shadow-color)_80%,transparent),0_0_30px_rgba(99,102,241,0.18)]',
            className,
          )}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Header: icon box, title + subtitle, round close button, divider below. */
export function ModalHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className="-mx-6 mb-5 flex items-center gap-3 border-b border-tint/8 px-6 pb-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-tint/12 bg-tint/5">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <DialogPrimitive.Title className="text-base font-bold text-ink">{title}</DialogPrimitive.Title>
        {subtitle && <div className="text-xs text-foreground/85">{subtitle}</div>}
      </div>
      <DialogPrimitive.Close
        className="flex size-8 items-center justify-center rounded-full border border-tint/12 bg-tint/5 text-muted-foreground transition-colors hover:bg-tint/10 hover:text-ink"
        aria-label="Close"
      >
        <Icon name="close" className="size-4" />
      </DialogPrimitive.Close>
    </div>
  );
}

/** Legacy modal buttons: neutral ("Bekor qilish"), green (export), blue (primary). */
export function ModalButton({
  tone = 'neutral',
  className,
  ...props
}: React.ComponentProps<'button'> & { tone?: 'neutral' | 'green' | 'blue' | 'blueOutline' }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-[18px] text-[13px] font-semibold transition-all disabled:pointer-events-none disabled:opacity-45',
        tone === 'neutral' && 'border border-tint/12 bg-tint/5 text-ink hover:bg-tint/10',
        tone === 'green' &&
          'bg-gradient-to-br from-chart-2 to-chart-2/75 text-white shadow-[0_4px_14px_rgba(16,185,129,0.35)] hover:brightness-110',
        tone === 'blue' &&
          'bg-gradient-to-br from-chart-6 to-chart-6/80 text-white shadow-[0_4px_14px_rgba(59,130,246,0.35)] hover:brightness-110',
        tone === 'blueOutline' && 'border border-chart-6/45 bg-chart-6/12 text-shade-chart-4 hover:bg-chart-6/20',
        className,
      )}
      {...props}
    />
  );
}

export const ModalClose = DialogPrimitive.Close;
