import type { LiveCounters, LiveOperator, OperatorToday } from '@cc/shared';
import type { TFunction } from 'i18next';
import type { CallListView } from '@/entities/call';

/** KPI cards whose details are a list of today's calls (the others show live state). */
export const CALL_CARDS = ['total', 'inbound', 'outbound', 'abandoned', 'missed', 'answered'] as const;
export type CallCard = (typeof CALL_CARDS)[number];

type T = TFunction<'liveCounters'>;

/** Operators with a non-zero `today` figure, most first: the chips that narrow the list to one operator. */
function chips(operators: readonly LiveOperator[], pick: (t: OperatorToday) => number): CallListView['operators'] {
  return operators
    .map((o) => ({ ext: o.extension, name: o.name, count: pick(o.today) }))
    .filter((o) => o.count > 0)
    .sort((a, b) => b.count - a.count || Number(a.ext) - Number(b.ext));
}

/**
 * What a KPI card opens: the calls it counts, split into the tabs its sub-line names. Filters follow the counter
 * definitions (LiveCountersSchema); the list comes from the CDR, the tab/chip counts from the live counters.
 */
export function callListView(card: CallCard, c: LiveCounters, operators: readonly LiveOperator[], t: T): CallListView {
  const title = t(card);
  switch (card) {
    case 'total':
      return {
        id: card,
        title,
        icon: 'chart',
        tabs: [
          { id: 'all', label: t('detail.all'), count: c.inbound + c.outbound, filter: { direction: 'external' } },
          { id: 'inbound', label: t('detail.inbound'), count: c.inbound, filter: { direction: 'inbound' } },
          { id: 'outbound', label: t('detail.outbound'), count: c.outbound, filter: { direction: 'outbound' } },
        ],
      };
    case 'inbound':
      return {
        id: card,
        title,
        icon: 'call-incoming',
        tabs: [
          { id: 'all', label: t('detail.all'), count: c.inbound, filter: { direction: 'inbound' } },
          {
            id: 'answered',
            label: t('detail.answered'),
            count: c.answered,
            filter: { direction: 'inbound', status: 'answered' },
          },
          {
            id: 'unanswered',
            label: t('unanswered'),
            count: c.unanswered,
            filter: { direction: 'inbound', status: 'missed' },
          },
        ],
      };
    case 'outbound':
      return {
        id: card,
        title,
        icon: 'arrow-up',
        tabs: [
          { id: 'all', label: t('detail.all'), count: c.outbound, filter: { direction: 'outbound' } },
          {
            id: 'connected',
            label: t('connected'),
            count: c.outboundAnswered,
            filter: { direction: 'outbound', status: 'answered' },
          },
          {
            id: 'notConnected',
            label: t('detail.notConnected'),
            count: Math.max(0, c.outbound - c.outboundAnswered),
            filter: { direction: 'outbound', status: 'missed' },
          },
        ],
        operators: chips(operators, (d) => d.outboundAttempts),
      };
    case 'abandoned':
      return {
        id: card,
        title,
        icon: 'timer',
        tabs: [
          { id: 'abandoned', label: t('abandoned'), count: c.abandoned, filter: { status: 'abandoned' } },
          { id: 'ivr', label: t('ivrOnly'), count: c.ivrOnly, filter: { status: 'ivr' } },
        ],
        note: t('detail.abandonedNote'),
      };
    case 'missed':
      return {
        id: card,
        title,
        icon: 'call-remove',
        tabs: [
          { id: 'all', label: t('detail.all'), count: c.operatorMissed, filter: { operatorMiss: 'any' } },
          {
            id: 'noAnswer',
            label: t('detail.noAnswer'),
            count: c.operatorMissedNoAnswer,
            filter: { operatorMiss: 'no_answer' },
          },
          {
            id: 'rejected',
            label: t('detail.rejected'),
            count: c.operatorMissedRejected,
            filter: { operatorMiss: 'rejected' },
          },
        ],
        operators: chips(operators, (d) => d.missed),
        showMissedBy: true,
        operatorNames: Object.fromEntries(operators.map((o) => [o.extension, o.name])),
        note: t('detail.missedNote'),
      };
    case 'answered':
      return {
        id: card,
        title,
        icon: 'tick-circle',
        tabs: [
          {
            id: 'answered',
            label: t('answered'),
            count: c.answered,
            filter: { direction: 'inbound', status: 'answered' },
          },
        ],
        operators: chips(operators, (d) => d.answered),
        note: t('detail.hangups', {
          client: c.clientHangups,
          operator: c.operatorHangups,
          unknown: c.unknownHangups,
        }),
      };
  }
}
