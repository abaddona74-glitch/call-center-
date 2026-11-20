import { useTranslation } from 'react-i18next';
import { LiveTimer, carrierOf, displayPhone, useLiveSnapshot } from '@/entities/telephony';
import { cn } from '@/shared/lib/cn';
import { accentText } from '@/shared/lib/theme';
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
  const { data } = useLiveSnapshot((s) => ({ queues: s.queues, calls: s.calls }));
  const waiting = (data?.queues ?? []).flatMap((q) => q.waiting.map((w) => ({ ...w, queue: q.name })));
  const ivr = (data?.calls ?? []).filter((c) => c.state === 'ivr' && c.direction === 'inbound');

  return (
    <div className={cn('qp', waiting.length > 0 && 'has-waiting')}>
      <div className="qp-head">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="user" className="ic size-3.5" />
          {t('title')}
        </span>
        <span className="qp-badge">{t('count', { n: waiting.length })}</span>
      </div>
      <div className="qp-list">
        {waiting.length === 0 && ivr.length === 0 && <div className="qp-empty">{t('empty')}</div>}
        {waiting.map((w) => {
          const carrier = carrierOf(w.phone);
          return (
            <div key={w.callId} className="qp-item" data-call-id={w.callId} title={`${t('queue')} ${w.queue}`}>
              <span className="qp-ic">
                <Icon name="call-incoming" className="size-3.5" />
              </span>
              <div className="qp-main">
                <span className="qp-num">{displayPhone(w.phone, tt('hidden'))}</span>
                {carrier && (
                  <span className="qp-carrier" style={{ color: accentText(carrier.color) }}>
                    <Icon name="simcard" className="size-2.5" />
                    {carrier.name}
                  </span>
                )}
              </div>
              <div className="qp-right">
                <span className="qp-pos">{t('position', { n: w.position })}</span>
                {/* amber after 3 min, pulsing red after 7 min of waiting */}
                <span className="qp-wait" title={t('waitTitle')}>
                  <Icon name="timer" className="size-3 text-info" />
                  <LiveTimer since={w.joinedAt} thresholds />
                </span>
              </div>
            </div>
          );
        })}
        {ivr.map((c) => (
          <div key={c.id} className="qp-item is-ivr" data-call-id={c.id}>
            <span className="qp-ivr">IVR</span>
            <div className="qp-main">
              <span className="qp-num">{displayPhone(c.phone, tt('hidden'))}</span>
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
