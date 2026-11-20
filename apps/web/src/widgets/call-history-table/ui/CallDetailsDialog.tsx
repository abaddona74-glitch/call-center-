import { type CallListItem, canAccessCdr } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CallDirectionBadge, CallStatusBadge, callDetailsQuery, formatDuration, formatPhone } from '@/entities/call';
import { ScorePill, callAnalysisQuery } from '@/entities/call-analysis';
import { useSessionUser } from '@/entities/session';
import { CallConversation } from '@/features/call-analysis/conversation';
import { CallRecordingStudio } from '@/features/recordings/play-call';
import { cn } from '@/shared/lib/cn';
import { Segmented } from '@/shared/ui/segmented';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Skeleton } from '@/shared/ui/skeleton';
import { recordingLabel } from './CallHistoryTable';
import '../i18n';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-tint/8 bg-tint/[0.02] px-3 py-2">
      <div className="text-[11px] font-bold tracking-[0.4px] text-muted-foreground uppercase">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{children}</div>
    </div>
  );
}

type DetailsTab = 'conversation' | 'legs';

/**
 * Call drill-down: the Studio player for the call's recording (when it has one and the user may listen; it loads
 * right here, paused until play — no trip to Audio Explorer), facts, then the AI analysis («Suhbat»: rubric +
 * dialogue, for whoever may read it — `CDR_ACCESS['analysis.call']`) and the raw CDR legs (legacy call detail modal).
 */
