import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PRESENCE_COLOR } from '@/entities/operator';
import { useSessionUser } from '@/entities/session';
import { LiveTimer, liveSnapshotQuery } from '@/entities/telephony';
import { ClickToCallForm } from '@/features/telephony/click-to-call';
import { PauseOperatorButton } from '@/features/telephony/pause-operator';
import { Icon } from '@/shared/ui/icon';
import '../i18n';

/** The signed-in operator's own phone: state, pause/unpause and click-to-call (replaces the viewer portal bar). */
export function MyPhone() {
  const { t } = useTranslation('myPhone');
  const { t: tp } = useTranslation('operator');
  const user = useSessionUser();
  const { data: me } = useQuery({
    ...liveSnapshotQuery,
    select: (s) => s.operators.find((o) => o.extension === user.extension),
  });
  if (!user.extension) return null;

  return (
    <section
      className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/8 bg-[#131d31] px-5 py-4"
      aria-label={t('title')}
    >
      <div className="flex items-center gap-3">
        <span
          className="grid size-11 place-items-center rounded-xl border border-[#243050] bg-[#18223a] text-[15px] font-bold tabular-nums"
          style={{ color: me ? PRESENCE_COLOR[me.presence] : undefined }}
        >
          {user.extension}
        </span>
        <div>
          <div className="text-xs text-muted-foreground">{t('title')}</div>
          <div
            className="flex items-center gap-2 text-sm font-semibold"
            style={{ color: me ? PRESENCE_COLOR[me.presence] : undefined }}
          >
            <Icon name="headphone" className="size-4" />
            {me ? tp(`presence.${me.presence}`) : t('unknown')}
            {me && <LiveTimer since={me.presenceSince} className="text-xs font-medium text-muted-foreground" />}
            {me?.paused && me.pauseReason && (
              <span className="text-xs font-medium text-[#fbbf24]">· {me.pauseReason}</span>
            )}
          </div>
        </div>
      </div>
      {me && <PauseOperatorButton paused={me.paused} />}
      <ClickToCallForm className="ml-auto" />
    </section>
  );
}
