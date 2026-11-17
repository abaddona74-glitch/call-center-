import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Building blocks with the legacy "Tizim Sozlamalari" look (settings modal of the old dashboard):
 * section cards, card headers, form labels, inputs, selects and action buttons.
 */
export function SettingsCard({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-[14px] border border-white/[0.07] bg-[rgba(15,23,42,0.55)] p-4', className)}
      {...props}
    />
  );
}

export function SettingsCardHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-[rgba(56,189,248,0.35)] bg-[rgba(56,189,248,0.15)] text-[#38bdf8]">
            {icon}
          </div>
        )}
        <div>
          <h4 className="m-0 text-sm font-bold text-[#f1f5f9]">{title}</h4>
          {description && <p className="mt-0.5 text-xs text-[#94a3b8]">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function FieldLabel({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      className={cn('flex items-center justify-between text-xs font-semibold text-[#cbd5e1]', className)}
      {...props}
    />
  );
}

export function FieldHint({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-[11px] leading-snug text-[#64748b]', className)} {...props} />;
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="text-[11px] text-[#f87171]" role="alert">
      {children}
    </p>
  );
}

const fieldBase =
  'w-full rounded-[10px] border border-white/10 bg-[rgba(30,41,59,0.7)] px-3 py-[9px] text-[13px] text-[#f1f5f9] outline-none transition-all placeholder:text-[#64748b] focus:border-[rgba(59,130,246,0.5)] focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] disabled:opacity-60 aria-invalid:border-[rgba(239,68,68,0.6)]';

export function SettingsInput({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldBase, className)} {...props} />;
}

export function SettingsSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(fieldBase, 'cursor-pointer [&>option]:bg-[#0f172a]', className)} {...props} />;
}

type Tone = 'primary' | 'success' | 'danger' | 'ghost';

const tones: Record<Tone, string> = {
  primary:
    'border-[rgba(96,165,250,0.4)] bg-[linear-gradient(135deg,#2563eb,#1d4ed8)] text-white shadow-[0_4px_12px_rgba(37,99,235,0.3)] hover:-translate-y-px hover:shadow-[0_6px_16px_rgba(37,99,235,0.45)]',
  success:
    'border-[rgba(16,185,129,0.4)] bg-[rgba(16,185,129,0.2)] text-[#34d399] hover:bg-[rgba(16,185,129,0.35)] hover:text-white',
  danger:
    'border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.12)] text-[#f87171] hover:bg-[rgba(239,68,68,0.22)] hover:border-[rgba(239,68,68,0.5)]',
  ghost: 'border-white/10 bg-transparent text-[#cbd5e1] hover:bg-white/10 hover:text-white',
};

export function SettingsButton({
  tone = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { tone?: Tone; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border font-semibold whitespace-nowrap transition-all disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'rounded-md px-2 py-1 text-[11px]' : 'px-4 py-2 text-[13px]',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Small colored pill (legacy role-tag / session-op-badge). */
export function Pill({
  tone = 'blue',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: 'blue' | 'green' | 'amber' | 'red' | 'gray' | 'purple' }) {
  const map = {
    blue: 'border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.2)] text-[#60a5fa]',
    green: 'border-[rgba(16,185,129,0.35)] bg-[rgba(16,185,129,0.2)] text-[#34d399]',
    amber: 'border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.15)] text-[#fbbf24]',
    red: 'border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.15)] text-[#f87171]',
    gray: 'border-[rgba(100,116,139,0.3)] bg-[rgba(100,116,139,0.15)] text-[#94a3b8]',
    purple: 'border-[rgba(168,85,247,0.35)] bg-[rgba(168,85,247,0.15)] text-[#c084fc]',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold',
        map[tone],
        className,
      )}
      {...props}
    />
  );
}
