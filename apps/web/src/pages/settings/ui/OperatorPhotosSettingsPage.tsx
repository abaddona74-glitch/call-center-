import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { operatorPhotosQuery } from '@/entities/operator-photo';
import { OperatorPhotosManager } from '@/features/operator-photos/manage';
import { SettingsCard, SettingsCardHeader } from '@/shared/ui/settings-panel';

/** "Operator rasmlari": the photos shown in the operator cards (owner, 20.11.2026). */
export function OperatorPhotosSettingsPage() {
  const { t } = useTranslation('settings');
  const { data } = useSuspenseQuery(operatorPhotosQuery);
  return (
    <SettingsCard>
      <SettingsCardHeader title={t('photos.title')} description={t('photos.description')} />
      <OperatorPhotosManager initial={data} />
    </SettingsCard>
  );
}
