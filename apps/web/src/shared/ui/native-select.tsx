import type * as React from 'react';
import { cn } from '@/shared/lib/cn';

/** Legacy toolbar `<select>` (32px, 12px text, dark translucent background). */
export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-8 cursor-pointer rounded-lg border border-white/8 bg-sidebar/75 px-2.5 text-xs text-foreground outline-none focus-visible:border-primary [&>option]:bg-sidebar',
        className,
      )}
      {...props}
    />
  );
}
