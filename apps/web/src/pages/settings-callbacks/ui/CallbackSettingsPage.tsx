import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { callbackSettingsQuery } from '@/entities/callback';
import { CallbackSettingsForm } from '@/features/callbacks/edit-settings';
import { Icon } from '@/shared/ui/icon';

/** Admin: working calendar used by the callbacks rules (owner decision: Mon–Fri 08:00–21:00 + holidays). */
export function CallbackSettingsPage() {
  const { t } = useTranslation('callbacksSettingsPage');
  const { data } = useSuspenseQuery(callbackSettingsQuery);
  return (
    <div className="max-w-[760px] rounded-2xl border border-white/[0.08] bg-muted p-[22px]">
      <h3 className="mb-1 inline-flex items-center gap-2 text-base font-semibold">
        <Icon name="calendar" className="size-5" />
        {t('title')}
      </h3>
      <p className="mb-5 text-xs text-slate-400">{t('subtitle')}</p>
      <CallbackSettingsForm initial={data} />
    </div>
  );
}
