import type { ComponentProps } from 'react';
import { cn } from '@/shared/lib/cn';

/** 6-digit one-time code input (legacy `.code-input`): numeric keyboard, OS code autofill. */
export function OtpInput({
  value,
  onValueChange,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'onChange' | 'value'> & { value: string; onValueChange: (v: string) => void }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      placeholder="······"
      value={value}
      onChange={(e) => onValueChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      className={cn(
        'w-full rounded-[14px] border-2 border-[rgba(59,130,246,0.4)] bg-glass/95 p-4 text-center font-mono text-[28px] font-extrabold tracking-[12px] text-link transition-all outline-none focus:border-[#3b82f6] focus:bg-sidebar focus:shadow-[0_0_0_3px_rgba(59,130,246,0.3)]',
        className,
      )}
      {...props}
    />
  );
}
