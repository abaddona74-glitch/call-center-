/**
 * Asterisk Manager Interface wire format (plain text over TCP):
 *
 *   Action: Ping\r\n
 *   ActionID: 7\r\n
 *   \r\n
 *
 * Messages are blocks of `Key: Value` lines terminated by an empty line. The server starts with
 * a banner line (`Asterisk Call Manager/5.0.1`). Keys are case-insensitive; we lowercase them
 * (`evt.calleridnum`), values keep their case.
 */

/** One AMI message (response or event) with lowercased keys. Repeated keys are joined with "\n". */
export type AmiMessage = Record<string, string>;

export type AmiFieldValue = string | number | boolean | undefined | null;

export class AmiHeaderInjectionError extends Error {
  constructor(field: string) {
    super(`AMI field "${field}" contains a forbidden character (CR/LF/NUL)`);
    this.name = 'AmiHeaderInjectionError';
  }
}

const SAFE_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
// CR/LF would start a new header (or end the message and inject a second action). NUL is never valid.
const FORBIDDEN_VALUE_CHARS = /[\r\n\0]/;

/** Throws if the value could break out of its header line. */
export function assertSafeAmiValue(field: string, value: string): void {
  if (FORBIDDEN_VALUE_CHARS.test(value)) throw new AmiHeaderInjectionError(field);
}

/** Serialize an action. `undefined`/`null` fields are omitted. Throws on unsafe keys/values. */
export function serializeAction(action: string, actionId: string, fields: Record<string, AmiFieldValue> = {}): string {
  if (!SAFE_KEY.test(action)) throw new AmiHeaderInjectionError('Action');
  assertSafeAmiValue('ActionID', actionId);
  const lines = [`Action: ${action}`, `ActionID: ${actionId}`];
  for (const [key, raw] of Object.entries(fields)) {
    if (raw === undefined || raw === null) continue;
    if (!SAFE_KEY.test(key) || key.toLowerCase() === 'action' || key.toLowerCase() === 'actionid') {
      throw new AmiHeaderInjectionError(key);
    }
    const value = typeof raw === 'boolean' ? (raw ? 'true' : 'false') : String(raw);
    assertSafeAmiValue(key, value);
    lines.push(`${key}: ${value}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

/**
 * Incremental parser: feed raw socket text, get complete messages.
 * Tolerates bare "\n" line endings (some proxies) and limits the buffered size.
 */
export class AmiParser {
  private buffer = '';
  private bannerSeen = false;
  banner: string | null = null;

  constructor(private readonly maxBufferBytes = 1_048_576) {}

  push(chunk: string): AmiMessage[] {
    this.buffer += chunk;
    if (this.buffer.length > this.maxBufferBytes) {
      this.buffer = '';
      throw new Error('AMI message exceeds the maximum size');
    }

    if (!this.bannerSeen) {
      const nl = this.buffer.indexOf('\n');
      if (nl === -1) return [];
      this.banner = this.buffer.slice(0, nl).replace(/\r$/, '');
      this.buffer = this.buffer.slice(nl + 1);
      this.bannerSeen = true;
    }

    const messages: AmiMessage[] = [];
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.buffer);
      if (!match) break;
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const msg = parseBlock(block);
      if (msg) messages.push(msg);
    }
    return messages;
  }

  reset(): void {
    this.buffer = '';
    this.bannerSeen = false;
    this.banner = null;
  }
}

function parseBlock(block: string): AmiMessage | null {
  const msg: AmiMessage = {};
  let any = false;
  for (const line of block.split(/\r?\n/)) {
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue; // free-form output lines are not used by this client
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    msg[key] = key in msg ? `${msg[key]}\n${value}` : value;
    any = true;
  }
  return any ? msg : null;
}

/** "00:01:05" / "1:05" / "65" -> seconds. */
export function parseAmiDuration(raw: string | undefined): number {
  if (!raw) return 0;
  const parts = raw.split(':').map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
