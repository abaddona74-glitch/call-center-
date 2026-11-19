import type { LiveOperator } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { PRESENCE_COLOR } from '@/entities/operator';
import { formatSeconds } from '@/entities/telephony';
import { PauseOperatorButton } from '@/features/telephony/pause-operator';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { accentText } from '@/shared/lib/theme';
import { type Medal, ratingOf } from '../model/rating';

/**
 * Operators-tab card (legacy admin-10): avatar, "Jami", then one row per number.
 * The desktop-agent rows of legacy (agent version, PC name) come from the agent module (S4);
 * here the SIP registration and the live state take their place.
 */
export function OperatorStatsCard({ op, controls, medal }: { op: LiveOperator; controls: boolean; medal?: Medal }) {
  const { t } = useTranslation('operatorsPage');
  const { t: tp } = useTranslation('operator');
  const { answered, outbound, missed, missedNoAnswer, missedRejected, transfersIn, talkSeconds } = op.today;
  const total = answered + outbound + transfersIn;
  const offline = op.presence === 'offline';
  const rating = ratingOf(total);
  const ratingTitle = rating.toNext > 0 ? t('rating.next', { n: rating.toNext }) : t('rating.max');
  return (
    <article className={cn('opp-card', offline && 'offline', medal && `mvp-${medal}`)} data-ext={op.extension}>
      <div className="opp-top">
        <div className="opp-av">{op.extension}</div>
        <div className="opp-who">
          <strong>
            {op.name}
            {medal && <span className={`opp-medal ${medal}`}>{t(`rating.medal.${medal}`)}</span>}
            {!medal && rating.stars === 1 && <span className="opp-medal npc">🤖 NPC</span>}
          </strong>
          <small>Exten: {op.extension}</small>
        </div>
        <div className="opp-badges">
          <span className="opp-ext">#{op.extension}</span>
          {rating.stars > 0 && (
            <span className="opp-stars" title={ratingTitle} aria-label={t('rating.stars', { n: rating.stars })}>
              {'★'.repeat(rating.stars)}
            </span>
          )}
          <span className="opp-state" style={{ color: accentText(PRESENCE_COLOR[op.presence]) }}>
            {tp(`presence.${op.presence}`)}
          </span>
        </div>
      </div>
      <div className="opp-total">
        <span className="inline-flex items-center gap-1">
          {t('card.total')}: <Icon name="chart" className="size-3" />
        </span>
        <b>{t('card.count', { n: total })}</b>
      </div>
      <div className="opp-row">
        <span>{t('card.sip')}:</span>
        <span className="opp-pill" style={{ color: op.registered ? 'var(--positive)' : 'var(--danger)' }}>
          <i />
          {t(op.registered ? 'card.active' : 'card.inactive')}
          {op.ip && <em>{op.ip}</em>}
        </span>
      </div>
      <div className="opp-row">
        <span>{t('card.queue')}:</span>
        <span className="text-link-soft">{op.queue ? op.queue.callsTaken : '—'}</span>
      </div>
      <div className="opp-row">
        <span>{t('card.answered')}:</span>
        <span className="text-positive">{t('card.count', { n: answered })}</span>
      </div>
      <div className="opp-row">
        <span>{t('card.outbound')}:</span>
        <span className="text-info">{t('card.count', { n: outbound })}</span>
      </div>
      <div className="opp-row" title={t('card.missedTitle', { noAnswer: missedNoAnswer, rejected: missedRejected })}>
        <span>{t('card.missed')}:</span>
        <span className="text-caution">
          {t('card.count', { n: missed })}
          <span className="ml-1 text-[11px] text-mute">
            ({missedNoAnswer} / {missedRejected})
          </span>
        </span>
      </div>
      <div className="opp-row extra">
        <span>{t('card.talkTotal')}:</span>
        <span className="text-ink">{formatSeconds(talkSeconds)}</span>
      </div>
      <div className="opp-row extra">
        <span>{t('card.talkAvg')}:</span>
        <span className="text-ink">{formatSeconds(total ? talkSeconds / total : 0)}</span>
      </div>
      {controls && !offline && (
        <div className="opp-actions">
          <PauseOperatorButton extension={op.extension} paused={op.paused} />
        </div>
      )}
    </article>
  );
}
