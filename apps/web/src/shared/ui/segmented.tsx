import { cn } from '@/shared/lib/cn';

const ACTIVE = {
  blue: 'bg-gradient-to-br from-chart-6 to-chart-6/85 shadow-[0_2px_8px_rgba(59,130,246,0.3)]',
  sky: 'bg-chart-4/85 shadow-[0_2px_8px_rgba(56,189,248,0.3)]',
  indigo: 'bg-primary shadow-[0_2px_8px_rgba(99,102,241,0.35)]',
} as const;

/** Legacy pill switch (e.g. "Mijozlar | Qo'ng'iroqlar", "Kun | Oy | Yil"). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'sm',
  tone = 'blue',
}: {
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (value: T) => void;
  className?: string;
  size?: 'xs' | 'sm';
  /** Active pill color: blue (history source switch), sky (statistics period), indigo (global date pills). */
  tone?: 'blue' | 'sky' | 'indigo';
}) {
  return (
    <div
      role="radiogroup"
      className={cn('inline-flex gap-0.5 rounded-lg border border-tint/8 bg-sidebar/60 p-0.5', className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md border border-transparent font-medium text-muted-foreground transition-all hover:text-foreground',
            size === 'xs' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs',
            o.value === value && cn('border-tint/14 font-semibold text-ink', ACTIVE[tone]),
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
