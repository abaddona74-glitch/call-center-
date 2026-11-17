import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatSeconds, liveSnapshotQuery } from '@/entities/telephony';
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
}: {
  color: string;
  icon: string;
  label: string;
  value: number;
  badge?: string;
  badgeCls?: string;
  sub: ReactNode;
}) {
  const { t } = useTranslation('liveCounters');
  return (
    <div className={`kpi-card ${color}`}>
      <div className="kpi-icon">
        <img src={`/images/kpi/${icon}.png`} alt="" width={54} height={54} />
      </div>
      <div className="kpi-details">
        <p>{label}</p>
        <h3>
          <span>{value}</span>
          <span className="kpi-unit">{t('unit')}</span>
          {badge && <span className={`kpi-badge ${badgeCls}`}>{badge}</span>}
        </h3>
        <div className="kpi-sub">{sub}</div>
      </div>
    </div>
  );
}

/**
 * Today's KPI cards from live AMI counters (admins only; operators get no counters).
 * They cover the time the API has been connected today — CDR statistics are the reference (S2).
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
  const since = new Date(c.since);
  const partial = since.getHours() * 60 + since.getMinutes() > 5;
  const sinceText = `${String(since.getHours()).padStart(2, '0')}:${String(since.getMinutes()).padStart(2, '0')}`;

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
          sub={<span>{t('missedHint')}</span>}
        />
        <Kpi
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
      {partial && <div className="kpi-note">{t('since', { time: sinceText })}</div>}
    </section>
  );
}
