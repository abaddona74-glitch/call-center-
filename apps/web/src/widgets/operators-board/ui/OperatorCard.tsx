import type { LiveOperator } from '@cc/shared';
import { type KeyboardEvent, type MouseEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PRESENCE_CLASS } from '@/entities/operator';
import { LiveTimer, displayPhone, formatSeconds } from '@/entities/telephony';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { grandTotal } from '../model/board';

/**
 * Clicking a card (or Enter/Space on it) opens the operator's calls; clicks on the card's own buttons
 * (pause) stay with those buttons.
 */
export function cardOpenProps(onOpen: (() => void) | undefined, label: string) {
  if (!onOpen) return {};
  return {
    tabIndex: 0,
    title: label,
    'aria-haspopup': 'dialog' as const,
    onClick: (e: MouseEvent<HTMLElement>) => {
      if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
      onOpen();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      onOpen();
    },
  };
}

/** "Muattar Karimova" → "MK", "Muattar" → "M". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Round photo slot ringed in the state colour, with a status dot; initials while there is no photo (or it fails). */
function OperatorPhoto({ name, src }: { name: string; src?: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="av" aria-hidden="true">
      {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : <span>{initials(name)}</span>}
      <i className="dot" />
    </div>
  );
}

/** Legacy "op-redesign" operator card: state bar, live call strip with stopwatch, today's numbers. */
export function OperatorCard({
  op,
  rank,
  next,
  actions,
  onOpen,
  photo,
}: {
  op: LiveOperator;
  rank?: number;
  next?: boolean;
  actions?: ReactNode;
  /** The operator's photo URL; until there is one the slot shows the name's initials. */
  photo?: string | null;
  /** Opens today's calls of this operator; without it the card is not clickable. */
  onOpen?: () => void;
}) {
  const { t } = useTranslation('operatorsBoard');
  const { t: tp } = useTranslation('operator');
  const { t: tt } = useTranslation('telephony');
  const total = grandTotal(op);
  const { answered, outbound, missed, missedNoAnswer, missedRejected, transfersIn, transfersOut, talkSeconds } =
    op.today;
  const handled = answered + outbound + transfersIn;
  const avg = handled ? talkSeconds / handled : 0;
  const phone = displayPhone(op.call?.phone ?? null, tt('hidden'));

  let strip: ReactNode;
  if (op.presence === 'talking' && op.call) {
    strip = (
      <div className="call">
        <div className="wave" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="no">
          <span className="lbl">{t('card.talkingWith')}</span>
          <span className="num">{phone}</span>
        </div>
        <LiveTimer since={op.call.since} thresholds className="timer" />
      </div>
    );
  } else if (op.presence === 'ringing') {
    const outboundCall = op.call?.direction === 'outbound';
    strip = (
      <div className="call ringing">
        <span className="ring-dot" />
        <div className="no">
          <span className="lbl">{t(outboundCall ? 'card.dialing' : 'card.incoming')}</span>
          <span className="num">{op.call ? phone : '—'}</span>
        </div>
      </div>
    );
  } else {
    const idle =
      op.presence === 'paused'
        ? 'card.pausedIdle'
        : op.presence === 'offline'
          ? 'card.offlineIdle'
          : 'card.waitingIdle';
    strip = (
      <div className="call">
        <span
          className="idle"
          style={{
            color:
              op.presence === 'paused' ? 'var(--op-wait)' : op.presence === 'offline' ? 'var(--op-off)' : undefined,
          }}
        >
          {t(idle)}
          {op.presence === 'paused' && op.pauseReason ? ` · ${op.pauseReason}` : ''}
        </span>
      </div>
    );
  }

  return (
    <article
      className={cn('opc', PRESENCE_CLASS[op.presence], next && 'next', onOpen && 'clickable')}
      data-ext={op.extension}
      data-presence={op.presence}
      data-flip-id={op.extension}
      {...cardOpenProps(onOpen, t('detail.open'))}
    >
      <div className="head">
        <OperatorPhoto name={op.name} src={photo} />
        <div className="who">
          <strong>
            <span className="truncate">{op.name}</span>
            {rank !== undefined && (
              <span className={cn('rank', rank === 0 && 'diamond')}>{rank === 0 ? 'MVP' : `#${rank + 1}`}</span>
            )}
          </strong>
          <small>
            Exten {op.extension}
            {/* The situation board gets no addresses: a registered phone without one shows just the extension. */}
            {(op.ip || !op.registered) && ` · ${op.ip ?? '-none-'}`}
          </small>
          <span className="st">{tp(`presence.${op.presence}`)}</span>
        </div>
      </div>

      {strip}

      <div className="total">
        <span className="n">{total}</span>
        <span className="u">{t('card.totalUnit')}</span>
      </div>
      <div className="bar" title={t('card.barTitle', { answered, outbound, missed })}>
        <i style={{ flex: answered || 1, background: 'var(--op-ok)' }} />
        {outbound > 0 && <i style={{ flex: outbound, background: 'var(--info)' }} />}
        {missed > 0 && <i style={{ flex: missed, background: 'var(--op-wait)' }} />}
      </div>
      <dl className="stats">
        <div>
          <dt>{t('card.inbound')}</dt>
          <dd style={{ color: 'var(--op-ok)' }}>{t('card.count', { n: answered })}</dd>
        </div>
        <div>
          <dt>{t('card.outbound')}</dt>
          <dd>{t('card.count', { n: outbound })}</dd>
        </div>
        <div title={t('card.transferTitle', { in: transfersIn, out: transfersOut })}>
          <dt>{t('card.transfer')}</dt>
          <dd className="inline-flex items-center gap-1">
            <span className="inline-flex items-center gap-0.5 text-positive">
              <Icon name="arrow-down" className="size-2.5" />
              {transfersIn}
            </span>
            <span className="font-light text-ink/25">|</span>
            <span className="inline-flex items-center gap-0.5 text-info">
              <Icon name="arrow-up" className="size-2.5" />
              {transfersOut}
            </span>
          </dd>
        </div>
        <div
          className={cn(missed > 0 && 'warn')}
          title={t('card.missedTitle', { noAnswer: missedNoAnswer, rejected: missedRejected })}
        >
          <dt>{t('card.missed')}</dt>
          <dd>{t('card.count', { n: missed })}</dd>
        </div>
        <div>
          <dt>{t('card.talkTotal')}</dt>
          <dd>{formatSeconds(talkSeconds)}</dd>
        </div>
        <div>
          <dt>{t('card.talkAvg')}</dt>
          <dd>{formatSeconds(avg)}</dd>
        </div>
      </dl>
      <div className="foot">
        <span>
          {/* Legacy "Agent faol" came from the 3CX desktop agent; now the phone's SIP registration (AMI). */}
          <em style={{ color: op.registered ? 'var(--op-ok)' : 'var(--op-mu)' }} title={t('card.phoneTitle')}>
            ● {t(op.registered ? 'card.phoneOnline' : 'card.phoneOffline')}
          </em>
        </span>
        <span className="right">
          {op.queue && <span title={t('card.queueTitle')}>{t('card.queueTaken', { n: op.queue.callsTaken })}</span>}
          {actions}
        </span>
      </div>
    </article>
  );
}
