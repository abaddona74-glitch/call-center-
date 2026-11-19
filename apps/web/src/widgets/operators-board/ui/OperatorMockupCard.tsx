import { type Contact, type LiveOperator, isMaskedPhone } from '@cc/shared';
import { Bell } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { displayPhone, formatSeconds, useElapsed } from '@/entities/telephony';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import {
  STAR_THRESHOLDS,
  type SurveyScore,
  type Tier,
  grandTotal,
  starLevel,
  surveyPercent,
  tierOf,
} from '../model/board';

/** The phone on the operator's current call, plus what the phonebook knows about it. */
export interface MockupContactTarget {
  phone: string;
  contact: Contact | null;
}

/**
 * Operator-portal card (legacy viewer `op-mockup`): avatar with a crown and a neon ring by rank —
 * #1 Diamond (MVP), #2 Gold, #3–#4 Silver — stars for today's calls, "Samaradorlik" from the clients'
 * post-call ratings, equalizer, the live call with the saved client.
 */
export function OperatorMockupCard({
  op,
  rank,
  survey,
  surveyAvailable = true,
  next,
  contact,
  onContact,
}: {
  op: LiveOperator;
  /** Place on the call-center leaderboard (0 = first), undefined without calls today. */
  rank?: number;
  /** Today's client ratings of this operator; undefined while not loaded or without ratings. */
  survey?: SurveyScore;
  /** false when the PBX has no survey table (or it could not be read). */
  surveyAvailable?: boolean;
  next?: boolean;
  /** Saved client for the current call's number. */
  contact?: Contact;
  /** Open the phonebook form for the current call; omitted when the user may not edit contacts. */
  onContact?: (target: MockupContactTarget) => void;
}) {
  const { t } = useTranslation('operatorsBoard');
  const { t: tt } = useTranslation('telephony');
  const total = grandTotal(op);
  const tier = total > 0 ? tierOf(rank) : null;
  const score = surveyPercent(survey?.avg);
  const scoreTitle = !surveyAvailable
    ? t('mockup.surveyOff')
    : score === null || !survey?.avg
      ? t('mockup.surveyNone')
      : t('mockup.surveyTitle', { avg: survey.avg.toFixed(1), n: survey.count });
  const { answered, outbound, transfersIn, talkSeconds } = op.today;
  const avg = total ? talkSeconds / total : 0;

  const ringing = op.presence === 'ringing';
  const talking = op.presence === 'talking';
  const outboundRing = ringing && op.call?.direction === 'outbound';
  const phone = op.call ? displayPhone(op.call.phone, tt('hidden')) : null;
  const realPhone = op.call?.phone && !isMaskedPhone(op.call.phone) ? op.call.phone : null;
  const openContact =
    realPhone && onContact ? () => onContact({ phone: realPhone, contact: contact ?? null }) : undefined;

  const status = outboundRing ? 'dialing' : op.presence;
  const badge = {
    idle: 'ready',
    ringing: outboundRing ? 'dialing' : 'ringing',
    talking: 'talking',
    paused: 'paused',
    offline: 'offline',
  }[op.presence];

  return (
    <article
      className={cn(
        'obm',
        tier && `tier-${tier}`,
        ringing && (outboundRing ? 'call-outbound-ringing' : 'call-ringing'),
        talking && 'call-talking',
        op.presence === 'paused' && 'status-paused',
        next && 'next',
      )}
      data-ext={op.extension}
      data-presence={op.presence}
      data-flip-id={op.extension}
    >
      {(ringing || talking) && (
        <div className={cn('obm-strip', talking ? 'talking' : outboundRing ? 'outbound-ringing' : 'ringing')} />
      )}
      {next && <NextInLineBadge title={t('mockup.nextTitle')} />}

      <div className="obm-body">
        <div className="obm-profile">
          <div className="obm-avatar-wrap">
            {tier && <div className={`obm-crown crown-${tier}`} aria-hidden="true" />}
            <div className={`obm-avatar ring-${tier ?? 'regular'}`}>
              <span className="obm-ext">{op.extension}</span>
            </div>
          </div>
          <RankPill tier={tier} rank={rank} total={total} extension={op.extension} />
        </div>

        <div className="obm-content">
          <div className="obm-head">
            <div className="obm-line">
              <h4 className="obm-name" title={op.name}>
                {op.name}
              </h4>
              <span
                className={`obm-badge badge-${badge}`}
                title={op.presence === 'paused' && op.pauseReason ? op.pauseReason : undefined}
              >
                <span className="dot" />
                {t(`mockup.status.${status}`)}
              </span>
            </div>
            <div className="obm-line obm-line-2">
              <span className="obm-corner">{tier && <TierIcon tier={tier} rank={rank ?? 0} />}</span>
              {talking && op.call && <TalkTimer since={op.call.since} title={t('mockup.timerTitle')} />}
            </div>
          </div>

          <div className="obm-meta">
            <span className="obm-ext-sub">Ext: {op.extension}</span>
            <span className="obm-sep">•</span>
            {/* Legacy showed the desktop agent's PC name; the new system knows the phone's SIP registration. */}
            <span className="obm-phone" title={t('card.phoneTitle')}>
              <span className={cn('obm-dot', op.registered && 'online')} />
              {op.registered ? (op.ip ?? t('card.phoneOnline')) : t('card.phoneOffline')}
            </span>
            <StarRating total={total} name={op.name} />
          </div>

          <div className="obm-stats">
            <div className="obm-row" title={t('mockup.callsTitle', { answered, outbound, in: transfersIn })}>
              <span className="obm-label">{t('mockup.calls')}</span>
              <span className="obm-val val-calls">{total}</span>
            </div>
            <div className="obm-row" title={t('mockup.totalTalk', { t: formatSeconds(talkSeconds) })}>
              <span className="obm-label">
                <ClockGlyph />
                {t('mockup.avg')}
              </span>
              <span className="obm-val val-time">{formatSeconds(avg)}s</span>
            </div>
            <div className="obm-row" title={scoreTitle}>
              <span className="obm-label">
                <PeopleGlyph />
                {t('mockup.score')}
              </span>
              <span className={cn('obm-val val-score', score === null && 'empty')}>
                {score === null ? '—' : `${score}%`}
              </span>
            </div>
          </div>

          <div className="obm-progress">
            <div className="obm-track" title={scoreTitle}>
              <div className={`obm-fill fill-${tier ?? 'emerald'}`} style={{ width: `${score ?? 0}%` }} />
            </div>
            <div
              className={cn('obm-eq', talking && 'is-talking')}
              title={t(talking ? 'mockup.talking' : 'mockup.lineIdle')}
            >
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>

          {(talking || ringing) && phone && (
            <CallBox phone={phone} ringing={ringing} contact={contact} onOpen={openContact} />
          )}
        </div>
      </div>
    </article>
  );
}

