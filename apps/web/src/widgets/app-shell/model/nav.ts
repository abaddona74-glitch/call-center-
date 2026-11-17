import type { Permission, RoleLevel } from '@cc/shared';
import { LayoutDashboard, type LucideIcon, Settings, UserRound } from 'lucide-react';

export interface NavItem {
  to: string;
  /** i18n key */
  label: string;
  icon: LucideIcon;
  /** The item shows when the user has any of these permissions (preferred). */
  permission?: Permission | Permission[];
  /** @deprecated minimum role level ('admin' = executive); use `permission`. */
  minRole?: RoleLevel;
}

/**
 * Sidebar navigation. Feature work adds one line per page here; the route itself
 * must still enforce the role in `beforeLoad` (hiding a link is not a permission check).
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, minRole: 'operator' },
  { to: '/settings', label: 'nav.settings', icon: Settings, permission: ['users.manage', 'sessions.manage', 'security.manage', 'audit.view'] },
  { to: '/profile', label: 'nav.profile', icon: UserRound, minRole: 'operator' },
];
