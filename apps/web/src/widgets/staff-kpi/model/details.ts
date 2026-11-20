import type { KpiExecutiveTicketMetric, KpiOperatorCallMetric, KpiOperatorTicketMetric } from '@cc/shared';

/**
 * "Open the records behind this number": what a clickable KPI number asks the page for (the page owns the dialogs —
 * the overview dashboard's CallListDialog / TicketListDialog — and the tables only describe the number).
 */
export type KpiDetailRequest =
  | {
      kind: 'calls';
      ext: string;
      /** Operator name (dialog title). */
      name: string;
      metric: KpiOperatorCallMetric;
      /** The number clicked; none for times and averages (their list is the calls they are over). */
      value?: number;
    }
  | { kind: 'operatorTickets'; ext: string; name: string; metric: KpiOperatorTicketMetric; value: number }
  | {
      kind: 'executiveTickets';
      userId: number;
      name: string;
      /** null = the person's whole row; `code` null = tickets without a region. */
      region: { code: string | null; name: string } | null;
      metric: KpiExecutiveTicketMetric;
      value: number;
    };

/** The handled share → the number of handled calls it is made of (rate = handled / analysed × 100, 2 decimals). */
export function handledCount(rate: number | null, analysed: number): number {
  return rate === null ? 0 : Math.round((rate * analysed) / 100);
}
