import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatSeconds, liveSnapshotQuery } from '@/entities/telephony';
import { tashkentDateTime } from '@/shared/lib/tashkent-time';
import { Icon } from '@/shared/ui/icon';
import '../i18n';
import './live-counters.css';

function Kpi({
  color,
  icon,
  label,
  value,
  badge,
  badgeCls,
  sub,
  extra = false,
}: {
  color: string;
  icon: string;
  label: string;
  value: number;
  badge?: string;
  badgeCls?: string;
  sub: ReactNode;
  /** Hidden when the grid is narrow (legacy shows 6 cards while the monitor panel is open). */
  extra?: boolean;
}) {
  const { t } = useTranslation('liveCounters');
  return (
    <div className={`kpi-card ${color}${extra ? ' extra' : ''}`}>
      <div className="kpi-icon">
        <img src={`/images/kpi/${icon}.png`} alt="" width={54} height={54} />
      </div>
      <div className="kpi-details">
        <p>{label}</p>
        <h3>
          {/* re-mounts on change -> legacy `numberPop` */}
          <span key={value} className="kpi-num">
            {value}
          </span>
          <span className="kpi-unit">{t('unit')}</span>
          {badge && <span className={`kpi-badge ${badgeCls}`}>{badge}</span>}
        </h3>
        <div className="kpi-sub">
          <Icon name="user" />
          {sub}
        </div>
      </div>
    </div>
  );
}

/** "HH:mm" in Tashkent. */
const hhmm = (iso: string) => tashkentDateTime(iso).slice(11, 16);

/**
 * Today's KPI cards (admins only; operators get no counters). The calls before the API started counting live come
 * from the PBX CDR (`seededThrough`), later ones from AMI; without that seed they cover only the time since `since`.
 */
export function LiveCounters() {
  const { t } = useTranslation('liveCounters');
  const { data } = useQuery({
    ...liveSnapshotQuery,
    select: (s) => ({
      c: s.counters,
      waiting: s.queues.reduce((n, q) => n + q.waiting.length, 0),
      talking: s.calls.filter((c) => c.state === 'talking').length,
      online: s.operators.filter((o) => o.presence !== 'offline').length,
    }),
  });
  const c = data?.c;
  if (!c || !data) return null;
  const pct = (n: number, d: number) => (d ? `${Math.round((n * 100) / d)}%` : '0%');
  const sinceText = hhmm(c.since);
  const [h, m] = sinceText.split(':').map(Number);
  // Whole day: seeded from the CDR, or counted live since (about) midnight.
  const note = c.seededThrough
    ? t('seeded', { time: hhmm(c.seededThrough) })
    : h * 60 + m > 5
      ? t('since', { time: sinceText })
      : null;

  return (
    <section className="kpi-wrap" aria-label={t('title')}>
      <div className="kpi-grid">
        <Kpi
          color="blue"
          icon="totalcalls"
          label={t('total')}
          value={c.inbound + c.outbound}
          sub={
            <span>
              {t('talkTime')}: <b>{formatSeconds(c.talkSeconds)}</b>
            </span>
          }
        />
        <Kpi
          color="cyan"
          icon="incomingcall"
          label={t('inbound')}
          value={c.inbound}
          sub={
            <span>
              {t('unanswered')}: <b>{c.unanswered}</b>
            </span>
          }
        />
        <Kpi
          color="purple"
          icon="outgoingcall"
          label={t('outbound')}
          value={c.outbound}
          badge={pct(c.outboundAnswered, c.outbound)}
          badgeCls="purple"
          sub={
            <span>
              {t('connected')}: <b>{c.outboundAnswered}</b>
            </span>
          }
        />
        <Kpi
          color="amber"
          icon="queue"
          label={t('abandoned')}
          value={c.abandoned}
          badge={pct(c.abandoned, c.inbound)}
          badgeCls="warning"
          sub={
            <span>
              {t('ivrOnly')}: <b>{c.ivrOnly}</b>
            </span>
          }
        />
        <Kpi
          color="indigo"
          icon="stillinqueue"
          label={t('waiting')}
          value={data.waiting}
          sub={
            <span>
              {t('talkingNow')}: <b>{data.talking}</b>
            </span>
          }
        />
        <Kpi
          color="red"
          icon="missedcall"
          label={t('missed')}
          value={c.operatorMissed}
          sub={
            <span title={t('missedHint')}>
              {t('missedNoAnswer')} <b>{c.operatorMissedNoAnswer}</b> · {t('missedRejected')}{' '}
              <b>{c.operatorMissedRejected}</b>
            </span>
          }
        />
        {/* Shown when there is room (legacy: only with the monitor panel collapsed). */}
        <Kpi
          extra
          color="green"
          icon="answered-calls-icon"
          label={t('answered')}
          value={c.answered}
          badge={`${c.answerRate}%`}
          badgeCls="success"
          sub={
            <span>
              {t('hangupClient')}: <b>{c.clientHangups}</b> · {t('hangupOperator')}: <b>{c.operatorHangups}</b>
            </span>
          }
        />
        <Kpi
          extra
          color="cyan"
          icon="answered-calls-icon"
          label={t('onlineOps')}
          value={data.online}
          sub={
            <span>
              {t('talkingNow')}: <b>{data.talking}</b>
            </span>
          }
        />
      </div>
      {note && <div className="kpi-note">{note}</div>}
    </section>
  );
}
