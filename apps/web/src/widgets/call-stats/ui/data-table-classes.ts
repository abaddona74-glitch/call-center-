/** Legacy `.data-table` (uppercase header on slate, centered cells). */
export const DT = {
  wrap: 'w-full overflow-x-auto rounded-xl border border-white/8',
  table: 'w-full border-collapse text-center text-[13px]',
  th: 'border-b border-white/8 bg-secondary/85 px-3.5 py-3 text-[11px] font-bold tracking-[0.6px] whitespace-nowrap text-muted-foreground uppercase',
  td: 'border-b border-white/5 px-3.5 py-[11px] whitespace-nowrap text-foreground',
  tr: 'transition-colors hover:bg-white/[0.04]',
} as const;
