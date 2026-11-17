import { normalizeUzPhone } from '@cc/shared';

/**
 * Channel name parsing for Asterisk 13+ (chan_sip / PJSIP, FreePBX/Issabel dialplan).
 *   SIP/101-0000002a                 -> operator phone (peer name matches the operator pattern)
 *   SIP/712020159-00000031           -> external (trunk) leg
 *   Local/101@from-queue-00000003;1  -> local (queue member) leg of extension 101
 */
export type ChannelKind = 'operator' | 'local' | 'external';

export interface ParsedChannel {
  kind: ChannelKind;
  /** Operator extension for operator channels and for Local/<ext>@... legs. */
  ext: string | null;
}

const DEVICE_CHANNEL = /^(SIP|PJSIP|IAX2|DAHDI)\/(.+)-[0-9a-f]+$/i;
const LOCAL_CHANNEL = /^Local\/([^@]+)@([^;]+?)-[0-9a-f]+;[12]$/i;
const DEVICE = /^(SIP|PJSIP|IAX2)\/([^/-]+)$/i;

export function parseChannel(name: string, operatorExt: RegExp): ParsedChannel {
  const device = DEVICE_CHANNEL.exec(name);
  if (device) {
    const peer = device[2];
    return operatorExt.test(peer) ? { kind: 'operator', ext: peer } : { kind: 'external', ext: null };
  }
  const local = LOCAL_CHANNEL.exec(name);
  if (local) return { kind: 'local', ext: operatorExt.test(local[1]) ? local[1] : null };
  return { kind: 'external', ext: null };
}

/** "SIP/101" (device / interface without the channel suffix) -> "101". */
export function extFromDevice(device: string | undefined, operatorExt: RegExp): string | null {
  if (!device) return null;
  const m = DEVICE.exec(device.trim());
  return m && operatorExt.test(m[2]) ? m[2] : null;
}

/**
 * Queue member identity in QueueMember and Agent events: Interface "Local/101@from-queue/n",
 * StateInterface "SIP/101", MemberName "Operator 101" / "101".
 */
export function extFromMember(evt: Record<string, string>, operatorExt: RegExp): string | null {
  for (const raw of [evt.interface, evt.location, evt.stateinterface, evt.membername, evt.name]) {
    if (!raw) continue;
    const local = /^Local\/([^@]+)@/i.exec(raw);
    if (local && operatorExt.test(local[1])) return local[1];
    const dev = extFromDevice(raw, operatorExt);
    if (dev) return dev;
    if (operatorExt.test(raw.trim())) return raw.trim();
    const tail = /(\d{2,6})\)?$/.exec(raw.trim());
    if (tail && operatorExt.test(tail[1])) return tail[1];
  }
  return null;
}

const HIDDEN = /^(|<unknown>|unknown|anonymous|restricted|private|unavailable)$/i;

/** Citizen number from a caller-id field, normalized; null for hidden/internal/garbage. Never parses channel names (B43). */
export function phoneOf(raw: string | undefined, operatorExt: RegExp): string | null {
  const value = (raw ?? '').trim();
  if (HIDDEN.test(value) || operatorExt.test(value)) return null;
  return normalizeUzPhone(value);
}

/** Dialed number from a Dial() string: "trunk/901234567", "901234567@trunk", "SIP/712020159/00998901234567". */
export function phoneFromDialString(dialString: string | undefined, operatorExt: RegExp): string | null {
  if (!dialString) return null;
  const runs = dialString.match(/\+?\d{7,}/g);
  if (!runs?.length) return null;
  let digits = runs[runs.length - 1].replace(/^\+/, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return phoneOf(digits, operatorExt);
}

/** Display name from CallerIDName, ignoring placeholders and numbers. */
export function callerNameOf(name: string | undefined, num: string | undefined): string | null {
  const v = (name ?? '').trim();
  if (!v || HIDDEN.test(v) || v === (num ?? '').trim() || /^[\d\s+()-]+$/.test(v)) return null;
  return v.slice(0, 80);
}

/** Asterisk ChannelState: 0 Down, 4 Ring (off-hook, dialing), 5 Ringing, 6 Up. */
export type ChannelState = 'down' | 'ring' | 'ringing' | 'up';

export function channelStateOf(code: string | undefined, desc?: string): ChannelState {
  switch (code) {
    case '6':
      return 'up';
    case '5':
      return 'ringing';
    case '4':
    case '3':
    case '7':
      return 'ring';
    default:
      if (desc && /^up$/i.test(desc)) return 'up';
      if (desc && /^ringing$/i.test(desc)) return 'ringing';
      return 'down';
  }
}
