import type { Role } from '@cc/shared';
import { ChartColumn, History, LayoutDashboard, type LucideIcon, Settings } from 'lucide-react';

export interface NavItem {
  to: string;
  /** i18n key */
  label: string;
  icon: LucideIcon;
  /** Minimum role that sees the item. */
  minRole: Role;
}

/**
 * Sidebar navigation. Feature work adds one line per page here; the route itself
 * must still enforce the role in `beforeLoad` (hiding a link is not a permission check).
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, minRole: 'operator' },
  { to: '/history', label: 'nav.history', icon: History, minRole: 'admin' },
  { to: '/statistics', label: 'nav.statistics', icon: ChartColumn, minRole: 'admin' },
  { to: '/settings', label: 'nav.settings', icon: Settings, minRole: 'admin' },
];
