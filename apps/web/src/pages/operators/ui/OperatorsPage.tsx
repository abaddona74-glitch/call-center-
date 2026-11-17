import { hasRoleAtLeast } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSessionUser } from '@/entities/session';
import { liveSnapshotQuery, useLiveTelephonySync } from '@/entities/telephony';
import { ClickToCallForm } from '@/features/telephony/click-to-call';
import { MyPhone } from '@/widgets/my-phone';
import { OperatorsBoard } from '@/widgets/operators-board';
import '../i18n';

/**
 * Operators (legacy "/operators"): every operator with live state and today's numbers.
 * Admins can pause/unpause anyone and place a call from any operator's phone.
 * (Desktop-agent logs and the CDR sync of the legacy tab belong to the agent module, S4.)
 */
export function OperatorsPage() {
  useLiveTelephonySync();
  const { t } = useTranslation('operatorsPage');
  const user = useSessionUser();
  const isAdmin = hasRoleAtLeast(user.role, 'admin');
  const { data: operators } = useQuery({ ...liveSnapshotQuery, select: (s) => s.operators });

  return (
    <div className="flex flex-col gap-6">
      <MyPhone />
      {isAdmin && (
        <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/8 bg-[#131d31] px-5 py-4">
          <div className="text-sm font-semibold">{t('callFrom')}</div>
          <ClickToCallForm operators={operators ?? []} className="ml-auto" />
        </section>
      )}
      <OperatorsBoard controls={isAdmin} sortable />
    </div>
  );
}
