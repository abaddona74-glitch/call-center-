import type * as React from 'react';
import { cn } from '@/shared/lib/cn';

/** Legacy `.glass-panel`: --bg-card #131d31 (our `muted` token), 1px border, 16px radius, 22px padding. */
export function Panel({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section className={cn('min-w-0 rounded-2xl border border-white/8 bg-muted p-[22px]', className)} {...props} />
  );
}

/** Legacy `.panel-header`. */
export function PanelHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mb-[18px] flex flex-wrap items-center justify-between gap-3.5', className)} {...props} />;
}

/** Legacy `.panel-title` (16px, semibold, icon gap 8px). */
export function PanelTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 className={cn('flex items-center gap-2 text-base font-semibold', className)} {...props} />;
}
