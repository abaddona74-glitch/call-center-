import type { TranscriptSegment } from '@cc/shared';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { formatClock } from '../lib/format';
import '../i18n';

const BUBBLE: Record<TranscriptSegment['role'], string> = {
  operator: 'ml-auto rounded-br-sm border-primary/30 bg-primary/12',
  client: 'mr-auto rounded-bl-sm border-tint/10 bg-tint/[0.05]',
  unknown: 'mx-auto border-dashed border-tint/12 bg-transparent',
};

const ROLE_TEXT: Record<TranscriptSegment['role'], string> = {
  operator: 'text-primary',
  client: 'text-shade-chart-4',
  unknown: 'text-muted-foreground',
};

/**
 * The conversation as chat bubbles: operator on the right, client on the left, unknown speaker centred.
 * Each bubble has its start time; clicking it calls `onSeek` (null = no right to play the recording).
 * The bubble at `activeIndex` is highlighted and kept in view while it changes.
 */
export function TranscriptView({
  segments,
  activeIndex = -1,
  onSeek,
  className,
}: {
  segments: readonly TranscriptSegment[];
  activeIndex?: number;
  onSeek?: ((seconds: number) => void) | null;
  className?: string;
}) {
  const { t } = useTranslation('callAnalysis');
  const box = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const c = box.current;
    const el = activeIndex >= 0 ? items.current[activeIndex] : null;
    if (!c || !el) return;
    const top = el.offsetTop - c.offsetTop;
    if (top < c.scrollTop || top + el.offsetHeight > c.scrollTop + c.clientHeight) {
      c.scrollTo({ top: Math.max(0, top - c.clientHeight / 3), behavior: 'smooth' });
    }
  }, [activeIndex]);

  if (segments.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">{t('chat.empty')}</div>;
  }

  return (
    <div ref={box} className={cn('flex flex-col gap-2 overflow-y-auto pr-1', className)}>
      {segments.map((s, i) => {
        const time = formatClock(s.start);
        const sameAsPrev = i > 0 && segments[i - 1].role === s.role;
        return (
          <div
            key={i}
            ref={(el) => {
              items.current[i] = el;
            }}
            className={cn(
              'max-w-[85%] rounded-2xl border px-3 py-2 transition-shadow',
              BUBBLE[s.role],
              sameAsPrev && 'mt-[-2px]',
              i === activeIndex && 'ring-2 ring-primary/60',
            )}
          >
            <div className="mb-0.5 flex items-center gap-2 text-[11px]">
              {!sameAsPrev && <span className={cn('font-bold', ROLE_TEXT[s.role])}>{t(`role.${s.role}`)}</span>}
              {onSeek ? (
                <button
                  type="button"
                  onClick={() => onSeek(s.start)}
                  title={t('chat.seekTitle', { time })}
                  className="font-mono text-muted-foreground underline-offset-2 hover:text-link hover:underline"
                >
                  {time}
                </button>
              ) : (
                <span className="font-mono text-muted-foreground">{time}</span>
              )}
            </div>
            <p className="text-[13px] leading-snug break-words whitespace-pre-wrap text-foreground">{s.text}</p>
          </div>
        );
      })}
    </div>
  );
}
