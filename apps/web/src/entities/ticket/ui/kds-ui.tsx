import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';

/** `.tk-form-group` + `.tk-form-label` */
export function KdsField({ label, icon, htmlFor, children }: { label: string; icon?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-xs font-bold text-[#cbd5e1]">
        {icon}
        <span>{label}</span>
      </label>
      {children}
    </div>
  );
}

const inputBase =
  'w-full rounded-[10px] border border-white/12 bg-[rgba(15,23,42,0.7)] px-3.5 py-2.5 text-[13.5px] text-white transition-all duration-200 outline-none placeholder:text-[#64748b] focus:border-[rgba(56,189,248,0.6)] focus:bg-[rgba(15,23,42,0.95)] focus:shadow-[0_0_0_3px_rgba(56,189,248,0.2)] disabled:opacity-60';

export function KdsInput({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={cn(inputBase, className)} />;
}

export function KdsTextarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cn(inputBase, 'min-h-[110px] resize-y', className)} />;
}

export function KdsSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select {...props} className={cn(inputBase, 'bg-[rgba(15,23,42,0.85)] focus:bg-[rgba(15,23,42,0.98)] [&_option]:bg-[#0f172a] [&_option]:text-[#f1f5f9]', className)}>
      {children}
    </select>
  );
}

/** `.tk-urgent-toggle-row` with the `.tk-switch` */
export function UrgentToggle({
  checked,
  onChange,
  label,
  description,
  switchTitle,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
  switchTitle: string;
}) {
  return (
    <div
      className={cn(
        'mb-3.5 flex items-center justify-between rounded-[10px] border px-3.5 py-3 transition-all duration-[250ms]',
        checked
          ? 'border-[rgba(239,68,68,0.55)] bg-[rgba(239,68,68,0.16)] shadow-[0_0_15px_rgba(239,68,68,0.25)]'
          : 'border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.08)]',
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-[13px] font-bold text-[#f1f5f9]">
          <Icon name="flash" className="size-4 text-[#f59e0b]" />
          {label}
        </span>
        <span className="text-[11px] text-[#94a3b8]">{description}</span>
      </div>
      <label title={switchTitle} className="relative h-6 w-[46px] shrink-0 cursor-pointer">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={switchTitle} />
        <span
          className={cn(
            'absolute inset-0 rounded-3xl border transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] peer-focus-visible:ring-2 peer-focus-visible:ring-[#38bdf8]',
            checked
              ? 'border-[#ef4444] bg-[linear-gradient(135deg,#ef4444,#f97316)] shadow-[0_0_12px_rgba(239,68,68,0.6)]'
              : 'border-white/15 bg-[rgba(71,85,105,0.6)]',
          )}
        />
        <span
          className={cn(
            'absolute bottom-0.5 left-0.5 size-[18px] rounded-full bg-white shadow-[0_2px_5px_rgba(0,0,0,0.3)] transition-transform duration-300',
            checked && 'translate-x-[22px]',
          )}
        />
      </label>
    </div>
  );
}

export type ActionVariant = 'accept' | 'complete' | 'reject' | 'delete' | 'edit' | 'primary';

const ACTION: Record<ActionVariant, string> = {
  accept:
    'bg-[linear-gradient(135deg,#8b5cf6,#7c3aed)] text-white shadow-[0_4px_14px_rgba(139,92,246,0.35)] hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(139,92,246,0.5)]',
  complete:
    'bg-[linear-gradient(135deg,#10b981,#059669)] text-white shadow-[0_4px_14px_rgba(16,185,129,0.35)] hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(16,185,129,0.5)]',
  primary:
    'bg-[linear-gradient(135deg,#2563eb,#1d4ed8)] text-white shadow-[0_4px_14px_rgba(37,99,235,0.35)] hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(37,99,235,0.5)]',
  reject:
    'bg-[linear-gradient(135deg,#ef4444,#dc2626)] text-white shadow-[0_4px_14px_rgba(239,68,68,0.35)] hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(239,68,68,0.5)]',
  delete: 'border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.15)] text-[#f87171] hover:bg-[rgba(239,68,68,0.25)]',
  edit:
    'border-[rgba(56,189,248,0.4)] bg-[rgba(56,189,248,0.15)] text-[#38bdf8] hover:bg-[rgba(56,189,248,0.28)] hover:text-white hover:shadow-[0_4px_14px_rgba(56,189,248,0.3)]',
};

/** `.tk-action-btn.{variant}` */
export function KdsAction({ variant, className, ...props }: ComponentProps<'button'> & { variant: ActionVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex items-center gap-2 rounded-[10px] border border-transparent px-[18px] py-[9px] text-[13px] font-bold transition-[transform,background-color,border-color,box-shadow,color] duration-[140ms] active:scale-[0.96] disabled:cursor-wait disabled:opacity-60',
        ACTION[variant],
        className,
      )}
    />
  );
}