function RankPill({
  tier,
  rank,
  total,
  extension,
}: {
  tier: Tier | null;
  rank?: number;
  total: number;
  extension: string;
}) {
  const { t } = useTranslation('operatorsBoard');
  if (tier === 'diamond') {
    return (
      <div className="obm-pill pill-diamond">
        <span className="top">{t('mockup.mvp')}</span>
        <span className="bottom">{t('mockup.diamond')}</span>
      </div>
    );
  }
  if (tier === 'gold') return <div className="obm-pill pill-gold">{t('mockup.gold')}</div>;
  if (tier === 'silver')
    return <div className="obm-pill pill-silver">{t('mockup.silver', { n: (rank ?? 0) + 1 })}</div>;
  return (
    <div className="obm-pill pill-regular">
      {total > 0 && rank !== undefined ? `#${rank + 1}` : `EXT: ${extension}`}
    </div>
  );
}

/** Legacy corner icons: a gem for Diamond, a microphone for Gold, a medal for Silver. */
function TierIcon({ tier, rank }: { tier: Tier; rank: number }) {
  const { t } = useTranslation('operatorsBoard');
  const props = {
    viewBox: '0 0 24 24',
    width: 20,
    height: 20,
    fill: 'none',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: `obm-tier-icon icon-${tier}`,
  };
  if (tier === 'diamond') {
    return (
      <svg {...props} stroke="#00f2fe" role="img" aria-label={t('mockup.diamondTitle')}>
        <title>{t('mockup.diamondTitle')}</title>
        <path d="M6 3h12l4 6-10 12L2 9z" />
        <path d="M2 9h20" />
        <path d="M10 3l-2 6 4 12 4-12-2-6" />
      </svg>
    );
  }
  if (tier === 'gold') {
    return (
      <svg {...props} stroke="#fbbf24" role="img" aria-label={t('mockup.goldTitle')}>
        <title>{t('mockup.goldTitle')}</title>
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
    );
  }
  const title = t('mockup.silverTitle', { n: rank + 1 });
  return (
    <svg {...props} stroke="currentColor" role="img" aria-label={title}>
      <title>{title}</title>
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  );
}

