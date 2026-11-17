/** The server requires 3..500 characters (CloseCallbackRequestSchema). */
export function isValidReason(reason: string): boolean {
  const r = reason.trim();
  return r.length >= 3 && r.length <= 500;
}
