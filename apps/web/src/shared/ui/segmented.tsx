import { cn } from '@/shared/lib/cn';

/** Legacy pill switch (e.g. "Mijozlar | Qo'ng'iroqlar", "Kun | Oy | Yil"). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'sm',
}: {
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (value: T) => void;
  className?: string;
  size?: 'xs' | 'sm';
}) {
  return (
    <div role="radiogroup" className={cn('inline-flex gap-0.5 rounded-lg border border-white/8 bg-sidebar/60 p-0.5', className)}>
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
            o.value === value && 'border-white/14 bg-gradient-to-br from-chart-6 to-chart-6/85 font-semibold text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
