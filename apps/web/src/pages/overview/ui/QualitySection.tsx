import type { OverviewQuality } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/entities/call';
import { OutcomeBadge, RedFlagBadge, SentimentBadge, formatAvg } from '@/entities/call-analysis';
import { Icon } from '@/shared/ui/icon';
import { Panel, PanelHeader, PanelTitle } from '@/shared/ui/panel';
import { Skeleton } from '@/shared/ui/skeleton';
import { KpiCard } from '@/widgets/call-stats';
import { overallAccent, qualityView } from '../model/quality';
import '../i18n';

const SENTIMENT_BAR = { positive: 'bg-chart-2', neutral: 'bg-mute/60', negative: 'bg-chart-8' } as const;

/**
 * AI call quality (the «Tahlil» page's figures for the current prompt version; aggregates only — no transcripts,
 * texts or numbers). Calls have no region, so the page's region filter does not apply. Before the analysis worker
 * runs there is nothing analysed: an explanatory empty state instead of zero cards.
 */
export function QualitySection({ data, error }: { data: OverviewQuality | undefined; error: unknown }) {
  const { t, i18n } = useTranslation('overviewPage');
  const n = (v: number) => formatNumber(v, i18n.language === 'ru' ? 'ru-RU' : 'uz-UZ');
  const view = data ? qualityView(data) : null;

  return (
    <section className="flex flex-col gap-4">
      <Panel className="py-4">
        <PanelHeader className="mb-0">
          <div>
            <PanelTitle>
              <Icon name="magic-star" className="size-[18px] text-violet" />
              {t('quality.title')}
            </PanelTitle>
            <p className="mt-1 text-xs text-mute">{t('quality.subtitle')}</p>
          </div>
          {data && (
            <span
              className="rounded-md border border-tint/10 bg-tint/5 px-2 py-0.5 font-mono text-[11px] text-mute"
              title={t('quality.versionHint')}
            >
              {t('quality.version', { v: data.promptVersion })}
            </span>
          )}
        </PanelHeader>
      </Panel>

      {error ? (
        <Panel className="text-center text-sm text-destructive">{t('error')}</Panel>
      ) : !data || !view ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[145px] rounded-2xl" />
          ))}
        </div>
      ) : view.empty ? (
        <Panel className="flex items-start gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-violet/30 bg-violet/10">
            <Icon name="magic-star" className="size-5 text-violet" />
          </span>
          <div>
            <p className="font-semibold text-ink">{t('quality.emptyTitle')}</p>
            <p className="mt-1 max-w-[720px] text-sm text-mute">{t('quality.emptyText')}</p>
          </div>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              accent={overallAccent(data.avgOverall)}
              icon="magic-star"
              label={t('quality.avgOverall')}
              value={formatAvg(data.avgOverall)}
              unit="/ 10"
              sub={data.handledRate === null ? undefined : t('quality.handled', { n: data.handledRate })}
            />
            <KpiCard
              accent="purple"
              icon="headphone"
              label={t('quality.analyzed')}
              value={n(data.analyzed)}
              unit={t('quality.ta')}
              badge={data.analyzedShare === null ? undefined : `${data.analyzedShare}%`}
              sub={
                data.answeredCalls === null ? t('quality.noPbx') : t('quality.ofAnswered', { n: n(data.answeredCalls) })
              }
            />
            <KpiCard
              accent="red"
              icon="shield-security"
              label={t('quality.redFlagCalls')}
              value={n(data.redFlagCalls)}
              unit={t('quality.ta')}
              badge={view.redFlagShare === null ? undefined : `${view.redFlagShare}%`}
              sub={
                view.topFlag
                  ? t('quality.topFlag', { flag: t(`flag.${view.topFlag}`, { ns: 'callAnalysis' }) })
                  : undefined
              }
            />
            <KpiCard
              accent="green"
              icon="tick-circle"
              label={t('quality.sentimentEnd')}
              value={view.positiveShare === null ? '—' : `${view.positiveShare}%`}
              unit={t('quality.positive')}
              sub={t('quality.sentimentSplit', {
                neutral: n(data.sentimentEnd.neutral),
                negative: n(data.sentimentEnd.negative),
              })}
            />
          </div>

          <Panel className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-2.5">
              <h4 className="text-[11px] font-bold tracking-[0.5px] text-mute uppercase">{t('quality.outcomes')}</h4>
              {view.outcomes.map((o) => (
                <div key={o.outcome} className="grid grid-cols-[11rem_1fr_auto] items-center gap-2.5 text-xs">
                  <OutcomeBadge outcome={o.outcome} className="max-w-full justify-self-start truncate" />
                  <div className="h-2 overflow-hidden rounded-full bg-tint/6">
                    <div className="h-full rounded-full bg-chart-1" style={{ width: `${o.share}%` }} />
                  </div>
                  <span className="font-bold text-ink tabular-nums">
                    {n(o.count)} <span className="font-medium text-mute">{o.share}%</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2.5">
              <h4 className="text-[11px] font-bold tracking-[0.5px] text-mute uppercase">
                {t('quality.sentimentEnd')}
              </h4>
              <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
                {view.sentiment
                  .filter((s) => s.count > 0)
                  .map((s) => (
                    <div
                      key={s.sentiment}
                      className={`h-full ${SENTIMENT_BAR[s.sentiment]}`}
                      style={{ width: `${s.share}%` }}
                    />
                  ))}
              </div>
              <div className="flex flex-col gap-1.5">
                {view.sentiment.map((s) => (
                  <div key={s.sentiment} className="flex items-center justify-between text-xs">
                    <SentimentBadge sentiment={s.sentiment} />
                    <span className="font-bold text-ink tabular-nums">
                      {n(s.count)} <span className="font-medium text-mute">{s.share}%</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2.5">
              <h4 className="text-[11px] font-bold tracking-[0.5px] text-mute uppercase">{t('quality.flags')}</h4>
              {view.flags.length === 0 ? (
                <p className="text-xs text-mute">{t('quality.noFlags')}</p>
              ) : (
                view.flags.map((f) => (
                  <div key={f.code} className="flex items-center justify-between text-xs">
                    <RedFlagBadge code={f.code} />
                    <span className="font-bold text-ink tabular-nums">{n(f.count)}</span>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </>
      )}
    </section>
  );
}
