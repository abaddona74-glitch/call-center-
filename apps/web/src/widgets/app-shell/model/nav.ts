import type { Role } from '@cc/shared';
import {
  CalendarClock,
  LayoutDashboard,
  type LucideIcon,
  MonitorSmartphone,
  Settings,
  ShieldBan,
  Users,
} from 'lucide-react';

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
  { to: '/clients', label: 'nav.clients', icon: Users, minRole: 'operator' },
  { to: '/settings', label: 'nav.settings', icon: Settings, minRole: 'admin' },
  { to: '/settings/blacklist', label: 'nav.blacklist', icon: ShieldBan, minRole: 'admin' },
  { to: '/settings/callbacks', label: 'nav.callbackSettings', icon: CalendarClock, minRole: 'admin' },
  { to: '/settings/agents', label: 'nav.agents', icon: MonitorSmartphone, minRole: 'admin' },
];
