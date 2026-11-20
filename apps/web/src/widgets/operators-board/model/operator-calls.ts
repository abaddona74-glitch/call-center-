import type { LiveOperator } from '@cc/shared';
import type { TFunction } from 'i18next';
import type { CallListView } from '@/entities/call';

/**
 * What an operator card opens: today's calls of that operator (GET /cdr/calls?operator=…), split like the card's
 * numbers. "Missed" lists the calls that rang on this operator and were not taken (`operatorMiss` + `operator`),
 * the other tabs the calls they took part in. No tab counts: the live card numbers and the CDR list are counted
 * differently (transfers, unanswered dials), so the list's own total is the one shown.
 */
export function operatorCallsView(op: LiveOperator, t: TFunction<'operatorsBoard'>): CallListView {
  const operator = op.extension;
  return {
    id: `operator:${operator}`,
    title: `${op.name} (${operator})`,
    icon: 'headphone',
    tabs: [
      { id: 'all', label: t('detail.all'), filter: { direction: 'external', operator } },
      { id: 'inbound', label: t('card.inbound'), filter: { direction: 'inbound', operator } },
      { id: 'outbound', label: t('card.outbound'), filter: { direction: 'outbound', operator } },
      { id: 'missed', label: t('card.missed'), filter: { operatorMiss: 'any', operator } },
    ],
  };
}
