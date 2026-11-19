/**
 * Clock offset server − browser (ms), so live stopwatches do not depend on the PC clock. Every live snapshot request
 * (the monitor's, the situation board's) records it from the server time in its answer.
 */
let offset = 0;

/** Record the server time of a response; `started` = when the request was sent (Date.now()). */
export function noteServerTime(serverTime: string, started: number, received = Date.now()): void {
  const server = Date.parse(serverTime);
  if (Number.isFinite(server)) offset = server - (started + (received - started) / 2);
}

export function serverClockOffset(): number {
  return offset;
}
