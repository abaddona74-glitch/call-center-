import type { LiveOperator } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { businessToday, operatorStatsQuery } from '@/entities/call';
import { useContactAccess, useContactLookup } from '@/entities/contact';
import { type OperatorGroupFilter, inGroup } from '@/entities/operator';
import { useLiveSnapshot } from '@/entities/telephony';
import { ContactDialog } from '@/features/contacts/edit-contact';
import { PauseOperatorButton } from '@/features/telephony/pause-operator';
import { cn } from '@/shared/lib/cn';
import { Icon } from '@/shared/ui/icon';
import { usePersistedState } from '@/shared/lib/use-persisted-state';
import { type SurveyScore, groupForBoard, leaderboard, nextInLine, ranks } from '../model/board';
import { useFlip } from '../model/use-flip';
import { OperatorCard } from './OperatorCard';
import { type MockupContactTarget, OperatorMockupCard } from './OperatorMockupCard';
import '../i18n';
import './operators-board.css';
import './operator-mockup.css';

const GROUPS = ['main', 'secondary', 'all'] as const;
const DENSITY = ['full', 'compact'] as const;
const SORT = ['state', 'alpha'] as const;
const OFFLINE_VIEW = ['rows', 'cards'] as const;
const byName = (a: LiveOperator, b: LiveOperator) => a.name.localeCompare(b.name);

/** Legacy "SAO" divider: converging lines with a glowing hexagon label. */
function Divider({
  color,
  label,
  count,
  children,
}: {
  color: string;
  label: string;
  count: number;
  children?: ReactNode;
}) {
  return (
    <div className="ob-div" style={{ '--c': color } as CSSProperties}>
      <span className="ob-div-line left">
        <span className="track">
          <i className="shine" />
        </span>
      </span>
      <div className="glow">
        <div className="ob-div-label">
          <i className="diamond" />
          <span>{label}</span>
          <b className="count">{count}</b>
          {children}
        </div>
      </div>
      <span className="ob-div-line right">
        <span className="track">
          <i className="shine" />
        </span>
      </span>
    </div>
  );
}

/**
 * Operators section of the dashboard (legacy "Operatorlar" panel): group tabs, live summary,
 * density toggle, operator cards, offline operators as compact rows.
 * `controls` adds pause/unpause on every card (admins); `sortable` adds the A–Z toggle.
 * `variant="mockup"` draws the operator-portal cards (legacy viewer: Diamond / Gold / Silver ranks).
 */
