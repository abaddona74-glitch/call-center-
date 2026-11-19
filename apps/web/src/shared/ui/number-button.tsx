import type * as React from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * A number that opens the records behind it (a details dialog): a real button named "<label>: <value>", looking like
 * the plain number until hovered or focused. Without `onOpen` it renders the number as text.
 */
export function NumberButton({
  label,
  value,
  onOpen,
  className,
  children,
}: {
  /** What the number is (for the accessible name). */
  label: string;
  value: number | string;
  onOpen?: () => void;
  className?: string;
  /** What to show instead of `value` (e.g. the value with a percent next to it). */
  children?: React.ReactNode;
}) {
  if (!onOpen) return <span className={className}>{children ?? value}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        // Only the dialog: not the clickable row or card around the number (e.g. a region row filters the page).
        e.stopPropagation();
        onOpen();
      }}
      aria-label={`${label}: ${value}`}
      aria-haspopup="dialog"
      className={cn(
        '-mx-1 cursor-pointer rounded px-1 tabular-nums underline-offset-[3px] outline-none hover:bg-tint/8 hover:underline focus-visible:ring-2 focus-visible:ring-primary',
        className,
      )}
    >
      {children ?? value}
    </button>
  );
}
