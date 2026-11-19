import type { OperatorPresence } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PRESENCE_COLOR, compareForBoard } from '@/entities/operator';
import { LiveTimer, displayPhone, formatSeconds, liveSnapshotQuery } from '@/entities/telephony';
import { cn } from '@/shared/lib/cn';
import { accentText } from '@/shared/lib/theme';
import { Icon } from '@/shared/ui/icon';
import { Modal, ModalHeader } from '@/shared/ui/modal';
import '../i18n';

/** Same look as the calls table (legacy `.detail-table`). */
const TH =
  'border-b border-tint/8 bg-secondary/70 px-3.5 py-3 text-center text-[11px] font-bold tracking-[0.6px] whitespace-nowrap text-muted-foreground uppercase';
const TD = 'border-b border-tint/5 px-3.5 py-3 text-center whitespace-nowrap tabular-nums text-foreground';

function LiveTable({ head, empty, children }: { head: ReactNode[]; empty: ReactNode | null; children: ReactNode }) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-tint/8">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={cn(TH, i === 0 && 'text-left')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr>td:first-child]:text-left [&>tr]:transition-colors [&>tr>td]:hover:bg-tint/[0.035]">
          {empty ? (
            <tr>
              <td colSpan={head.length} className="px-5 py-8 text-center whitespace-normal text-muted-foreground">
                {empty}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

function PhoneCell({ phone, icon = 'call' }: { phone: string | null; icon?: string }) {
  const { t } = useTranslation('telephony');
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex size-7 items-center justify-center rounded-lg bg-chart-4/12 text-shade-chart-4">
        <Icon name={icon} className="size-3.5" />
      </span>
      <span className="text-sm font-semibold tracking-[0.2px] text-ink">{displayPhone(phone, t('hidden'))}</span>
    </span>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="mt-4 text-right text-xs font-semibold text-muted-foreground">{children}</div>;
}

/** "Navbatda kutayotganlar" card (legacy `openQueueDetail`): callers waiting now, plus the calls being talked now. */
export function QueueDetailDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('liveCounters');
  const { t: tt } = useTranslation('telephony');
  const { data } = useQuery(liveSnapshotQuery);
  const waiting = (data?.queues ?? [])
    .flatMap((q) => q.waiting.map((w) => ({ ...w, queue: q.name })))
    .sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt));
  const talking = (data?.calls ?? []).filter((c) => c.state === 'talking');
  const names = new Map((data?.operators ?? []).map((o) => [o.extension, o.name]));
  const opLabel = (ext: string | null) => (ext ? (names.get(ext) ? `${names.get(ext)} (${ext})` : ext) : '—');

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} glow="indigo" className="max-w-[1100px] sm:px-7">
      <ModalHeader
        icon={<Icon name="user" className="size-5 text-primary" />}
        title={t('queue.title')}
        subtitle={t('queue.subtitle')}
      />
      <LiveTable
        head={[t('queue.position'), t('queue.phone'), t('queue.queue'), t('queue.wait')]}
        empty={waiting.length === 0 ? t('queue.empty') : null}
      >
        {waiting.map((w) => (
          <tr key={w.callId}>
            <td className={cn(TD, 'font-bold text-caution')}>#{w.position}</td>
            <td className={TD}>
              <PhoneCell phone={w.phone} icon="call-incoming" />
            </td>
            <td className={TD}>
              <span className="rounded-md bg-info/12 px-2 py-0.5 text-xs font-semibold text-info">{w.queue}</span>
            </td>
            <td className={cn(TD, 'font-mono font-semibold text-caution')}>
              <LiveTimer since={w.joinedAt} />
            </td>
          </tr>
        ))}
      </LiveTable>
      <Footer>{t('queue.total', { n: waiting.length })}</Footer>

      <h3 className="mt-6 mb-3 flex items-center gap-2 text-sm font-bold text-ink">
        <Icon name="headphone" className="size-4 text-positive" />
        {t('queue.talking')}
        <span className="rounded-full bg-positive/15 px-2 py-0.5 text-xs text-positive">{talking.length}</span>
      </h3>
      <LiveTable
        head={[t('queue.phone'), t('queue.operator'), t('queue.direction'), t('queue.talk')]}
        empty={talking.length === 0 ? t('queue.talkingEmpty') : null}
      >
        {talking.map((c) => (
          <tr key={c.id}>
            <td className={TD}>
              <PhoneCell phone={c.phone} icon={c.direction === 'outbound' ? 'arrow-up' : 'call-incoming'} />
            </td>
            <td className={cn(TD, 'font-semibold')}>{opLabel(c.extension)}</td>
            <td className={cn(TD, 'text-xs text-muted-foreground')}>{tt(`direction.${c.direction}`)}</td>
            <td className={cn(TD, 'font-mono font-semibold text-positive')}>
              <LiveTimer since={c.answeredAt ?? c.stateSince} thresholds />
            </td>
          </tr>
        ))}
      </LiveTable>
    </Modal>
  );
}

