import type { Role } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

/** Production legacy users table: superuser purple, operator cyan; the new roles blue and amber. */
const TONE: Record<Role, string> = {
  superuser: 'bg-[rgba(168,85,247,0.2)] text-violet',
  executive: 'bg-[rgba(59,130,246,0.2)] text-link',
  observer: 'bg-[rgba(245,158,11,0.18)] text-caution',
  operator: 'bg-[rgba(56,189,248,0.2)] text-info',
};

export function RoleBadge({ role }: { role: Role }) {
  const { t } = useTranslation('user');
  return (
    <span className={cn('inline-block rounded px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', TONE[role])}>
      {t(`role.${role}`)}
    </span>
  );
}