export function CallDetailsDialog({
  call,
  onClose,
  canListen = false,
}: {
  call: CallListItem | null;
  onClose: () => void;
  /** May play the recording (`calls.recordings`). */
  canListen?: boolean;
}) {
  const { t } = useTranslation('callHistory');
  const { t: tc } = useTranslation('call');
  const canAnalyse = canAccessCdr(useSessionUser(), 'analysis.call');
  const [tab, setTab] = useState<DetailsTab>('conversation');
  useEffect(() => setTab('conversation'), [call?.id]);
  const details = useQuery({ ...callDetailsQuery(call?.id ?? ''), enabled: Boolean(call) });
  const analysis = useQuery({ ...callAnalysisQuery(call?.id ?? ''), enabled: Boolean(call) && canAnalyse });
  const overall = analysis.data?.analysis?.overall;
  const shownTab: DetailsTab = canAnalyse ? tab : 'legs';
  const c = details.data?.call ?? call;
  const listenHere = Boolean(c?.hasRecording && canListen);
  const contentRef = useRef<HTMLDivElement>(null);
  const opName = (ext: string | null) => {
    if (!ext) return '—';
    const o = c?.operators.find((x) => x.ext === ext);
    return o?.name ? `${o.name} (${ext})` : ext;
  };

  return (
    <Dialog open={Boolean(call)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={contentRef}
        // With the player: focus the dialog itself, not its first button, so Space / arrows reach the player
        // shortcuts (a focused button would take Space for itself).
        onOpenAutoFocus={(e) => {
          if (!listenHere) return;
          e.preventDefault();
          contentRef.current?.focus();
        }}
        className={cn(
          'max-h-[90svh] overflow-y-auto border-tint/8 bg-card [&>*]:min-w-0',
          canAnalyse ? 'sm:max-w-5xl' : 'sm:max-w-4xl',
        )}
      >
        {c && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 text-lg">
                {c.clientNumber ? formatPhone(c.clientNumber) : tc('hidden')}
                <CallDirectionBadge call={c} />
                <CallStatusBadge call={c} />
              </DialogTitle>
              <DialogDescription>
                {t('details.title')} · {c.date} {c.time} · ID {c.id}
              </DialogDescription>
            </DialogHeader>

            {listenHere && <CallRecordingStudio uniqueid={c.id} label={recordingLabel(c)} />}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 [&>*]:min-w-0">
              <Fact label={t('details.talk')}>{formatDuration(c.talkSec)}</Fact>
              <Fact label={t('details.wait')}>{c.waitSec === null ? '—' : formatDuration(c.waitSec)}</Fact>
              <Fact label={t('details.duration')}>{formatDuration(c.durationSec)}</Fact>
              <Fact label={t('details.workingHours')}>{c.inWorkingHours ? t('details.yes') : t('details.no')}</Fact>
              <Fact label={t('details.operators')}>
                {c.operators.length ? c.operators.map((o) => opName(o.ext)).join(' ➔ ') : '—'}
              </Fact>
              <Fact label={t('details.missed')}>
                {c.missedBy.length
                  ? c.missedBy.map((m) => (
                      <div key={m.ext} className="text-xs">
                        {opName(m.ext)} · {t(`details.missReason.${m.reason}`)}
                      </div>
                    ))
                  : '—'}
              </Fact>
              <Fact label={t('details.transfers')}>
                {c.transfers.length
                  ? c.transfers.map((x, i) => (
                      <div key={i} className="text-xs">
                        {opName(x.from)} ➔ {opName(x.to)}{' '}
                        {x.answered ? `· ${formatDuration(x.talkSec)}` : `· ${t('details.notAnswered')}`}
                      </div>
                    ))
                  : '—'}
              </Fact>
              {/* With listening the Studio player above is the control; this shows the file only. */}
              <Fact label={t('details.recording')}>
                <span className="font-mono text-xs break-all">{c.recordingFile ?? (c.hasRecording ? '✓' : '—')}</span>
              </Fact>
            </div>

            {canAnalyse && (
              <Segmented
                value={shownTab}
                onChange={setTab}
                className="justify-self-start"
                options={[
                  {
                    value: 'conversation',
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        {t('details.tabs.conversation')}
                        {overall !== undefined && <ScorePill value={overall} max={10} className="px-1.5 py-0" />}
                      </span>
                    ),
                  },
                  { value: 'legs', label: t('details.tabs.legs') },
                ]}
              />
            )}

            {shownTab === 'conversation' && (
              <CallConversation callId={c.id} recordingTitle={recordingLabel(c)} canListen={canListen} />
            )}

            <div className={shownTab === 'legs' ? undefined : 'hidden'}>
              {!canAnalyse && (
                <div className="mb-2 text-xs font-bold tracking-[0.4px] text-muted-foreground uppercase">
                  {t('details.legs')}
                </div>
              )}
              {details.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : details.isError ? (
                <div className="text-sm text-destructive">{t('error')}</div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-tint/8">
                  <table className="w-full border-collapse text-xs">
                    <thead className="bg-secondary/85 text-[11px] font-bold tracking-[0.6px] text-muted-foreground uppercase">
                      <tr>
                        {['calldate', 'src', 'dst', 'dcontext', 'channel', 'dstchannel', 'disposition', 'billsec'].map(
                          (h) => (
                            <th key={h} className="border-b border-tint/8 px-2.5 py-2 text-left whitespace-nowrap">
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {details.data?.legs.map((l, i) => (
                        <tr key={i} className="border-b border-tint/5 last:border-0">
                          <td className="px-2.5 py-1.5 font-mono whitespace-nowrap text-muted-foreground">
                            {l.calldate.slice(11)}
                          </td>
                          <td className="px-2.5 py-1.5 whitespace-nowrap">{l.src}</td>
                          <td className="px-2.5 py-1.5 whitespace-nowrap">{l.dst}</td>
                          <td className="px-2.5 py-1.5 whitespace-nowrap text-muted-foreground">{l.dcontext}</td>
                          <td className="px-2.5 py-1.5 font-mono whitespace-nowrap">{l.channel}</td>
                          <td className="px-2.5 py-1.5 font-mono whitespace-nowrap">{l.dstchannel || '—'}</td>
                          <td className="px-2.5 py-1.5 whitespace-nowrap">{l.disposition}</td>
                          <td className="px-2.5 py-1.5 text-right font-mono whitespace-nowrap">{l.billsec}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
