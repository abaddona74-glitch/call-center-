import { cn } from '@/shared/lib/cn';
import { Icon } from './icon';

/** Page numbers with ellipses: 1 … 4 5 [6] 7 8 … 20 */
export function pageItems(page: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const items: (number | 'gap')[] = [1];
  const start = Math.max(2, page - 2);
  const end = Math.min(totalPages - 1, page + 2);
  if (start > 2) items.push('gap');
  for (let p = start; p <= end; p++) items.push(p);
  if (end < totalPages - 1) items.push('gap');
  items.push(totalPages);
  return items;
}

const btn =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 px-[7px] text-xs font-semibold text-muted-foreground transition-all hover:-translate-y-px hover:border-chart-4/40 hover:bg-chart-4/12 hover:text-chart-4 disabled:pointer-events-none disabled:opacity-35';

/** Legacy `.pagination-controls-wrapper` / `.page-btn`. */
export function Pagination({
  page,
  totalPages,
  onPageChange,
  summary,
  className,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** e.g. "Sahifa 2 / 10 · 194 ta" */
  summary?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mt-4 flex flex-wrap items-center justify-between gap-3 px-1', className)}>
      <div className="text-xs text-muted-foreground">{summary}</div>
      <nav className="inline-flex flex-wrap items-center gap-1.5" aria-label="Pagination">
        <button
          type="button"
          className={btn}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous"
        >
          <Icon name="arrow-left" className="size-3.5" />
        </button>
        {pageItems(page, totalPages).map((item, i) =>
          item === 'gap' ? (
            <span
              key={`gap-${i}`}
              className="inline-flex h-8 min-w-6 items-center justify-center text-xs font-bold tracking-[1.5px] text-muted-foreground/70"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              aria-current={item === page ? 'page' : undefined}
              className={cn(
                btn,
                item === page &&
                  'pointer-events-none border-chart-4/60 bg-gradient-to-br from-chart-4/80 to-chart-4/60 font-bold text-white shadow-[0_2px_8px_rgba(2,132,199,0.45)]',
              )}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          className={btn}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next"
        >
          <Icon name="arrow-right" className="size-3.5" />
        </button>
      </nav>
    </div>
  );
}
