import type { CallListItem } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CallDirectionBadge, CallStatusBadge, callDetailsQuery, formatDuration, formatPhone } from '@/entities/call';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Skeleton } from '@/shared/ui/skeleton';
import '../i18n';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
      <div className="text-[11px] font-bold tracking-[0.4px] text-muted-foreground uppercase">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{children}</div>
    </div>
  );
}

/** Call drill-down: facts + raw CDR legs (legacy call detail modal). */
export function CallDetailsDialog({ call, onClose }: { call: CallListItem | null; onClose: () => void }) {
  const { t } = useTranslation('callHistory');
  const { t: tc } = useTranslation('call');
  const details = useQuery({ ...callDetailsQuery(call?.id ?? ''), enabled: Boolean(call) });
  const c = details.data?.call ?? call;
  const opName = (ext: string | null) => {
    if (!ext) return '—';
    const o = c?.operators.find((x) => x.ext === ext);
    return o?.name ? `${o.name} (${ext})` : ext;
  };

  return (
    <Dialog open={Boolean(call)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto border-white/8 bg-card sm:max-w-4xl [&>*]:min-w-0">
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

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 [&>*]:min-w-0">
              <Fact label={t('details.talk')}>{formatDuration(c.talkSec)}</Fact>
              <Fact label={t('details.wait')}>{c.waitSec === null ? '—' : formatDuration(c.waitSec)}</Fact>
              <Fact label={t('details.duration')}>{formatDuration(c.durationSec)}</Fact>
              <Fact label={t('details.workingHours')}>{c.inWorkingHours ? t('details.yes') : t('details.no')}</Fact>
              <Fact label={t('details.operators')}>
                {c.operators.length ? c.operators.map((o) => opName(o.ext)).join(' ➔ ') : '—'}
              </Fact>
              <Fact label={t('details.missed')}>{c.missedBy.length ? c.missedBy.join(', ') : '—'}</Fact>
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
              {/* TODO(S5 recordings): link to the recording player once the recordings module exists. */}
              <Fact label={t('details.recording')}>
                <span className="font-mono text-xs break-all">{c.recordingFile ?? (c.hasRecording ? '✓' : '—')}</span>
              </Fact>
            </div>

            <div>
              <div className="mb-2 text-xs font-bold tracking-[0.4px] text-muted-foreground uppercase">
                {t('details.legs')}
              </div>
              {details.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : details.isError ? (
                <div className="text-sm text-destructive">{t('error')}</div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-white/8">
                  <table className="w-full border-collapse text-xs">
                    <thead className="bg-secondary/85 text-[11px] font-bold tracking-[0.6px] text-muted-foreground uppercase">
                      <tr>
                        {['calldate', 'src', 'dst', 'dcontext', 'channel', 'dstchannel', 'disposition', 'billsec'].map(
                          (h) => (
                            <th key={h} className="border-b border-white/8 px-2.5 py-2 text-left whitespace-nowrap">
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {details.data?.legs.map((l, i) => (
                        <tr key={i} className="border-b border-white/5 last:border-0">
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
