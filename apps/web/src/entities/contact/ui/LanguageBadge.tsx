import type { ContactLanguage } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';

const STYLES: Record<ContactLanguage, string> = {
  uz: 'border-blue-500/35 bg-blue-500/15 text-link',
  ru: 'border-purple-500/35 bg-purple-500/15 text-violet',
  en: 'border-emerald-500/35 bg-emerald-500/15 text-positive',
  other: 'border-amber-500/35 bg-amber-500/15 text-caution',
};

/** Legacy `client-lang-badge`. */
export function LanguageBadge({ language }: { language: ContactLanguage | null }) {
  const { t } = useTranslation('contact');
  const base =
    'inline-flex items-center gap-[5px] rounded-md border px-[9px] py-[3px] text-[11px] leading-[1.3] tracking-[0.2px]';
  if (!language) {
    return <span className={cn(base, 'border-mute/20 bg-mute/10 font-medium text-muted-foreground')}>—</span>;
  }
  return (
    <span className={cn(base, 'font-semibold', STYLES[language])}>
      <Icon name="global" className="size-3" />
      {t(`language.${language}`)}
    </span>
  );
}
