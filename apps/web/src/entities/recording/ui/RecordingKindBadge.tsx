import type { RecordingKind } from '@cc/shared';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';

const STYLE: Record<RecordingKind, string> = {
  empty: 'bg-[rgba(239,68,68,0.15)] text-danger',
  robot: 'bg-[rgba(245,158,11,0.15)] text-caution',
  talk: 'bg-[rgba(16,185,129,0.15)] text-positive',
};

/** Legacy explorer type badge (`.badge-danger` / `.badge-warning` / `.badge-success`). */
export function RecordingKindBadge({ kind }: { kind: RecordingKind }) {
  const { t } = useTranslation('recording');
  return (
    <span
      title={t(`kind.${kind}Desc`)}
      className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap', STYLE[kind])}
    >
      {kind === 'empty' && <Icon name="close-circle" className="size-3" />}
      {t(`kind.${kind}`)}
    </span>
  );
}

/** `.badge` pill used in the explorer table (`badge-info` by default). */
export function InfoPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(6,182,212,0.15)] px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-info">
      {children}
    </span>
  );
}
