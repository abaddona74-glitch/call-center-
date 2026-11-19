import type { TicketListParams, TicketListRequest } from '@/entities/overview';

/**
 * The filters of the tickets behind a clicked number: the page's period and region (a regions-table cell brings its
 * own region), the metric and its parameter (status / Mas'ul) — the same filters the number was counted with.
 */
export function ticketListParams(
  request: TicketListRequest,
  state: { from: string; to: string; region: string | null },
): Omit<TicketListParams, 'page' | 'pageSize' | 'search'> {
  const region = request.region !== undefined ? request.region : state.region;
  return {
    from: state.from,
    to: state.to,
    metric: request.metric,
    ...(region ? { region } : {}),
    ...(request.status ? { status: request.status } : {}),
    ...(request.executive !== undefined ? { executive: request.executive } : {}),
  };
}

/** A stable id per number, so the dialog starts over (page 1, no search) when another one opens. */
export function listId(params: object): string {
  return JSON.stringify(params);
}
