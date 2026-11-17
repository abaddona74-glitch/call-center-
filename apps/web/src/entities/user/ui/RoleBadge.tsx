import type { Role } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

/** Production legacy users table: superuser purple, operator cyan (admin did not exist in the UI — blue). */
const TONE: Record<Role, string> = {
  superuser: 'bg-[rgba(168,85,247,0.2)] text-[#c084fc]',
  admin: 'bg-[rgba(59,130,246,0.2)] text-[#60a5fa]',
  operator: 'bg-[rgba(56,189,248,0.2)] text-[#38bdf8]',
};

export function RoleBadge({ role }: { role: Role }) {
  const { t } = useTranslation('user');
  return (
    <span className={cn('inline-block rounded px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', TONE[role])}>
      {t(`role.${role}`)}
    </span>
  );
}
