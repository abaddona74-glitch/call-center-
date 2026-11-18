import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { workingCalendarQuery } from '@/entities/working-calendar';
import { WorkingCalendarForm } from '@/features/working-calendar/edit';
import { Icon } from '@/shared/ui/icon';
import { SettingsCard, SettingsCardHeader } from '@/shared/ui/settings-panel';

/** "Ish vaqti": the one working calendar (owner decision 2026-11-18). */
export function WorkingCalendarSettingsPage() {
  const { t } = useTranslation('settings');
  const { data } = useSuspenseQuery(workingCalendarQuery);
  return (
    <SettingsCard className="max-w-[760px]">
      <SettingsCardHeader
        icon={<Icon name="calendar" className="size-5" />}
        title={t('calendar.title')}
        description={t('calendar.description')}
      />
      <WorkingCalendarForm initial={data} />
    </SettingsCard>
  );
}
