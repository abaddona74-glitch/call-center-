import type { LiveOperator } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type OperatorGroupFilter, compareForBoard, inGroup } from '@/entities/operator';
import { liveSnapshotQuery } from '@/entities/telephony';
import { PauseOperatorButton } from '@/features/telephony/pause-operator';
import { Icon } from '@/shared/ui/icon';
import { nextInLine, ranks, usePersistedState } from '../model/board';
import { OperatorCard } from './OperatorCard';
import '../i18n';
import './operators-board.css';

const GROUPS = ['main', 'secondary', 'all'] as const;
const DENSITY = ['full', 'compact'] as const;
const SORT = ['state', 'alpha'] as const;

/**
 * Operators section of the dashboard (legacy "Operatorlar" panel): group tabs, live summary,
 * density toggle, operator cards, offline operators as compact rows.
 * `controls` adds pause/unpause on every card (admins); `sortable` adds the A–Z toggle.
 */
export function OperatorsBoard({ controls = false, sortable = false }: { controls?: boolean; sortable?: boolean }) {
  const { t } = useTranslation('operatorsBoard');
  const { t: tp } = useTranslation('operator');
  const { data: operators, isPending } = useQuery({ ...liveSnapshotQuery, select: (s) => s.operators });
  const [group, setGroup] = usePersistedState<OperatorGroupFilter>('callcenter_op_group', 'main', GROUPS);
  const [density, setDensity] = usePersistedState('dashboard_op_density', 'full', DENSITY);
  const [sort, setSort] = usePersistedState('tabOperatorSortMode', 'state', SORT);

  const all = operators ?? [];
  const visible = all.filter((o) => inGroup(o.extension, group));
  const sorted = [...visible].sort(sort === 'alpha' ? (a, b) => a.name.localeCompare(b.name) : compareForBoard);
  const online = sorted.filter((o) => o.presence !== 'offline');
  const offline = sorted.filter((o) => o.presence === 'offline');
  const rankMap = ranks(visible);
  const next = nextInLine(visible);
  const count = (p: LiveOperator['presence'][]) => visible.filter((o) => p.includes(o.presence)).length;

  return (
    <section className="ob-panel" aria-label={t('title')}>
      <div className="ob-head">
        <div className="flex flex-wrap items-center gap-[18px]">
          <h3 className="ob-title">
            <Icon name="headphone" className="size-5 text-[#818cf8]" />
            {t('title')}
          </h3>
          <div className="ob-tabs" role="group">
            {GROUPS.map((g) => (
              <button key={g} type="button" className="ob-tab" aria-pressed={group === g} onClick={() => setGroup(g)}>
                {g !== 'all' && (
                  <span
                    className="dot"
                    style={{
                      background: g === 'main' ? '#38bdf8' : '#a855f7',
                      color: g === 'main' ? '#38bdf8' : '#a855f7',
                    }}
                  />
                )}
                {tp(`group.${g}`)}
                <span className="count">{all.filter((o) => inGroup(o.extension, g)).length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="ob-sum">
            <span style={{ color: 'var(--op-live)' }}>
              <i />
              <b>{count(['talking', 'ringing'])}</b>
              {t('sum.talking')}
            </span>
            <span style={{ color: 'var(--op-wait)' }}>
              <i />
              <b>{count(['idle', 'paused'])}</b>
              {t('sum.waiting')}
            </span>
            <span style={{ color: 'var(--op-off)' }}>
              <i />
              <b>{count(['offline'])}</b>
              {t('sum.offline')}
            </span>
          </div>
          {sortable && (
            <button
              type="button"
              className="ob-tool"
              aria-pressed={sort === 'alpha'}
              onClick={() => setSort(sort === 'alpha' ? 'state' : 'alpha')}
            >
              A–Z
            </button>
          )}
          <button
            type="button"
            className="ob-tool"
            aria-pressed={density === 'compact'}
            onClick={() => setDensity(density === 'compact' ? 'full' : 'compact')}
          >
            <Icon name="setting-4" className="size-3.5" />
            {t('density')}
          </button>
        </div>
      </div>

      <div className={density === 'compact' ? 'ob-grid compact' : 'ob-grid'}>
        {isPending && Array.from({ length: 4 }, (_, i) => <div key={i} className="ob-skeleton" />)}
        {!isPending && visible.length === 0 && <div className="ob-empty">{t('empty')}</div>}
        {online.map((op) => (
          <OperatorCard
            key={op.extension}
            op={op}
            rank={rankMap.get(op.extension)}
            next={op.extension === next}
            actions={
              controls ? (
                <PauseOperatorButton extension={op.extension} paused={op.paused} compact className="px-2 py-1" />
              ) : undefined
            }
          />
        ))}
        {offline.length > 0 && (
          <>
            <div className="ob-sep">
              <span>
                {t('offlineSep')} — <b>{offline.length}</b>
              </span>
            </div>
            <div className="ob-offs">
              {offline.map((op) => (
                <div key={op.extension} className="row" data-ext={op.extension}>
                  <div className="av">{op.extension}</div>
                  <div className="who">
                    <strong>{op.name}</strong>
                    <small>Exten {op.extension}</small>
                  </div>
                  <span className="st">{tp('presence.offline')}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
