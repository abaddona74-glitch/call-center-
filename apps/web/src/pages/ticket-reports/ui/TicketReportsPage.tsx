import type { TicketReportRow } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STATUS_STRIPE, TicketStatusBadge, refName, ticketReportQuery } from '@/entities/ticket';
import { tashkentDate } from '@/shared/lib/tashkent-time';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';

const PRESETS = { today: 0, week: 6, month: 29, quarter: 89 } as const;

function shift(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Ticket reports: by region, category, status, executive; overdue share; average time to resolution. */
export function TicketReportsPage() {
  const { t, i18n } = useTranslation('ticketReports');
  const today = tashkentDate();
  const [from, setFrom] = useState(shift(today, PRESETS.month));
  const [to, setTo] = useState(today);
  const report = useQuery(ticketReportQuery({ from, to }));
  const r = report.data;
  const hours = (n: number | null) => (n === null ? t('none') : t('hours', { n }));

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[rgba(59,130,246,0.25)] bg-[rgba(15,23,42,0.9)] px-7 py-3.5">
        <div>
          <h1 className="m-0 inline-flex items-center gap-2 text-lg font-bold text-white">
            <Icon name="chart" className="size-5" />
            {t('title')}
          </h1>
          <p className="m-0 text-xs text-[#94a3b8]">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((p) => {
            const active = to === today && from === shift(today, PRESETS[p]);
            return (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setTo(today);
                  setFrom(shift(today, PRESETS[p]));
                }}
                className={cn(
                  'rounded-[10px] border px-3 py-1.5 text-xs font-semibold transition-colors',
                  active ? 'border-[#38bdf8] bg-[rgba(56,189,248,0.2)] text-white' : 'border-white/10 bg-white/5 text-[#94a3b8] hover:text-white',
                )}
              >
                {t(`preset.${p}`)}
              </button>
            );
          })}
          <label className="flex items-center gap-1.5 text-xs text-[#94a3b8]">
            {t('from')}
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="rounded-lg border border-white/12 bg-[rgba(15,23,42,0.7)] px-2 py-1 text-white [color-scheme:dark]" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[#94a3b8]">
            {t('to')}
            <input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className="rounded-lg border border-white/12 bg-[rgba(15,23,42,0.7)] px-2 py-1 text-white [color-scheme:dark]" />
          </label>
          <Link to="/tickets" className="text-xs font-semibold text-[#38bdf8] hover:underline">
            ← {t('back')}
          </Link>
        </div>
      </header>

      {report.isError && <div className="text-sm text-[#f87171]">{t('error', { message: report.error.message })}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label={t('kpi.total')} value={r?.total ?? '…'} color="#38bdf8" icon="clipboard-text" />
        <Kpi label={t('kpi.resolved')} value={r?.resolved ?? '…'} color="#34d399" icon="tick-circle" />
        <Kpi label={t('kpi.closed')} value={r?.closed ?? '…'} color="#94a3b8" icon="call" />
        <Kpi label={t('kpi.overdue')} value={r ? `${r.overdue} · ${Math.round(r.overdueShare * 100)}%` : '…'} color="#f87171" icon="timer" />
        <Kpi label={t('kpi.avg')} value={r ? hours(r.avgResolutionHours) : '…'} color="#c084fc" icon="clock" />
      </div>

      {r && r.total === 0 ? (
        <div className="rounded-2xl border border-white/8 bg-muted py-10 text-center text-sm text-[#94a3b8]">{t('empty')}</div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title={t('byRegion')}>
            <ReportTable rows={r?.byRegion ?? []} lang={i18n.language} />
          </Panel>
          <Panel title={t('byCategory')}>
            <ReportTable rows={r?.byCategory ?? []} lang={i18n.language} />
          </Panel>
          <Panel title={t('byStatus')}>
            <div className="flex flex-col gap-2">
              {(r?.byStatus ?? []).map((s) => (
                <div key={s.status} className="grid grid-cols-[150px_1fr_48px] items-center gap-3 text-[13px]">
                  <TicketStatusBadge status={s.status} className="justify-self-start" />
                  <div className="h-2.5 overflow-hidden rounded-full bg-white/6">
                    <div className="h-full rounded-full" style={{ width: `${r && r.total ? (s.count / r.total) * 100 : 0}%`, background: STATUS_STRIPE[s.status] }} />
                  </div>
                  <span className="text-right font-bold text-white tabular-nums">{s.count}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title={t('byExecutive')}>
            <ReportTable rows={r?.byExecutive ?? []} lang={i18n.language} />
          </Panel>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color, icon }: { label: string; value: ReactNode; color: string; icon: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-muted px-5 py-4">
      <span className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/5" style={{ color }}>
        <Icon name={icon} className="size-5" />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold tracking-[0.4px] text-[#94a3b8] uppercase">{label}</div>
        <div className="text-xl font-bold text-white tabular-nums">{value}</div>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-muted p-5">
      <h2 className="m-0 mb-3 text-[15px] font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function ReportTable({ rows, lang }: { rows: TicketReportRow[]; lang: string }) {
  const { t } = useTranslation('ticketReports');
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-[13px]">
        <thead>
          <tr className="text-[11px] tracking-[0.5px] text-[#94a3b8] uppercase">
            <th className="py-2 text-left font-bold">{t('col.name')}</th>
            <th className="py-2 text-right font-bold">{t('col.total')}</th>
            <th className="py-2 text-right font-bold">{t('col.resolved')}</th>
            <th className="py-2 text-right font-bold">{t('col.overdue')}</th>
            <th className="py-2 text-right font-bold">{t('col.avg')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.id ?? 'none'}-${r.nameUz}`} className="border-t border-white/5">
              <td className="py-2 pr-3">
                <div className="font-semibold text-white">{refName(r, lang)}</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/6">
                  <div className="h-full rounded-full bg-[#38bdf8]" style={{ width: `${(r.total / max) * 100}%` }} />
                </div>
              </td>
              <td className="py-2 text-right font-bold text-white tabular-nums">{r.total}</td>
              <td className="py-2 text-right text-[#34d399] tabular-nums">{r.resolved}</td>
              <td className={cn('py-2 text-right tabular-nums', r.overdue > 0 ? 'font-bold text-[#f87171]' : 'text-[#94a3b8]')}>{r.overdue}</td>
              <td className="py-2 text-right text-[#c084fc] tabular-nums">{r.avgResolutionHours ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