function TalkTimer({ since, title }: { since: string; title: string }) {
  const sec = useElapsed(since);
  const level = sec >= 420 ? 'danger' : sec >= 180 ? 'warning' : undefined;
  return (
    <span className={cn('obm-timer', level && `timer-${level}`)} title={title} data-level={level ?? 'normal'}>
      <Icon name="timer" className="size-[11px]" />
      <span className="digits">{formatSeconds(sec)}</span>
    </span>
  );
}

function CallBox({
  phone,
  ringing,
  contact,
  onOpen,
}: {
  phone: string;
  ringing: boolean;
  contact?: Contact;
  onOpen?: () => void;
}) {
  const { t } = useTranslation('operatorsBoard');
  const { t: tc } = useTranslation('contact');
  const name = contact?.name.trim() ?? '';
  const org = contact?.organization.trim() ?? '';
  const who = [name, org].filter(Boolean).join(' • ');
  const sub = contact
    ? (name || org || contact.language) && (
        <div className="obm-talk-sub">
          {name && (
            <span className="obm-client-name" title={name}>
              <Icon name="user" className="size-3" />
              {name}
            </span>
          )}
          {org && (
            <span className={cn('obm-client-org', !name && 'solo')} title={org}>
              <Icon name="location" className="size-[11px]" />
              {org}
            </span>
          )}
          {!ringing && contact.language && (
            <span className="obm-client-lang">
              <Icon name="global" className="size-2.5" />
              {tc(`language.${contact.language}`)}
            </span>
          )}
        </div>
      )
    : onOpen && (
        <div className="obm-talk-sub add">
          <span className="obm-add">+ {t('mockup.addContact')}</span>
        </div>
      );
  const head = (
    <div className="obm-talk-head">
      <span className={cn('obm-pulse', ringing && 'ringing')} />
      <span className="obm-talk-num">
        {ringing ? <Bell className="size-3" aria-hidden="true" /> : <Icon name="call" className="size-3" />}
        {phone}
      </span>
      {contact && onOpen && <Icon name="edit" className="obm-edit size-3" />}
    </div>
  );
  const className = cn('obm-talk', ringing && 'is-ringing');
  if (!onOpen) {
    return (
      <div className={className} title={who || undefined}>
        {head}
        {sub}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cn(className, 'clickable')}
      title={contact ? t('mockup.editContactTitle', { who: who || phone }) : t('mockup.addContactTitle')}
      onClick={onOpen}
    >
      {head}
      {sub}
    </button>
  );
}

const STAR_PATH =
  'M12 1.8L15.09 8.26L22.18 9.27L17.09 14.14L18.29 21.2L12 17.85L5.71 21.2L6.91 14.14L1.82 9.27L8.91 8.26L12 1.8Z';

function Star({ className, fill = 'currentColor' }: { className?: string; fill?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('obm-star', className)} aria-hidden="true">
      <path d={STAR_PATH} fill={fill} />
    </svg>
  );
}

