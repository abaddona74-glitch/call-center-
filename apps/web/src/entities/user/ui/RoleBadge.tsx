import type { Role } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { Pill } from '@/shared/ui/settings-panel';

const TONE = { superuser: 'blue', admin: 'purple', operator: 'green' } as const;

/** Legacy `.role-tag`: blue superuser, green operator (admin gets purple). */
export function RoleBadge({ role }: { role: Role }) {
  const { t } = useTranslation('user');
  return <Pill tone={TONE[role]}>{t(`role.${role}`)}</Pill>;
}
