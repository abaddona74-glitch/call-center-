import { type Role, digitsOnly, normalizeUzPhone, telephonyAccess } from '@cc/shared';

/**
 * Who may do what with live calls (pure rules, unit-tested):
 *  - admin/superuser: any operator / any call (as in legacy);
 *  - operator: only their own extension and the calls they are on.
 */
export interface Actor {
  role: Role;
  extension: string | null;
}

export type Decision<T> = { ok: true; value: T } | { ok: false; status: 400 | 403; message: string };

const deny = (message: string): Decision<never> => ({ ok: false, status: 403, message });
const bad = (message: string): Decision<never> => ({ ok: false, status: 400, message });

/** Extension the action applies to: the requested one for admins, the own one for operators. */
export function resolveExtension(actor: Actor, requested: string | undefined, operatorExt: RegExp): Decision<string> {
  if (telephonyAccess(actor.role).manageAll) {
    const ext = requested ?? actor.extension;
    if (!ext) return bad('extension is required');
    if (!operatorExt.test(ext)) return bad('Not an operator extension');
    return { ok: true, value: ext };
  }
  if (!actor.extension) return deny('Your account has no extension');
  if (requested !== undefined && requested !== actor.extension)
    return deny('Operators may act only on their own extension');
  return { ok: true, value: actor.extension };
}

/** May the actor transfer / hang up this call? Operators: only calls they are talking on or dialing. */
export function canControlCall(actor: Actor, call: { extension: string | null }): boolean {
  if (telephonyAccess(actor.role).manageAll) return true;
  return actor.extension !== null && call.extension === actor.extension;
}

/**
 * Click-to-call target. Internal: an operator extension. External: normalized to the national
 * 9-digit form and matched against the allow-list (no international, no premium/short numbers).
 */
export function resolveDialTarget(
  raw: string,
  allowed: RegExp[],
  operatorExt: RegExp,
): Decision<{ dial: string; phone: string | null }> {
  const digits = digitsOnly(raw);
  if (operatorExt.test(digits) && digits === raw.trim()) return { ok: true, value: { dial: digits, phone: null } };
  const trimmed = raw.trim();
  if (trimmed.startsWith('+') && !trimmed.startsWith('+998')) return bad('International numbers are not allowed');
  if (digits.startsWith('00') || digits.startsWith('810')) return bad('International numbers are not allowed');
  const national = normalizeUzPhone(digits);
  if (!national || national.length !== 9) return bad('Enter a 9-digit Uzbek number');
  if (!allowed.some((re) => re.test(national))) return bad('This number is not allowed for click-to-call');
  return { ok: true, value: { dial: national, phone: national } };
}

/** Transfer target: another operator extension. */
export function validateTransferTarget(target: string, current: string | null, operatorExt: RegExp): Decision<string> {
  if (!operatorExt.test(target)) return bad('Transfer target must be an operator extension');
  if (target === current) return bad('The call is already on this extension');
  return { ok: true, value: target };
}
