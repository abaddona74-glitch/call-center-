/** Inclusive byte range, as in `Content-Range: bytes start-end/size`. */
export interface ByteRange {
  start: number;
  end: number;
}

export type RangeResult = { kind: 'full' } | { kind: 'partial'; range: ByteRange } | { kind: 'unsatisfiable' };

/**
 * Parses a single-range `Range: bytes=...` header (what <audio> and download managers send).
 * Multiple ranges and malformed headers are ignored (full response), as RFC 9110 allows.
 */
export function parseRangeHeader(header: string | undefined, size: number): RangeResult {
  if (!header) return { kind: 'full' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return { kind: 'full' };
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return { kind: 'full' };
  if (size <= 0) return { kind: 'unsatisfiable' };

  if (rawStart === '') {
    // Suffix range: last N bytes.
    const n = Number(rawEnd);
    if (!Number.isSafeInteger(n) || n === 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', range: { start: Math.max(0, size - n), end: size - 1 } };
  }

  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Number(rawEnd);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { kind: 'full' };
  if (start >= size) return { kind: 'unsatisfiable' };
  if (end < start) return { kind: 'full' };
  return { kind: 'partial', range: { start, end: Math.min(end, size - 1) } };
}
