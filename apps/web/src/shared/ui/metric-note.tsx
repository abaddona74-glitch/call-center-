import { Info } from 'lucide-react';
import type * as React from 'react';

/**
 * The records-behind-a-number dialogs: the line that says how the number is calculated (shown first, before the list).
 */
export function MetricNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 flex gap-2 rounded-lg border border-tint/8 bg-tint/[0.03] px-3 py-2 text-xs leading-relaxed text-ink-2">
      <Info className="mt-px size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** A dialog title with the number it explains next to it (the same number as on the dashboard). */
export function TitleValue({ title, value }: { title: React.ReactNode; value: number | string }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {title}
      <span className="rounded-md bg-primary/15 px-2 py-0.5 text-sm font-bold text-primary tabular-nums">{value}</span>
    </span>
  );
}
