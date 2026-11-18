import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { callbackSettingsQuery } from '@/entities/callback';
import { workingCalendarQuery } from '@/entities/working-calendar';
import { CallbackSettingsForm } from '@/features/callbacks/edit-settings';
import { WorkingCalendarForm } from '@/features/working-calendar/edit';
import { Icon } from '@/shared/ui/icon';
import { SettingsCard, SettingsCardHeader } from '@/shared/ui/settings-panel';

/** "Ish vaqti": the one working calendar (owner decision 2026-11-18) and the callbacks threshold. */
export function WorkingCalendarSettingsPage() {
  const { t } = useTranslation('settings');
  const { data: calendar } = useSuspenseQuery(workingCalendarQuery);
  const { data: callbacks } = useSuspenseQuery(callbackSettingsQuery);
  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <SettingsCard>
        <SettingsCardHeader
          icon={<Icon name="calendar" className="size-5" />}
          title={t('calendar.title')}
          description={t('calendar.description')}
        />
        <WorkingCalendarForm initial={calendar} />
      </SettingsCard>
      <SettingsCard>
        <SettingsCardHeader
          icon={<Icon name="call" className="size-5" />}
          title={t('calendar.callbacksTitle')}
          description={t('calendar.callbacksDescription')}
        />
        <CallbackSettingsForm initial={callbacks} />
      </SettingsCard>
    </div>
  );
}