export function OperatorsBoard({
  controls = false,
  sortable = false,
  variant = 'classic',
}: {
  controls?: boolean;
  sortable?: boolean;
  variant?: 'classic' | 'mockup';
}) {
  const { t } = useTranslation('operatorsBoard');
  const { t: tp } = useTranslation('operator');
  const { data: operators, isPending } = useLiveSnapshot((s) => s.operators);
  const [group, setGroup] = usePersistedState<OperatorGroupFilter>('callcenter_op_group', 'main', GROUPS);
  const [density, setDensity] = usePersistedState('dashboard_op_density', 'full', DENSITY);
  const [sort, setSort] = usePersistedState('tabOperatorSortMode', 'state', SORT);
  const [offlineView, setOfflineView] = usePersistedState('dashboard_offline_view', 'rows', OFFLINE_VIEW);

  const contactOf = useContactLookup();
  const { canEdit: canEditContacts } = useContactAccess();
  const [contactForm, setContactForm] = useState<MockupContactTarget | null>(null);
  const mockup = variant === 'mockup';
  // "Samaradorlik" on the portal cards = today's client ratings (PBX operator_baho), refreshed like legacy (~25 s).
  const today = businessToday();
  const { data: stats, isError: statsFailed } = useQuery({
    ...operatorStatsQuery({ from: today, to: today, scope: 'all' }),
    enabled: mockup,
    refetchInterval: 30_000,
  });
  const surveyOf = new Map<string, SurveyScore>(
    (stats?.operators ?? []).map((r) => [r.ext, { avg: r.surveyAvg, count: r.surveyCount }]),
  );
  const surveyAvailable = !statsFailed && (stats?.surveyAvailable ?? true);

  const all = operators ?? [];
  const visible = all.filter((o) => inGroup(o.extension, group));
  // The portal ranks the whole call center (legacy viewer), the dashboard ranks the open group.
  const rankMap = mockup ? leaderboard(all) : ranks(visible);
  const next = nextInLine(visible);
  const groups =
    sort === 'alpha'
      ? {
          talking: [...visible].filter((o) => o.presence !== 'offline').sort(byName),
          ready: [],
          offline: visible.filter((o) => o.presence === 'offline').sort(byName),
        }
      : groupForBoard(visible, next);
  const gridRef = useRef<HTMLDivElement>(null);
  const order = [...groups.talking, ...groups.ready, ...groups.offline].map((o) => o.extension).join(',');
  useFlip(gridRef, `${order}|${density}|${offlineView}`);
  const card = (op: LiveOperator) =>
    mockup ? (
      <OperatorMockupCard
        key={op.extension}
        op={op}
        rank={rankMap.get(op.extension)}
        survey={surveyOf.get(op.extension)}
        surveyAvailable={surveyAvailable}
        next={op.extension === next}
        contact={contactOf(op.call?.phone)}
        onContact={canEditContacts ? setContactForm : undefined}
      />
    ) : (
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
    );
  const count = (p: LiveOperator['presence'][]) => visible.filter((o) => p.includes(o.presence)).length;

  return (
    <section className="ob-panel" aria-label={t('title')}>
      <div className="ob-head">
        <div className="flex flex-wrap items-center gap-[18px]">
          <h3 className="ob-title">
            <Icon name="headphone" className="size-5 text-brand-soft" />
            {t('title')}
          </h3>
          <div className="ob-tabs" role="group">
            {GROUPS.map((g) => (
              <button key={g} type="button" className="ob-tab" aria-pressed={group === g} onClick={() => setGroup(g)}>
                {g !== 'all' && (
                  <span
                    className="dot"
                    style={{
                      background: g === 'main' ? 'var(--info)' : '#a855f7',
                      color: g === 'main' ? 'var(--info)' : '#a855f7',
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
          {!mockup && (
            <button
              type="button"
              className="ob-tool"
              aria-pressed={density === 'compact'}
              onClick={() => setDensity(density === 'compact' ? 'full' : 'compact')}
            >
              <Icon name="setting-4" className="size-3.5" />
              {t('density')}
            </button>
          )}
        </div>
      </div>

      <div ref={gridRef} className={cn('ob-grid', mockup ? 'mockup' : density === 'compact' && 'compact')}>
        {isPending && Array.from({ length: 4 }, (_, i) => <div key={i} className="ob-skeleton" />)}
        {!isPending && visible.length === 0 && <div className="ob-empty">{t('empty')}</div>}
        {groups.talking.map(card)}
        {groups.ready.length > 0 && <Divider color="#22c55e" label={t('readySep')} count={groups.ready.length} />}
        {groups.ready.map(card)}
        {groups.offline.length > 0 && (
          <Divider color="#ef4444" label={t('offlineSep')} count={groups.offline.length}>
            <button
              type="button"
              className="ob-div-toggle"
              onClick={() => setOfflineView(offlineView === 'rows' ? 'cards' : 'rows')}
            >
              <Icon name="setting-4" className="size-3" />
              {t(offlineView === 'rows' ? 'offlineFull' : 'offlineCompact')}
            </button>
          </Divider>
        )}
        {offlineView === 'cards'
          ? groups.offline.map(card)
          : groups.offline.length > 0 && (
              <div className="ob-offs">
                {groups.offline.map((op) => (
                  <div key={op.extension} className="row" data-ext={op.extension} data-flip-id={op.extension}>
                    <div className="av">{op.extension}</div>
                    <div className="who">
                      <strong>{op.name}</strong>
                      <small>Exten {op.extension}</small>
                    </div>
                    <span className={op.registered ? 'tag on' : 'tag'}>
                      {t(op.registered ? 'card.phoneOnline' : 'card.phoneOffline')}
                    </span>
                  </div>
                ))}
              </div>
            )}
      </div>
      {contactForm && (
        <ContactDialog
          open
          onOpenChange={(open) => !open && setContactForm(null)}
          contact={contactForm.contact}
          presetPhone={contactForm.phone}
        />
      )}
    </section>
  );
}
