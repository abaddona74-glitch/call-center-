import { type CallAnalysisDetails, KPI_CRITERIA } from '@cc/shared';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { formatDateTime } from '@/shared/lib/format-datetime';
import { formatClock, pickText, scoreTone } from '../lib/format';
import { OutcomeBadge, RedFlagBadge, ScorePill, SentimentBadge } from './badges';
import '../i18n';

type Analysis = NonNullable<CallAnalysisDetails['analysis']>;

const METER: Record<ReturnType<typeof scoreTone>, string> = {
  success: 'bg-success',
  info: 'bg-chart-4',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  muted: 'bg-muted-foreground',
};

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[11px] font-bold tracking-[0.4px] text-muted-foreground uppercase">{children}</div>;
}

function Block({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('rounded-lg border border-tint/8 bg-tint/[0.02] px-3 py-2', className)}>{children}</div>;
}

/** 1–5 score as five cells plus the number. */
function ScoreMeter({ value }: { value: number }) {
  const tone = METER[scoreTone(value, 5)];
  return (
    <span className="flex items-center gap-1.5" aria-label={`${value}/5`}>
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={cn('h-2 w-3.5 rounded-sm', n <= value ? tone : 'bg-tint/10')} />
        ))}
      </span>
      <span className="w-3 text-right font-mono text-xs font-semibold text-foreground">{value}</span>
    </span>
  );
}

/**
 * The model's rubric for one call: topic, problem, outcome next to the real tickets of the call (ground truth),
 * KPI scores, red flags (their time seeks the player via `onSeek`), client sentiment, summary and a tip.
 */
export function AnalysisCard({
  analysis: a,
  tickets,
  onSeek,
}: {
  analysis: Analysis;
  tickets: CallAnalysisDetails['tickets'];
  onSeek?: ((seconds: number) => void) | null;
}) {
  const { t, i18n } = useTranslation('callAnalysis');
  const text = (v: { uz: string; ru: string }) => pickText(v, i18n.language);
  const mismatch = (a.outcome === 'ticket_opened') !== tickets.length > 0;

  return (
    <div className="flex flex-col gap-2.5">
      <Block>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Label>{t('card.topic')}</Label>
            <div className="text-sm font-semibold text-ink">{text(a.topicName)}</div>
            {text(a.subtopic) && <div className="text-xs text-muted-foreground">{text(a.subtopic)}</div>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-[10px] font-bold tracking-[0.4px] text-muted-foreground uppercase">
              {t('criterion.overall')}
            </span>
            <ScorePill value={a.overall} max={10} className="px-3 text-sm" />
          </div>
        </div>
      </Block>

      <Block>
        <Label>{t('card.problem')}</Label>
        <p className="text-[13px] leading-snug text-foreground">{text(a.problem) || '—'}</p>
      </Block>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 [&>*]:min-w-0">
        <Block>
          <Label>{t('card.outcome')}</Label>
          <OutcomeBadge outcome={a.outcome} />
        </Block>
        <Block>
          <Label>{t('card.groundTruth')}</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {tickets.length === 0 ? (
              <span className="text-[13px] text-muted-foreground">{t('card.ticketNo')}</span>
            ) : (
              tickets.map((tk) => (
                <Link
                  key={tk.id}
                  to="/tickets"
                  search={{ open: tk.id }}
                  className="text-[13px] font-semibold text-link hover:underline"
                >
                  {t('card.ticketYes', { id: tk.id })}
                </Link>
              ))
            )}
          </div>
          {mismatch && <div className="mt-1 text-[11px] text-warning">{t('card.ticketMismatch')}</div>}
        </Block>
      </div>

      <Block>
        <Label>{t('card.scores')}</Label>
        <div className="flex flex-col gap-1">
          {KPI_CRITERIA.map((c) => (
            <div key={c} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-foreground/85">{t(`criterion.${c}`)}</span>
              <ScoreMeter value={a.scores[c]} />
            </div>
          ))}
        </div>
      </Block>

      <Block>
        <Label>{t('card.sentiment')}</Label>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t('card.sentimentStart')}</span>
          <SentimentBadge sentiment={a.sentimentStart} />
          <span aria-hidden="true">→</span>
          <span>{t('card.sentimentEnd')}</span>
          <SentimentBadge sentiment={a.sentimentEnd} />
        </div>
      </Block>

      <Block>
        <Label>{t('card.flags')}</Label>
        {a.redFlags.length === 0 ? (
          <span className="text-[13px] text-success">{t('card.noFlags')}</span>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {a.redFlags.map((f, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-[13px]">
                <RedFlagBadge code={f.code} />
                {f.at !== null &&
                  (onSeek ? (
                    <button
                      type="button"
                      onClick={() => onSeek(f.at ?? 0)}
                      title={t('card.seek')}
                      className="font-mono text-xs text-link hover:underline"
                    >
                      {formatClock(f.at)}
                    </button>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">{formatClock(f.at)}</span>
                  ))}
                <span className="text-foreground/85">{f.note}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block>
        <Label>{t('card.summary')}</Label>
        <p className="text-[13px] leading-snug whitespace-pre-wrap text-foreground">{text(a.summary) || '—'}</p>
      </Block>

      {text(a.recommendation) && (
        <Block className="border-primary/25 bg-primary/[0.06]">
          <Label>{t('card.recommendation')}</Label>
          <p className="text-[13px] leading-snug text-foreground">{text(a.recommendation)}</p>
        </Block>
      )}

      <div className="px-1 text-[11px] text-muted-foreground">
        {t('card.language')}: {t(`language.${a.language}`)} ·{' '}
        {t('card.meta', {
          version: a.promptVersion,
          model: a.llmModel.split('/').pop(),
          date: formatDateTime(a.createdAt),
        })}
      </div>
    </div>
  );
}
