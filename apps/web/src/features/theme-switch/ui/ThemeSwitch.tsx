import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { setTheme, useTheme } from '@/shared/lib/theme';
import { Icon } from '@/shared/ui/icon';
import '../i18n';

/** Dark / light theme toggle: shows the theme it switches to (sun in dark, moon in light). */
export function ThemeSwitch({ className }: { className?: string }) {
  const { t } = useTranslation('themeSwitch');
  const theme = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = t(next === 'light' ? 'toLight' : 'toDark');
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-tint/10 bg-tint/5 text-mute transition-colors hover:border-primary/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      <Icon name={next === 'light' ? 'sun-1' : 'moon'} className="size-[18px]" />
    </button>
  );
}