/** Legacy star cluster: 1 / 2 side by side / 3 as a peak / 4 as a rhombus / 5 as an arch with a diamond star. */
function StarCluster({ level }: { level: number }) {
  const gradient = useId();
  if (level === 5) {
    return (
      <span className="obm-stars n5">
        <span className="row top">
          <svg viewBox="0 0 24 24" className="obm-star diamond" aria-hidden="true">
            <defs>
              <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="35%" stopColor="#7dd3fc" />
                <stop offset="70%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#0284c7" />
              </linearGradient>
            </defs>
            <path d={STAR_PATH} fill={`url(#${gradient})`} stroke="#bae6fd" strokeWidth="0.75" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="row bottom">
          <span className="wing left">
            <Star className="outer" />
            <Star className="inner" />
          </span>
          <span className="wing right">
            <Star className="inner" />
            <Star className="outer" />
          </span>
        </span>
      </span>
    );
  }
  if (level === 4) {
    return (
      <span className="obm-stars n4">
        <span className="row">
          <Star />
        </span>
        <span className="row mid">
          <Star />
          <Star />
        </span>
        <span className="row">
          <Star />
        </span>
      </span>
    );
  }
  if (level === 3) {
    return (
      <span className="obm-stars n3">
        <span className="row top">
          <Star className="peak" />
        </span>
        <span className="row bottom">
          <Star />
          <Star />
        </span>
      </span>
    );
  }
  return (
    <span className={`obm-stars n${level}`}>
      <span className="row">
        {Array.from({ length: level }, (_, i) => (
          <Star key={i} />
        ))}
      </span>
    </span>
  );
}

function StarRating({ total, name }: { total: number; name: string }) {
  const { t } = useTranslation('operatorsBoard');
  const { level, toNext } = starLevel(total);
  if (level === 0) return null;
  const levels = [5, 4, 3, 2, 1].map((n) => {
    const from = STAR_THRESHOLDS[n - 1];
    const to = STAR_THRESHOLDS[n];
    return {
      n,
      range: to === undefined ? t('mockup.stars.rangeTop', { from }) : t('mockup.stars.range', { from, to: to - 1 }),
    };
  });
  return (
    <span className="obm-rating" tabIndex={0} aria-label={t('mockup.stars.current', { n: total })}>
      <StarCluster level={level} />
      <span className="obm-rating-tip" role="tooltip">
        <span className="tip-head">
          <Star className="size-3" />
          {t('mockup.stars.title')}
        </span>
        <span className="tip-current">
          <b>{name}:</b> {t('mockup.stars.current', { n: total })}
          <span className={cn('tip-note', toNext === 0 && 'max')}>
            {toNext > 0 ? t('mockup.stars.next', { n: toNext }) : t('mockup.stars.max')}
          </span>
        </span>
        <span className="tip-divider" />
        <span className="tip-levels">
          {levels.map(({ n, range }) => (
            <span key={n} className={cn('tip-level', n === level && 'current')}>
              <span className="stars">{'★'.repeat(n)}</span>
              <span className="range">{range}</span>
              <span className="desc">{t(`mockup.stars.level${n}`)}</span>
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

/** Legacy "next call" corner badge: a gold ring with an up arrow. */
function NextInLineBadge({ title }: { title: string }) {
  const id = useId();
  return (
    <div className="obm-next" title={title}>
      <svg viewBox="0 0 100 100" width="24" height="24" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-rim`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fff099" />
            <stop offset="35%" stopColor="#f59e0b" />
            <stop offset="70%" stopColor="#d97706" />
            <stop offset="100%" stopColor="#78350f" />
          </linearGradient>
          <linearGradient id={`${id}-arrow`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fff3b0" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="47" fill={`url(#${id}-rim)`} stroke="#fef08a" strokeWidth="2" />
        <circle cx="50" cy="50" r="33" fill="#1e2430" />
        <path
          d="M 50 23 L 69 42 L 58 42 L 58 73 L 42 73 L 42 42 L 31 42 Z"
          fill="none"
          stroke={`url(#${id}-arrow)`}
          strokeWidth="5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function ClockGlyph() {
  return (
    <svg className="obm-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function PeopleGlyph() {
  return (
    <svg className="obm-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
