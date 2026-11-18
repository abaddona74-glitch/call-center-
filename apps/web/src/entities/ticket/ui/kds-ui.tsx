import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/** `.tk-form-group` + `.tk-form-label` */
export function KdsField({
  label,
  icon,
  htmlFor,
  children,
}: {
  label: string;
  icon?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-3.5 flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-xs font-bold text-ink-2">
        {icon}
        <span>{label}</span>
      </label>
      {children}
    </div>
  );
}

const inputBase =
  'w-full rounded-[10px] border border-tint/12 bg-glass/70 px-3.5 py-2.5 text-[13.5px] text-ink transition-all duration-200 outline-none placeholder:text-dim focus:border-[rgba(56,189,248,0.6)] focus:bg-glass/95 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.2)] disabled:opacity-60';

export function KdsInput({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={cn(inputBase, className)} />;
}

export function KdsTextarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cn(inputBase, 'min-h-[110px] resize-y', className)} />;
}

export function KdsSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select
      {...props}
      className={cn(
        inputBase,
        'bg-glass/85 focus:bg-glass/98 [&_option]:bg-sidebar [&_option]:text-ink',
        className,
      )}
    >
      {children}
    </select>
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
  delete: 'border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.15)] text-danger hover:bg-[rgba(239,68,68,0.25)]',
  edit: 'border-[rgba(56,189,248,0.4)] bg-[rgba(56,189,248,0.15)] text-info hover:bg-[rgba(56,189,248,0.28)] hover:text-ink hover:shadow-[0_4px_14px_rgba(56,189,248,0.3)]',
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
