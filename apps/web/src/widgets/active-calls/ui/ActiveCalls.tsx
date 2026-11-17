import { type LiveCall, hasRoleAtLeast } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionUser } from '@/entities/session';
import { LiveTimer, carrierOf, displayPhone, liveSnapshotQuery } from '@/entities/telephony';
import { HangupCallButton } from '@/features/telephony/hangup-call';
import { TransferCallButton } from '@/features/telephony/transfer-call';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { useLeaving } from '../model/use-leaving';
import '../i18n';
import './active-calls.css';

const SHOWN = new Set<LiveCall['state']>(['talking', 'ringing', 'dialing']);

/** "Faol suhbatlar": calls connected to / ringing an operator, with live durations and actions. */
export function ActiveCalls() {
  const { t } = useTranslation('activeCalls');
  const { t: tt } = useTranslation('telephony');
  const user = useSessionUser();
  const isAdmin = hasRoleAtLeast(user.role, 'admin');
  const { data } = useQuery({ ...liveSnapshotQuery, select: (s) => ({ calls: s.calls, operators: s.operators }) });
  const [openId, setOpenId] = useState<string | null>(null);
  const calls = useLeaving((data?.calls ?? []).filter((c) => SHOWN.has(c.state)));
  const operators = data?.operators ?? [];
  const nameOf = (ext: string | null) =>
    operators.find((o) => o.extension === ext)?.name ?? (ext ? `Operator ${ext}` : '');

  return (
    <div className="cc-panel">
      <div className="cc-panel-head">
        <h2 className="cc-panel-title">
          <span>{t('title')}</span>
          <span className="cnt">{calls.filter((c) => !c.leaving).length}</span>
        </h2>
      </div>
      {calls.length === 0 && <div className="cc-empty">{t('empty')}</div>}
      {calls.map((call) => {
        const outbound = call.direction === 'outbound';
        const talking = call.state === 'talking';
        const iconCls = talking ? (outbound ? 'out' : '') : outbound ? 'out' : 'ringing';
        const ext = call.extension ?? call.ringing[0] ?? null;
        const sub = ext ? `${nameOf(ext)} · ${ext}` : t('noOperator');
        const carrier = carrierOf(call.phone);
        const canControl = isAdmin || (user.extension !== null && call.extension === user.extension);
        const open = openId === call.id;
        const tag = talking
          ? outbound
            ? ['out', tt('direction.outbound')]
            : ['ok', tt('direction.inbound')]
          : outbound
            ? ['out', tt('callState.dialing')]
            : ['wait', tt('callState.ringing')];
        return (
          <div
            key={call.id}
            className={cn('cc-call', open && 'open', call.leaving && 'leaving')}
            data-call-id={call.id}
            data-state={call.state}
          >
            <button
              type="button"
              className="cc-call-main"
              onClick={() => setOpenId(open ? null : call.id)}
              aria-expanded={open}
            >
              <span className={cn('cc-icon', iconCls)} title={tag[1]}>
                <Icon name={outbound ? 'call' : 'call-incoming'} />
              </span>
              <span className="cc-info">
                <span className="cc-top">
                  <span className="cc-num">{displayPhone(call.phone, tt('hidden'))}</span>
                  <span className="cc-op" title={sub}>
                    {sub}
                  </span>
                </span>
                <span className="cc-tags">
                  <span className={cn('cc-tag', tag[0])}>{tag[1]}</span>
                  {carrier && (
                    <span className="cc-tag" style={{ color: carrier.color }} title={carrier.name}>
                      <Icon name="simcard" className="size-[11px]" />
                      {carrier.name}
                    </span>
                  )}
                  <span className="cc-tag time">
                    <Icon name="timer" className="size-[11px] text-[#60a5fa]" />
                    <LiveTimer since={talking ? (call.answeredAt ?? call.stateSince) : call.stateSince} />
                  </span>
                </span>
              </span>
              <svg
                className="cc-chev"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <div className="cc-actions">
              <div className="cc-actions-inner">
                {canControl && !call.leaving ? (
                  <>
                    <TransferCallButton call={call} operators={operators} className="cc-btn cc-btn-switch" />
                    <HangupCallButton callId={call.id} className="cc-btn cc-btn-end" />
                  </>
                ) : (
                  <span className="cc-readonly">{t('readonly')}</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
