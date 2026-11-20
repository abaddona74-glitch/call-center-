import { useTranslation } from 'react-i18next';
import { type Language, LANGUAGES, setLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/cn';
import '../i18n';

/**
 * Interface language as one button: shows the current language (UZ / RU) and a click switches to the next
 * one, with no dropdown in between. Sits next to the theme toggle and matches it.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t, i18n } = useTranslation('languageSwitch');
  const current = (LANGUAGES as readonly string[]).includes(i18n.language) ? (i18n.language as Language) : LANGUAGES[0];
  const next = LANGUAGES[(LANGUAGES.indexOf(current) + 1) % LANGUAGES.length];
  const label = t(`to_${next}`);
  return (
    <button
      type="button"
      onClick={() => setLanguage(next)}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-8 min-w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-tint/10 bg-tint/5 px-2 text-xs font-bold tracking-wide text-ink-2 transition-colors hover:border-primary/50 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      {current.toUpperCase()}
    </button>
  );
}
