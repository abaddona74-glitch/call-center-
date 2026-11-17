import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LiveTimer, carrierOf, displayPhone, liveSnapshotQuery } from '@/entities/telephony';
import { Icon } from '@/shared/ui/icon';
import '../i18n';
import './queues.css';

/**
 * "NAVBATDA KUTAYOTGANLAR": callers waiting in any queue (with position and live wait time),
 * plus callers still in the IVR, shown separately with an "IVR" tag (legacy mixed them in).
 */
export function QueueWaiters() {
  const { t } = useTranslation('queues');
  const { t: tt } = useTranslation('telephony');
  const { data } = useQuery({ ...liveSnapshotQuery, select: (s) => ({ queues: s.queues, calls: s.calls }) });
  const waiting = (data?.queues ?? []).flatMap((q) => q.waiting.map((w) => ({ ...w, queue: q.name })));
  const ivr = (data?.calls ?? []).filter((c) => c.state === 'ivr' && c.direction === 'inbound');

  return (
    <div className="qp">
      <div className="qp-head">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="user" className="size-3.5" />
          {t('title')}
        </span>
        <span className="qp-badge">{t('count', { n: waiting.length })}</span>
      </div>
      <div className="qp-list">
        {waiting.length === 0 && ivr.length === 0 && <div className="qp-empty">{t('empty')}</div>}
        {waiting.map((w) => {
          const carrier = carrierOf(w.phone);
          return (
            <div key={w.callId} className="qp-item" data-call-id={w.callId}>
              <span className="qp-pos">{w.position}</span>
              <div className="min-w-0 flex-1">
                <div className="qp-num">{displayPhone(w.phone, tt('hidden'))}</div>
                <div className="qp-meta">
                  <span>
                    {t('queue')} {w.queue}
                  </span>
                  {carrier && <span style={{ color: carrier.color }}>{carrier.name}</span>}
                </div>
              </div>
              <span className="qp-wait" title={t('waitTitle')}>
                <Icon name="timer" className="size-2.5 text-[#38bdf8]" />
                <LiveTimer since={w.joinedAt} />
              </span>
            </div>
          );
        })}
        {ivr.map((c) => (
          <div key={c.id} className="qp-item opacity-80" data-call-id={c.id}>
            <span className="qp-ivr">IVR</span>
            <div className="min-w-0 flex-1">
              <div className="qp-num">{displayPhone(c.phone, tt('hidden'))}</div>
            </div>
            <span className="qp-wait">
              <LiveTimer since={c.startedAt} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