const ONLINE: OperatorPresence[] = ['idle', 'ringing', 'talking', 'paused'];

/** "Onlayn operatorlar" card: who is online now, their state and today's figures. */
export function OnlineOperatorsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('liveCounters');
  const { t: to } = useTranslation('operator');
  const { t: tt } = useTranslation('telephony');
  const { data } = useQuery(liveSnapshotQuery);
  const online = (data?.operators ?? []).filter((o) => o.presence !== 'offline').sort(compareForBoard);

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} glow="indigo" className="max-w-[1240px] sm:px-7">
      <ModalHeader
        icon={<Icon name="headphone" className="size-5 text-primary" />}
        title={t('online.title')}
        subtitle={t('online.subtitle')}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {ONLINE.map((p) => (
          <span
            key={p}
            className="inline-flex items-center gap-2 rounded-lg border border-tint/10 bg-tint/5 px-3 py-1.5 text-xs text-ink-2"
          >
            <span className="size-2 rounded-full" style={{ background: PRESENCE_COLOR[p] }} />
            {to(`presence.${p}`)}
            <b className="tabular-nums text-ink">{online.filter((o) => o.presence === p).length}</b>
          </span>
        ))}
      </div>
      <LiveTable
        head={[
          t('online.operator'),
          t('online.status'),
          t('online.inStatus'),
          t('online.call'),
          t('online.answered'),
          <span key="out" title={t('online.outboundTitle')}>
            {t('online.outbound')}
          </span>,
          t('online.missed'),
          t('online.talk'),
        ]}
        empty={online.length === 0 ? t('online.empty') : null}
      >
        {online.map((o) => (
          <tr key={o.extension}>
            <td className={TD}>
              <span className="font-semibold text-ink">{o.name}</span>{' '}
              <span className="text-xs text-muted-foreground">({o.extension})</span>
            </td>
            <td className={TD}>
              <span
                className="inline-flex items-center gap-1.5 text-xs font-semibold"
                style={{ color: accentText(PRESENCE_COLOR[o.presence]) }}
              >
                <span className="size-2 rounded-full" style={{ background: PRESENCE_COLOR[o.presence] }} />
                {to(`presence.${o.presence}`)}
                {o.presence === 'paused' && o.pauseReason && (
                  <span className="font-normal text-muted-foreground">({o.pauseReason})</span>
                )}
              </span>
            </td>
            <td className={cn(TD, 'font-mono text-xs text-muted-foreground')}>
              <LiveTimer since={o.presenceSince} />
            </td>
            <td className={TD}>
              {o.call ? (
                <span className="inline-flex items-center gap-2">
                  <span className="font-semibold text-ink">{displayPhone(o.call.phone, tt('hidden'))}</span>
                  <span className="text-[11px] text-muted-foreground">{tt(`direction.${o.call.direction}`)}</span>
                  <LiveTimer since={o.call.since} className="font-mono text-xs" />
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
            <td className={cn(TD, 'font-semibold text-positive')}>{o.today.answered}</td>
            <td className={TD} title={t('online.outboundTitle')}>
              <span className="font-semibold text-violet">{o.today.outbound}</span>
              <span className="text-muted-foreground"> / {o.today.outboundAttempts}</span>
            </td>
            <td
              className={cn(TD, 'font-semibold', o.today.missed > 0 ? 'text-danger' : 'text-muted-foreground')}
              title={`${t('missedNoAnswer')} ${o.today.missedNoAnswer} · ${t('missedRejected')} ${o.today.missedRejected}`}
            >
              {o.today.missed}
            </td>
            <td className={cn(TD, 'font-mono')}>{formatSeconds(o.today.talkSeconds)}</td>
          </tr>
        ))}
      </LiveTable>
      <Footer>{t('online.total', { n: online.length })}</Footer>
    </Modal>
  );
}
