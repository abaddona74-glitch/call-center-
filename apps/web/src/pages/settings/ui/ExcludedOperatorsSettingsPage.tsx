import { useSuspenseQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { excludedOperatorsQuery } from '@/entities/excluded-operator';
import { ExcludedOperatorsForm } from '@/features/excluded-operators/edit';
import { SettingsCard, SettingsCardHeader } from '@/shared/ui/settings-panel';

/** "Statistika & Exclude List": operators left out of the board, the per-operator statistics and reports. */
export function ExcludedOperatorsSettingsPage() {
  const { t } = useTranslation('settings');
  const { data } = useSuspenseQuery(excludedOperatorsQuery);
  return (
    <SettingsCard>
      <SettingsCardHeader title={t('exclude.title')} description={t('exclude.description')} />
      <ExcludedOperatorsForm initial={data} />
    </SettingsCard>
  );
}
