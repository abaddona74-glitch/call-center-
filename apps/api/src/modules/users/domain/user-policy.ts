import { type Permission, type Role, hasPermission } from '@cc/shared';

/**
 * Who may manage whom (permission-based; the role → permission map is ROLE_PERMISSIONS in @cc/shared):
 *  - managing accounts needs `users.manage` (today: superuser only);
 *  - only a superuser manages superuser accounts or grants the superuser role;
 *  - nobody removes, demotes or deactivates the last active superuser;
 *  - nobody deletes/deactivates themselves or changes their own role here;
 *  - "log in as" needs `impersonate`, never targets a superuser, never oneself, only active accounts.
 */
export interface Actor {
  id: number;
  role: Role;
  permissions?: readonly Permission[] | null;
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
  if (!hasPermission(actor, 'users.manage')) return false;
  return actor.role === 'superuser' || target.role !== 'superuser';
}

export function canGrantRole(actor: Actor, role: Role): boolean {
  if (!hasPermission(actor, 'users.manage')) return false;
  return actor.role === 'superuser' || role !== 'superuser';
}

export function canImpersonate(actor: Actor, target: TargetUser): boolean {
  return (
    hasPermission(actor, 'impersonate') && actor.id !== target.id && target.isActive && target.role !== 'superuser'
  );
}

export function checkCreate(actor: Actor, role: Role): PolicyResult {
  return canGrantRole(actor, role) ? OK : deny(`Your role cannot create ${role} accounts`);
}

export interface UserChange {
  role?: Role;
  isActive?: boolean;
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

export function checkImpersonate(actor: Actor, target: TargetUser): PolicyResult {
  if (!hasPermission(actor, 'impersonate')) return deny('Your role cannot log in as other users');
  if (actor.id === target.id) return deny('You cannot log in as yourself');
  if (target.role === 'superuser') return deny('Superuser accounts cannot be impersonated');
  if (!target.isActive) return deny('The account is disabled');
  return OK;
}
