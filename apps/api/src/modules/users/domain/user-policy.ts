import type { Role } from '@cc/shared';

/**
 * Who may manage whom (fixes the legacy RBAC where any admin could create superusers):
 *  - superuser manages everyone (including other superusers);
 *  - admin manages only operators and may only grant the operator role;
 *  - operators manage nobody;
 *  - nobody removes, demotes or deactivates the last active superuser;
 *  - nobody deletes/deactivates themselves or changes their own role here.
 */
export interface Actor {
  id: number;
  role: Role;
}

export interface TargetUser {
  id: number;
  role: Role;
  isActive: boolean;
}

export type PolicyResult = { ok: true } | { ok: false; status: 403 | 409; reason: string };

const OK: PolicyResult = { ok: true };
const deny = (reason: string): PolicyResult => ({ ok: false, status: 403, reason });
const conflict = (reason: string): PolicyResult => ({ ok: false, status: 409, reason });

export function canManage(actor: Actor, target: Pick<TargetUser, 'role'>): boolean {
  if (actor.role === 'superuser') return true;
  if (actor.role === 'admin') return target.role === 'operator';
  return false;
}

export function canGrantRole(actor: Actor, role: Role): boolean {
  if (actor.role === 'superuser') return true;
  if (actor.role === 'admin') return role === 'operator';
  return false;
}

export function checkCreate(actor: Actor, role: Role): PolicyResult {
  return canGrantRole(actor, role) ? OK : deny(`Your role cannot create ${role} accounts`);
}

export interface UserChange {
  role?: Role;
  isActive?: boolean;
  /** Any other field (username, email, extension, group). */
  other?: boolean;
}

/**
 * @param activeSuperusers number of active superusers right now (including the target if it is one)
 */
export function checkUpdate(
  actor: Actor,
  target: TargetUser,
  change: UserChange,
  activeSuperusers: number,
): PolicyResult {
  const self = actor.id === target.id;
  // Admins editing themselves go through the profile, not the users admin.
  if (!canManage(actor, target)) return deny('You cannot manage this account');
  if (change.role !== undefined && change.role !== target.role) {
    if (self) return deny('You cannot change your own role');
    if (!canGrantRole(actor, change.role)) return deny(`Your role cannot grant ${change.role}`);
  }
  if (change.isActive === false && target.isActive && self) return deny('You cannot deactivate yourself');
  const losesSuperuser =
    target.role === 'superuser' &&
    target.isActive &&
    ((change.role !== undefined && change.role !== 'superuser') || change.isActive === false);
  if (losesSuperuser && activeSuperusers <= 1) return conflict('The last superuser cannot be demoted or deactivated');
  return OK;
}

export function checkDelete(actor: Actor, target: TargetUser, activeSuperusers: number): PolicyResult {
  if (actor.id === target.id) return deny('You cannot delete yourself');
  if (!canManage(actor, target)) return deny('You cannot manage this account');
  if (target.role === 'superuser' && target.isActive && activeSuperusers <= 1) {
    return conflict('The last superuser cannot be deleted');
  }
  return OK;
}

/** Reset another user's password / revoke their sessions or passkeys. */
export function checkCredentialsAdmin(actor: Actor, target: Pick<TargetUser, 'id' | 'role'>): PolicyResult {
  if (actor.id === target.id) return deny('Use your profile to change your own password');
  return canManage(actor, target) ? OK : deny('You cannot manage this account');
}
