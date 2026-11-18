import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { callbackSettingsQuery } from '@/entities/callback';
import { CallbackSettingsForm } from '@/features/callbacks/edit-settings';
import { Icon } from '@/shared/ui/icon';

/** Admin: the callbacks threshold. Working days, hours and holidays live in Settings → Ish vaqti. */
export function CallbackSettingsPage() {
  const { t } = useTranslation('callbacksSettingsPage');
  const { data } = useSuspenseQuery(callbackSettingsQuery);
  return (
    <div className="max-w-[760px] rounded-2xl border border-white/[0.08] bg-muted p-[22px]">
      <h3 className="mb-1 inline-flex items-center gap-2 text-base font-semibold">
        <Icon name="calendar" className="size-5" />
        {t('title')}
      </h3>
      <p className="mb-5 text-xs text-slate-400">
        {t('subtitle')}{' '}
        <Link to="/settings/calendar" className="font-semibold text-indigo-300 hover:underline">
          {t('calendarLink')} →
        </Link>
      </p>
      <CallbackSettingsForm initial={data} />
    </div>
  );
}
