import type * as React from 'react';
import { cn } from '@/shared/lib/cn';
import { Icon } from './icon';

/** Legacy `.search-box`: magnifier on the left, dark input. */
export function SearchBox({ className, inputClassName, ...props }: React.ComponentProps<'input'> & { inputClassName?: string }) {
  return (
    <div className={cn('relative min-w-[240px]', className)}>
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground/70">
        <Icon name="search-normal" className="size-[15px]" />
      </span>
      <input
        type="search"
        autoComplete="off"
        spellCheck={false}
        className={cn(
          'h-8 w-full rounded-lg border border-white/8 bg-black/30 py-2 pr-3.5 pl-[34px] text-[13px] text-white outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary',
          inputClassName,
        )}
        {...props}
      />
    </div>
  );
}
