import type { CallHistoryResponse } from '@cc/shared';
import type { QueryKey, UseQueryOptions } from '@tanstack/react-query';
import type { CallHistoryParams } from '../api/call.queries';

/** What a call list can be narrowed by (GET /cdr/calls). */
export type CallListFilter = Pick<CallHistoryParams, 'direction' | 'status' | 'operatorMiss' | 'operator'>;

/**
 * A list of today's calls that a dashboard KPI card opens: its title, the tabs (sub-filters) and, optionally,
 * per-operator chips that narrow the list to one operator.
 */
export interface CallListView {
  /** Stable per card: the dialog starts over (first tab, page 1, no search) when another view opens. */
  id: string;
  title: string;
  /** The number the list explains, shown next to the title (the overview dashboard). */
  value?: number;
  /** Iconsax icon name of the header. */
  icon: string;
  /** One or more; a switch is shown for two or more. */
  tabs: { id: string; label: string; count?: number; filter: CallListFilter }[];
  operators?: { ext: string; name: string; count: number }[];
  /** Shows who missed each call (the "O'tkazib yuborilgan" card). */
  showMissedBy?: boolean;
  /** Extension → name, for the "missed by" column. */
  operatorNames?: Readonly<Record<string, string>>;
  /** One line under the title (what the numbers mean). */
  note?: string;
  /** Header subtitle; default: today's calls. */
  subtitle?: string;
  /** Show the date column (lists longer than a day). */
  showDate?: boolean;
  /**
   * Where a tab's page comes from; default: GET /cdr/calls for today with the tab's `filter` (the dashboard). The
   * overview dashboard passes its own read-only lists (`/overview/calls/list`, `/overview/quality/list`).
   */
  list?: (tabId: string, p: { page: number; pageSize: number; search?: string }) => CallListQueryOptions;
}

/** Query options of a call list page (any query key). */
export type CallListQueryOptions = UseQueryOptions<CallHistoryResponse, Error, CallHistoryResponse, QueryKey>;

/** `queryOptions(...)` of a call list with its own typed key → the dialog's options type. */
export function asCallListQuery(options: { queryKey: QueryKey }): CallListQueryOptions {
  return options as unknown as CallListQueryOptions;
}

/**
 * The dialog that shows a CallListView (widgets/call-history-table implements it; the dashboard page hands it to the
 * KPI cards, so the cards stay free of the calls table). Closed while `view` is null.
 */
export interface CallListDialogProps {
  view: CallListView | null;
  onClose: () => void;
}
