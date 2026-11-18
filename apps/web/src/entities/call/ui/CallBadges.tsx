import type { CallListItem } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import '../i18n';

/** Legacy `.badge` pill. */
export function Pill({ tone, className, children }: { tone: PillTone; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold',
        PILL_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export type PillTone = 'success' | 'danger' | 'info' | 'warning' | 'purple' | 'cyan' | 'muted';

const PILL_TONES: Record<PillTone, string> = {
  success: 'bg-success/15 text-success',
  danger: 'bg-destructive/15 text-destructive',
  info: 'bg-chart-7/15 text-shade-chart-4',
  warning: 'bg-warning/15 text-warning',
  purple: 'border border-chart-3/40 bg-chart-3/15 text-outbound',
  cyan: 'border border-chart-4/45 bg-chart-4/15 text-shade-chart-4',
  muted: 'bg-muted-foreground/15 text-muted-foreground',
};

function Dot({ className }: { className: string }) {
  return <span className={cn('inline-block size-2 rounded-full', className)} aria-hidden="true" />;
}

/** Holati column (legacy renderServerHistoryRowHtml). */
export function CallStatusBadge({ call }: { call: Pick<CallListItem, 'status' | 'direction' | 'transferred'> }) {
  const { t } = useTranslation('call');
  if (call.transferred && call.status === 'answered') {
    return (
      <Pill tone="purple">
        <Icon name="arrow-swap-horizontal" className="size-3" /> {t('status.transferred')}
      </Pill>
    );
  }
  if (call.status === 'answered') {
    if (call.direction === 'outbound') {
      return (
        <Pill tone="purple">
          <Dot className="bg-outbound" /> {t('status.outboundConnected')}
        </Pill>
      );
    }
    return (
      <Pill tone="success">
        <Dot className="bg-success" /> {t('status.answered')}
      </Pill>
    );
  }
  if (call.status === 'abandoned') {
    return (
      <Pill tone="warning">
        <Dot className="bg-warning" /> {t('status.abandoned')}
      </Pill>
    );
  }
  if (call.status === 'ivr' || call.status === 'after_hours') {
    return (
      <Pill tone="muted">
        <Dot className="bg-muted-foreground" /> {t(`status.${call.status}`)}
      </Pill>
    );
  }
  return (
    <Pill tone="danger">
      <Dot className="bg-destructive" /> {t(`status.${call.status}`)}
    </Pill>
  );
}

/** Yo'nalish column: bordered, slightly rounded badge with an icon (legacy history table). */
export function CallDirectionBadge({ call }: { call: Pick<CallListItem, 'direction' | 'transferred'> }) {
  const { t } = useTranslation('call');
  const shape = 'rounded-md border px-2 py-[3px]';
  if (call.transferred) {
    return (
      <Pill tone="cyan" className={shape}>
        <Icon name="refresh" className="size-3" /> {t('direction.transfer')}
      </Pill>
    );
  }
  if (call.direction === 'internal') {
    return (
      <Pill tone="muted" className={cn(shape, 'border-tint/12')}>
        {t('direction.internal')}
      </Pill>
    );
  }
  const out = call.direction === 'outbound';
  return (
    <Pill tone={out ? 'purple' : 'info'} className={cn(shape, !out && 'border-chart-4/30 bg-chart-4/12')}>
      <DirectionMaskIcon outbound={out} /> {t(`direction.${call.direction}`)}
    </Pill>
  );
}

/** Legacy `.badge-dir-icon` (PNG used as a mask, colored with currentColor). */
function DirectionMaskIcon({ outbound }: { outbound: boolean }) {
  const url = outbound ? '/img/icon-chiquvchi.png' : '/img/icon-kiruvchi.png';
  return (
    <i
      aria-hidden="true"
      className="mr-0.5 inline-block size-[13px] shrink-0 bg-current"
      style={{ maskImage: `url(${url})`, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center' }}
    />
  );
}

/** Small square arrow before the number (legacy `.dir.in/.out/.xfer`). */
export function DirectionMark({ call }: { call: Pick<CallListItem, 'direction' | 'transferred'> }) {
  const { t } = useTranslation('call');
  const kind = call.transferred ? 'transfer' : call.direction;
  const styles: Record<string, string> = {
    inbound: 'text-success bg-success/12',
    outbound: 'text-outbound bg-outbound/12',
    internal: 'text-muted-foreground bg-muted-foreground/12',
    transfer: 'text-primary bg-primary/12',
  };
  const glyph = kind === 'outbound' ? '↗' : kind === 'transfer' ? '⇄' : kind === 'internal' ? '↔' : '↙';
  return (
    <span
      className={cn('inline-flex size-5 items-center justify-center rounded text-xs', styles[kind])}
      title={t(`direction.${kind}`)}
    >
      {glyph}
    </span>
  );
}
