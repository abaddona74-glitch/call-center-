/**
 * Call-history filtering, smart search and mapping to the API shape. Pure functions.
 */
import {
  type CallDirectionFilter,
  type CallListItem,
  type CallScope,
  type CallStatusFilter,
  digitsOnly,
} from '@cc/shared';
import type { AssembledCall } from '../../../pbx/calls/call-assembler.js';
import { isExtension, normalizeClientNumber, type PbxDialplan } from '../../../pbx/calls/dialplan.js';

export type ParsedSearch =
  | { kind: 'none' }
  | { kind: 'extension'; ext: string }
  | { kind: 'phone'; number: string }
  | { kind: 'partialPhone'; digits: string }
  | { kind: 'text'; text: string };

const PHONE_CHARS = /^[0-9+\-() ]+$/;

/**
 * Smart search: an extension ("101"), a phone in any format ("+998 (90) 123-45-67", "0901234567" →
 * exact match on the normalized number), 5–6 digits (part of a number), otherwise operator name text.
 */
export function parseSearch(raw: string | undefined, dp: PbxDialplan): ParsedSearch {
  const term = (raw ?? '').trim();
  if (!term) return { kind: 'none' };
  if (PHONE_CHARS.test(term)) {
    const digits = digitsOnly(term);
    if (isExtension(digits, dp) && digits === term) return { kind: 'extension', ext: digits };
    if (digits.length >= 7) {
      const number = normalizeClientNumber(digits, dp);
      if (number) return { kind: 'phone', number };
    }
    if (digits.length >= 3) return { kind: 'partialPhone', digits };
  }
  return { kind: 'text', text: term.toLocaleLowerCase() };
}

/** The operator took part: talked, dialled, transferred or received a transfer. */
export function involvesOperator(call: AssembledCall, ext: string): boolean {
  return (
    call.firstOperator === ext ||
    call.finalOperator === ext ||
    call.operators.includes(ext) ||
    call.transfers.some((t) => t.from === ext || t.to === ext)
  );
}

export function matchesSearch(call: AssembledCall, search: ParsedSearch, names: ReadonlyMap<string, string>): boolean {
  switch (search.kind) {
    case 'none':
      return true;
    case 'extension':
      return involvesOperator(call, search.ext);
    case 'phone':
      return call.clientNumber === search.number;
    case 'partialPhone':
      return (
        (call.clientNumber ?? '').includes(search.digits) || digitsOnly(call.clientNumberRaw).includes(search.digits)
      );
    case 'text': {
      const exts = new Set(
        [...call.operators, call.firstOperator, call.finalOperator].filter((x): x is string => Boolean(x)),
      );
      for (const ext of exts) if ((names.get(ext) ?? '').toLocaleLowerCase().includes(search.text)) return true;
      return (call.clientNumberRaw ?? '').toLocaleLowerCase().includes(search.text);
    }
  }
}

export interface CallFilter {
  direction?: CallDirectionFilter;
  status?: CallStatusFilter;
  operator?: string;
  scope: CallScope;
  search: ParsedSearch;
}

export function matchesFilter(call: AssembledCall, f: CallFilter, names: ReadonlyMap<string, string>): boolean {
  if (f.scope === 'working' && !call.inWorkingHours) return false;
  if (f.direction === 'transfer') {
    if (call.transfers.length === 0) return false;
  } else if (f.direction && call.direction !== f.direction) return false;
  if (f.status === 'missed') {
    if (call.status === 'answered') return false;
  } else if (f.status && call.status !== f.status) return false;
  if (f.operator && !involvesOperator(call, f.operator)) return false;
  return matchesSearch(call, f.search, names);
}

/** Newest first, then one page. */
export function paginate<T extends { startEpochMs: number; id: string }>(
  items: readonly T[],
  page: number,
  pageSize: number,
) {
  const sorted = [...items].sort((a, b) => b.startEpochMs - a.startEpochMs || b.id.localeCompare(a.id));
  return { total: sorted.length, items: sorted.slice((page - 1) * pageSize, page * pageSize) };
}

export function toCallListItem(
  call: AssembledCall,
  names: ReadonlyMap<string, string>,
  opts: { includeRecording: boolean; toIso: (wall: string) => string },
): CallListItem {
  const op = (ext: string) => ({ ext, name: names.get(ext) ?? null });
  const handler = call.finalOperator ?? call.firstOperator;
  return {
    id: call.id,
    startedAt: opts.toIso(call.start),
    date: call.date,
    time: call.time,
    direction: call.direction,
    status: call.status,
    transferred: call.transfers.length > 0,
    clientNumber: call.clientNumber,
    clientNumberRaw: call.clientNumberRaw,
    hiddenNumber: call.hiddenNumber,
    operator: handler ? op(handler) : null,
    operators: (call.operators.length ? call.operators : handler ? [handler] : []).map(op),
    transfers: call.transfers.map((t) => ({ ...t, at: opts.toIso(t.at) })),
    missedBy: call.missedBy,
    talkSec: call.talkSec,
    waitSec: call.waitSec,
    durationSec: call.durationSec,
    inWorkingHours: call.inWorkingHours,
    hangupBy: 'unknown',
    hasRecording: Boolean(call.recordingFile),
    recordingFile: opts.includeRecording ? call.recordingFile : null,
  };
}
