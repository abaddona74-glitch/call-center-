import type { OverviewTicketMetric, TicketStatus } from '@cc/shared';

/**
 * "Open the tickets behind this number": what a clickable number asks the overview page for (the page owns the
 * dialogs; widgets only describe the number). `region` overrides the page's region filter (a regions-table row);
 * `undefined` keeps it.
 */
export interface TicketListRequest {
  metric: OverviewTicketMetric;
  status?: TicketStatus;
  executive?: number;
  /** Name of the Mas'ul (dialog title). */
  executiveName?: string;
  region?: string | null;
  /** The number clicked (shown next to the title; the list total must equal it). */
  value: number;
}
