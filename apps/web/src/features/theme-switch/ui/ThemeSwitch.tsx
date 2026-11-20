import { type CSSProperties, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { setTheme, useTheme } from '@/shared/lib/theme';
import { Icon } from '@/shared/ui/icon';
import '../i18n';

const FOCUS = 'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

/**
 * Dark / light theme switch: a pill with the sun on the left and the moon on the right; the knob sits on the
 * current theme. `compact` (the folded sidebar rail, no room for the pill) is a single icon button showing
 * the theme it switches to.
 *
 * The knob slides in step with the page's theme crossfade: switching the theme is a View Transition
 * (shared/lib/page-transition), and the knob is its own part of it (`view-transition-class: theme-knob`),
 * so the browser moves it from the old side to the new one over the same duration and easing as the
 * background fade (`--theme-fade` in app/styles/index.css): both start and end on the same frame. Its side
 * comes from the `dark` class on <html>, which flips in the same step as the colours.
 */
export function ThemeSwitch({ className, compact }: { className?: string; compact?: boolean }) {
  const { t } = useTranslation('themeSwitch');
  const dark = useTheme() === 'dark';
  const action = t(dark ? 'toLight' : 'toDark');
  // A name unique per switch on the page (the sidebar's and the phone header's): a repeated name cancels the transition.
  const knobName = `theme-knob-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;
  const toggle = () => setTheme(dark ? 'light' : 'dark');

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={action}
        title={action}
        className={cn(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-tint/10 bg-tint/5 text-mute transition-colors hover:border-primary/50 hover:text-ink',
          FOCUS,
          className,
        )}
      >
        <Icon name={dark ? 'sun-1' : 'moon'} className="size-[18px]" />
      </button>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={t('dark')}
      title={action}
      onClick={toggle}
      className={cn(
        'relative inline-flex h-8 w-[60px] shrink-0 cursor-pointer items-center justify-between rounded-full border border-tint/10 bg-tint/5 px-[7px] text-mute transition-colors hover:border-primary/50 hover:text-ink',
        FOCUS,
        className,
      )}
    >
      <Icon name="sun-1" className="size-4" />
      <Icon name="moon" className="size-4" />
      <span
        aria-hidden="true"
        style={{ viewTransitionName: knobName, viewTransitionClass: 'theme-knob' } as CSSProperties}
        className="absolute top-[3px] left-[3px] flex size-6 items-center justify-center rounded-full bg-card shadow-[0_1px_4px_color-mix(in_srgb,var(--shadow-color)_70%,transparent)] dark:translate-x-7"
      >
        <Icon name="sun-1" className="size-3.5 text-caution dark:hidden" />
        <Icon name="moon" className="hidden size-3.5 text-primary dark:block" />
      </span>
    </button>
  );
}
